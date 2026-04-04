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
 *
 * Insecure escape hatch: KRISP_WEBHOOK_SKIP_AUTH_HARDCODED below, or env KRISP_WEBHOOK_SKIP_AUTH=1.
 * Anyone who guesses the URL can send fake payloads. Turn off when Krisp Authorization header works.
 */

/** @type {boolean} Set true only to bypass auth while debugging Krisp UI. Prefer Authorization header matching PB_WEBHOOK_SECRET / KRISP_WEBHOOK_INBOUND_SECRET. */
const KRISP_WEBHOOK_SKIP_AUTH_HARDCODED = false;

const express = require('express');
const crypto = require('crypto');
const { createSafeLogger } = require('../utils/loggerHelper');
const { persistKrispWebhook, getKrispWebhookDbSummary } = require('../services/krispWebhookDb');

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
  try {
    const r = await persistKrispWebhook({
      event,
      krispId: meetingId != null ? String(meetingId) : null,
      payload: body,
    });
    dbSaved = r.ok === true;
  } catch (e) {
    log.error(`KRISP-WEBHOOK db persist failed: ${e.message}`);
  }

  return res.status(200).json({
    ok: true,
    received: true,
    krisp_meeting_id: meetingId,
    db_saved: dbSaved,
  });
});

module.exports = router;
