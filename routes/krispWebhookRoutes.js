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
 * Calendar match harness (admin): GET /webhooks/krisp/calendar-match-harness?secret=…&postgresId=7&calendarEmail=you@gmail.com — compares stored Krisp meeting times to Google Calendar (service account). Optional recent=5 to scan last N rows. Set KRISP_CALENDAR_MATCH_EMAIL on server to omit calendarEmail.
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
} = require('../services/krispWebhookDb');
const { extractKrispDisplayText, krispEventTypeLabel } = require('../services/krispPayloadText');
const { linkKrispEventToLeadsByEmail } = require('../services/krispLeadLinkService');
const { maybeSendKrispUnmatchedAlert } = require('../services/krispUnmatchedAlertService');
const { maybeSendKrispConversationAlert } = require('../services/krispConversationEmailService');
const { listCalendarEventsWithAttendeesInRange } = require('../config/calendarServiceAccount.js');

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
 * Query: postgresId=7 OR recent=5 (1–20). calendarEmail=… or env KRISP_CALENDAR_MATCH_EMAIL. padMinutes=10 (optional).
 */
router.get('/webhooks/krisp/calendar-match-harness', async (req, res) => {
  if (!pbAdminOk(req)) {
    return res.status(401).json({ error: 'admin auth required (PB_WEBHOOK_SECRET or ?secret=)' });
  }

  const calendarEmail =
    (typeof req.query.calendarEmail === 'string' && req.query.calendarEmail.trim()) ||
    (process.env.KRISP_CALENDAR_MATCH_EMAIL || '').trim();
  if (!calendarEmail) {
    return res.status(400).json({
      error: 'calendarEmail required (query) or set KRISP_CALENDAR_MATCH_EMAIL on the server',
    });
  }

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
      calendar_events: cal.events,
      calendar_error: cal.error || null,
    };
  }

  if (postgresIdRaw != null && String(postgresIdRaw).trim() !== '') {
    const out = await oneRow(String(postgresIdRaw).trim());
    return res.json({ harness: 'krisp-calendar-match', calendarEmail, result: out });
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
    return res.json({ harness: 'krisp-calendar-match', calendarEmail, recent, results });
  }

  return res.status(400).json({
    error: 'pass postgresId=… for one row, or recent=1–20 for last N rows from krisp_webhook_events',
    hint: 'Also set calendarEmail=… or KRISP_CALENDAR_MATCH_EMAIL',
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
