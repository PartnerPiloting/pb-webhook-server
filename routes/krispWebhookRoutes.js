/**
 * Krisp Webhook API — ingestion + review queue.
 *
 * Three-table model:
 *   krisp_webhook_events  — raw immutable payloads
 *   krisp_meetings        — one per real conversation (review queue)
 *   krisp_meeting_participants — who was in each meeting
 */

const KRISP_WEBHOOK_SKIP_AUTH_HARDCODED = false;

const express = require('express');
const crypto = require('crypto');
const { createSafeLogger } = require('../utils/loggerHelper');
const {
  persistKrispWebhook,
  getKrispWebhookDbSummary,
  getKrispWebhookEventById,
  createMeeting,
  getMeetingById,
  getMeetingQueue,
  updateMeetingStatus,
  setMeetingIngestStatus,
  splitMeeting,
  upsertMeetingParticipant,
  getParticipantsForMeeting,
  saveMeetingSpeakers,
  getMeetingsForLead,
  listMeetingLeads,
  addMeetingLead,
  removeMeetingLead,
  syncMeetingReviewStatus,
  recomputeAllKrispMeetingReviewStatuses,
  seedManualTestTranscript,
  purgeManualTestTranscripts,
} = require('../services/krispWebhookDb');
const { extractSpeakerLabels, sampleLinesForSpeaker } = require('../services/krispSpeakerLabels');
const { extractKrispDisplayText, krispEventTypeLabel } = require('../services/krispPayloadText');
const { linkKrispEventToLeadsByEmail, DEFAULT_COACH_CLIENT_ID } = require('../services/krispLeadLinkService');
const { maybeSendKrispUnmatchedAlert } = require('../services/krispUnmatchedAlertService');
const { maybeSendKrispConversationAlert } = require('../services/krispConversationEmailService');
const {
  listCalendarEventsWithAttendeesInRange,
  getEventsForDate,
} = require('../config/calendarServiceAccount.js');
const clientService = require('../services/clientService');
const { analyzeTranscript } = require('../services/krispTranscriptAnalysisService');
const { findLeadByEmail } = require('../services/inboundEmailService');

const router = express.Router();

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

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

function krispInboundSecret() {
  return (process.env.KRISP_WEBHOOK_INBOUND_SECRET || process.env.PB_WEBHOOK_SECRET || '').trim();
}

