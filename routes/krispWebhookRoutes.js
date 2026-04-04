/**
 * Krisp Webhook API — ingestion stub.
 *
 * Krisp POSTs meeting payloads to your URL. Custom header (Krisp often rejects Authorization):
 *   X-Webhook-Secret: <same as KRISP_WEBHOOK_INBOUND_SECRET or PB_WEBHOOK_SECRET>
 *   (Krisp UI may truncate display to X-Webhook-Secr — we accept that alias too.)
 * Or: Authorization: Bearer <secret>   (or raw secret)
 * Use the same value as your existing admin secret, or a dedicated one:
 *   KRISP_WEBHOOK_INBOUND_SECRET=<secret>   (preferred if set)
 *   PB_WEBHOOK_SECRET=<secret>             (used if KRISP_WEBHOOK_INBOUND_SECRET is empty)
 *
 * Optional: KRISP_WEBHOOK_LOG_FULL_BODY=1 logs stringified JSON (large / sensitive — use briefly).
 * With DATABASE_URL (Render Postgres), each accepted POST is stored in krisp_webhook_events (JSONB).
 * Participant emails in payload.data.participants are matched to Leads in Airtable (default client KRISP_COACH_CLIENT_ID or Guy-Wilson); links in krisp_event_leads.
 * HTML portal (admin): GET /krisp-portal?secret=PB_WEBHOOK_SECRET — list; /krisp-portal/event/:id?secret=… — copy text.
 * Test harness (admin): POST /krisp-test/seed?secret=… — one fake row + same summary email as real webhooks (then purge if you like); POST /krisp-test/seed-fixtures?secret=… — 3 fixtures (no conversation emails); POST /krisp-test/purge?secret=… — remove harness rows.
 * POST /krisp-test/relink-event — JSON { "postgresId": "123" } re-runs lead linking for a stored row (after fixing Airtable).
 * Calendar match harness (admin): GET /webhooks/krisp/calendar-match-harness?secret=…&postgresId=7 — uses same calendar as Smart FUP: Airtable Clients "Google Calendar Email" for clientId (query) or KRISP_CALENDAR_CLIENT_ID / KRISP_COACH_CLIENT_ID. Override with calendarEmail=… or KRISP_CALENDAR_MATCH_EMAIL.
 *
 * Unmatched participants (email + name lookup both miss): optional email to ALERT_EMAIL when KRISP_UNMATCHED_EMAIL_ALERT=1 (Mailgun + FROM_EMAIL required). One alert per postgres row (deduped). Secure fix + transcript links when PB_WEBHOOK_SECRET or KRISP_PUBLIC_LINK_SECRET is set.
 * Every conversation: one email (ALERT_EMAIL or alert default) with all participants + transcript + Copy link (deduped per row).
 *
 * Insecure escape hatch: KRISP_WEBHOOK_SKIP_AUTH_HARDCODED below, or env KRISP_WEBHOOK_SKIP_AUTH=1.
 * Anyone who guesses the URL can send fake payloads. Turn off when Krisp Authorization header works.
 */

/** @type {boolean} Set true only to bypass auth while debugging Krisp UI. Prefer Authorization header matching PB_WEBHOOK_SECRET / KRISP_WEBHOOK_INBOUND_SECRET. */
const KRISP_WEBHOOK_SKIP_AUTH_HARDCODED = false;

const express = require('express');
const crypto = require('crypto');
const { createSafeLogger } = require('../utils/loggerHelper');
const {
  persistKrispWebhook,
  getKrispWebhookDbSummary,
  getKrispWebhookEventById,
  getKrispLinksForLead,
  getKrispTranscriptRowsForLead,
  seedManualTestTranscript,
  seedKrispBackendFixtures,
  purgeManualTestTranscripts,
  getKrispReviewQueue,
  getKrispReviewEventById,
  saveVerifiedSpeakers,
  updateKrispEventStatus,
} = require('../services/krispWebhookDb');
const { extractKrispDisplayText, krispEventTypeLabel } = require('../services/krispPayloadText');
const { linkKrispEventToLeadsByEmail, DEFAULT_COACH_CLIENT_ID } = require('../services/krispLeadLinkService');
const { maybeSendKrispUnmatchedAlert } = require('../services/krispUnmatchedAlertService');
const { maybeSendKrispConversationAlert } = require('../services/krispConversationEmailService');
const {
  listCalendarEventsWithAttendeesInRange,
  getEventsForDate,
} = require('../config/calendarServiceAccount.js');
const clientService = require('../services/clientService');

const router = express.Router();

function normalizeAuthToken(headerVal) {
  if (!headerVal || typeof headerVal !== 'string') return null;
  const s = headerVal.trim();
  const lower = s.toLowerCase();
  if (lower.startsWith('bearer ')) return s.slice(7).trim();
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
  return (
    process.env.KRISP_WEBHOOK_INBOUND_SECRET ||
    process.env.PB_WEBHOOK_SECRET ||
    ''
  ).trim();
}

