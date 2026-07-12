/**
 * Recall review API + light HTML queue.
 *
 * ⚠ NAMING: "recall" here = the SOURCE-AGNOSTIC transcript store/lookup, not the Recall.ai
 * service. The /recall-review/api/latest-transcript-by-email endpoint (used by the
 * recall_latest_transcript MCP that powers Guy's "I had a meeting with X" chat) returns the
 * latest meeting for a lead regardless of source — Recall.ai OR Fathom. No source filter.
 * See docs/wingguy.md → "Terminology trap — recall_ ≠ Recall.ai".
 */

const express = require('express');
const crypto = require('crypto');
const {
  getRecallWebhookDbSummary,
  getMeetingById,
  getMeetingQueue,
  updateMeetingStatus,
  setMeetingIngestStatus,
  splitMeeting,
  upsertRecallMeetingParticipant,
  getParticipantsForMeeting,
  saveMeetingSpeakers,
  listMeetingLeads,
  addMeetingLead,
  removeMeetingLead,
  syncMeetingReviewStatus,
  recomputeAllRecallMeetingReviewStatuses,
  getLeadSegmentsForMeeting,
  seedManualTestRecall,
  purgeManualTestRecall,
  getMeetingsForLead,
  saveReconstruction,
  confirmReconstruction,
} = require('../services/recallWebhookDb');

function extractSpeakerLabels(text) {
  if (!text) return [];
  const labels = new Set();
  const rxPipe = /^(Participant \d+)\s*\|/gm;
  let m;
  while ((m = rxPipe.exec(text)) !== null) labels.add(m[1]);
  const rxColon = /^([A-Za-z(][^:\n]{0,50}):\s/gm;
  while ((m = rxColon.exec(text)) !== null) {
    const lab = m[1].trim();
    if (lab && !lab.startsWith('{') && !lab.startsWith('[')) labels.add(lab);
  }
  return [...labels];
}

function sampleLinesForSpeaker(text, label, count = 6) {
  if (!text || !label) return [];
  const prefixColon = label + ':';
  const prefixPipe = label + ' |';
  const lines = text.split('\n');
  const speakerLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(prefixColon)) {
      speakerLines.push(lines[i].slice(prefixColon.length).trim());
    } else if (lines[i].startsWith(prefixPipe)) {
      const nextLine = lines[i + 1] || '';
      if (nextLine && !nextLine.startsWith('Participant ') && !nextLine.startsWith('Speaker ')) {
        speakerLines.push(nextLine.trim());
      }
    }
  }
  return speakerLines
    .filter(Boolean)
    .slice(0, count);
}
const clientService = require('../services/clientService');
const { findLeadByEmail, findLeadByName } = require('../services/inboundEmailService');
const {
  DEFAULT_COACH_CLIENT_ID: RECALL_DEFAULT_COACH,
  linkMeetingByCalendarAttendees,
} = require('../services/recallLeadLinkService');
const { createRecallBot } = require('../services/recallBotService');
const { tryAutoSplitForMeeting } = require('../services/recallAutoSplitService');
const { getAutoJoinStatus, extractMeetingUrl } = require('../services/recallAutoJoinService');
const { listCalendarEventsWithAttendeesInRange } = require('../config/calendarServiceAccount');
const { generateMeetingSummary, renderSummaryText, normaliseSummary } = require('../services/recallSummaryService');
const { importTranscript } = require('../services/recallImportService');
const speakerReconstruction = require('../services/speakerReconstructionService');

// Pick the most likely "send to" person: a non-coach speaker with an email.
function suggestedRecipient(verifiedSpeakers) {
  for (const s of Object.values(verifiedSpeakers || {})) {
    if (s && s.role !== 'coach' && s.email) return { email: s.email, name: s.name || '' };
  }
  for (const s of Object.values(verifiedSpeakers || {})) {
    if (s && s.role !== 'coach' && s.name) return { email: '', name: s.name };
  }
  return { email: '', name: '' };
}

const REJOIN_NOW_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

const DEFAULT_COACH_CLIENT_ID = RECALL_DEFAULT_COACH;

const router = express.Router();

function normalizeAuthToken(headerVal) {
  if (!headerVal || typeof headerVal !== 'string') return null;
  const s = headerVal.trim();
  if (s.toLowerCase().startsWith('bearer ')) return s.slice(7).trim();
  return s;
}

function timingSafeEqualString(a, b) {
  if (a == null || b == null) return false;
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

// Public share-link tokens: HMAC of meeting ID with PB_WEBHOOK_SECRET, scoped by purpose.
// Truncated to 32 hex chars (128 bits) — strong enough for an unguessable share URL.
// To revoke ALL outstanding share links: rotate PB_WEBHOOK_SECRET on the server.
function computeShareToken(meetingId) {
  const secret = (process.env.PB_WEBHOOK_SECRET || '').trim();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(`share:${meetingId}`).digest('hex').slice(0, 32);
}

function verifyShareToken(meetingId, token) {
  const expected = computeShareToken(meetingId);
  if (!expected || !token) return false;
  return timingSafeEqualString(String(token), expected);
}

function publicBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host');
  return host ? `${proto}://${host}` : 'https://pb-webhook-server.onrender.com';
}

function pbAdminOk(req) {
  const expected = (process.env.PB_WEBHOOK_SECRET || '').trim();
  if (!expected) return false;
  const q = typeof req.query.secret === 'string' ? req.query.secret.trim() : '';
  const auth = normalizeAuthToken(req.get('authorization') || '');
  return timingSafeEqualString(q, expected) || timingSafeEqualString(auth, expected);
}

function expectedPortalDevKey() {
  return (process.env.PORTAL_DEV_KEY || process.env.PB_WEBHOOK_SECRET || '').trim();
}