function krispSkipAuth() {
  if (KRISP_WEBHOOK_SKIP_AUTH_HARDCODED) return true;
  const v = (process.env.KRISP_WEBHOOK_SKIP_AUTH || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
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

async function pbKrispReviewApiOk(req) {
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
    const allowed = (process.env.KRISP_REVIEW_ALLOWED_CLIENT_IDS || DEFAULT_COACH_CLIENT_ID || 'Guy-Wilson')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return allowed.includes(String(client.clientId).toLowerCase());
  } catch (_e) { return false; }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

function extractKrispMeetingWindowUtc(payload, padMinutes = 10) {
  const m = payload && typeof payload === 'object' ? payload.data?.meeting : null;
  if (!m || typeof m !== 'object') return { error: 'payload.data.meeting missing' };
  const startRaw = m.start_date ?? m.startDate;
  if (!startRaw || typeof startRaw !== 'string') return { error: 'meeting.start_date missing' };
  const t0 = new Date(startRaw);
  if (Number.isNaN(t0.getTime())) return { error: 'invalid meeting.start_date' };
  const endRaw = m.end_date ?? m.endDate;
  let t1;
  if (endRaw && typeof endRaw === 'string') {
    t1 = new Date(endRaw);
    if (Number.isNaN(t1.getTime())) t1 = new Date(t0.getTime() + 3600000);
  } else {
    t1 = new Date(t0.getTime() + 3600000);
  }
  const padMs = Math.max(0, Math.min(120, padMinutes)) * 60 * 1000;
  return {
    timeMin: new Date(t0.getTime() - padMs),
    timeMax: new Date(t1.getTime() + padMs),
    coreStart: t0.toISOString(),
    coreEnd: t1.toISOString(),
    calendarEventId: m.calendar_event_id != null ? m.calendar_event_id : null,
    meetingTitle: typeof m.title === 'string' ? m.title : null,
  };
}

function rankCalendarEventsForKrispCoreWindow(events, coreStartIso, coreEndIso) {
  const ks = new Date(coreStartIso).getTime();
  const ke = new Date(coreEndIso).getTime();
  if (!Array.isArray(events) || !Number.isFinite(ks) || !Number.isFinite(ke) || ke <= ks) {
    return { ranked: events || [], suggested: [] };
  }
  const augmented = events.map((ev) => {
    const startStr = ev.start;
    const endStr = ev.end || startStr;
    const allDay = typeof startStr === 'string' && !String(startStr).includes('T');
    let overlapMs = 0;
    let multiDayAllDay = false;
    let note = '';
    if (allDay) {
      const sd = String(startStr).slice(0, 10);
      const edExcl = String(endStr).slice(0, 10);
      const spanDays = (Date.parse(`${edExcl}T00:00:00.000Z`) - Date.parse(`${sd}T00:00:00.000Z`)) / 86400000;
      multiDayAllDay = spanDays > 1.05;
      const rangeStart = Date.parse(`${sd}T00:00:00.000Z`);
      const rangeEndExcl = Date.parse(`${edExcl}T00:00:00.000Z`);
      overlapMs = Math.max(0, Math.min(ke, rangeEndExcl) - Math.max(ks, rangeStart));
      note = multiDayAllDay ? 'all-day multi-day (ignored)' : 'all-day event';
    } else {
      const es = new Date(startStr).getTime();
      const ee = new Date(endStr).getTime();
      if (Number.isFinite(es) && Number.isFinite(ee)) overlapMs = Math.max(0, Math.min(ke, ee) - Math.max(ks, es));
      note = overlapMs > 0 ? 'timed event overlaps' : 'timed event no overlap';
    }
    let priority = 0;
    if (multiDayAllDay) priority = 0;
    else if (!allDay && overlapMs > 0) priority = 3;
    else if (!allDay) priority = 2;
    else priority = 1;
    return { ...ev, match: { overlap_ms: overlapMs, all_day: allDay, multi_day_all_day: multiDayAllDay, priority, note } };
  });
  augmented.sort((a, b) => b.match.priority !== a.match.priority ? b.match.priority - a.match.priority : b.match.overlap_ms - a.match.overlap_ms);
  const suggested = augmented.filter((e) => !e.match.multi_day_all_day && !e.match.all_day && e.match.overlap_ms > 0);
  return { ranked: augmented, suggested };
}

async function resolveCalendarEmailForIngest() {
  const clientId = (process.env.KRISP_CALENDAR_CLIENT_ID || process.env.KRISP_COACH_CLIENT_ID || '').trim() || DEFAULT_COACH_CLIENT_ID;
  const baseId = process.env.MASTER_CLIENTS_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (clientId && baseId && apiKey) {
    const safe = clientId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const url = `https://api.airtable.com/v0/${baseId}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${safe}')&fields[]=Google Calendar Email`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (r.ok) {
        const data = await r.json();
        const cal = data.records?.[0]?.fields?.['Google Calendar Email'];
        if (cal && String(cal).trim()) return { calendarEmail: String(cal).trim(), clientId };
      }
    } catch (_) { /* fall through */ }
  }
  const envCal = (process.env.KRISP_CALENDAR_MATCH_EMAIL || '').trim();
  if (envCal) return { calendarEmail: envCal, clientId: null };
  return { calendarEmail: null, clientId: clientId || null };
}

async function resolveCalendarEmailForKrispHarness(req) {
  const qCal = typeof req.query.calendarEmail === 'string' ? req.query.calendarEmail.trim() : '';
  if (qCal) return { calendarEmail: qCal, resolved_via: 'query_calendarEmail', clientId: null };
  const qClient = typeof req.query.clientId === 'string' ? req.query.clientId.trim() : '';
  const clientId = qClient || (process.env.KRISP_CALENDAR_CLIENT_ID || process.env.KRISP_COACH_CLIENT_ID || '').trim() || DEFAULT_COACH_CLIENT_ID;
  const baseId = process.env.MASTER_CLIENTS_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (clientId && baseId && apiKey) {
    const safe = clientId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const url = `https://api.airtable.com/v0/${baseId}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${safe}')&fields[]=Google Calendar Email`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (r.ok) {
        const data = await r.json();
        const cal = data.records?.[0]?.fields?.['Google Calendar Email'];
        if (cal && String(cal).trim()) return { calendarEmail: String(cal).trim(), resolved_via: 'airtable_clients', clientId };
      }
    } catch (_) { /* fall through */ }
  }
  const envCal = (process.env.KRISP_CALENDAR_MATCH_EMAIL || '').trim();
  if (envCal) return { calendarEmail: envCal, resolved_via: 'env', clientId: null };
  return { calendarEmail: null, resolved_via: null, clientId: clientId || null, error: 'No calendar resolved' };
}

