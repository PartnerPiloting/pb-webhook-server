/**
 * Krisp Webhook API — ingestion stub.
 *
 * Krisp POSTs meeting payloads to your URL. In the Krisp UI, set optional header
 *   Authorization: Bearer <secret>   (or the raw secret — both work)
 * Use the same value as your existing admin secret, or a dedicated one:
 *   KRISP_WEBHOOK_INBOUND_SECRET=<secret>   (preferred if set)
 *   PB_WEBHOOK_SECRET=<secret>             (used if KRISP_WEBHOOK_INBOUND_SECRET is empty)
 *
 * Optional: KRISP_WEBHOOK_LOG_FULL_BODY=1 logs stringified JSON (large / sensitive — use briefly).
 *
 * Insecure escape hatch (e.g. Krisp UI cannot save custom headers): set KRISP_WEBHOOK_SKIP_AUTH=1
 * on Render to accept POSTs with no Authorization. Anyone who guesses the URL can send fake payloads.
 * Remove or unset as soon as headers work.
 */

const express = require('express');
const crypto = require('crypto');
const { createSafeLogger } = require('../utils/loggerHelper');

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
  const v = (process.env.KRISP_WEBHOOK_SKIP_AUTH || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

// Body parsed by global express.json in index.js (10mb limit).
router.post('/webhooks/krisp', (req, res) => {
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

    const authHeader = req.get('authorization') || req.get('Authorization') || '';
    const token = normalizeAuthToken(authHeader);
    if (!timingSafeEqualString(token, expected)) {
      log.warn('KRISP-WEBHOOK rejected: invalid Authorization');
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  } else {
    log.warn(
      'KRISP-WEBHOOK accepted without Authorization (KRISP_WEBHOOK_SKIP_AUTH) — insecure; turn off when Krisp headers work',
    );
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const meetingId = body.krisp_meeting_id ?? body.meeting_id ?? body.id ?? null;
  const title = body.meeting_title ?? body.title ?? null;
  const summaryLen =
    typeof body.summary === 'string' ? body.summary.length : body.summary != null ? JSON.stringify(body.summary).length : 0;
  let transcriptLen = 0;
  if (typeof body.transcripts === 'string') transcriptLen = body.transcripts.length;
  else if (body.transcripts != null) transcriptLen = JSON.stringify(body.transcripts).length;

  log.info(
    `KRISP-WEBHOOK received meetingId=${meetingId ?? 'unknown'} title=${title ? String(title).slice(0, 120) : 'n/a'} summaryChars=${summaryLen} transcriptChars=${transcriptLen} keys=${Object.keys(body).join(',')}`,
  );

  if (process.env.KRISP_WEBHOOK_LOG_FULL_BODY === '1') {
    try {
      log.info(`KRISP-WEBHOOK full body: ${JSON.stringify(body)}`);
    } catch (e) {
      log.warn(`KRISP-WEBHOOK could not stringify body: ${e.message}`);
    }
  }

  return res.status(200).json({
    ok: true,
    received: true,
    krisp_meeting_id: meetingId,
  });
});

module.exports = router;
