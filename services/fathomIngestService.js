/**
 * Fathom API ingest — STEP 2 of the Recall -> Fathom migration.
 *
 * Takes a finished Fathom meeting (pulled from the Fathom REST API) and files it into the
 * SAME store a Recall capture uses (recall_meetings + recall_meeting_leads), so it flows
 * through the existing review / summary / share / "I had a meeting with X" lookup unchanged.
 *
 * Split-aware: it checks the coach's calendar for the recording window. If the recording
 * spans MORE THAN ONE real meeting (a back-to-back), it runs the speaker-transition splitter
 * (services/fathomSplitService) and files ONE correctly-named entry per meeting, each linked
 * to that meeting's lead. A single meeting is filed as-is.
 *
 * ⚠ NAMING: "recall_*" = the source-agnostic transcript store, NOT the Recall.ai service.
 * See docs/wingguy.md → "Terminology trap — recall_ ≠ Recall.ai".
 *
 * ADDITIVE + SAFE:
 *   - New file; nothing calls it yet. Recall path untouched.
 *   - WRITE path gated behind FATHOM_INGEST_ENABLED (default OFF).
 *   - dryRun does everything EXCEPT write (fetch, split, normalise, match leads).
 *   - Rows tagged source='fathom-api' (bot_id `manual:fathom-api:`) — identifiable + reversible
 *     in one DELETE (leads cascade).
 *   - Calendar read failure degrades gracefully to "single meeting" (files the blob rather
 *     than crashing); back-to-backs only split when the calendar is readable.
 */

const clientService = require('./clientService');
const { findLeadByEmail, findLeadByName, learnEmailForLead } = require('./inboundEmailService');
const { insertImportedMeeting, addMeetingLead } = require('./recallWebhookDb');
const { normalizeEmail } = require('./recallImportService');
const { splitFathomMeeting, eventLeadSpeaks } = require('./fathomSplitService');
const { extractMeetingUrl, isCoachAttending } = require('./recallAutoJoinService');
const { getMeetingsInWindow } = require('./calendarProvider');
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
 * and keeps the per-line timestamp the back-to-back splitter needs.
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
      return `${ts ? `[${ts}] ` : ''}${speaker}: ${text}`.trim();
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

/**
 * Invitee emails — external (the leads) first, de-duped. Also returns an email→display-name map
 * for the external invitees, so the single-meeting path can fall back to a NAME match (and
 * self-heal the email) when the booking email isn't on any lead yet.
 */
function extractLeadEmails(meeting) {
  const inv = Array.isArray(meeting.calendar_invitees) ? meeting.calendar_invitees : [];
  const ext = inv.filter((p) => p && p.is_external);
  const external = [...new Set(ext.filter((p) => p.email).map((p) => p.email))];
  const internal = [...new Set(inv.filter((p) => p && !p.is_external && p.email).map((p) => p.email))];
  const externalNames = {};
  for (const p of ext) {
    const e = (p.email || '').toLowerCase().trim();
    if (e && p.name && !externalNames[e]) externalNames[e] = String(p.name).trim();
  }
  return { external, internal, externalNames };
}

