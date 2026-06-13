/**
 * Fathom API ingest — STEP 2 of the Recall -> Fathom migration.
 *
 * Takes a finished Fathom meeting (pulled from the Fathom REST API) and files it
 * into the SAME store a Recall capture uses (recall_meetings + recall_meeting_leads),
 * so it flows through the existing review / summary / share pipeline unchanged.
 *
 * ADDITIVE + SAFE BY DESIGN:
 *   - New file; nothing calls it yet. Recall path is untouched.
 *   - The WRITE path is gated behind the FATHOM_INGEST_ENABLED kill switch (default OFF).
 *   - dryRun mode does everything EXCEPT write — fetch, normalise, match the lead — and
 *     returns the would-be result, so we can verify before any data changes.
 *   - Every row is tagged source='fathom-api' (bot_id prefix `manual:fathom-api:`), so a
 *     shadow ingest is always identifiable and reversible in one DELETE (leads cascade).
 *
 * This is the single-meeting core. The back-to-back splitter and the automatic trigger
 * (webhook/poll) are separate later slices.
 */

const clientService = require('./clientService');
const { findLeadByEmail } = require('./inboundEmailService');
const { insertImportedMeeting, addMeetingLead } = require('./recallWebhookDb');
const { normalizeEmail } = require('./recallImportService');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'fathom_ingest');

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';
const SOURCE = 'fathom-api';
const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