function krispParticipantSummaryForHarness(payload) {
  const d = payload?.data;
  if (!d || typeof d !== 'object') return { sources: [], emails: [] };
  const emails = new Set();
  const sources = [];
  const add = (arr, label) => {
    if (!Array.isArray(arr)) return;
    for (const p of arr) {
      if (p && typeof p.email === 'string' && p.email.trim()) {
        const e = p.email.trim().toLowerCase();
        if (!emails.has(e)) {
          emails.add(e);
          const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || (typeof p.name === 'string' ? p.name.trim() : '');
          sources.push({ from: label, email: p.email.trim(), name });
        }
      }
    }
  };
  add(d.participants, 'data.participants');
  if (d.meeting && typeof d.meeting === 'object') {
    add(d.meeting.participants, 'data.meeting.participants');
    add(d.meeting.speakers, 'data.meeting.speakers');
  }
  return { sources, emails: [...emails] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  try { return new Date(isoStr).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return String(isoStr); }
}

// ---------------------------------------------------------------------------
// GET probe (Krisp verifies URL)
// ---------------------------------------------------------------------------

router.get('/webhooks/krisp', (_req, res) => res.status(200).json({ ok: true, krisp_webhook: true }));
router.head('/webhooks/krisp', (_req, res) => res.status(204).end());

// ---------------------------------------------------------------------------
// Admin: DB summary
// ---------------------------------------------------------------------------

router.get('/webhooks/krisp/db-summary', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'admin auth required' });
  const limit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 15;
  const summary = await getKrispWebhookDbSummary(Number.isFinite(limit) ? limit : 15);
  res.json(summary);
});

/** Recompute speaker-review status for recent meetings (stricter rules; run once after deploy). GET or POST; admin auth. */
async function recomputeReviewStatusesHandler(req, res) {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'admin auth required' });
  const rawLim = req.body?.limit != null ? req.body.limit : req.query.limit;
  const lim = rawLim != null ? parseInt(String(rawLim), 10) : 500;
  const out = await recomputeAllKrispMeetingReviewStatuses(Number.isFinite(lim) ? lim : 500);
  res.json(out);
}
router.post('/webhooks/krisp/recompute-review-statuses', recomputeReviewStatusesHandler);
router.get('/webhooks/krisp/recompute-review-statuses', recomputeReviewStatusesHandler);

// ---------------------------------------------------------------------------
// Calendar match harness (admin)
// ---------------------------------------------------------------------------

router.get('/webhooks/krisp/calendar-match-harness', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'admin auth required' });
  const calResolved = await resolveCalendarEmailForKrispHarness(req);
  if (!calResolved.calendarEmail) return res.status(400).json({ error: calResolved.error || 'could not resolve calendar' });

  const postgresIdRaw = req.query.postgresId ?? req.query.postgres_id;
  if (!postgresIdRaw) return res.status(400).json({ error: 'postgresId required' });

  const row = await getKrispWebhookEventById(String(postgresIdRaw).trim());
  if (!row) return res.status(404).json({ error: 'not found' });

  const win = extractKrispMeetingWindowUtc(row.payload, 10);
  if (win.error) return res.json({ postgres_id: String(row.id), error: win.error });

  const cal = await listCalendarEventsWithAttendeesInRange(calResolved.calendarEmail, win.timeMin, win.timeMax);
  const { ranked, suggested } = rankCalendarEventsForKrispCoreWindow(cal.events || [], win.coreStart, win.coreEnd);

  res.json({
    harness: 'krisp-calendar-match',
    calendar: { calendarEmail: calResolved.calendarEmail, clientId: calResolved.clientId },
    krisp_meeting: { core_start: win.coreStart, core_end: win.coreEnd, title: win.meetingTitle },
    krisp_participants: krispParticipantSummaryForHarness(row.payload),
    calendar_events_suggested: suggested,
    calendar_events_ranked: ranked,
  });
});

// ---------------------------------------------------------------------------
// Review queue — JSON API for Next.js frontend
// ---------------------------------------------------------------------------