function recallReviewAllowedClientIds() {
  const raw = (
    process.env.RECALL_REVIEW_ALLOWED_CLIENT_IDS
    || DEFAULT_COACH_CLIENT_ID
    || 'Guy-Wilson'
  );
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function pbRecallReviewApiOk(req) {
  if (pbAdminOk(req)) return true;
  const expectedDev = expectedPortalDevKey();
  const dk = (req.get('x-dev-key') || '').trim();
  if (expectedDev && timingSafeEqualString(dk, expectedDev)) return true;

  const portalToken = (req.get('x-portal-token') || '').trim();
  const clientIdHeader = (req.get('x-client-id') || '').trim();
  if (!portalToken || !clientIdHeader) return false;
  try {
    const client = await clientService.getClientByPortalToken(portalToken);
    if (!client || client.status !== 'Active') return false;
    if (String(client.clientId).toLowerCase() !== String(clientIdHeader).toLowerCase()) return false;
    const allowed = recallReviewAllowedClientIds();
    return allowed.includes(String(client.clientId).toLowerCase());
  } catch (_e) {
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STATUS_LABELS = {
  incomplete: 'Incomplete',
  complete: 'Complete',
  skipped: 'Skipped',
  to_verify: 'Incomplete',
  verified: 'Complete',
};
const STATUS_COLOURS = {
  incomplete: '#f59e0b',
  complete: '#22c55e',
  skipped: '#94a3b8',
  to_verify: '#f59e0b',
  verified: '#22c55e',
};

function formatDuration(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return '';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function formatBrisbane(isoStr) {
  try {
    return new Date(isoStr).toLocaleString('en-AU', {
      timeZone: 'Australia/Brisbane',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(isoStr);
  }
}

async function replaceParticipantLabelsInTranscript(text, meetingId) {
  if (!text || !meetingId) return text;
  let rows;
  try {
    rows = await getParticipantsForMeeting(meetingId);
  } catch {
    return text;
  }
  let result = text;
  for (const p of rows || []) {
    if (p.verified_name && p.speaker_label && String(p.speaker_label).startsWith('Participant ')) {
      const escaped = String(p.speaker_label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), p.verified_name);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
router.get('/webhooks/recall/db-summary', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'admin auth required' });
  const limit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 15;
  const summary = await getRecallWebhookDbSummary(Number.isFinite(limit) ? limit : 15);
  res.json(summary);
});

async function recomputeRecallReviewStatusesHandler(req, res) {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'admin auth required' });
  const rawLim = req.body?.limit != null ? req.body.limit : req.query.limit;
  const lim = rawLim != null ? parseInt(String(rawLim), 10) : 500;
  const out = await recomputeAllRecallMeetingReviewStatuses(Number.isFinite(lim) ? lim : 500);
  res.json(out);
}
router.post('/webhooks/recall/recompute-review-statuses', recomputeRecallReviewStatusesHandler);
router.get('/webhooks/recall/recompute-review-statuses', recomputeRecallReviewStatusesHandler);

/**
 * Retroactively link a Recall meeting to Airtable leads via the coach's
 * Google Calendar attendees. Useful for meetings recorded before the
 * calendar-attendee auto-link was wired in, or when Recall missed a guest's email.
 *
 * Query:
 *   meeting_id (required) — numeric meeting id
 *   client_id  (optional) — coach client id; defaults to Guy-Wilson
 */
async function linkByCalendarAttendeesHandler(req, res) {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'admin auth required' });
  const rawMeetingId = req.body?.meeting_id != null ? req.body.meeting_id : req.query.meeting_id;
  const meetingId = parseInt(String(rawMeetingId || ''), 10);
  if (!Number.isFinite(meetingId) || meetingId < 1) {
    return res.status(400).json({ error: 'meeting_id is required' });
  }
  const clientId = (req.body?.client_id || req.query.client_id || DEFAULT_COACH_CLIENT_ID).toString().trim();
  try {
    const result = await linkMeetingByCalendarAttendees(meetingId, { coachClientId: clientId });
    return res.json({ meeting_id: meetingId, coach_client_id: clientId, result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
router.post('/webhooks/recall/link-calendar-attendees', linkByCalendarAttendeesHandler);
router.get('/webhooks/recall/link-calendar-attendees', linkByCalendarAttendeesHandler);

// ---------------------------------------------------------------------------
router.get('/recall-review/api/queue', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const raw = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const allowed = new Set(['all', 'incomplete', 'complete', 'skipped', 'to_verify', 'verified']);
  const statusFilter = allowed.has(raw) ? raw : 'incomplete';
  const qTitle = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await getMeetingQueue(200, statusFilter, qTitle ? { titleContains: qTitle } : {});
  return res.json({ rows, statusFilter, q: qTitle || undefined });
});

router.get('/recall-review/api/event/:id', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const row = await getMeetingById(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const fullText = row.transcript_text || '';
  const speakerLabels = extractSpeakerLabels(fullText);
  const participants = await getParticipantsForMeeting(row.id);
  const meetingLeads = await listMeetingLeads(row.id);
  const speakerSamples = {};
  for (const lab of speakerLabels) {
    speakerSamples[lab] = sampleLinesForSpeaker(fullText, lab, 6);
  }

  let coachHint = { clientId: DEFAULT_COACH_CLIENT_ID, displayName: 'Coach', calendarEmail: '' };
  try {
    const coach = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
    if (coach) {
      coachHint = {
        clientId: coach.clientId || DEFAULT_COACH_CLIENT_ID,
        displayName: (coach.clientName || coach.clientId || 'Coach').trim(),
        calendarEmail: coach.googleCalendarEmail || coach.calendarEmail || '',
      };
    }
  } catch (_e) { /* optional */ }

  const verifiedSpeakers = {};
  for (const p of participants) {
    if (p.speaker_label) {
      verifiedSpeakers[p.speaker_label] = {
        name: p.verified_name || '',
        email: p.verified_email || '',
        role: p.role || 'unknown',
        airtable_lead_id: p.airtable_lead_id || null,
      };
    }
  }

  // When transcript uses names instead of "Participant NNN" (e.g. child meetings),
  // map name-based labels to their participant data
  for (const lab of speakerLabels) {
    if (verifiedSpeakers[lab]) continue;
    const matchByName = participants.find(p =>
      p.verified_name && p.verified_name.toLowerCase() === lab.toLowerCase()
    );
    if (matchByName) {
      verifiedSpeakers[lab] = {
        name: matchByName.verified_name || lab,
        email: matchByName.verified_email || '',
        role: matchByName.role || 'unknown',
        airtable_lead_id: matchByName.airtable_lead_id || null,
      };
    }
  }

  // Cross-reference meeting_leads with speakers to fill in airtable_lead_id gaps
  const assignedLeadIds = new Set(
    Object.values(verifiedSpeakers).map(s => s.airtable_lead_id).filter(Boolean)
  );
  const unassignedLeads = meetingLeads.filter(ml => !assignedLeadIds.has(ml.airtable_lead_id));
  if (unassignedLeads.length > 0) {
    const coachLabel = Object.keys(verifiedSpeakers).find(k => verifiedSpeakers[k].role === 'coach');
    const nonCoachLabels = speakerLabels.filter(l => l !== coachLabel && !verifiedSpeakers[l]?.airtable_lead_id);

    // Try name matching via Airtable lookup
    for (const ml of unassignedLeads) {
      try {
        const client = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
        if (client?.airtableBaseId) {
          const { createBaseInstance } = require('../config/airtableClient');
          const base = createBaseInstance(client.airtableBaseId);
          const rec = await base('Leads').find(ml.airtable_lead_id);
          if (rec) {
            const leadName = [rec.fields['First Name'], rec.fields['Last Name']].filter(Boolean).join(' ').trim().toLowerCase();
            const leadEmail = (rec.fields['Email'] || '').toLowerCase();
            for (const lab of nonCoachLabels) {
              const vs = verifiedSpeakers[lab];
              if (vs && !vs.airtable_lead_id) {
                const speakerName = (vs.name || '').toLowerCase();
                if ((leadName && speakerName && leadName === speakerName) ||
                    (leadEmail && vs.email && leadEmail === vs.email.toLowerCase())) {
                  vs.airtable_lead_id = ml.airtable_lead_id;
                  vs.role = vs.role === 'unknown' ? 'client' : vs.role;
                  break;
                }
              }
            }
          }
        }
      } catch (_e) { /* best-effort */ }
    }

    // Fallback: if exactly 1 non-coach speaker and 1 unassigned lead, auto-assign
    const stillUnassigned = meetingLeads.filter(ml =>
      !Object.values(verifiedSpeakers).some(s => s.airtable_lead_id === ml.airtable_lead_id)
    );
    const unlinkedNonCoach = nonCoachLabels.filter(l => !verifiedSpeakers[l]?.airtable_lead_id);
    if (stillUnassigned.length === 1 && unlinkedNonCoach.length === 1) {
      const vs = verifiedSpeakers[unlinkedNonCoach[0]];
      if (vs) {
        vs.airtable_lead_id = stillUnassigned[0].airtable_lead_id;
        vs.role = vs.role === 'unknown' ? 'client' : vs.role;
      }
    }
  }

  const leadSegmentInfo = await getLeadSegmentsForMeeting(row.id);

  let summary = null;
  let summaryText = '';
  if (row.summary_json) {
    try {
      summary = normaliseSummary(JSON.parse(row.summary_json));
      summaryText = renderSummaryText(summary, { title: row.title || `Meeting ${row.id}`, durationSeconds: row.duration_seconds });
    } catch (_e) { /* malformed summary — treat as none */ }
  }
  const recipient = suggestedRecipient(verifiedSpeakers);

  // Speaker reconstruction state — drives the confirm card. Only 'pending' shows the card;
  // 'confirmed'/null pass through. reconstruction_json holds the proposed transcript +
  // high-stakes lines (we surface only the high-stakes lines + note to the UI, not the whole
  // proposed transcript).
  let reconstruction = null;
  if (row.reconstruction_json) {
    try {
      const r = speakerReconstruction.normaliseReconstruction(JSON.parse(row.reconstruction_json));
      reconstruction = { highStakes: r.highStakes, note: r.note, transcript: r.transcript };
    } catch (_e) { /* malformed — treat as none */ }
  }

  return res.json({
    id: row.id,
    created_at: row.created_at,
    meeting_start: row.meeting_start || null,
    webhook_received_at: row.webhook_received_at,
    recall_bot_id: row.bot_id,
    recall_recording_id: row.recording_id,
    status: row.status,
    status_reason: row.status_reason || null,
    needs_split: !!row.needs_split,
    start_line: row.start_line,
    end_line: row.end_line,
    title: row.title || 'Recall meeting',
    duration: row.duration_seconds,
    full_text: fullText,
    speaker_labels: speakerLabels,
    speaker_samples: speakerSamples,
    verified_speakers: verifiedSpeakers,
    participants,
    meeting_leads: meetingLeads.map(ml => ({
      ...ml,
      resolved_name: Object.values(verifiedSpeakers).find(s => s.airtable_lead_id === ml.airtable_lead_id)?.name || null,
    })),
    coach_hint: coachHint,
    calendar_attendees: [],
    lead_segments: leadSegmentInfo.segments || [],
    presence_windows: leadSegmentInfo.windows || [],
    summary,
    summary_text: summaryText,
    summary_generated_at: row.summary_generated_at || null,
    reconstruction_status: row.reconstruction_status || null,
    reconstruction,
    suggested_recipient_email: recipient.email,
    suggested_recipient_name: recipient.name,
  });
});

/**
 * POST /recall-review/:id/generate-summary
 * Generate (or regenerate with ?force=1) the Fathom-style recap on demand.
 * Used by the review page when a summary isn't present yet (e.g. short call,
 * or generated before this feature shipped).
 */
/**
 * POST /recall-review/api/import-transcript
 * Accept a manually-pasted transcript (Tactiq, Fathom, or Other) and create a
 * recall_meetings row that flows through the rest of the system — review queue,
 * summary, share link, send-from-Gmail — identically to a Recall capture.
 *
 * Body: {
 *   title:           string (required),
 *   source:          'tactiq' | 'fathom' | 'other',
 *   transcript_text: string (required),
 *   meeting_start:   ISO string (optional, defaults to now),
 *   duration_seconds: number (optional),
 *   lead_email:      string (optional — used to attach an Airtable lead)
 * }
 */
router.post('/recall-review/api/import-transcript', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const body = req.body || {};
  const result = await importTranscript({
    title: body.title,
    source: body.source,
    transcriptText: body.transcript_text || body.transcriptText,
    meetingStart: body.meeting_start || body.meetingStart,
    durationSeconds: typeof body.duration_seconds === 'number' ? body.duration_seconds : (typeof body.durationSeconds === 'number' ? body.durationSeconds : undefined),
    leadEmail: body.lead_email || body.leadEmail,
  });
  if (!result.ok) return res.status(400).json(result);
  return res.json(result);
});

router.post('/recall-review/:id/generate-summary', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const force = String(req.query.force || req.body?.force || '') === '1';
  const gen = await generateMeetingSummary(req.params.id, { force });
  if (!gen.ok) return res.status(502).json({ ok: false, error: gen.error });
  return res.json({
    ok: true,
    summary: gen.summary,
    summary_text: renderSummaryText(gen.summary, gen.meta),
  });
});

/**
 * POST /recall-review/:id/reconstruct
 * Run (or re-run) speaker reconstruction via Claude on a single-speaker / dodgy transcript.
 * Backs both the "Run another pass" button (no body) and free-text corrections
 * ({ correction }). Stores the proposal (status -> 'pending') without touching the canonical
 * transcript; returns only the high-stakes lines + note for the confirm card.
 */
router.post('/recall-review/:id/reconstruct', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!speakerReconstruction.isEnabled()) return res.status(403).json({ ok: false, error: 'speaker reconstruction is disabled' });

  const correction = typeof req.body?.correction === 'string' ? req.body.correction : '';
  const recon = await speakerReconstruction.reconstructSpeakers({ meetingId: req.params.id, correction });
  if (!recon.ok) return res.status(502).json({ ok: false, error: recon.error });

  const saved = await saveReconstruction(req.params.id, recon.reconstruction);
  if (!saved.ok) return res.status(500).json({ ok: false, error: 'failed to save reconstruction' });

  return res.json({
    ok: true,
    reconstruction_status: 'pending',
    reconstruction: {
      highStakes: recon.reconstruction.highStakes,
      note: recon.reconstruction.note,
      transcript: recon.reconstruction.transcript,
    },
  });
});

