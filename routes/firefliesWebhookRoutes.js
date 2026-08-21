/**
 * Fireflies "transcript ready" webhook — the push door for the Fireflies transcript provider.
 *
 * Fireflies POSTs a tiny event ({meetingId, eventType:'Meeting transcribed', ...} — the real
 * event names seen live are 'Meeting transcribed', 'Meeting summarized', 'Meeting bot joined') the
 * moment a client's meeting finishes processing; we fetch the transcript with the CLIENT's own
 * API key over GraphQL and file it via services/firefliesIngestService (same store, same lead
 * ladder as Fathom/Granola).
 *
 * PER-CLIENT BY CONSTRUCTION: the URL carries the tenant — POST /webhooks/fireflies/:clientId —
 * because a Fireflies webhook is configured per ACCOUNT (the client pastes this URL into their
 * own Fireflies dashboard, Settings -> Developer settings, and sets a signing secret there in
 * the same screen). The route looks up the client, verifies with THEIR stored secret
 * ('Fireflies Webhook Secret' on the Clients master), and ingests into THEIR tenant. No shared
 * secret, no cross-tenant ambiguity. Fireflies only fires webhooks for meetings the account
 * OWNS — which is exactly the tenant's own captures.
 *
 * ⚠ Must mount BEFORE express.json() (see index.js) so the HMAC uses the raw request body.
 *
 * AUTH: Fireflies is NOT Standard-Webhooks/Svix — it signs with a single `x-hub-signature`
 * header: "sha256=" + HMAC-SHA256(rawBody, secret) hex digest (GitHub-style). Verified locally
 * here with a timing-safe compare. Deliveries without the header are rejected: the secret is
 * mandatory in our setup (the client must set one in Developer settings, 16-32 chars).
 *
 * ADDITIVE + SAFE (mirrors routes/granolaWebhookRoutes.js):
 *   - New file; nothing existing changes.
 *   - FIREFLIES_WEBHOOK_ENABLED gates processing (default OFF; configure + observe first).
 *   - FIREFLIES_INGEST_ENABLED gates the actual WRITE inside ingestFirefliesTranscript.
 *   - Dedup: firefliesTranscriptIngested(meetingId) — a redelivery of a filed transcript is a no-op.
 *   - Always 200-ack after verification (never invite a retry-storm for an event we're
 *     deliberately ignoring). Unsigned/forged -> 401.
 */

const express = require('express');
const crypto = require('crypto');
const { createSafeLogger } = require('../utils/loggerHelper');
const { ingestFirefliesTranscript, firefliesTranscriptIngested } = require('../services/firefliesIngestService');
const clientService = require('../services/clientService');

const router = express.Router();
const rawJson = express.raw({ type: 'application/json' });