function krispSkipAuth() {
  if (KRISP_WEBHOOK_SKIP_AUTH_HARDCODED) return true;
  const v = (process.env.KRISP_WEBHOOK_SKIP_AUTH || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Browser-friendly admin check: ?secret= same as PB_WEBHOOK_SECRET, or Authorization: Bearer … */
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

/**
 * Krisp review JSON API (Next.js fetch): PB secret, x-dev-key, or portal token + x-client-id for allowed clients.
 */
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
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return allowed.includes(String(client.clientId).toLowerCase());
  } catch (_e) {
    return false;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** From stored Krisp JSON: UTC window for calendar search (padded). */
function extractKrispMeetingWindowUtc(payload, padMinutes = 10) {
  const m = payload && typeof payload === 'object' ? payload.data?.meeting : null;
  if (!m || typeof m !== 'object') {
    return { error: 'payload.data.meeting missing' };
  }
  const startRaw = m.start_date ?? m.startDate;
  const endRaw = m.end_date ?? m.endDate;
  if (!startRaw || typeof startRaw !== 'string') {
    return { error: 'meeting.start_date missing' };
  }
  const t0 = new Date(startRaw);
  if (Number.isNaN(t0.getTime())) {
    return { error: 'invalid meeting.start_date' };
  }
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

/**
 * Rank Google Calendar events vs Krisp's real start/end. Deprioritises multi-day all-day banners (e.g. Easter).
 * @returns {{ ranked: object[], suggested: object[] }}
 */
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
      note = multiDayAllDay
        ? 'all-day multi-day (ignored for suggestions — use timed meeting or manual pick)'
        : 'all-day event';
    } else {
      const es = new Date(startStr).getTime();
      const ee = new Date(endStr).getTime();
      if (Number.isFinite(es) && Number.isFinite(ee)) {
        overlapMs = Math.max(0, Math.min(ke, ee) - Math.max(ks, es));
      }
      note = overlapMs > 0 ? 'timed event overlaps Krisp recording window' : 'timed event does not overlap Krisp recording window';
    }

    let priority = 0;
    if (multiDayAllDay) priority = 0;
    else if (!allDay && overlapMs > 0) priority = 3;
    else if (!allDay) priority = 2;
    else priority = 1;

    const { start, end, ...rest } = ev;
    return {
      ...rest,
      start,
      end,
      match: {
        overlap_ms: overlapMs,
        all_day: allDay,
        multi_day_all_day: multiDayAllDay,
        priority,
        note,
      },
    };
  });

  augmented.sort((a, b) => {
    if (b.match.priority !== a.match.priority) return b.match.priority - a.match.priority;
    return b.match.overlap_ms - a.match.overlap_ms;
  });

  const suggested = augmented.filter(
    (e) => !e.match.multi_day_all_day && !e.match.all_day && e.match.overlap_ms > 0,
  );

  return { ranked: augmented, suggested };
}

/**
 * Same calendar source as Smart FUP (`/api/calendar/upcoming-meeting-with-lead`): Airtable Clients → Google Calendar Email.
 * Priority: query calendarEmail → Airtable by clientId (query or env or same default as Krisp linking: DEFAULT_COACH_CLIENT_ID) → env KRISP_CALENDAR_MATCH_EMAIL.
 */
async function resolveCalendarEmailForKrispHarness(req) {
  const qCal = typeof req.query.calendarEmail === 'string' ? req.query.calendarEmail.trim() : '';
  if (qCal) return { calendarEmail: qCal, resolved_via: 'query_calendarEmail', clientId: null };

  const qClient = typeof req.query.clientId === 'string' ? req.query.clientId.trim() : '';
  const clientId =
    qClient ||
    (process.env.KRISP_CALENDAR_CLIENT_ID || process.env.KRISP_COACH_CLIENT_ID || '').trim() ||
    DEFAULT_COACH_CLIENT_ID;

  const baseId = process.env.MASTER_CLIENTS_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (clientId && baseId && apiKey) {
    const safe = clientId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const url = `https://api.airtable.com/v0/${baseId}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${safe}')&fields[]=Google Calendar Email`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!r.ok) {
        return {
          calendarEmail: null,
          resolved_via: null,
          clientId,
          error: `Airtable client lookup failed: HTTP ${r.status}`,
        };
      }
      const data = await r.json();
      const rec = data.records?.[0];
      const cal = rec?.fields?.['Google Calendar Email'];
      if (cal && String(cal).trim()) {
        return { calendarEmail: String(cal).trim(), resolved_via: 'airtable_clients', clientId };
      }
      return {
        calendarEmail: null,
        resolved_via: null,
        clientId,
        error: `No "Google Calendar Email" on Airtable for Client ID: ${clientId}`,
      };
    } catch (e) {
      return { calendarEmail: null, resolved_via: null, clientId, error: e.message };
    }
  }

  const envCal = (process.env.KRISP_CALENDAR_MATCH_EMAIL || '').trim();
  if (envCal) return { calendarEmail: envCal, resolved_via: 'env_KRISP_CALENDAR_MATCH_EMAIL', clientId: null };

  return {
    calendarEmail: null,
    resolved_via: null,
    clientId: clientId || null,
    error:
      'No calendar resolved: add "Google Calendar Email" on the Airtable client (e.g. Guy-Wilson), or pass calendarEmail=…, or set KRISP_CALENDAR_MATCH_EMAIL. Check MASTER_CLIENTS_BASE_ID and AIRTABLE_API_KEY on the server.',
  };
}

// Krisp (and similar UIs) often verify the URL with GET/HEAD before save — POST-only returned 404 and broke "Update".
router.get('/webhooks/krisp', (_req, res) => {
  res.status(200).json({ ok: true, krisp_webhook: true });
});

// Temporary debug endpoint — admin-auth protected, reveals secret metadata (not the full value) and tests incoming header.
router.get('/webhooks/krisp/debug', (req, res) => {
  const adminAuth = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const adminOk = adminAuth === (process.env.PB_WEBHOOK_SECRET || '').trim();
  if (!adminOk) return res.status(401).json({ error: 'admin auth required (PB_WEBHOOK_SECRET)' });

  const raw = process.env.KRISP_WEBHOOK_INBOUND_SECRET || '';
  const trimmed = raw.trim();
  const fallbackRaw = process.env.PB_WEBHOOK_SECRET || '';
  const usingFallback = !process.env.KRISP_WEBHOOK_INBOUND_SECRET;
  const effective = krispInboundSecret();

  const charCodes = (s) => [...s].map((c, i) => ({ pos: i, char: c === ' ' ? '(space)' : c.length > 1 ? `(multi-byte)` : c, code: c.charCodeAt(0) }));

  res.json({
    KRISP_WEBHOOK_INBOUND_SECRET_set: !!process.env.KRISP_WEBHOOK_INBOUND_SECRET,
    raw_length: raw.length,
    trimmed_length: trimmed.length,
    effective_length: effective.length,
    first3: effective.substring(0, 3),
    last3: effective.substring(effective.length - 3),
    char_codes: charCodes(effective),
    using_fallback_PB_WEBHOOK_SECRET: usingFallback,
    skip_auth: krispSkipAuth(),
  });
});