router.get('/krisp-review/api/queue', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const raw = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const allowed = new Set(['all', 'incomplete', 'complete', 'skipped', 'to_verify', 'verified']);
  const statusFilter = allowed.has(raw) ? raw : 'incomplete';
  const qTitle = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await getMeetingQueue(200, statusFilter, qTitle ? { titleContains: qTitle } : {});
  return res.json({ rows, statusFilter, q: qTitle || undefined });
});

router.get('/krisp-review/api/event/:id', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
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

  // Build verified speakers map from participants
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

  // Calendar attendee suggestions
  let calendarAttendees = [];
  try {
    const calResolved = await resolveCalendarEmailForKrispHarness(req);
    if (calResolved.calendarEmail) {
      const win = extractKrispMeetingWindowUtc(row.payload, 10);
      if (!win.error) {
        const events = await listCalendarEventsWithAttendeesInRange(calResolved.calendarEmail, win.timeMin, win.timeMax);
        const { suggested } = rankCalendarEventsForKrispCoreWindow(events.events || [], win.coreStart, win.coreEnd);
        const best = suggested[0];
        if (best?.attendees) {
          calendarAttendees = best.attendees.filter(a => a.email && !a.self).map(a => ({ email: a.email, name: a.displayName || '' }));
        }
      }
    }
  } catch (_e) { /* calendar optional */ }

  return res.json({
    id: row.id,
    webhook_event_id: row.webhook_event_id,
    created_at: row.created_at,
    webhook_received_at: row.webhook_received_at,
    krisp_id: row.krisp_id,
    status: row.status,
    status_reason: row.status_reason || null,
    needs_split: !!row.needs_split,
    start_line: row.start_line,
    end_line: row.end_line,
    title: row.title || row.webhook_event || 'Krisp meeting',
    duration: row.duration_seconds,
    full_text: fullText,
    speaker_labels: speakerLabels,
    speaker_samples: speakerSamples,
    verified_speakers: verifiedSpeakers,
    participants,
    meeting_leads: meetingLeads,
    coach_hint: coachHint,
    calendar_attendees: calendarAttendees,
  });
});

// Save speaker assignments (role coach|client|other + optional lead). Recomputes incomplete/complete.
router.post('/krisp-review/:id/speakers', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
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
            await upsertMeetingParticipant({
              meetingId: req.params.id,
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

router.post('/krisp-review/:id/meeting-leads', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const leadId = typeof req.body?.airtable_lead_id === 'string' ? req.body.airtable_lead_id.trim() : '';
  if (!leadId) return res.status(400).json({ error: 'airtable_lead_id required' });
  const out = await addMeetingLead(req.params.id, leadId, DEFAULT_COACH_CLIENT_ID, 'manual');
  return res.json(out);
});

router.delete('/krisp-review/:id/meeting-leads/:leadId', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const leadId = String(req.params.leadId || '').trim();
  if (!leadId) return res.status(400).json({ error: 'leadId required' });
  const out = await removeMeetingLead(req.params.id, leadId);
  return res.json(out);
});

router.get('/krisp-review/api/search-lead', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'email query required' });
  try {
    const client = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
    if (!client?.airtableBaseId) return res.json({ lead: null, error: 'no_base' });
    const lead = await findLeadByEmail(client, email);
    if (!lead?.id) return res.json({ lead: null });
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || email;
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

router.post('/krisp-review/:id/status', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const status = req.body?.status;
  if (!status || typeof status !== 'string') return res.status(400).json({ error: 'status required' });
  const result = await updateMeetingStatus(req.params.id, status);
  return res.json(result);
});

router.post('/krisp-review/:id/split', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const splitAtLine = req.body?.splitAtLine;
  if (typeof splitAtLine !== 'number' || splitAtLine < 1) return res.status(400).json({ error: 'splitAtLine required' });
  const result = await splitMeeting(req.params.id, splitAtLine);
  return res.json(result);
});

router.post('/krisp-review/:id/analyze', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const row = await getMeetingById(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const fullText = row.transcript_text || '';
  const result = await analyzeTranscript(fullText, {
    meetingTitle: row.title,
    durationSeconds: row.duration_seconds,
  });

  if (result.needsSplit && !result.error) {
    try {
      await setMeetingIngestStatus(req.params.id, {
        status: 'to_verify',
        statusReason: `AI: ${result.splitReason || 'back-to-back detected'}`,
        needsSplit: true,
      });
    } catch (_) { /* best effort */ }
  }

  return res.json(result);
});

