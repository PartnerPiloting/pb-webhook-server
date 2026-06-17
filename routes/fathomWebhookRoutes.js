/**
 * Fathom "new meeting content ready" webhook — the PUSH that replaces the poll lag.
 *
 * STEP 4 of the Recall -> Fathom migration. Today services/fathomPollService.js wakes every
 * ~15 min, lists recent Fathom meetings, and files new ones. This route lets Fathom TELL us the
 * instant a meeting is ready instead: Fathom POSTs here, we extract recording_id, and call the
 * SAME services/fathomIngestService.ingestFathomMeeting the poll already uses. Nothing else changes.
 *
 * ⚠ Must mount BEFORE express.json() (see index.js) so the HMAC uses the raw request body.
 *
 * AUTH: Fathom signs webhooks with the EXACT same Svix HMAC-SHA256 scheme as Recall.ai — a
 * `whsec_…` secret + `webhook-id` / `webhook-timestamp` / `webhook-signature` headers, signed over
 * `${id}.${timestamp}.${rawBody}`. So we reuse utils/verifyRecallWebhook.verifyRequestFromRecall
 * verbatim (it's generic Svix despite the name). The signing secret is returned when you register
 * the webhook (scripts/fathom-webhook.js --register) and lives in env FATHOM_WEBHOOK_SECRET.
 *
 * ADDITIVE + SAFE:
 *   - New file; the ingest path is untouched.
 *   - Three gates, mirroring the poll:
 *       FATHOM_WEBHOOK_ENABLED — does this route PROCESS at all (default OFF; register + observe first).
 *       FATHOM_LIVE_FROM       — must be set, or nothing is eligible (poll's "ingest nothing" default).
 *       FATHOM_INGEST_ENABLED  — enforced inside ingestFathomMeeting for the actual WRITE.
 *   - Double-fire is impossible: every ingest first checks fathomRecordingIngested(recording_id).
 *   - We KEEP THE POLL RUNNING as a backstop, so we never depend on Svix retries — we always
 *     200-ack after attempting (logging the outcome); a missed/failed push is swept up by the poll.
 */

const express = require('express');
const { createSafeLogger } = require('../utils/loggerHelper');
const { verifyRequestFromRecall } = require('../utils/verifyRecallWebhook');
const { ingestFathomMeeting } = require('../services/fathomIngestService');
const { fathomRecordingIngested } = require('../services/recallWebhookDb');

const router = express.Router();
const rawJson = express.raw({ type: 'application/json' });

const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

function fathomWebhookSecret() {
  return (process.env.FATHOM_WEBHOOK_SECRET || '').trim();
}

/** Process gate: default OFF so we can register the webhook and watch it before it does anything. */
function webhookProcessingEnabled() {
  const v = String(process.env.FATHOM_WEBHOOK_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Mirror the poll's eligibility default: nothing is eligible until FATHOM_LIVE_FROM is set. */
function liveFromSet() {
  const raw = String(process.env.FATHOM_LIVE_FROM || '').trim();
  if (!raw) return false;
  return !Number.isNaN(Date.parse(raw));
}

function normalizeHeaderMap(req) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    out[String(k).toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v || '');
  }
  return out;
}

/** Verify the Svix signature using the Fathom signing secret. Returns true/false (never throws). */
function verifyFathomSignature(req, rawStr) {
  const secret = fathomWebhookSecret();
  if (!secret.startsWith('whsec_')) return false;
  try {
    verifyRequestFromRecall({ secret, headers: normalizeHeaderMap(req), payload: rawStr });
    return true;
  } catch (_e) {
    return false;
  }
}

// Probe endpoints — confirm reachability + signing-secret config without sending a real event.
router.get('/webhooks/fathom', (req, res) => {
  res.status(200).json({
    ok: true,
    fathom_webhook: true,
    processing_enabled: webhookProcessingEnabled(),
    live_from_set: liveFromSet(),
    secret_configured: fathomWebhookSecret().startsWith('whsec_'),
  });
});
router.head('/webhooks/fathom', (req, res) => res.status(204).end());

router.post('/webhooks/fathom', rawJson, async (req, res) => {
  const log = createSafeLogger('SYSTEM', null, 'fathom_webhook');
  const rawBuf = req.body;
  const rawStr = Buffer.isBuffer(rawBuf) ? rawBuf.toString('utf8') : String(rawBuf || '');

  // 1) Verify signature first — reject anything unsigned/forged.
  if (!verifyFathomSignature(req, rawStr)) {
    log.warn('FATHOM-WEBHOOK signature verify failed (or FATHOM_WEBHOOK_SECRET not a whsec_ value)');
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  let body;
  try {
    body = rawStr ? JSON.parse(rawStr) : {};
  } catch (_e) {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }

  const type = body && typeof body.type === 'string' ? body.type : null;
  const recordingId = body && body.recording_id != null ? String(body.recording_id) : null;
  log.info(`FATHOM-WEBHOOK type=${type || 'n/a'} recording=${recordingId || 'n/a'}`);

  // 2) Process gates (mirror the poll). Ack 200 either way — a verified-but-ignored event is fine,
  //    and we never want Fathom to retry-storm something we're deliberately not handling yet.
  if (!webhookProcessingEnabled()) {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: 'FATHOM_WEBHOOK_ENABLED not true' });
  }
  if (!liveFromSet()) {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: 'FATHOM_LIVE_FROM not set' });
  }
  if (type && type !== 'meeting_content_ready') {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: `ignored type ${type}` });
  }
  if (!recordingId) {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: 'no recording_id in payload' });
  }

  // 3) Dedup — the poll may have already filed this one (or a retry of this same webhook did).
  try {
    if (await fathomRecordingIngested(recordingId)) {
      log.info(`FATHOM-WEBHOOK recording=${recordingId} already ingested — skipping (poll/webhook overlap is a no-op)`);
      return res.status(200).json({ ok: true, received: true, processed: false, reason: 'already ingested', recording_id: recordingId });
    }
  } catch (e) {
    log.warn(`FATHOM-WEBHOOK dedup check failed for ${recordingId}: ${e.message} — proceeding (ingest re-checks)`);
  }

  // 4) Ingest via the SAME path the poll uses. FATHOM_INGEST_ENABLED still gates the actual write
  //    inside ingestFathomMeeting. We always 200-ack; the poll is the backstop for any failure here.
  try {
    const result = await ingestFathomMeeting({ recordingId, coachClientId: DEFAULT_COACH_CLIENT_ID });
    if (result.ok && result.mode === 'single') {
      log.info(`FATHOM-WEBHOOK ingested recording=${recordingId} -> meeting_id=${result.meetingId}`);
    } else if (result.ok && result.mode === 'split') {
      log.info(`FATHOM-WEBHOOK ingested back-to-back recording=${recordingId} -> ${result.filed?.length || 0} segments`);
    } else if (!result.ok) {
      log.warn(`FATHOM-WEBHOOK ingest not completed for ${recordingId}: ${result.error} (poll will retry)`);
    }
    return res.status(200).json({
      ok: true,
      received: true,
      processed: !!result.ok,
      recording_id: recordingId,
      mode: result.mode || null,
      meeting_id: result.meetingId || null,
      filed: result.filed?.length || null,
      ingest_error: result.ok ? null : (result.error || null),
    });
  } catch (e) {
    log.error(`FATHOM-WEBHOOK ingest threw for ${recordingId}: ${e.message} (poll will retry)`);
    return res.status(200).json({ ok: true, received: true, processed: false, recording_id: recordingId, ingest_error: e.message });
  }
});

module.exports = router;