/**
 * POST /recall-review/:id/confirm-reconstruction
 * Commit the human-confirmed transcript as canonical (overwrite transcript_text, mark
 * 'confirmed') and regenerate the summary off the corrected transcript. Body { transcript }
 * lets the UI submit edited text; absent => accept the proposed reconstruction as-is.
 */
router.post('/recall-review/:id/confirm-reconstruction', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });

  let confirmed = typeof req.body?.transcript === 'string' ? req.body.transcript.trim() : '';
  if (!confirmed) {
    const row = await getMeetingById(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'meeting not found' });
    if (!row.reconstruction_json) return res.status(400).json({ ok: false, error: 'no reconstruction to confirm' });
    try {
      confirmed = speakerReconstruction.normaliseReconstruction(JSON.parse(row.reconstruction_json)).transcript;
    } catch (_e) { /* fall through */ }
  }
  if (!confirmed) return res.status(400).json({ ok: false, error: 'no transcript to confirm' });

  const done = await confirmReconstruction(req.params.id, confirmed);
  if (!done.ok) return res.status(500).json({ ok: false, error: done.error || 'failed to confirm' });

  // Regenerate the summary off the now-canonical, human-confirmed transcript (garbage-in was
  // the root cause of the reversed-intro-direction failure, so this must run on the fixed text).
  let summary = null;
  let summaryText = '';
  try {
    const gen = await generateMeetingSummary(req.params.id, { force: true });
    if (gen.ok) { summary = gen.summary; summaryText = renderSummaryText(gen.summary, gen.meta); }
  } catch (_e) { /* summary is best-effort; the canonical transcript is already saved */ }

  return res.json({ ok: true, reconstruction_status: 'confirmed', summary, summary_text: summaryText });
});