// ---------------------------------------------------------------------------
// Simple HTML portal (admin)
// ---------------------------------------------------------------------------

router.get('/krisp-portal', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).type('html').send(`<p>Unauthorized. Add ?secret=PB_WEBHOOK_SECRET</p>`);
  const sec = encodeURIComponent(String(req.query.secret || '').trim());
  const summary = await getKrispWebhookDbSummary(50);
  if (!summary.database_configured) return res.status(503).type('html').send(`<p>Database not configured.</p>`);
  const rows = summary.recent || [];
  const list = rows.map((r) =>
    `<tr><td>${escapeHtml(String(r.id))}</td><td>${escapeHtml(String(r.received_at))}</td><td>${escapeHtml(String(r.event || ''))}</td><td><a href="/krisp-portal/event/${encodeURIComponent(String(r.id))}?secret=${sec}">Open</a></td></tr>`
  ).join('');
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Krisp webhooks</title>
<style>body{font-family:system-ui;max-width:960px;margin:1rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f5f5f5}</style>
</head><body><h1>Saved webhooks</h1><p>Total: ${escapeHtml(String(summary.total_rows))}</p>
<table><thead><tr><th>ID</th><th>Received</th><th>Event</th><th></th></tr></thead><tbody>${list}</tbody></table></body></html>`);
});

router.get('/krisp-portal/event/:id', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).type('html').send(`<p>Unauthorized.</p>`);
  const row = await getKrispWebhookEventById(req.params.id);
  if (!row) return res.status(404).type('html').send(`<p>Not found.</p>`);
  const sec = encodeURIComponent(String(req.query.secret || '').trim());
  const text = extractKrispDisplayText(row.payload);
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Event #${row.id}</title>
<style>body{font-family:system-ui;max-width:960px;margin:1rem auto;padding:0 1rem}textarea{width:100%;min-height:280px;font-family:monospace;font-size:13px}</style>
</head><body><p><a href="/krisp-portal?secret=${sec}">← Back</a></p><h1>Event #${escapeHtml(String(row.id))}</h1>
<textarea id="txt" readonly>${escapeHtml(text)}</textarea>
<button onclick="navigator.clipboard.writeText(document.getElementById('txt').value).then(()=>alert('Copied'))">Copy</button></body></html>`);
});

router.get('/krisp-portal/event/:id/json', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const row = await getKrispWebhookEventById(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(row);
});

// ---------------------------------------------------------------------------
// HTML review queue (admin — simpler version, main UI is Next.js)
// ---------------------------------------------------------------------------

router.get('/krisp-review', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).type('html').send(`<p>Unauthorized.</p>`);
  const sec = encodeURIComponent(String(req.query.secret || '').trim());
  const rawF = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : 'incomplete';
  const allowedF = new Set(['all', 'incomplete', 'complete', 'skipped', 'to_verify', 'verified']);
  const statusFilter = allowedF.has(rawF) ? rawF : 'incomplete';
  const qHtml = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await getMeetingQueue(200, statusFilter, qHtml ? { titleContains: qHtml } : {});

  const rowsHtml = rows.length === 0
    ? '<tr><td colspan="5">No meetings.</td></tr>'
    : rows.map(r => {
        const title = r.title || '—';
        const dur = formatDuration(r.duration_seconds);
        const when = formatBrisbane(r.webhook_received_at || r.created_at);
        const st = r.status || 'incomplete';
        const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:${STATUS_COLOURS[st] || '#666'}">${escapeHtml(STATUS_LABELS[st] || st)}</span>`;
        return `<tr><td>${r.id}</td><td>${escapeHtml(when)}</td><td>${escapeHtml(title)}${dur ? ` (${dur})` : ''}</td><td>${badge}${r.needs_split ? ' ⚠️' : ''}</td><td><a href="/krisp-review/${r.id}?secret=${sec}">Review</a></td></tr>`;
      }).join('');

  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Review Queue</title>
<style>body{font-family:system-ui;max-width:1080px;margin:0 auto;padding:1rem}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #eee;padding:10px 12px;text-align:left}th{background:#f8f8f8;font-size:12px;text-transform:uppercase}</style>
</head><body><h1>Meeting Review Queue</h1><p>Filter: ${statusFilter}. <a href="/krisp-review?status=all&secret=${sec}">Show all</a></p>
<table><thead><tr><th>#</th><th>When</th><th>Meeting</th><th>Status</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`);
});

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