// Admin-only: Postgres row counts / recent Krisp rows (no payload JSON).
router.get('/webhooks/krisp/db-summary', async (req, res) => {
  const adminAuth = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const adminOk = adminAuth === (process.env.PB_WEBHOOK_SECRET || '').trim();
  if (!adminOk) return res.status(401).json({ error: 'admin auth required (PB_WEBHOOK_SECRET)' });

  const limit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 15;
  const summary = await getKrispWebhookDbSummary(Number.isFinite(limit) ? limit : 15);
  res.json(summary);
});

/**
 * Test harness: load Krisp row(s) from Postgres, derive meeting time from payload, fetch overlapping Google Calendar events (attendees).
 * Admin: ?secret=PB_WEBHOOK_SECRET or Authorization: Bearer …
 * Query: postgresId=7 OR recent=5 (1–20). Calendar: same as Smart FUP (Airtable by clientId / coach env) unless calendarEmail=… overrides. padMinutes=10 (optional).
 * sameDay=0 — skip extra full-day Brisbane query (default: include all events that local day so timed invites off the Krisp window still appear).
 */
router.get('/webhooks/krisp/calendar-match-harness', async (req, res) => {
  if (!pbAdminOk(req)) {
    return res.status(401).json({ error: 'admin auth required (PB_WEBHOOK_SECRET or ?secret=)' });
  }

  const harnessIncludeSameDay = !(
    req.query.sameDay === '0' || req.query.sameDay === 'false' || req.query.sameDay === 'no'
  );

  const calResolved = await resolveCalendarEmailForKrispHarness(req);
  if (!calResolved.calendarEmail) {
    return res.status(400).json({
      error: calResolved.error || 'could not resolve calendar email',
      hint: 'Uses Airtable "Google Calendar Email" for KRISP_COACH_CLIENT_ID when set (same as smart calendar).',
    });
  }
  const calendarEmail = calResolved.calendarEmail;

  const padRaw = req.query.padMinutes != null ? parseInt(String(req.query.padMinutes), 10) : 10;
  const padMinutes = Number.isFinite(padRaw) ? padRaw : 10;

  const postgresIdRaw = req.query.postgresId ?? req.query.postgres_id;
  const recentRaw = req.query.recent != null ? parseInt(String(req.query.recent), 10) : 0;
  const recent = Number.isFinite(recentRaw) ? Math.min(20, Math.max(0, recentRaw)) : 0;

  async function oneRow(idStr) {
    const row = await getKrispWebhookEventById(idStr);
    if (!row) {
      return { postgres_id: idStr, error: 'krisp_webhook_events row not found' };
    }
    const win = extractKrispMeetingWindowUtc(row.payload, padMinutes);
    if (win.error) {
      return {
        postgres_id: String(row.id),
        krisp_id: row.krisp_id,
        event: row.event,
        window_error: win.error,
        krisp_participants: krispParticipantSummaryForHarness(row.payload),
      };
    }
    const cal = await listCalendarEventsWithAttendeesInRange(calendarEmail, win.timeMin, win.timeMax);

    let sameDayEvents = [];
    let brisbaneYmd = null;
    let sameDayErr = null;
    if (harnessIncludeSameDay) {
      brisbaneYmd = new Date(win.coreStart).toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
      const dayRes = await getEventsForDate(calendarEmail, brisbaneYmd, 'Australia/Brisbane');
      sameDayEvents = dayRes.events || [];
      sameDayErr = dayRes.error || null;
    }

    const byId = new Map();
    for (const e of cal.events || []) {
      if (e.eventId) byId.set(e.eventId, e);
    }
    for (const e of sameDayEvents) {
      if (e.eventId && !byId.has(e.eventId)) byId.set(e.eventId, e);
      if (!e.eventId) byId.set(`noid:${byId.size}:${e.summary}:${e.start}`, e);
    }
    const mergedForRank = [...byId.values()];

    const { ranked, suggested } = rankCalendarEventsForKrispCoreWindow(mergedForRank, win.coreStart, win.coreEnd);
    return {
      postgres_id: String(row.id),
      krisp_id: row.krisp_id,
      event: row.event,
      received_at: row.received_at,
      krisp_meeting: {
        core_start: win.coreStart,
        core_end: win.coreEnd,
        padded_search_from: win.timeMin.toISOString(),
        padded_search_to: win.timeMax.toISOString(),
        calendar_event_id: win.calendarEventId,
        title: win.meetingTitle,
      },
      krisp_participants: krispParticipantSummaryForHarness(row.payload),
      calendar_match_hint:
        suggested.length === 0
          ? 'No timed calendar event overlaps Krisp start/end. Check calendar_events_same_day_brisbane for other meetings that day, or confirm the event is on this Google account and shared with the service account.'
          : null,
      calendar_events_narrow_window: cal.events,
      ...(harnessIncludeSameDay
        ? {
            brisbane_local_date: brisbaneYmd,
            calendar_events_same_day_brisbane: sameDayEvents,
            calendar_same_day_error: sameDayErr,
          }
        : {}),
      calendar_events: cal.events,
      calendar_events_merged_for_match: mergedForRank,
      calendar_events_suggested: suggested,
      calendar_events_ranked: ranked,
      calendar_error: cal.error || null,
    };
  }

  const calendarMeta = {
    calendarEmail,
    resolved_via: calResolved.resolved_via,
    clientId: calResolved.clientId,
  };

  if (postgresIdRaw != null && String(postgresIdRaw).trim() !== '') {
    const out = await oneRow(String(postgresIdRaw).trim());
    return res.json({ harness: 'krisp-calendar-match', calendar: calendarMeta, result: out });
  }

  if (recent > 0) {
    const summary = await getKrispWebhookDbSummary(recent);
    if (!summary.database_configured) {
      return res.status(503).json({ error: summary.error || 'database not configured' });
    }
    const ids = (summary.recent || []).map((r) => String(r.id));
    const results = [];
    for (const id of ids) {
      results.push(await oneRow(id));
    }
    return res.json({ harness: 'krisp-calendar-match', calendar: calendarMeta, recent, results });
  }

  return res.status(400).json({
    error: 'pass postgresId=… for one row, or recent=1–20 for last N rows from krisp_webhook_events',
    hint: 'Calendar defaults from Airtable (KRISP_COACH_CLIENT_ID) like smart calendar; override with calendarEmail=…',
  });
});