/** Process gate: default OFF so a configured webhook can be observed before it does anything. */
function webhookProcessingEnabled() {
  const v = String(process.env.FIREFLIES_WEBHOOK_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Verify Fireflies' x-hub-signature: "sha256=<hex HMAC-SHA256 of the raw body>" with the
 * client's stored secret. Timing-safe; any malformed/missing piece fails closed.
 */
function verifyFirefliesSignature(req, rawStr, secret) {
  const s = String(secret || '').trim();
  if (!s) return false;
  const header = String(req.headers['x-hub-signature'] || '').trim();
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header);
  if (!match) return false;
  try {
    const expected = crypto.createHmac('sha256', s).update(rawStr, 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(match[1].toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
  } catch (_e) {
    return false;
  }
}

// Probe endpoints — confirm reachability + per-client config without sending a real event.
router.get('/webhooks/fireflies/:clientId', async (req, res) => {
  let client = null;
  try { client = await clientService.getClientById(req.params.clientId); } catch (_e) { /* reported below */ }
  res.status(200).json({
    ok: true,
    fireflies_webhook: true,
    client_found: !!client,
    processing_enabled: webhookProcessingEnabled(),
    api_key_configured: !!client?.firefliesApiKey,
    secret_configured: !!client?.firefliesWebhookSecret,
  });
});
router.head('/webhooks/fireflies/:clientId', (req, res) => res.status(204).end());

router.post('/webhooks/fireflies/:clientId', rawJson, async (req, res) => {
  const clientId = String(req.params.clientId || '').trim();
  const log = createSafeLogger(clientId || 'SYSTEM', null, 'fireflies_webhook');
  const rawBuf = req.body;
  const rawStr = Buffer.isBuffer(rawBuf) ? rawBuf.toString('utf8') : String(rawBuf || '');

  // 1) The tenant must exist and carry a signing secret — then verify BEFORE trusting anything.
  let client = null;
  try {
    client = await clientService.getClientById(clientId);
  } catch (e) {
    log.error(`FIREFLIES-WEBHOOK client lookup failed for ${clientId}: ${e.message}`);
    return res.status(500).json({ ok: false, error: 'client lookup failed' });
  }
  if (!client || !client.firefliesWebhookSecret) {
    log.warn(`FIREFLIES-WEBHOOK ${!client ? 'unknown client' : 'no signing secret stored'} (${clientId}) — rejecting`);
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!verifyFirefliesSignature(req, rawStr, client.firefliesWebhookSecret)) {
    log.warn(`FIREFLIES-WEBHOOK signature verify failed for ${clientId}`);
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  let body;
  try {
    body = rawStr ? JSON.parse(rawStr) : {};
  } catch (_e) {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }

  const eventType = typeof body.eventType === 'string' ? body.eventType : (typeof body.event === 'string' ? body.event : null);
  const meetingId = body.meetingId != null ? String(body.meetingId)
    : body.meeting_id != null ? String(body.meeting_id)
    : body.transcriptId != null ? String(body.transcriptId) : null;
  log.info(`FIREFLIES-WEBHOOK client=${clientId} type=${eventType || 'n/a'} meeting=${meetingId || 'n/a'}`);

  // 2) Process gates. Ack 200 either way — verified-but-ignored is fine.
  if (!webhookProcessingEnabled()) {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: 'FIREFLIES_WEBHOOK_ENABLED not true' });
  }
  // The docs say "Transcription completed", but the events a real Fireflies account actually
  // sends are "Meeting transcribed", "Meeting summarized" and "Meeting bot joined". Match loosely
  // on the word stem so all the transcript-ready spellings pass and "Meeting bot joined" does not.
  // "Meeting summarized" is accepted deliberately as a second-chance retry: dedup makes a repeat
  // delivery a no-op and only a non-empty transcript counts as ingested, so a "Meeting transcribed"
  // that arrived too early can still be picked up by the later "Meeting summarized". A missing
  // eventType is let through when a meetingId is present — the dedup + fetch make a spurious
  // attempt harmless.
  if (eventType && !/transcri|summar/i.test(eventType)) {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: `ignored type ${eventType}` });
  }
  if (!meetingId) {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: 'no meeting id in payload' });
  }

  // 3) Dedup — a Fireflies redelivery of an already-filed transcript is a no-op.
  try {
    if (await firefliesTranscriptIngested(meetingId)) {
      log.info(`FIREFLIES-WEBHOOK meeting=${meetingId} already ingested — skipping`);
      return res.status(200).json({ ok: true, received: true, processed: false, reason: 'already ingested', meeting_id: meetingId });
    }
  } catch (e) {
    log.warn(`FIREFLIES-WEBHOOK dedup check failed for ${meetingId}: ${e.message} — proceeding (ingest re-checks nothing worse than a dup attempt)`);
  }

  // 4) Ingest. FIREFLIES_INGEST_ENABLED still gates the write inside. Always 200-ack.
  try {
    const result = await ingestFirefliesTranscript({ transcriptId: meetingId, coachClientId: clientId });
    if (result.ok && result.held) {
      log.info(`FIREFLIES-WEBHOOK meeting=${meetingId} HELD in the capture window until ${result.releaseAt || 'release'} — sentences not fetched`);
    } else if (result.ok && result.skipped) {
      log.info(`FIREFLIES-WEBHOOK meeting=${meetingId} declined by capture policy (${result.skipped}) — nothing stored`);
    } else if (result.ok) {
      log.info(`FIREFLIES-WEBHOOK ingested meeting=${meetingId} -> meeting_id=${result.meetingId}`);
    } else {
      log.warn(`FIREFLIES-WEBHOOK ingest not completed for ${meetingId}: ${result.error}`);
    }
    return res.status(200).json({
      ok: true,
      received: true,
      processed: !!(result.ok && result.meetingId),
      held: !!result.held,
      policy_skipped: result.skipped || null,
      fireflies_meeting_id: meetingId,
      meeting_id: result.meetingId || null,
      ingest_error: result.ok ? null : (result.error || null),
    });
  } catch (e) {
    log.error(`FIREFLIES-WEBHOOK ingest threw for ${meetingId}: ${e.message}`);
    return res.status(200).json({ ok: true, received: true, processed: false, fireflies_meeting_id: meetingId, ingest_error: e.message });
  }
});

module.exports = router;