router.post('/recall-review/:id/speakers', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const speakers = req.body?.speakers;
  if (!speakers || typeof speakers !== 'object') return res.status(400).json({ error: 'speakers object required' });

  const coachClientId = DEFAULT_COACH_CLIENT_ID;
  const result = await saveMeetingSpeakers(req.params.id, speakers, { coachClientId });
  if (!result.ok) return res.json(result);

  const linkedEmails = [];
  try {
    const client = await clientService.getClientById(coachClientId);
    if (client?.airtableBaseId) {
      for (const [label, info] of Object.entries(speakers)) {
        if (!info || typeof info !== 'object') continue;
        const email = (info.email || '').trim().toLowerCase();
        if (!email || (info.airtable_lead_id || '').trim()) continue;
        try {
          const lead = await findLeadByEmail(client, email);
          if (lead?.id) {
            const mPlat = /^Participant\s*(\d+)$/i.exec(String(label).trim());
            const plat = mPlat ? parseInt(mPlat[1], 10) : null;
            await upsertRecallMeetingParticipant({
              meetingId: req.params.id,
              platformParticipantId: Number.isFinite(plat) ? plat : null,
              speakerLabel: label,
              verifiedName: info.name || null,
              verifiedEmail: email,
              role: info.role || 'client',
              airtableLeadId: lead.id,
              coachClientId,
              matchMethod: 'manual_speaker_verification',
            });
            await addMeetingLead(req.params.id, lead.id, coachClientId, 'email_resolve');
            linkedEmails.push(email);
          }
        } catch (_) { /* best effort */ }
      }
    }
  } catch (_) { /* optional */ }

  if (linkedEmails.length) await syncMeetingReviewStatus(req.params.id);

  return res.json({ ...result, linked_emails: linkedEmails });
});

router.post('/recall-review/:id/meeting-leads', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const leadId = typeof req.body?.airtable_lead_id === 'string' ? req.body.airtable_lead_id.trim() : '';
  if (!leadId) return res.status(400).json({ error: 'airtable_lead_id required' });
  const out = await addMeetingLead(req.params.id, leadId, DEFAULT_COACH_CLIENT_ID, 'manual');
  return res.json(out);
});

router.delete('/recall-review/:id/meeting-leads/:leadId', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const leadId = String(req.params.leadId || '').trim();
  if (!leadId) return res.status(400).json({ error: 'leadId required' });
  const out = await removeMeetingLead(req.params.id, leadId);
  return res.json(out);
});