/** Match a list of emails to Airtable leads (read-only lookup). */
async function matchLeads(coach, emails) {
  const matched = [];
  const unmatched = [];
  for (const raw of emails) {
    const clean = normalizeEmail(raw);
    if (!clean) { unmatched.push(raw); continue; }
    try {
      const lead = await findLeadByEmail(coach, clean);
      if (lead?.id) {
        matched.push({
          email: clean,
          leadId: lead.id,
          name: [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || clean,
          via: 'email',
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
 * Resolve the lead for one split segment: try the calendar attendee emails first, then fall
 * back to matching the spoken lead NAME against Airtable (the back-to-back leads often have no
 * email in Fathom — only a spoken name — so name-fallback is load-bearing here).
 */
async function matchLeadsForSegment(coach, seg) {
  const byEmail = await matchLeads(coach, seg.leadEmails || []);
  if (byEmail.matched.length) return { matched: byEmail.matched, method: 'email' };
  if (seg.leadName) {
    try {
      const r = await findLeadByName(coach, seg.leadName);
      if (r && r.matchType === 'unique' && r.lead?.id) {
        return {
          matched: [{
            leadId: r.lead.id,
            name: [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ').trim() || seg.leadName,
            email: r.lead.email || '',
            via: 'name',
          }],
          method: 'name',
          // The segment's booking emails matched NO lead but the NAME did — these are the emails
          // to self-heal onto the matched lead at write time (see ingestFathomMeeting split path).
          learnEmails: byEmail.unmatched,
        };
      }
      if (r && r.matchType === 'ambiguous') {
        return { matched: [], method: 'name_ambiguous', ambiguousCount: (r.allMatches || []).length };
      }
    } catch (e) {
      log.warn(`name match failed for "${seg.leadName}": ${e.message}`);
    }
  }
  return { matched: [], method: 'none' };
}

/**
 * Calendar events that overlap the recording window AND look like real meetings (have a
 * conferencing URL + the coach is an attendee). Reuses the exact filters the Recall splitter
 * uses. Pass `override` (an array of events) to bypass the live read in tests.
 */
async function relevantCalendarEvents(meeting, coach, override) {
  if (Array.isArray(override)) return override;

  const recStart = new Date(meeting.recording_start_time || meeting.scheduled_start_time);
  const recEnd = new Date(meeting.recording_end_time || meeting.scheduled_end_time);
  if (Number.isNaN(recStart.getTime()) || Number.isNaN(recEnd.getTime())) return [];

  let result;
  try {
    // Routed through the calendar adapter (Google today / Nylas when flipped) — see calendarProvider.js.
    result = await getMeetingsInWindow(
      coach,
      new Date(recStart.getTime() - 10 * 60 * 1000),
      new Date(recEnd.getTime() + 10 * 60 * 1000),
    );
  } catch (e) {
    log.warn(`calendar read failed: ${e.message} — treating as single`);
    return [];
  }
  if (result.error) { log.warn(`calendar read (${result.provider}): ${result.error} — treating as single`); return []; }

  const overlapping = (result.events || []).filter((ev) => new Date(ev.start) < recEnd && new Date(ev.end) > recStart);
  return overlapping.filter((ev) => extractMeetingUrl(ev) && isCoachAttending(ev));
}

/**
 * Ingest one Fathom meeting (split-aware).
 *
 * @param {object} opts
 * @param {string} opts.recordingId        Fathom recording_id (required)
 * @param {string} [opts.coachClientId]    tenant scope (default Guy-Wilson)
 * @param {boolean} [opts.dryRun]          if true: do everything EXCEPT write
 * @param {object[]} [opts.calendarEvents] inject calendar events (tests); else read live
 * @param {string} [opts.createdAfter]     ISO bound to find the meeting in the list call
 * @param {string} [opts.createdBefore]    ISO bound
 * @returns {Promise<object>} { ok, dryRun?, mode:'single'|'split', plan, ... }
 */
async function ingestFathomMeeting(opts = {}) {
  const { recordingId, coachClientId = DEFAULT_COACH_CLIENT_ID, dryRun = false, createdAfter, createdBefore, calendarEvents } = opts;
  if (!recordingId) return { ok: false, error: 'recordingId is required' };

  const coach = await clientService.getClientById(coachClientId);
  if (!coach) return { ok: false, error: `coach client ${coachClientId} not found` };
  if (!coach.fathomApiKey) return { ok: false, error: `no Fathom API key for ${coachClientId}` };

  const f = await fetchFathomMeeting(recordingId, coach.fathomApiKey, { createdAfter, createdBefore });
  if (!f.ok) return f;
  const meeting = f.meeting;

  const coachEmails = [coach.googleCalendarEmail, coach.calendarEmail].filter(Boolean);
  const coachNames = [coach.clientName, 'Guy Wilson'].filter(Boolean);
  const events = await relevantCalendarEvents(meeting, coach, calendarEvents);

  // Guard against FALSE splits: only treat as a real back-to-back the events whose expected lead
  // ACTUALLY SPEAKS in the recording. A call that overruns into the next booked slot, or a phantom/
  // duplicated calendar event, leaves a non-attending lead (cancelled/no-show) who never speaks — so
  // we must not carve a bogus segment under their name. (2026-06-17 Al/Courtney case.) Worst case the
  // filter is over-eager and we file as a single meeting, which is always safe (lead-matched by email).
  const speakingEvents = events.filter((ev) => eventLeadSpeaks(meeting, ev, coachNames));

  // ---- SPLIT PATH (back-to-back: >1 real meeting whose lead actually spoke) ----
  if (speakingEvents.length > 1) {
    const split = splitFathomMeeting(meeting, speakingEvents, { coachNames, coachEmails });
    const segPlans = [];
    for (const seg of split.segments) {
      const lr = await matchLeadsForSegment(coach, seg);
      segPlans.push({
        _transcriptText: seg.transcriptText,
        _learnEmails: lr.learnEmails || [],
        title: seg.calendarEvent.summary || `${seg.leadName} meeting`,
        leadName: seg.leadName,
        meetingStart: seg.calendarEvent.start || new Date(seg.startMs).toISOString(),
        durationSeconds: Math.max(0, Math.round((seg.endMs - seg.startMs) / 1000)),
        transcriptLines: seg.lineCount,
        transcriptChars: seg.transcriptText.length,
        matchedLeads: lr.matched,
        leadMatchMethod: lr.method,
        strayLines: seg.strayLines,
      });
    }
    const plan = {
      recordingId: String(meeting.recording_id),
      mode: 'split',
      source: SOURCE,
      segments: segPlans.map(({ _transcriptText, _learnEmails, ...rest }) => rest),
    };

    if (dryRun) return { ok: true, dryRun: true, plan };
    if (!ingestEnabled()) return { ok: false, error: 'FATHOM_INGEST_ENABLED is not true — write path is disabled', plan };

    const filed = [];
    for (const sp of segPlans) {
      const ins = await insertImportedMeeting({ title: sp.title, source: SOURCE, transcriptText: sp._transcriptText, meetingStart: sp.meetingStart, durationSeconds: sp.durationSeconds, fathomRecordingId: String(meeting.recording_id), coachClientId });
      if (!ins.ok) { log.warn(`segment insert failed (${sp.title}): ${ins.error}`); continue; }
      for (const m of sp.matchedLeads) {
        try { await addMeetingLead(ins.meeting_id, m.leadId, coachClientId, 'fathom-api'); } catch (e) { log.warn(`link lead ${m.leadId} failed: ${e.message}`); }
        // SELF-HEAL: lead resolved by NAME — record the booking email(s) that matched nobody.
        if (sp.leadMatchMethod === 'name') {
          for (const le of (sp._learnEmails || [])) {
            try { await learnEmailForLead(coach, m.leadId, le); } catch (e) { log.warn(`self-heal email failed for ${m.leadId}: ${e.message}`); }
          }
        }
      }
      filed.push({ meetingId: ins.meeting_id, title: sp.title, leads: sp.matchedLeads.length });
    }
    log.info(`ingested fathom back-to-back rec=${plan.recordingId} -> ${filed.length} segment meetings`);
    return { ok: true, mode: 'split', filed, plan };
  }

  // ---- SINGLE PATH (one meeting, or calendar unreadable) ------------------
  const transcriptText = normalizeFathomApiTranscript(meeting);
  const meta = extractMeta(meeting);
  const emails = extractLeadEmails(meeting);
  const { matched, unmatched } = await matchLeads(coach, emails.external);

  // Q2(A) — single-meeting NAME fallback: a booking email that matched NO lead still gets a shot
  // via the invitee's NAME. A UNIQUE name match links the lead and flags the email to self-heal,
  // so someone booking with a brand-new business email still attaches AND has it learned for next
  // time. Read-only here (runs in dryRun too, so the plan reflects it); the write happens below.
  const remainingUnmatched = [];
  for (const rawEmail of unmatched) {
    const name = emails.externalNames[String(rawEmail).toLowerCase().trim()];
    let healed = false;
    if (name) {
      try {
        const r = await findLeadByName(coach, name);
        if (r && r.matchType === 'unique' && r.lead?.id) {
          matched.push({
            email: normalizeEmail(rawEmail) || rawEmail,
            leadId: r.lead.id,
            name: [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ').trim() || name,
            via: 'name',
          });
          healed = true;
          log.info(`single-path name fallback matched "${name}" -> lead ${r.lead.id} (will learn ${rawEmail})`);
        } else if (r && r.matchType === 'ambiguous') {
          log.info(`single-path name fallback: "${name}" ambiguous (${(r.allMatches || []).length}) — left unmatched`);
        }
      } catch (e) { log.warn(`single-path name fallback failed for "${name}": ${e.message}`); }
    }
    if (!healed) remainingUnmatched.push(rawEmail);
  }

  // Q2(B) — LAST-RESORT speaker fallback: the recording had NO usable calendar invitee (so neither
  // email nor invitee-name matched anything), e.g. an ad-hoc Zoom with no event. Fall back to the
  // DOMINANT non-coach SPEAKER's name in the transcript. Only fires when nothing else matched, and
  // only on a UNIQUE name match, so it never guesses. No email to self-heal here (none was supplied).
  if (matched.length === 0) {
    const speaker = dominantSpeakerName(meeting, coachNames);
    if (speaker) {
      try {
        const r = await findLeadByName(coach, speaker);
        if (r && r.matchType === 'unique' && r.lead?.id) {
          matched.push({
            email: '',
            leadId: r.lead.id,
            name: [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ').trim() || speaker,
            via: 'speaker',
          });
          log.info(`single-path speaker fallback matched "${speaker}" -> lead ${r.lead.id}`);
        } else if (r && r.matchType === 'ambiguous') {
          log.info(`single-path speaker fallback: "${speaker}" ambiguous (${(r.allMatches || []).length}) — left unmatched`);
        }
      } catch (e) { log.warn(`single-path speaker fallback failed for "${speaker}": ${e.message}`); }
    }
  }

  const plan = {
    recordingId: String(meeting.recording_id),
    mode: 'single',
    title: meta.title,
    meetingStart: meta.meetingStart,
    durationSeconds: meta.durationSeconds,
    transcriptLines: transcriptText ? transcriptText.split('\n').length : 0,
    transcriptChars: transcriptText.length,
    externalEmails: emails.external,
    matchedLeads: matched,
    unmatchedEmails: remainingUnmatched,
    source: SOURCE,
  };

  if (dryRun) return { ok: true, dryRun: true, plan, transcriptText };
  if (!ingestEnabled()) return { ok: false, error: 'FATHOM_INGEST_ENABLED is not true — write path is disabled', plan };

  const ins = await insertImportedMeeting({ title: meta.title, source: SOURCE, transcriptText, meetingStart: meta.meetingStart, durationSeconds: meta.durationSeconds, fathomRecordingId: String(meeting.recording_id), coachClientId });
  if (!ins.ok) return { ok: false, error: ins.error || 'insert failed', plan };

  const meetingId = ins.meeting_id;
  const linkedLeads = [];
  for (const m of matched) {
    try { await addMeetingLead(meetingId, m.leadId, coachClientId, 'fathom-api'); linkedLeads.push(m); }
    catch (e) { log.warn(`failed to link lead ${m.leadId} to meeting ${meetingId}: ${e.message}`); }
    // SELF-HEAL: lead resolved by NAME — record the booking email so future lookups by it resolve.
    if (m.via === 'name' && m.email) {
      try { await learnEmailForLead(coach, m.leadId, m.email); } catch (e) { log.warn(`self-heal email failed for ${m.leadId}: ${e.message}`); }
    }
  }
  log.info(`ingested fathom single rec=${plan.recordingId} -> meeting_id=${meetingId} (${plan.transcriptLines} lines, ${linkedLeads.length} leads)`);
  return { ok: true, mode: 'single', meetingId, botId: ins.bot_id, plan, linkedLeads };
}

/**
 * The dominant non-coach speaker in a Fathom transcript — the person (other than the coach) with
 * the most spoken lines. Last-resort lead identity for single recordings with no calendar invitee.
 * Returns the speaker's display name, or null if only the coach (or nobody) speaks.
 */
function dominantSpeakerName(meeting, coachNames = []) {
  const segs = Array.isArray(meeting.transcript) ? meeting.transcript : [];
  const coachSet = (coachNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean);
  const isCoach = (name) => {
    const x = String(name).trim().toLowerCase();
    if (!x) return true;
    return coachSet.some((c) => x === c || x.includes(c) || c.includes(x) || x.split(/\s+/)[0] === c.split(/\s+/)[0]);
  };
  const counts = new Map();
  for (const u of segs) {
    const sp = (u && u.speaker && (u.speaker.display_name || u.speaker.name))
      || (typeof u?.speaker === 'string' ? u.speaker : '');
    const name = String(sp || '').trim();
    if (!name || isCoach(name)) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  let best = null, bestN = 0;
  for (const [name, n] of counts) { if (n > bestN) { best = name; bestN = n; } }
  return best;
}

module.exports = {
  ingestFathomMeeting,
  dominantSpeakerName,
  fetchFathomMeeting,
  normalizeFathomApiTranscript,
  extractMeta,
  extractLeadEmails,
  matchLeads,
  matchLeadsForSegment,
  relevantCalendarEvents,
  ingestEnabled,
  SOURCE,
};