// Admin: transcripts linked to an Airtable Lead id (rec…)
router.get('/webhooks/krisp/links-for-lead', async (req, res) => {
  const adminAuth = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const adminOk = adminAuth === (process.env.PB_WEBHOOK_SECRET || '').trim();
  if (!adminOk) return res.status(401).json({ error: 'admin auth required (PB_WEBHOOK_SECRET)' });

  const leadId = typeof req.query.leadId === 'string' ? req.query.leadId.trim() : '';
  if (!leadId) return res.status(400).json({ error: 'leadId query required (Airtable record id)' });

  const limit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 50;
  const rows = await getKrispLinksForLead(leadId, Number.isFinite(limit) ? limit : 50);
  res.json({ leadId, count: rows.length, links: rows });
});

const KRISP_TRANSCRIPT_PREVIEW_MAX = 500;

// Same auth as links-for-lead; includes preview + full_text for portal copy workflow.
router.get('/webhooks/krisp/transcripts-for-lead', async (req, res) => {
  const adminAuth = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const adminOk = adminAuth === (process.env.PB_WEBHOOK_SECRET || '').trim();
  if (!adminOk) return res.status(401).json({ error: 'admin auth required (PB_WEBHOOK_SECRET)' });

  const leadId = typeof req.query.leadId === 'string' ? req.query.leadId.trim() : '';
  if (!leadId) return res.status(400).json({ error: 'leadId query required (Airtable record id)' });

  const limit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 50;
  const rows = await getKrispTranscriptRowsForLead(leadId, Number.isFinite(limit) ? limit : 50);
  const transcripts = rows.map((row) => {
    const fullText = extractKrispDisplayText(row.payload);
    const preview =
      fullText.length <= KRISP_TRANSCRIPT_PREVIEW_MAX
        ? fullText
        : `${fullText.slice(0, KRISP_TRANSCRIPT_PREVIEW_MAX)}…`;
    return {
      event_id: row.event_id,
      received_at: row.received_at,
      krisp_id: row.krisp_id,
      event: row.event,
      type_label: krispEventTypeLabel(row.event),
      participant_email: row.participant_email,
      match_method: row.match_method,
      preview,
      full_text: fullText,
    };
  });
  res.json({ leadId, count: transcripts.length, transcripts });
});

// --- Simple HTML portal (same admin secret as other debug GETs: ?secret=PB_WEBHOOK_SECRET) ---
router.get('/krisp-portal', async (req, res) => {
  if (!pbAdminOk(req)) {
    res.status(401).type('html')
      .send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Krisp portal</title></head><body>
<p>Unauthorized. Open this page with <code>?secret=</code> your <strong>PB_WEBHOOK_SECRET</strong> (same as other debug URLs), or send header <code>Authorization: Bearer …</code>.</p>
</body></html>`);
    return;
  }
  const sec = encodeURIComponent(String(req.query.secret || '').trim());
  const summary = await getKrispWebhookDbSummary(50);
  if (!summary.database_configured) {
    res.status(503).type('html').send(`<!DOCTYPE html><html><body><p>Database not configured (${escapeHtml(summary.error || 'unknown')}).</p></body></html>`);
    return;
  }
  if (summary.error) {
    res.status(500).type('html').send(`<!DOCTYPE html><html><body><p>Error: ${escapeHtml(summary.error)}</p></body></html>`);
    return;
  }
  const rows = summary.recent || [];
  const list = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(String(r.id))}</td><td>${escapeHtml(String(r.received_at))}</td><td>${escapeHtml(String(r.event || ''))}</td><td>${escapeHtml(String(r.krisp_id || ''))}</td><td><a href="/krisp-portal/event/${encodeURIComponent(String(r.id))}?secret=${sec}">Open</a></td></tr>`,
    )
    .join('');
  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Krisp — saved webhooks</title>
<style>
body{font-family:system-ui,sans-serif;max-width:960px;margin:1rem auto;padding:0 1rem}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f5f5f5}
code{font-size:12px}
</style></head><body>
<h1>Saved Krisp webhooks</h1>
<p>Total rows: <strong>${escapeHtml(String(summary.total_rows))}</strong></p>
<table><thead><tr><th>ID</th><th>Received</th><th>Event</th><th>Krisp meeting id</th><th></th></tr></thead><tbody>${list || '<tr><td colspan="5">No rows yet.</td></tr>'}</tbody></table>
</body></html>`);
});

// ---------------------------------------------------------------------------
// Review queue + speaker verification
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  new: 'New',
  speakers_verified: 'Speakers verified',
  ready: 'Ready',
  linked: 'Linked to CRM',
  skipped: 'Skipped',
};

const STATUS_COLOURS = {
  new: '#ef4444',
  speakers_verified: '#f59e0b',
  ready: '#22c55e',
  linked: '#3b82f6',
  skipped: '#94a3b8',
};

function extractUniqueSpeakers(payload) {
  const text = extractKrispDisplayText(payload);
  const speakers = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^(Speaker\s*\d+|[^:]{1,40}):\s/);
    if (m) {
      const label = m[1].trim();
      if (label && !label.startsWith('{') && !label.startsWith('[')) speakers.add(label);
    }
  }
  return [...speakers];
}

function formatDuration(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return '';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function formatBrisbane(isoStr) {
  try {
    return new Date(isoStr).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' });
  } catch { return String(isoStr); }
}

router.get('/krisp-review', async (req, res) => {
  if (!pbAdminOk(req)) {
    return res.status(401).type('html').send(`<!DOCTYPE html><html><body><p>Unauthorized. Add <code>?secret=</code> your PB_WEBHOOK_SECRET.</p></body></html>`);
  }
  const sec = encodeURIComponent(String(req.query.secret || '').trim());
  const rows = await getKrispReviewQueue(50);

  const rowsHtml = rows.length === 0
    ? '<tr><td colspan="6">No transcripts yet.</td></tr>'
    : rows.map(r => {
        const title = r.meeting_title || r.event || '—';
        const dur = formatDuration(r.duration_seconds);
        const when = formatBrisbane(r.received_at);
        const st = r.status || 'new';
        const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:${STATUS_COLOURS[st] || '#666'}">${escapeHtml(STATUS_LABELS[st] || st)}</span>`;
        const speakersOk = r.verified_speakers ? 'Yes' : '—';
        return `<tr>
          <td>${escapeHtml(String(r.id))}</td>
          <td>${escapeHtml(when)}</td>
          <td>${escapeHtml(title)}${dur ? ` <span style="color:#888">(${escapeHtml(dur)})</span>` : ''}</td>
          <td>${badge}</td>
          <td>${speakersOk}</td>
          <td><a href="/krisp-review/${encodeURIComponent(String(r.id))}?secret=${sec}">Review</a></td>
        </tr>`;
      }).join('');

  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Krisp — Review Queue</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;max-width:1080px;margin:0 auto;padding:1rem;color:#111;background:#fafafa}