router.get('/recall-review/api/search-lead', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const nameQ = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const linkedinQ = typeof req.query.linkedin === 'string' ? req.query.linkedin.trim() : '';
  if (!email && !nameQ && !linkedinQ) return res.status(400).json({ error: 'email, name, or linkedin query required' });
  try {
    const client = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
    if (!client?.airtableBaseId) return res.json({ lead: null, error: 'no_base' });

    let lead = null;
    if (email && email.includes('@')) {
      lead = await findLeadByEmail(client, email);
    }
    if (!lead && linkedinQ && linkedinQ.includes('linkedin.com/')) {
      const { createBaseInstance } = require('../config/airtableClient');
      const base = createBaseInstance(client.airtableBaseId);
      const normalized = linkedinQ.replace(/\/+$/, '').toLowerCase();
      const records = await base('Leads').select({
        filterByFormula: `OR(LOWER({LinkedIn Profile URL}) = "${normalized}", LOWER({LinkedIn URL}) = "${normalized}")`,
        maxRecords: 1,
      }).firstPage();
      if (records && records.length > 0) {
        const rec = records[0];
        lead = {
          id: rec.id,
          firstName: rec.fields['First Name'] || '',
          lastName: rec.fields['Last Name'] || '',
          email: rec.fields['Email'] || '',
        };
      }
    }
    if (!lead && nameQ && nameQ.length >= 2) {
      const nameResult = await findLeadByName(client, nameQ);
      if (nameResult.matchType === 'unique' && nameResult.lead) lead = nameResult.lead;
      if (nameResult.matchType === 'ambiguous') {
        return res.json({
          lead: null,
          ambiguous: true,
          matches: nameResult.allMatches?.map(l => ({
            id: l.id,
            name: [l.firstName, l.lastName].filter(Boolean).join(' ').trim(),
            email: l.email || '',
          })),
        });
      }
    }
    if (!lead?.id) return res.json({ lead: null });
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || email || nameQ || linkedinQ;
    return res.json({
      lead: {
        id: lead.id,
        email: lead.email || email,
        name,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /recall-review/api/latest-transcript-by-email?email=...
 * Optional: name=<first last> (fallback if email lookup fails, or if no email given)
 * Optional: after=ISO8601 (only meetings on/after this instant), format=json|text
 * Auth: same as other recall-review API (PB_WEBHOOK_SECRET Bearer, x-dev-key, or portal token).
 * For MCP: use format=text and Authorization Bearer with PB_WEBHOOK_SECRET.
 */
router.get('/recall-review/api/latest-transcript-by-email', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const hasEmail = email && email.includes('@');
  const hasName = name.length >= 2;
  if (!hasEmail && !hasName) {
    return res.status(400).json({ error: 'email or name query parameter required' });
  }
  const wantText = String(req.query.format || '').toLowerCase() === 'text'
    || (req.get('accept') || '').includes('text/plain');
  const afterRaw = typeof req.query.after === 'string' ? req.query.after.trim() : '';
  const afterMs = afterRaw ? new Date(afterRaw).getTime() : null;
  const afterOk = afterMs != null && !Number.isNaN(afterMs);

  try {
    const coachClient = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
    if (!coachClient?.airtableBaseId) {
      return res.status(503).json({ error: 'coach_base_not_configured' });
    }
    let lead = hasEmail ? await findLeadByEmail(coachClient, email) : null;
    let lookupMethod = lead?.id ? 'email' : null;
    if (!lead?.id && hasName) {
      const nameResult = await findLeadByName(coachClient, name);
      if (nameResult.matchType === 'ambiguous') {
        return res.status(409).json({
          ok: false,
          error: 'name_ambiguous',
          name,
          matches: (nameResult.allMatches || []).map((l) => ({
            id: l.id,
            name: [l.firstName, l.lastName].filter(Boolean).join(' ').trim(),
            email: l.email || '',
            company: l.company || '',
          })),
        });
      }
      if (nameResult.matchType === 'unique' && nameResult.lead) {
        lead = nameResult.lead;
        lookupMethod = 'name';
      }
    }
    if (!lead?.id) {
      return res.status(404).json({
        ok: false,
        error: 'lead_not_found',
        email: email || undefined,
        name: name || undefined,
      });
    }
    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || email || name;
    const limit = 100;
    let rows = await getMeetingsForLead(lead.id, limit);
    if (afterOk) {
      rows = rows.filter((r) => {
        const t = r.meeting_start || r.created_at;
        if (!t) return false;
        return new Date(t).getTime() >= afterMs;
      });
    }
    const resolvedEmail = email || (lead.email || '').toLowerCase();
    if (!rows || rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'no_meetings',
        email: resolvedEmail,
        leadId: lead.id,
        leadName,
        lookupMethod,
      });
    }
    // --- Prefer Fathom, with a LOUD fallback to Recall (Recall->Fathom migration) ----------
    // rows are newest-first. Take the latest meeting, then within its time-cluster (same real
    // meeting captured by both recorders) prefer a USABLE Fathom copy. If we have to serve a
    // Recall copy for a meeting on/after FATHOM_LIVE_FROM, say so out loud (the chat surfaces it).
    const FATHOM_MIN_USABLE_CHARS = 200;
    const CLUSTER_WINDOW_MS = 30 * 60 * 1000;
    const liveFromMs = (() => {
      const raw = String(process.env.FATHOM_LIVE_FROM || '').trim();
      const ms = raw ? Date.parse(raw) : NaN;
      return Number.isNaN(ms) ? null : ms;
    })();
    const isFathom = (r) => String(r.source || '').toLowerCase().startsWith('fathom');
    const isUsable = (r) => (r.transcript_text || '').length >= FATHOM_MIN_USABLE_CHARS;
    const rowMs = (r) => {
      const t = Date.parse(r.meeting_start || r.created_at);
      return Number.isNaN(t) ? null : t;
    };

    let latest;
    let sourceNotice = null;
    if (liveFromMs == null) {
      // Migration behaviour OFF (FATHOM_LIVE_FROM unset): identical to before — latest by time.
      latest = rows[0];
    } else {
      const top = rows[0];
      const topMs = rowMs(top);
      const cluster = rows.filter((r) => {
        const t = rowMs(r);
        return t != null && topMs != null && Math.abs(t - topMs) <= CLUSTER_WINDOW_MS;
      });
      const fathomPick = cluster.find((r) => isFathom(r) && isUsable(r));
      if (fathomPick) {
        latest = fathomPick;
      } else {
        latest = top;
        // Loud flag only for meetings on/after the cutoff (don't whinge about historical Recall-only).
        const eligible = topMs != null && topMs >= liveFromMs;
        if (eligible && !isFathom(latest)) {
          const brokenFathom = cluster.some((r) => isFathom(r) && !isUsable(r));
          sourceNotice = brokenFathom
            ? '⚠️ Fathom transcript for this meeting looks incomplete — showing the Recall copy instead. Fathom may have failed to capture it.'
            : '⚠️ No Fathom transcript found for this meeting — showing the Recall copy instead. Fathom may have missed it.';
        }
      }
    }

    const rawText = latest.transcript_text || '';
    let transcript = await replaceParticipantLabelsInTranscript(rawText, latest.meeting_id);
    // Bake the notice into the transcript text so it surfaces even through the current MCP client.
    if (sourceNotice) transcript = `${sourceNotice}\n\n${transcript}`;

    if (wantText) {
      res.type('text/plain; charset=utf-8');
      return res.send(transcript);
    }

    return res.json({
      ok: true,
      email: resolvedEmail,
      lookupMethod,
      leadId: lead.id,
      leadName,
      meeting: {
        id: latest.meeting_id,
        title: latest.title || 'Meeting',
        created_at: latest.created_at,
        meeting_start: latest.meeting_start,
        duration_seconds: latest.duration_seconds,
        status: latest.status,
        source: latest.source || null,
      },
      sourceNotice,
      transcript,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/recall-review/:id/status', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const status = req.body?.status;
  if (!status || typeof status !== 'string') return res.status(400).json({ error: 'status required' });
  const result = await updateMeetingStatus(req.params.id, status);
  return res.json(result);
});

router.post('/recall-review/:id/split', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const splitAtLine = req.body?.splitAtLine;
  if (typeof splitAtLine !== 'number' || splitAtLine < 1) {
    return res.status(400).json({ error: 'splitAtLine required' });
  }
  const result = await splitMeeting(req.params.id, splitAtLine);
  return res.json(result);
});

router.post('/recall-review/:id/analyze', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const row = await getMeetingById(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  return res.json({ ok: true, note: 'AI transcript analysis not yet wired for Recall' });
});

router.post('/recall-test/seed', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const out = await seedManualTestRecall();
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/recall-test/purge', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const out = await purgeManualTestRecall();
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/recall-test/auto-split', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const meetingId = req.body?.meeting_id;
    if (!meetingId) return res.status(400).json({ ok: false, error: 'meeting_id required' });

    const calendarEvents = req.body?.calendar_events || null;
    const out = await tryAutoSplitForMeeting(meetingId, calendarEvents ? { calendarEvents } : undefined);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/recall-api/auto-join-status', async (req, res) => {
  if (!pbAdminOk(req) && !(await pbRecallReviewApiOk(req))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.json(getAutoJoinStatus());
});

/**
 * POST /recall-api/create-bot
 * Body: { meeting_url, join_at? (ISO), transcript_mode? ('prioritize_accuracy' | 'prioritize_low_latency') }
 * Creates a Recall bot with separate-stream diarization + webhooks to this server's /webhooks/recall.
 * Auth: PB admin secret (query/header) or portal recall-review auth (same as recall-review API).
 */
router.post('/recall-api/create-bot', async (req, res) => {
  if (!pbAdminOk(req) && !(await pbRecallReviewApiOk(req))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const meetingUrl = req.body?.meeting_url || req.body?.meetingUrl;
  const joinAt = req.body?.join_at || req.body?.joinAt;
  const transcriptMode = req.body?.transcript_mode || req.body?.transcriptMode;
  const out = await createRecallBot({ meetingUrl, joinAt, transcriptMode });
  const status = out.ok ? 200 : typeof out.status === 'number' && out.status >= 400 && out.status < 600 ? out.status : 502;
  return res.status(status).json(out);
});

/**
 * POST/GET /recall-api/rejoin-now
 * Finds the calendar event currently in progress (start ≤ now ≤ end + 15min grace) on the
 * coach's calendar that has a Zoom/Meet/Teams link, and dispatches a fresh Recall bot to it.
 * Use case: bot was denied/missed the waiting room — one tap to send another knock.
 * Auth: PB admin secret or portal recall-review auth.
 */
const rejoinNowHandler = async (req, res) => {
  if (!pbAdminOk(req) && !(await pbRecallReviewApiOk(req))) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let calendarEmail = (process.env.RECALL_COACH_CALENDAR_EMAIL || '').trim();
  if (!calendarEmail) {
    try {
      const coach = await clientService.getClientById(REJOIN_NOW_COACH_CLIENT_ID);
      calendarEmail = coach?.googleCalendarEmail || '';
    } catch (e) {
      return res.status(500).json({ ok: false, error: `could not get coach calendar email: ${e.message}` });
    }
  }
  if (!calendarEmail) {
    return res.status(500).json({ ok: false, error: 'coach calendar email not configured' });
  }

  const now = new Date();
  const t0 = new Date(now.getTime() - 15 * 60 * 1000);
  const t1 = new Date(now.getTime() + 15 * 60 * 1000);
  const { events, error } = await listCalendarEventsWithAttendeesInRange(calendarEmail, t0, t1);
  if (error) return res.status(502).json({ ok: false, error: `calendar error: ${error}` });

  const GRACE_MS = 15 * 60 * 1000;
  const nowMs = now.getTime();
  const inProgress = (events || [])
    .map(ev => ({ ev, url: extractMeetingUrl(ev) }))
    .filter(({ ev, url }) => {
      if (!url) return false;
      const start = ev.start ? new Date(ev.start).getTime() : NaN;
      const end = ev.end ? new Date(ev.end).getTime() : NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return start <= nowMs && nowMs <= end + GRACE_MS;
    });

  if (inProgress.length === 0) {
    return res.status(404).json({ ok: false, error: 'no calendar event in progress with a meeting link' });
  }

  if (inProgress.length > 1) {
    return res.status(409).json({
      ok: false,
      error: 'multiple events in progress — use /recall-api/create-bot with a specific meeting_url',
      candidates: inProgress.map(({ ev, url }) => ({
        summary: ev.summary,
        start: ev.start,
        end: ev.end,
        meetingUrl: url,
      })),
    });
  }

  const { ev, url } = inProgress[0];
  const out = await createRecallBot({ meetingUrl: url, meetingTitle: ev.summary });
  if (!out.ok) {
    const status = typeof out.status === 'number' && out.status >= 400 && out.status < 600 ? out.status : 502;
    return res.status(status).json({ ok: false, error: out.error, summary: ev.summary, meetingUrl: url });
  }
  return res.json({
    ok: true,
    summary: ev.summary,
    meetingUrl: url,
    botId: out.recall_response?.id || null,
  });
};
router.post('/recall-api/rejoin-now', rejoinNowHandler);
router.get('/recall-api/rejoin-now', rejoinNowHandler);

/**
 * GET /recall-review/api/share-link/:id
 * Authenticated. Returns a public share URL for the meeting's transcript.
 * Anyone with the URL can read the transcript (no login required) — designed for
 * sending to a non-customer (e.g. "Tony, here's the recording transcript").
 * Token is HMAC of meeting id + PB_WEBHOOK_SECRET; rotate the secret to revoke.
 */
router.get('/recall-review/api/share-link/:id', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const id = req.params.id;
  const row = await getMeetingById(id);
  if (!row) return res.status(404).json({ ok: false, error: 'meeting not found' });
  const token = computeShareToken(id);
  if (!token) return res.status(500).json({ ok: false, error: 'PB_WEBHOOK_SECRET not configured' });
  const url = `${publicBaseUrl(req)}/recall-share/${encodeURIComponent(id)}?token=${token}`;
  return res.json({ ok: true, url, title: row.title || row.meeting_title || '' });
});

/**
 * GET /recall-share/:id?token=XXX[&format=html]
 * PUBLIC endpoint — anyone with a valid token can fetch the transcript as plain text
 * (default) or a small HTML page with a Copy button (?format=html).
 * Speaker labels are replaced with verified names where confirmed during review.
 */
router.get('/recall-share/:id', async (req, res) => {
  const id = req.params.id;
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!verifyShareToken(id, token)) {
    res.status(404).type('text/plain; charset=utf-8');
    return res.send('Not found.');
  }
  const row = await getMeetingById(id);
  if (!row) {
    res.status(404).type('text/plain; charset=utf-8');
    return res.send('Not found.');
  }
  const rawText = row.transcript_text || '';
  const labelled = await replaceParticipantLabelsInTranscript(rawText, row.id);
  // Strip ASCII control chars (NUL, BEL, etc., keeping \t \n \r) and zero-width Unicode
  // (U+200B–U+200D, U+2060, U+FEFF). These invisible characters cause Gmail and some other
  // apps to silently refuse paste even though navigator.clipboard.writeText reports success.
  const stripCtrlRe = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', 'g');
  const stripZeroWidthRe = new RegExp('[\\u200B-\\u200D\\u2060\\uFEFF]', 'g');
  const transcript = labelled.replace(stripCtrlRe, '').replace(stripZeroWidthRe, '');
  const title = row.title || row.meeting_title || `Meeting ${id}`;
  const wantHtml = String(req.query.format || '').toLowerCase() === 'html';

  if (!wantHtml) {
    res.type('text/plain; charset=utf-8');
    return res.send(transcript || '(transcript not yet available)');
  }

  // Minimal HTML view with a Copy button — no auth, no nav.
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)} — transcript</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 24px; color: #111827; background: #f9fafb; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 16px; }
  .actions { margin-bottom: 16px; }
  button { background: #6d28d9; color: white; border: 0; padding: 8px 14px; border-radius: 6px; font-size: 14px; cursor: pointer; }
  button:hover { background: #5b21b6; }
  pre { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; white-space: pre-wrap; word-wrap: break-word; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; line-height: 1.5; }
</style>
</head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">Transcript shared from Recall review. You can copy this and paste into ChatGPT, Claude, etc.</div>
<div class="actions"><button id="copyBtn" type="button">Copy transcript</button> <span id="copied" style="color:#059669;font-size:13px;margin-left:8px;display:none">Copied to clipboard.</span></div>
<pre id="t">${escapeHtml(transcript || '(transcript not yet available)')}</pre>
<script>
  document.getElementById('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('t').textContent);
      const el = document.getElementById('copied'); el.style.display = 'inline'; setTimeout(() => { el.style.display = 'none'; }, 2000);
    } catch (e) { alert('Copy failed: ' + e.message); }
  });
</script>
</body></html>`;
  res.type('text/html; charset=utf-8');
  return res.send(html);
});

router.get('/recall-review', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).type('html').send(`<p>Unauthorized.</p>`);
  const sec = encodeURIComponent(String(req.query.secret || '').trim());
  const rawF = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : 'incomplete';
  const allowedF = new Set(['all', 'incomplete', 'complete', 'skipped', 'to_verify', 'verified']);
  const statusFilter = allowedF.has(rawF) ? rawF : 'incomplete';
  const qHtml = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await getMeetingQueue(200, statusFilter, qHtml ? { titleContains: qHtml } : {});

  const rowsHtml = rows.length === 0
    ? '<tr><td colspan="5">No meetings.</td></tr>'
    : rows.map((r) => {
      const title = r.title || '—';
      const dur = formatDuration(r.duration_seconds);
      const when = formatBrisbane(r.updated_at || r.created_at);
      const st = r.status || 'incomplete';
      const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:${STATUS_COLOURS[st] || '#666'}">${escapeHtml(STATUS_LABELS[st] || st)}</span>`;
      return `<tr><td>${r.id}</td><td>${escapeHtml(when)}</td><td>${escapeHtml(title)}${dur ? ` (${dur})` : ''}</td><td>${badge}${r.needs_split ? ' ⚠️' : ''}</td><td><a href="/recall-review/${r.id}?secret=${sec}">Review</a></td></tr>`;
    }).join('');

  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recall Review Queue</title>
<style>body{font-family:system-ui;max-width:1080px;margin:0 auto;padding:1rem}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #eee;padding:10px 12px;text-align:left}th{background:#f8f8f8;font-size:12px;text-transform:uppercase}</style>
</head><body><h1>Recall Meeting Review Queue</h1><p>Filter: ${statusFilter}. <a href="/recall-review?status=all&secret=${sec}">Show all</a></p>
<table><thead><tr><th>#</th><th>When</th><th>Meeting</th><th>Status</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>
<p class="text-sm text-gray-500">Next.js UI: <code>/recall-review</code> on the portal (Guy-Wilson).</p></body></html>`);
});

// ---------------------------------------------------------------------------
// Fathom-direct helpers for the MCP tools below.
//
// These hit the Fathom REST API and BYPASS the transcript store entirely — the fallback
// path for "get it straight from Fathom" when the ingest/split pipeline has mangled or
// not yet filed a meeting (2026-07-03 back-to-back incident). Note: Fathom returns whole
// RECORDINGS, so a back-to-back morning comes back as one blob with timestamps + speakers.
// ---------------------------------------------------------------------------
const FATHOM_DIRECT_API_BASE = 'https://api.fathom.ai/external/v1';

async function fathomDirectFetchMeetings(apiKey, { includeTranscript = false, createdAfter } = {}) {
  const u = new URL(`${FATHOM_DIRECT_API_BASE}/meetings`);
  u.searchParams.set('limit', '25');
  if (includeTranscript) u.searchParams.set('include_transcript', 'true');
  if (createdAfter) u.searchParams.set('created_after', createdAfter);
  const r = await fetch(u.toString(), { headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`Fathom API ${r.status} ${r.statusText}`);
  const data = await r.json();
  return data.items || data.meetings || data.data || [];
}

function fathomDirectMeetingSummary(m) {
  const start = m.recording_start_time || m.scheduled_start_time || m.created_at || '';
  const end = m.recording_end_time || m.scheduled_end_time || '';
  let durMin = null;
  if (start && end) {
    const d = (Date.parse(end) - Date.parse(start)) / 60000;
    if (Number.isFinite(d) && d > 0) durMin = Math.round(d);
  }
  const invitees = (m.calendar_invitees || m.invitees || [])
    .filter((p) => p && p.is_external)
    .map((p) => `${p.name || '?'} <${p.email || '?'}>`);
  return {
    recordingId: String(m.recording_id ?? m.id ?? '?'),
    title: m.title || m.meeting_title || '(untitled)',
    start,
    durMin,
    invitees,
  };
}

/** Case-insensitive match of a fathom meeting against a free-text query (title or invitee name/email). */
function fathomDirectMeetingMatches(m, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const s = fathomDirectMeetingSummary(m);
  return s.title.toLowerCase().includes(q) || s.invitees.some((i) => i.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Remote MCP endpoint for Claude.ai browser ("Add custom connector")
// URL: POST /mcp/:token  where :token = PB_WEBHOOK_SECRET
// ---------------------------------------------------------------------------
// Diagnostic access log (2026-07-03): claude.ai chats intermittently report this connector as
// absent and there is otherwise NO trace of whether the client ever reached us. Log every hit
// so "never knocked" (claude.ai side) can be told apart from "knocked and we fumbled it".
function logMcpConnectorHit(req, note) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 60);
  const rpc = req.body?.method || 'n/a';
  console.log(`MCP-CONNECTOR ${req.method} rpc=${rpc} ${note || ''} ua="${ua}"`);
}

// Non-POST probes (some MCP clients open a GET stream or send DELETE on session close).
router.get('/mcp/:token', (req, res) => {
  logMcpConnectorHit(req, 'GET-probe');
  res.status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST' } });
});
router.delete('/mcp/:token', (req, res) => {
  logMcpConnectorHit(req, 'DELETE-probe');
  res.status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST' } });
});

router.post('/mcp/:token', express.json(), async (req, res) => {
  const expected = (process.env.PB_WEBHOOK_SECRET || '').trim();
  // URL-safe alias (2026-07-03): the legacy secret contains "!!@@" — a raw "@" in a URL, which
  // claude.ai's connector plumbing now appears to reject client-side (refresh/chat produce NO
  // request at all). MCP_CONNECTOR_TOKEN is a clean hex token for the connector URL; the old
  // secret keeps working so nothing else breaks.
  const alt = (process.env.MCP_CONNECTOR_TOKEN || '').trim();
  const authOk = (expected && req.params.token === expected) || (alt && req.params.token === alt);
  logMcpConnectorHit(req, authOk ? 'auth=ok' : 'auth=BAD');
  if (!authOk) {
    const id = req.body?.id ?? null;
    return res.status(401).json({ jsonrpc: '2.0', id, error: { code: -32001, message: 'unauthorized' } });
  }

  const { method, params, id } = req.body || {};

  if (method === 'initialize') {
    // Echo the client's protocol version when it's one we can serve (claude.ai sends its
    // preferred version; answering with an ancient one risks being treated as degraded).
    const requested = String(params?.protocolVersion || '').trim();
    const KNOWN = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
    return res.json({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: KNOWN.has(requested) ? requested : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'recall-transcript', version: '1.1.0' },
      },
    });
  }

  // Notifications have no id — acknowledge silently
  if (!id && method && method.startsWith('notifications/')) {
    return res.status(204).end();
  }

  // Modern clients probe these even when we have nothing to offer — answering "method not
  // found" can get the server quietly demoted, so give well-formed empty answers instead.
  if (method === 'ping') {
    return res.json({ jsonrpc: '2.0', id, result: {} });
  }
  if (method === 'prompts/list') {
    return res.json({ jsonrpc: '2.0', id, result: { prompts: [] } });
  }
  if (method === 'resources/list') {
    return res.json({ jsonrpc: '2.0', id, result: { resources: [] } });
  }
  if (method === 'resources/templates/list') {
    return res.json({ jsonrpc: '2.0', id, result: { resourceTemplates: [] } });
  }

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0', id,
      result: {
        tools: [
          {
            name: 'recall_latest_transcript',
            description: 'Fetches the latest meeting transcript for a lead from the reviewed transcript STORE (meetings already filed and split per person). Use when asked for a transcript for a specific person (by email). Returns the formatted transcript text. If the result looks wrong (missing, empty, or contains a different person\'s call), fall back to fathom_transcript to pull the raw recording straight from Fathom.',
            inputSchema: {
              type: 'object',
              properties: {
                email: { type: 'string', description: 'The lead\'s email address (must match their Airtable record)' },
                after: { type: 'string', description: 'Optional ISO 8601 date — only return meetings on or after this date/time' },
              },
              required: ['email'],
            },
          },
          {
            name: 'fathom_list_meetings',
            description: 'Lists the most recent Fathom recordings (title, start time, duration, external invitees, recording_id) straight from the Fathom API, bypassing the transcript store. Use to see what Fathom captured — e.g. to find the right recording before calling fathom_transcript.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Optional filter — matches meeting title or invitee name/email (case-insensitive)' },
                after: { type: 'string', description: 'Optional ISO 8601 date — only recordings created on or after this date/time' },
              },
            },
          },
          {
            name: 'fathom_transcript',
            description: 'Fetches a verbatim meeting transcript DIRECTLY from Fathom, bypassing the transcript store. Use when the user says to get it "from Fathom", or when recall_latest_transcript returns nothing/wrong content. NOTE: Fathom returns whole recordings — a back-to-back session comes back as ONE transcript covering all its calls (use timestamps + speaker names to find the right portion). Identify the recording by recording_id (from fathom_list_meetings), or by query (title/invitee match — most recent match wins).',
            inputSchema: {
              type: 'object',
              properties: {
                recording_id: { type: 'string', description: 'Fathom recording_id (from fathom_list_meetings) — most precise' },
                query: { type: 'string', description: 'Title or invitee name/email to match (most recent matching recording is returned)' },
                after: { type: 'string', description: 'Optional ISO 8601 date — only consider recordings created on or after this date/time' },
              },
            },
          },
          // Wingguy onboarding / status tool ("get me started") — shared defs with /mcp2.
          ...require('../services/wingguyGetStartedMcp').legacyToolList(),
          // Wingguy rules-store tools ("update my rules") — shared defs with /mcp2.
          ...require('../services/wingguyRulesMcp').legacyToolList(),
          // Wingguy booking tools (the ONE BOOKING DOOR) — shared defs with /mcp2.
          ...require('../services/wingguyBookingMcp').legacyToolList(),
          // Wingguy mail tools (clean-link draft door) — shared defs with /mcp2.
          ...require('../services/wingguyMailMcp').legacyToolList(),
        ],
      },
    });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    // --- Wingguy rules-store + booking tools (shared executors with /mcp2) ---
    if (String(toolName || '').startsWith('wingguy_')) {
      const result = await require('../services/wingguyGetStartedMcp').legacyToolCall(toolName, args)
        || await require('../services/wingguyRulesMcp').legacyToolCall(toolName, args)
        || await require('../services/wingguyBookingMcp').legacyToolCall(toolName, args)
        || await require('../services/wingguyMailMcp').legacyToolCall(toolName, args);
      if (result) return res.json({ jsonrpc: '2.0', id, result });
    }

    // --- Fathom-direct tools (bypass the store; see helpers above) ---------
    if (toolName === 'fathom_list_meetings' || toolName === 'fathom_transcript') {
      try {
        const coachClient = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
        if (!coachClient?.fathomApiKey) {
          return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Server config error: no Fathom API key for the coach client.' }], isError: true } });
        }

        if (toolName === 'fathom_list_meetings') {
          let items = await fathomDirectFetchMeetings(coachClient.fathomApiKey, { createdAfter: args.after });
          items = items.filter((m) => fathomDirectMeetingMatches(m, args.query));
          if (!items.length) {
            return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'No Fathom recordings matched.' }] } });
          }
          const lines = items.map((m) => {
            const s = fathomDirectMeetingSummary(m);
            return `- recording_id=${s.recordingId} | "${s.title}" | start=${s.start}${s.durMin ? ` | ${s.durMin} min` : ''}${s.invitees.length ? ` | invitees: ${s.invitees.join(', ')}` : ''}`;
          });
          return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Fathom recordings (newest window, ${items.length} shown):\n${lines.join('\n')}` }] } });
        }

        // fathom_transcript
        if (!args.recording_id && !(args.query || '').trim()) {
          return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Provide recording_id (from fathom_list_meetings) or a query (title / invitee name / email).' }], isError: true } });
        }
        const items = await fathomDirectFetchMeetings(coachClient.fathomApiKey, { includeTranscript: true, createdAfter: args.after });
        let meeting = null;
        if (args.recording_id) {
          meeting = items.find((m) => String(m.recording_id ?? m.id) === String(args.recording_id));
        } else {
          const matches = items.filter((m) => fathomDirectMeetingMatches(m, args.query));
          matches.sort((a, b) => Date.parse(fathomDirectMeetingSummary(b).start || 0) - Date.parse(fathomDirectMeetingSummary(a).start || 0));
          meeting = matches[0] || null;
        }
        if (!meeting) {
          return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'No matching Fathom recording found in the recent window. Try fathom_list_meetings to see what is available.' }], isError: true } });
        }

        const { normalizeFathomApiTranscript } = require('../services/fathomIngestService');
        const transcript = normalizeFathomApiTranscript(meeting);
        if (!transcript) {
          return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Recording found but its transcript is empty (Fathom may still be processing it).' }], isError: true } });
        }
        const s = fathomDirectMeetingSummary(meeting);
        const header = [
          `Fathom recording: "${s.title}" (recording_id=${s.recordingId})`,
          `Start: ${s.start}${s.durMin ? ` | Duration: ${s.durMin} min` : ''}`,
          s.invitees.length ? `External invitees: ${s.invitees.join(', ')}` : '',
          'Source: Fathom API direct (raw recording — may span back-to-back calls; check timestamps/speakers)',
          '---',
          '',
        ].filter(Boolean).join('\n');
        return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: header + transcript }] } });
      } catch (e) {
        return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Fathom API error: ${e.message}` }], isError: true } });
      }
    }

    if (toolName !== 'recall_latest_transcript') {
      return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${toolName}` } });
    }

    const email = (args.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: a valid email address is required.' }], isError: true } });
    }

    try {
      const coachClient = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
      if (!coachClient?.airtableBaseId) {
        return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Server config error: coach base not set.' }], isError: true } });
      }
      const lead = await findLeadByEmail(coachClient, email);
      if (!lead?.id) {
        return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `No lead found for email: ${email}` }], isError: true } });
      }

      const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || email;
      let rows = await getMeetingsForLead(lead.id, 100);

      if (args.after) {
        const afterMs = new Date(args.after).getTime();
        if (!isNaN(afterMs)) {
          rows = rows.filter((r) => {
            const t = r.meeting_start || r.created_at;
            return t && new Date(t).getTime() >= afterMs;
          });
        }
      }

      if (!rows || rows.length === 0) {
        return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `No meetings found for ${leadName} (${email}).` }] } });
      }

      const latest = rows[0];
      const rawText = latest.transcript_text || '';
      const transcript = await replaceParticipantLabelsInTranscript(rawText, latest.meeting_id);

      const dateStr = latest.meeting_start || latest.created_at || '';
      const durMin = latest.duration_seconds ? Math.round(latest.duration_seconds / 60) : null;

      const header = [
        `Meeting: ${latest.title || 'Meeting'} (#${latest.meeting_id})`,
        `Lead: ${leadName} (${email})`,
        dateStr ? `Date: ${dateStr}` : '',
        durMin ? `Duration: ${durMin} min` : '',
        '---',
        '',
      ].filter(Boolean).join('\n');

      return res.json({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: header + transcript }] },
      });
    } catch (e) {
      return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } });
    }
  }

  return res.json({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } });
});

module.exports = router;