/** The write path only runs when this is explicitly enabled. */
function ingestEnabled() {
  return String(process.env.FATHOM_INGEST_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * Fetch one finished meeting from the Fathom API by recording_id.
 * (Fathom has no get-by-id endpoint, so we pull a bounded recent window and pick it out.)
 */
async function fetchFathomMeeting(recordingId, apiKey, { createdAfter, createdBefore } = {}) {
  const u = new URL(`${FATHOM_API_BASE}/meetings`);
  u.searchParams.set('limit', '50');
  u.searchParams.set('include_transcript', 'true');
  if (createdAfter) u.searchParams.set('created_after', createdAfter);
  if (createdBefore) u.searchParams.set('created_before', createdBefore);

  const res = await fetch(u.toString(), {
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    return { ok: false, error: `Fathom API ${res.status} ${res.statusText}` };
  }
  const data = await res.json();
  const items = data.items || data.meetings || data.data || [];
  const meeting = items.find((m) => String(m.recording_id) === String(recordingId));
  if (!meeting) {
    return { ok: false, error: `recording ${recordingId} not in fetched window (${items.length} meetings seen)` };
  }
  return { ok: true, meeting };
}

/**
 * Fathom transcript array -> canonical "[HH:MM:SS] Speaker: text" lines.
 * Matches the format the existing Fathom code already produces (smartFollowUpService),
 * and keeps the per-line timestamp the future back-to-back splitter needs.
 */
function normalizeFathomApiTranscript(meeting) {
  const segs = Array.isArray(meeting.transcript) ? meeting.transcript : [];
  return segs
    .map((u) => {
      if (typeof u === 'string') return u;
      if (!u || typeof u !== 'object') return '';
      const speaker = (typeof u.speaker === 'string')
        ? u.speaker
        : (u.speaker?.display_name || u.speaker?.name || 'Speaker');
      let text = u.text ?? u.content ?? u.value;
      if (typeof text !== 'string') {
        text = (text && typeof text === 'object') ? (text.text ?? text.content ?? '') : '';
      }
      const ts = (typeof u.timestamp === 'string') ? u.timestamp : '';
      const line = `${ts ? `[${ts}] ` : ''}${speaker}: ${text}`.trim();
      return line;
    })
    .filter(Boolean)
    .join('\n');
}

/** Title + start time + duration (prefers the real recording window). */
function extractMeta(meeting) {
  const title = meeting.title || meeting.meeting_title || 'Fathom meeting';
  const start = meeting.recording_start_time || meeting.scheduled_start_time || meeting.created_at || null;
  const end = meeting.recording_end_time || meeting.scheduled_end_time || null;
  let durationSeconds = null;
  if (start && end) {
    const d = (Date.parse(end) - Date.parse(start)) / 1000;
    if (Number.isFinite(d) && d > 0) durationSeconds = Math.round(d);
  }
  return { title, meetingStart: start, durationSeconds };
}

/** Invitee emails — external (the leads) first, de-duped. */
function extractLeadEmails(meeting) {
  const inv = Array.isArray(meeting.calendar_invitees) ? meeting.calendar_invitees : [];
  const external = [...new Set(inv.filter((p) => p && p.is_external && p.email).map((p) => p.email))];
  const internal = [...new Set(inv.filter((p) => p && !p.is_external && p.email).map((p) => p.email))];
  return { external, internal };
}

/** Match external invitee emails to Airtable leads (read-only lookup). */
async function matchLeads(coach, externalEmails) {
  const matched = [];
  const unmatched = [];
  for (const raw of externalEmails) {
    const clean = normalizeEmail(raw);
    if (!clean) { unmatched.push(raw); continue; }
    try {
      const lead = await findLeadByEmail(coach, clean);
      if (lead?.id) {
        matched.push({
          email: clean,
          leadId: lead.id,
          name: [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || clean,
        });
      } else {
        unmatched.push(clean);
      }
    } catch (e) {
      log.warn(`lead lookup failed for ${clean}: ${e.message}`);
      unmatched.push(clean);
    }
  }
  return { matched, unmatched };
}

/**
 * Ingest one Fathom meeting.
 *
 * @param {object} opts
 * @param {string} opts.recordingId        Fathom recording_id (required)
 * @param {string} [opts.coachClientId]    tenant scope (default Guy-Wilson)
 * @param {boolean} [opts.dryRun]          if true: fetch + normalise + match lead, but DO NOT write
 * @param {string} [opts.createdAfter]     ISO bound to find the meeting in the list call
 * @param {string} [opts.createdBefore]    ISO bound
 * @returns {Promise<object>} { ok, dryRun?, plan, transcriptText?, meetingId? }
 */
async function ingestFathomMeeting(opts = {}) {
  const { recordingId, coachClientId = DEFAULT_COACH_CLIENT_ID, dryRun = false, createdAfter, createdBefore } = opts;
  if (!recordingId) return { ok: false, error: 'recordingId is required' };

  const coach = await clientService.getClientById(coachClientId);
  if (!coach) return { ok: false, error: `coach client ${coachClientId} not found` };
  if (!coach.fathomApiKey) return { ok: false, error: `no Fathom API key for ${coachClientId}` };

  const f = await fetchFathomMeeting(recordingId, coach.fathomApiKey, { createdAfter, createdBefore });
  if (!f.ok) return f;
  const meeting = f.meeting;

  const transcriptText = normalizeFathomApiTranscript(meeting);
  const meta = extractMeta(meeting);
  const emails = extractLeadEmails(meeting);
  const { matched, unmatched } = await matchLeads(coach, emails.external);

  const plan = {
    recordingId: String(meeting.recording_id),
    title: meta.title,
    meetingStart: meta.meetingStart,
    durationSeconds: meta.durationSeconds,
    transcriptLines: transcriptText ? transcriptText.split('\n').length : 0,
    transcriptChars: transcriptText.length,
    externalEmails: emails.external,
    matchedLeads: matched,
    unmatchedEmails: unmatched,
    source: SOURCE,
  };

  if (dryRun) {
    return { ok: true, dryRun: true, plan, transcriptText };
  }

  // ---- WRITE PATH (gated) -------------------------------------------------
  if (!ingestEnabled()) {
    return { ok: false, error: 'FATHOM_INGEST_ENABLED is not true — write path is disabled', plan };
  }

  const ins = await insertImportedMeeting({
    title: meta.title,
    source: SOURCE,
    transcriptText,
    meetingStart: meta.meetingStart,
    durationSeconds: meta.durationSeconds,
  });
  if (!ins.ok) return { ok: false, error: ins.error || 'insert failed', plan };

  const meetingId = ins.meeting_id;
  const linkedLeads = [];
  for (const m of matched) {
    try {
      await addMeetingLead(meetingId, m.leadId, coachClientId, 'fathom-api');
      linkedLeads.push(m);
    } catch (e) {
      log.warn(`failed to link lead ${m.leadId} to meeting ${meetingId}: ${e.message}`);
    }
  }

  log.info(`ingested fathom meeting rec=${plan.recordingId} -> meeting_id=${meetingId} (${plan.transcriptLines} lines, ${linkedLeads.length} leads)`);
  return { ok: true, meetingId, botId: ins.bot_id, plan, linkedLeads };
}

module.exports = {
  ingestFathomMeeting,
  fetchFathomMeeting,
  normalizeFathomApiTranscript,
  extractMeta,
  extractLeadEmails,
  matchLeads,
  ingestEnabled,
  SOURCE,
};