h1{font-size:1.5rem;margin-bottom:.25rem}
.subtitle{color:#666;font-size:.875rem;margin-bottom:1.25rem}
table{border-collapse:collapse;width:100%;font-size:14px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
th,td{border-bottom:1px solid #eee;padding:10px 12px;text-align:left;vertical-align:middle}
th{background:#f8f8f8;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#555}
tr:last-child td{border-bottom:none}
tr:hover td{background:#f5f7ff}
a{color:#2563eb;text-decoration:none;font-weight:500}
a:hover{text-decoration:underline}
</style></head><body>
<h1>Transcript Review Queue</h1>
<p class="subtitle">Verify speakers, then mark ready. Newest first.</p>
<table>
<thead><tr><th>#</th><th>When</th><th>Meeting</th><th>Status</th><th>Speakers</th><th></th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
</body></html>`);
});

router.get('/krisp-review/:id', async (req, res) => {
  if (!pbAdminOk(req)) {
    return res.status(401).type('html').send(`<!DOCTYPE html><html><body><p>Unauthorized.</p></body></html>`);
  }
  const sec = encodeURIComponent(String(req.query.secret || '').trim());
  const row = await getKrispReviewEventById(req.params.id);
  if (!row) {
    return res.status(404).type('html').send(`<!DOCTYPE html><html><body><p>Not found.</p></body></html>`);
  }

  const fullText = extractKrispDisplayText(row.payload);
  const speakerLabels = extractUniqueSpeakers(row.payload);
  const title = row.payload?.data?.meeting?.title || row.event || 'Krisp meeting';
  const when = formatBrisbane(row.received_at);
  const dur = formatDuration(row.payload?.data?.meeting?.duration_seconds);
  const st = row.status || 'new';
  const verified = row.verified_speakers || {};

  // Calendar attendee suggestions
  let calendarAttendees = [];
  try {
    const calResolved = await resolveCalendarEmailForKrispHarness(req);
    if (calResolved.calendarEmail) {
      const win = extractKrispMeetingWindowUtc(row.payload, 10);
      if (!win.error) {
        const events = await listCalendarEventsWithAttendeesInRange(
          calResolved.calendarEmail, win.timeMin, win.timeMax,
        );
        const { suggested } = rankCalendarEventsForKrispCoreWindow(events, win.coreStart, win.coreEnd);
        const best = suggested[0];
        if (best?.attendees) {
          calendarAttendees = best.attendees
            .filter(a => a.email && !a.self)
            .map(a => ({ email: a.email, name: a.displayName || '' }));
        }
      }
    }
  } catch (_e) { /* calendar optional */ }

  const speakerRows = speakerLabels.map((label, i) => {
    const saved = verified[label] || {};
    const nameVal = saved.name || '';
    const emailVal = saved.email || '';
    const calSuggestions = calendarAttendees.map(a =>
      `<button type="button" class="suggest-btn" data-idx="${i}" data-name="${escapeHtml(a.name || a.email)}" data-email="${escapeHtml(a.email)}">${escapeHtml(a.name || a.email)}</button>`
    ).join(' ');
    return `<tr>
      <td><strong>${escapeHtml(label)}</strong></td>
      <td><input type="text" name="name_${i}" value="${escapeHtml(nameVal)}" placeholder="Real name" class="field" id="name_${i}"></td>
      <td><input type="email" name="email_${i}" value="${escapeHtml(emailVal)}" placeholder="Email (optional)" class="field" id="email_${i}"></td>
      <td>${calSuggestions || '<span style="color:#aaa">No calendar match</span>'}</td>
      <input type="hidden" name="label_${i}" value="${escapeHtml(label)}">
    </tr>`;
  }).join('');

  const transcriptLines = fullText.split('\n').map(line => {
    const m = line.match(/^(Speaker\s*\d+|[^:]{1,40}):\s/);
    if (m) {
      const label = m[1].trim();
      const vName = verified[label]?.name;
      const displayLabel = vName || label;
      const rest = line.slice(m[0].length);
      return `<div class="line"><span class="speaker" title="${escapeHtml(label)}">${escapeHtml(displayLabel)}:</span> ${escapeHtml(rest)}</div>`;
    }
    return `<div class="line">${escapeHtml(line)}</div>`;
  }).join('\n');

  const statusOptions = Object.entries(STATUS_LABELS).map(([k, v]) =>
    `<option value="${k}"${k === st ? ' selected' : ''}>${v}</option>`
  ).join('');

  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review — ${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;max-width:1080px;margin:0 auto;padding:1rem;color:#111;background:#fafafa}
a{color:#2563eb;text-decoration:none}
a:hover{text-decoration:underline}
h1{font-size:1.35rem;margin-bottom:.15rem}
.meta{color:#666;font-size:.875rem;margin-bottom:1.25rem}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#fff}
.card{background:#fff;border-radius:8px;padding:1.25rem;margin-bottom:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card h2{font-size:1rem;margin:0 0 .75rem}
table.speakers{border-collapse:collapse;width:100%;font-size:14px}
table.speakers th,table.speakers td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left}
table.speakers th{font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#555}
.field{width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:14px}
.field:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.suggest-btn{background:#e0e7ff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;margin:2px}
.suggest-btn:hover{background:#c7d2fe}
.transcript{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;max-height:500px;overflow-y:auto;font-size:13.5px;line-height:1.65}
.line{margin-bottom:4px}
.speaker{font-weight:600;color:#1e40af}
.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.btn{padding:10px 20px;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}
.btn-primary{background:#111;color:#fff}
.btn-primary:hover{background:#333}
.btn-secondary{background:#e5e7eb;color:#333}
.btn-secondary:hover{background:#d1d5db}
select.status-select{padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:14px}
.toast{position:fixed;bottom:24px;right:24px;background:#111;color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:999}
.toast.show{opacity:1}
</style></head><body>
<p><a href="/krisp-review?secret=${sec}">&larr; Back to queue</a></p>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml(when)}${dur ? ` &middot; ${escapeHtml(dur)}` : ''} &middot; ID #${escapeHtml(String(row.id))} &middot; <span class="badge" style="background:${STATUS_COLOURS[st] || '#666'}">${escapeHtml(STATUS_LABELS[st] || st)}</span></p>

<div class="card">
<h2>Speakers</h2>
${speakerLabels.length === 0
  ? '<p style="color:#888">No speaker labels detected in transcript.</p>'
  : `<form id="speakerForm">
<table class="speakers">
<thead><tr><th>Label</th><th>Name</th><th>Email</th><th>Calendar suggestion</th></tr></thead>
<tbody>${speakerRows}</tbody>
</table>
<div style="margin-top:12px"><button type="submit" class="btn btn-primary">Save speakers</button></div>
</form>`}
</div>

<div class="card">
<h2>Transcript</h2>
<div class="transcript">${transcriptLines}</div>
</div>

<div class="card">
<h2>Status</h2>
<div class="actions">
<select class="status-select" id="statusSelect">${statusOptions}</select>
<button class="btn btn-secondary" id="statusBtn">Update status</button>
<button class="btn btn-secondary" id="skipBtn" style="color:#ef4444">Skip this transcript</button>
</div>
</div>

<div class="toast" id="toast"></div>

<script>
const SECRET = '${sec}';
const EVENT_ID = '${escapeHtml(String(row.id))}';

function showToast(msg, ms) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms || 2500);
}

// Calendar suggestion buttons
document.querySelectorAll('.suggest-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const i = btn.dataset.idx;
    document.getElementById('name_' + i).value = btn.dataset.name;
    document.getElementById('email_' + i).value = btn.dataset.email;
  });
});

// Save speakers
const form = document.getElementById('speakerForm');
if (form) form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const speakers = {};
  let idx = 0;
  while (fd.has('label_' + idx)) {
    const label = fd.get('label_' + idx);
    speakers[label] = { name: fd.get('name_' + idx) || '', email: fd.get('email_' + idx) || '' };
    idx++;
  }
  try {
    const r = await fetch('/krisp-review/' + EVENT_ID + '/speakers?secret=' + SECRET, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speakers })
    });
    const j = await r.json();
    if (j.ok) { showToast('Speakers saved'); setTimeout(() => location.reload(), 800); }
    else showToast('Error: ' + (j.error || 'unknown'), 4000);
  } catch (err) { showToast('Network error', 4000); }
});

// Update status
document.getElementById('statusBtn').addEventListener('click', async () => {
  const st = document.getElementById('statusSelect').value;
  try {
    const r = await fetch('/krisp-review/' + EVENT_ID + '/status?secret=' + SECRET, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: st })
    });
    const j = await r.json();
    if (j.ok) { showToast('Status updated'); setTimeout(() => location.reload(), 800); }
    else showToast('Error: ' + (j.error || 'unknown'), 4000);
  } catch (err) { showToast('Network error', 4000); }
});

document.getElementById('skipBtn').addEventListener('click', async () => {
  if (!confirm('Skip this transcript? You can always change the status later.')) return;
  try {
    const r = await fetch('/krisp-review/' + EVENT_ID + '/status?secret=' + SECRET, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skipped' })
    });
    const j = await r.json();
    if (j.ok) { showToast('Skipped'); setTimeout(() => location.href = '/krisp-review?secret=' + SECRET, 800); }
    else showToast('Error: ' + (j.error || 'unknown'), 4000);
  } catch (err) { showToast('Network error', 4000); }
});
</script>
</body></html>`);
});

// JSON API for Next.js frontend
router.get('/krisp-review/api/queue', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const rows = await getKrispReviewQueue(50);
  return res.json({ rows });
});

router.get('/krisp-review/api/event/:id', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const row = await getKrispReviewEventById(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const fullText = extractKrispDisplayText(row.payload);
  const title = row.payload?.data?.meeting?.title || row.event || 'Krisp meeting';
  const duration = row.payload?.data?.meeting?.duration_seconds || null;

  let calendarAttendees = [];
  try {
    const calResolved = await resolveCalendarEmailForKrispHarness(req);
    if (calResolved.calendarEmail) {
      const win = extractKrispMeetingWindowUtc(row.payload, 10);
      if (!win.error) {
        const events = await listCalendarEventsWithAttendeesInRange(
          calResolved.calendarEmail, win.timeMin, win.timeMax,
        );
        const { suggested } = rankCalendarEventsForKrispCoreWindow(events, win.coreStart, win.coreEnd);
        const best = suggested[0];
        if (best?.attendees) {
          calendarAttendees = best.attendees
            .filter(a => a.email && !a.self)
            .map(a => ({ email: a.email, name: a.displayName || '' }));
        }
      }
    }
  } catch (_e) { /* calendar optional */ }

  const speakerLabels = [];
  const lines = fullText.split('\n');
  const seen = new Set();
  for (const line of lines) {
    const m = line.match(/^(Speaker\s*\d+|[^:]{1,40}):\s/);
    if (m) {
      const label = m[1].trim();
      if (label && !label.startsWith('{') && !label.startsWith('[') && !seen.has(label)) {
        seen.add(label);
        speakerLabels.push(label);
      }
    }
  }

  return res.json({
    id: row.id,
    received_at: row.received_at,
    event: row.event,
    krisp_id: row.krisp_id,
    status: row.status || 'new',
    verified_speakers: row.verified_speakers || null,
    title,
    duration,
    full_text: fullText,
    speaker_labels: speakerLabels,
    calendar_attendees: calendarAttendees,
  });
});

// Save verified speakers
router.post('/krisp-review/:id/speakers', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const speakers = req.body?.speakers;
  if (!speakers || typeof speakers !== 'object') {
    return res.status(400).json({ error: 'speakers object required' });
  }
  const result = await saveVerifiedSpeakers(req.params.id, speakers);
  return res.json(result);
});

// Update status
router.post('/krisp-review/:id/status', async (req, res) => {
  if (!(await pbKrispReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const status = req.body?.status;
  if (!status || typeof status !== 'string') {
    return res.status(400).json({ error: 'status string required' });
  }
  const result = await updateKrispEventStatus(req.params.id, status);
  return res.json(result);
});

router.post('/krisp-test/seed', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized (PB_WEBHOOK_SECRET)' });
  try {
    const out = await seedManualTestTranscript();
    if (!out.ok) return res.status(503).json(out);
    let linkResult = null;
    let conversationEmail = null;
    if (out.postgres_id) {
      const full = await getKrispWebhookEventById(out.postgres_id);
      if (full?.payload) {
        linkResult = await linkKrispEventToLeadsByEmail(out.postgres_id, full.payload);
        try {
          conversationEmail = await maybeSendKrispConversationAlert({
            postgresId: String(out.postgres_id),
            payload: full.payload,
            krispId: out.krisp_id != null ? String(out.krisp_id) : null,
            event: 'manual_test',
            leadsLinked: linkResult?.linked ?? 0,
          });
        } catch (e) {
          conversationEmail = { sent: false, reason: e.message };
        }
      }
    }
    return res.json({ ...out, lead_link: linkResult, conversation_email: conversationEmail });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/krisp-test/seed-fixtures', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized (PB_WEBHOOK_SECRET)' });
  try {
    const out = await seedKrispBackendFixtures();
    if (!out.ok) return res.status(503).json(out);
    const linkSummaries = [];
    for (const row of out.rows || []) {
      const full = await getKrispWebhookEventById(row.postgres_id);
      if (full?.payload) {
        linkSummaries.push({
          postgres_id: row.postgres_id,
          ...(await linkKrispEventToLeadsByEmail(row.postgres_id, full.payload)),
        });
      }
    }
    return res.json({ ...out, lead_links: linkSummaries });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Re-run CRM linking for one stored Krisp row (e.g. after correcting Airtable).
 * Body or query: postgresId (string or number).
 */
router.post('/krisp-test/relink-event', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized (PB_WEBHOOK_SECRET)' });
  try {
    const raw = req.body?.postgresId ?? req.body?.postgres_id ?? req.query.postgresId ?? req.query.postgres_id;
    const n = typeof raw === 'string' ? parseInt(raw.trim(), 10) : Number(raw);
    if (!Number.isFinite(n) || n < 1) {
      return res.status(400).json({ error: 'postgresId required (positive integer)' });
    }
    const full = await getKrispWebhookEventById(n);
    if (!full?.payload) {
      return res.status(404).json({ error: 'krisp_webhook_events row not found', postgresId: String(n) });
    }
    const lr = await linkKrispEventToLeadsByEmail(n, full.payload);
    return res.json({ ok: true, postgres_id: String(n), ...lr });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/krisp-test/purge', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized (PB_WEBHOOK_SECRET)' });
  try {
    const out = await purgeManualTestTranscripts();
    if (!out.ok) return res.status(503).json(out);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/krisp-portal/event/:id/json', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const row = await getKrispWebhookEventById(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ id: row.id, received_at: row.received_at, event: row.event, krisp_id: row.krisp_id, payload: row.payload });
});

router.get('/krisp-portal/event/:id', async (req, res) => {
  if (!pbAdminOk(req)) {
    res.status(401).type('html')
      .send(`<!DOCTYPE html><html><body><p>Unauthorized. Add <code>?secret=</code> your PB_WEBHOOK_SECRET.</p></body></html>`);
    return;
  }
  const row = await getKrispWebhookEventById(req.params.id);
  if (!row) {
    res.status(404).type('html').send(`<!DOCTYPE html><html><body><p>Not found.</p></body></html>`);
    return;
  }
  const sec = encodeURIComponent(String(req.query.secret || '').trim());
  const text = extractKrispDisplayText(row.payload);
  const title = `Event #${row.id} — ${row.event || 'unknown'}`;
  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:960px;margin:1rem auto;padding:0 1rem}
textarea{width:100%;min-height:280px;font-family:ui-monospace,monospace;font-size:13px}
button{padding:8px 14px;font-size:15px;margin:8px 8px 8px 0}
.meta{color:#444;font-size:14px;margin-bottom:12px}
a{color:#2563eb}
</style></head><body>
<p><a href="/krisp-portal?secret=${sec}">← Back to list</a></p>
<h1>${escapeHtml(title)}</h1>
<div class="meta">Received: ${escapeHtml(String(row.received_at))}<br>Krisp id: ${escapeHtml(String(row.krisp_id || '—'))}</div>
<label for="txt"><strong>Text to copy</strong> (best guess from payload)</label>
<textarea id="txt" readonly>${escapeHtml(text)}</textarea>
<p><button type="button" id="copyBtn">Copy to clipboard</button></p>
<script>
document.getElementById('copyBtn').addEventListener('click', async function() {
  var t = document.getElementById('txt');
  t.select();
  try {
    await navigator.clipboard.writeText(t.value);
    alert('Copied');
  } catch (e) {
    document.execCommand('copy');
    alert('Copied (fallback)');
  }
});
</script>
</body></html>`);
});

router.head('/webhooks/krisp', (_req, res) => {
  res.status(204).end();
});

// Body parsed by global express.json in index.js (10mb limit).
router.post('/webhooks/krisp', async (req, res) => {
  const log = createSafeLogger('SYSTEM', null, 'krisp_webhook');
  const skipAuth = krispSkipAuth();
  const expected = krispInboundSecret();

  if (!skipAuth) {
    if (!expected) {
      log.error('KRISP-WEBHOOK rejected: no secret (set KRISP_WEBHOOK_INBOUND_SECRET or PB_WEBHOOK_SECRET)');
      return res.status(503).json({
        ok: false,
        error: 'server_not_configured',
        message:
          'Set KRISP_WEBHOOK_INBOUND_SECRET or PB_WEBHOOK_SECRET on the server to match the Authorization value in Krisp, or set KRISP_WEBHOOK_SKIP_AUTH=1 (insecure).',
      });
    }

    const authHeader =
      req.get('x-webhook-secret') ||
      req.get('x-webhook-secr') ||
      req.get('authorization') ||
      '';
    const token = normalizeAuthToken(authHeader);
    if (!timingSafeEqualString(token, expected)) {
      const hdrLen = authHeader.length;
      const tokLen = token ? token.length : 0;
      const expLen = expected.length;
      log.warn(`KRISP-WEBHOOK rejected: invalid Authorization (hdrLen=${hdrLen} tokenLen=${tokLen} expectedLen=${expLen} headerPreview=${authHeader.substring(0, 12)}... ua=${(req.get('user-agent') || '').substring(0, 80)})`);
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  } else {
    log.warn(
      'KRISP-WEBHOOK accepted without Authorization (KRISP_WEBHOOK_SKIP_AUTH) — insecure; turn off when Krisp headers work',
    );
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const nested =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : null;
  const meetingId =
    body.krisp_meeting_id ??
    body.meeting_id ??
    body.id ??
    nested?.id ??
    nested?.meeting_id ??
    null;
  const title =
    body.meeting_title ?? body.title ?? nested?.title ?? nested?.meeting_title ?? nested?.name ?? null;
  const summaryVal = body.summary ?? nested?.summary;
  const summaryLen =
    typeof summaryVal === 'string'
      ? summaryVal.length
      : summaryVal != null
        ? JSON.stringify(summaryVal).length
        : 0;
  const transcriptVal = body.transcripts ?? nested?.transcript ?? nested?.transcripts ?? nested?.text;
  let transcriptLen = 0;
  if (typeof transcriptVal === 'string') transcriptLen = transcriptVal.length;
  else if (transcriptVal != null) transcriptLen = JSON.stringify(transcriptVal).length;

  const event = typeof body.event === 'string' ? body.event : null;
  const dataKeys = nested ? Object.keys(nested).join(',') : '';

  log.info(
    `KRISP-WEBHOOK received event=${event ?? 'n/a'} meetingId=${meetingId ?? 'unknown'} title=${title ? String(title).slice(0, 120) : 'n/a'} summaryChars=${summaryLen} transcriptChars=${transcriptLen} topKeys=${Object.keys(body).join(',')}${dataKeys ? ` dataKeys=${dataKeys}` : ''}`,
  );

  if (process.env.KRISP_WEBHOOK_LOG_FULL_BODY === '1') {
    try {
      log.info(`KRISP-WEBHOOK full body: ${JSON.stringify(body)}`);
    } catch (e) {
      log.warn(`KRISP-WEBHOOK could not stringify body: ${e.message}`);
    }
  }

  let dbSaved = false;
  let leadLinksLinked = 0;
  try {
    const r = await persistKrispWebhook({
      event,
      krispId: meetingId != null ? String(meetingId) : null,
      payload: body,
    });
    dbSaved = r.ok === true;
    if (r.postgres_id) {
      try {
        const lr = await linkKrispEventToLeadsByEmail(r.postgres_id, body);
        leadLinksLinked = lr.linked;
        if (lr.unmatchedParticipants?.length > 0) {
          try {
            await maybeSendKrispUnmatchedAlert({
              postgresId: String(r.postgres_id),
              krispId: meetingId != null ? String(meetingId) : null,
              event: event || null,
              unmatchedParticipants: lr.unmatchedParticipants,
            });
          } catch (alertErr) {
            log.warn(`KRISP-WEBHOOK unmatched alert failed: ${alertErr.message}`);
          }
        }
      } catch (linkErr) {
        log.warn(`KRISP-WEBHOOK lead link failed: ${linkErr.message}`);
      }
      try {
        await maybeSendKrispConversationAlert({
          postgresId: String(r.postgres_id),
          payload: body,
          krispId: meetingId != null ? String(meetingId) : null,
          event: event || null,
          leadsLinked: leadLinksLinked,
        });
      } catch (convErr) {
        log.warn(`KRISP-WEBHOOK conversation alert failed: ${convErr.message}`);
      }
    }
  } catch (e) {
    log.error(`KRISP-WEBHOOK db persist failed: ${e.message}`);
  }

  return res.status(200).json({
    ok: true,
    received: true,
    krisp_meeting_id: meetingId,
    db_saved: dbSaved,
    lead_links_linked: leadLinksLinked,
  });
});

module.exports = router;