router.post('/krisp-test/seed', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const out = await seedManualTestTranscript();
    return res.json(out);
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/krisp-test/purge', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const out = await purgeManualTestTranscripts();
    return res.json(out);
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// ---------------------------------------------------------------------------
// Webhook ingest
// ---------------------------------------------------------------------------

router.post('/webhooks/krisp', async (req, res) => {
  const log = createSafeLogger('SYSTEM', null, 'krisp_webhook');
  const skipAuth = krispSkipAuth();
  const expected = krispInboundSecret();

  if (!skipAuth) {
    if (!expected) {
      log.error('KRISP-WEBHOOK rejected: no secret configured');
      return res.status(503).json({ ok: false, error: 'server_not_configured' });
    }
    const authHeader = req.get('x-webhook-secret') || req.get('x-webhook-secr') || req.get('authorization') || '';
    const token = normalizeAuthToken(authHeader);
    if (!timingSafeEqualString(token, expected)) {
      log.warn(`KRISP-WEBHOOK rejected: invalid auth`);
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const nested = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : null;
  const meetingId = body.krisp_meeting_id ?? body.meeting_id ?? body.id ?? nested?.id ?? nested?.meeting_id ?? null;
  const title = body.meeting_title ?? body.title ?? nested?.title ?? nested?.meeting_title ?? nested?.name ?? null;
  const event = typeof body.event === 'string' ? body.event : null;

  log.info(`KRISP-WEBHOOK received event=${event ?? 'n/a'} meetingId=${meetingId ?? 'unknown'} title=${title ? String(title).slice(0, 120) : 'n/a'}`);

  // 1. Persist raw webhook (immutable)
  let dbSaved = false;
  let webhookId = null;
  let meetingDbId = null;
  try {
    const r = await persistKrispWebhook({ event, krispId: meetingId != null ? String(meetingId) : null, payload: body });
    dbSaved = r.ok === true;
    webhookId = r.postgres_id || null;
  } catch (e) {
    log.error(`KRISP-WEBHOOK db persist failed: ${e.message}`);
  }

  // 2. Create meeting row
  if (webhookId) {
    try {
      const transcriptText = extractKrispDisplayText(body);
      const m = nested?.meeting || {};
      const startRaw = m.start_date ?? m.startDate;
      const endRaw = m.end_date ?? m.endDate;
      const mr = await createMeeting({
        webhookEventId: webhookId,
        title: title ? String(title).slice(0, 500) : null,
        transcriptText,
        durationSeconds: m.duration_seconds || null,
        meetingStart: startRaw ? new Date(startRaw).toISOString() : null,
        meetingEnd: endRaw ? new Date(endRaw).toISOString() : null,
      });
      meetingDbId = mr.meeting_id || null;
    } catch (e) {
      log.warn(`KRISP-WEBHOOK meeting create failed: ${e.message}`);
    }
  }

  // 3. Auto-link participants from payload → create participant rows with Airtable leads
  let leadLinksLinked = 0;
  if (webhookId && meetingDbId) {
    try {
      const lr = await linkKrispEventToLeadsByEmail(webhookId, body);
      leadLinksLinked = lr.linked;

      for (let i = 0; i < (lr.linkedLeads || []).length; i++) {
        const ll = lr.linkedLeads[i];
        try {
          await upsertMeetingParticipant({
            meetingId: meetingDbId,
            speakerLabel: `Participant ${i + 1}`,
            verifiedEmail: ll.email,
            airtableLeadId: ll.leadId,
            matchMethod: ll.matchMethod || 'auto_email',
          });
          await addMeetingLead(meetingDbId, ll.leadId, DEFAULT_COACH_CLIENT_ID, 'ingest_auto');
        } catch (_) { /* best effort */ }
      }

      if (lr.unmatchedParticipants?.length > 0) {
        try {
          await maybeSendKrispUnmatchedAlert({
            postgresId: String(webhookId),
            krispId: meetingId != null ? String(meetingId) : null,
            event: event || null,
            unmatchedParticipants: lr.unmatchedParticipants,
          });
        } catch (alertErr) { log.warn(`KRISP-WEBHOOK unmatched alert failed: ${alertErr.message}`); }
      }
    } catch (linkErr) {
      log.warn(`KRISP-WEBHOOK lead link failed: ${linkErr.message}`);
    }
  }

  // Return 200 immediately
  res.status(200).json({
    ok: true,
    received: true,
    krisp_meeting_id: meetingId,
    db_saved: dbSaved,
    meeting_id: meetingDbId,
    lead_links_linked: leadLinksLinked,
  });

  // 4. Async: calendar check, AI analysis, status, email
  if (meetingDbId) {
    const asyncMeetingId = meetingDbId;
    const asyncWebhookId = webhookId;
    const asyncLeadsLinked = leadLinksLinked;
    setImmediate(async () => {
      const ingestStatus = 'incomplete';
      let statusReason = '';
      let needsSplit = false;

      try {
        const win = extractKrispMeetingWindowUtc(body, 10);
        if (!win.error) {
          const calResolved = await resolveCalendarEmailForIngest();
          if (calResolved.calendarEmail) {
            const calResult = await listCalendarEventsWithAttendeesInRange(calResolved.calendarEmail, win.timeMin, win.timeMax);
            const { suggested } = rankCalendarEventsForKrispCoreWindow(calResult.events || [], win.coreStart, win.coreEnd);
            const timedOverlaps = suggested.length;

            if (timedOverlaps >= 2) {
              needsSplit = true;
              statusReason = `${timedOverlaps} calendar events overlap — possible back-to-back`;
            } else if (timedOverlaps === 1 && asyncLeadsLinked > 0) {
              statusReason = `Ingest: ${asyncLeadsLinked} lead(s) matched from payload; 1 calendar event — confirm speakers in review`;
            } else if (asyncLeadsLinked > 0) {
              statusReason = `Ingest: ${asyncLeadsLinked} lead(s) matched from payload — confirm speakers in review`;
            } else {
              statusReason = timedOverlaps === 0 ? 'No leads linked from payload, no calendar overlap' : `No leads linked from payload, ${timedOverlaps} calendar event`;
            }
          } else {
            statusReason = asyncLeadsLinked > 0
              ? `Ingest: ${asyncLeadsLinked} lead(s) from payload; calendar not resolved — confirm in review`
              : 'No leads linked; calendar not resolved';
          }
        } else {
          statusReason = asyncLeadsLinked > 0
            ? `Ingest: ${asyncLeadsLinked} lead(s); calendar skipped (${win.error})`
            : `Calendar skipped: ${win.error}`;
        }
      } catch (calErr) {
        log.warn(`KRISP-WEBHOOK async calendar failed: ${calErr.message}`);
        statusReason = asyncLeadsLinked > 0
          ? `Ingest: ${asyncLeadsLinked} lead(s); calendar error: ${calErr.message}`
          : `Calendar error: ${calErr.message}`;
      }

      try {
        const meeting = await getMeetingById(asyncMeetingId);
        const transcriptText = meeting?.transcript_text || '';
        if (transcriptText.length >= 50) {
          const aiResult = await analyzeTranscript(transcriptText, { meetingTitle: title, durationSeconds: body.data?.meeting?.duration_seconds });
          if (aiResult.needsSplit && !aiResult.error) {
            needsSplit = true;
            ingestStatus = 'to_verify';
            statusReason += ` | AI: ${aiResult.splitReason || 'back-to-back detected'}`;
          }
        }
      } catch (aiErr) { log.warn(`KRISP-WEBHOOK async AI failed: ${aiErr.message}`); }

      try {
        await setMeetingIngestStatus(asyncMeetingId, { status: ingestStatus, statusReason: statusReason.trim(), needsSplit });
        log.info(`KRISP-WEBHOOK async status=${ingestStatus} needsSplit=${needsSplit}`);
      } catch (stErr) { log.warn(`KRISP-WEBHOOK async status update failed: ${stErr.message}`); }

      try {
        await maybeSendKrispConversationAlert({
          postgresId: String(asyncWebhookId),
          meetingId: asyncMeetingId,
          payload: body,
          krispId: meetingId != null ? String(meetingId) : null,
          event: event || null,
          leadsLinked: asyncLeadsLinked,
        });
      } catch (convErr) { log.warn(`KRISP-WEBHOOK async email failed: ${convErr.message}`); }
    });
  }
});

module.exports = router;
