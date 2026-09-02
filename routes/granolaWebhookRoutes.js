/**
 * Granola "note generated" webhook — the push door for the Granola transcript provider.
 *
 * Granola POSTs a tiny event ({type:'note.generated', note_id, ...}) the moment a client's
 * note-taker finishes a meeting note; we fetch the note + transcript with the CLIENT's own API
 * key and file it via services/granolaIngestService (same store, same lead ladder as Fathom).
 *
 * PER-CLIENT BY CONSTRUCTION: the URL carries the tenant — POST /webhooks/granola/:clientId —
 * because a Granola webhook is registered per WORKSPACE with that client's API key
 * (scripts/register-granola-webhook.js), and its signing secret is per-registration. So the
 * route looks up the client, verifies with THEIR stored secret ('Granola Webhook Secret' on the
 * Clients master), and ingests into THEIR tenant. No shared secret, no cross-tenant ambiguity.
 *
 * ⚠ Must mount BEFORE express.json() (see index.js) so the HMAC uses the raw request body.
 *
 * AUTH: Granola signs per the Standard Webhooks spec — the SAME `webhook-id` / `webhook-timestamp`
 * / `webhook-signature` HMAC-SHA256 scheme Svix uses (Recall + Fathom), so we reuse
 * utils/verifyRecallWebhook.verifyRequestFromRecall verbatim.
 *
 * ADDITIVE + SAFE (mirrors routes/fathomWebhookRoutes.js):
 *   - New file; nothing existing changes.
 *   - GRANOLA_WEBHOOK_ENABLED gates processing (default OFF; register + observe first).
 *   - GRANOLA_INGEST_ENABLED gates the actual WRITE inside ingestGranolaNote.
 *   - Dedup: granolaNoteIngested(note_id) — a retry or regenerate of a filed note is a no-op.
 *   - Always 200-ack after verification (Granola retries over 24h with backoff; we never want a
 *     retry-storm for an event we're deliberately ignoring). Unsigned/forged -> 401.
 */

const express = require('express');
const { createSafeLogger } = require('../utils/loggerHelper');
const { verifyRequestFromRecall } = require('../utils/verifyRecallWebhook');
const { ingestGranolaNote, granolaNoteIngested } = require('../services/granolaIngestService');
const clientService = require('../services/clientService');

const router = express.Router();
const rawJson = express.raw({ type: 'application/json' });

/** Process gate: default OFF so a registered webhook can be observed before it does anything. */
function webhookProcessingEnabled() {
  const v = String(process.env.GRANOLA_WEBHOOK_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function normalizeHeaderMap(req) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    out[String(k).toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v || '');
  }
  return out;
}

/** Verify the Standard-Webhooks signature with THIS client's stored signing secret. */
function verifyGranolaSignature(req, rawStr, secret) {
  const s = String(secret || '').trim();
  if (!s) return false;
  try {
    verifyRequestFromRecall({ secret: s, headers: normalizeHeaderMap(req), payload: rawStr });
    return true;
  } catch (_e) {
    return false;
  }
}

// Probe endpoints — confirm reachability + per-client config without sending a real event.
router.get('/webhooks/granola/:clientId', async (req, res) => {
  let client = null;
  try { client = await clientService.getClientById(req.params.clientId); } catch (_e) { /* reported below */ }
  res.status(200).json({
    ok: true,
    granola_webhook: true,
    client_found: !!client,
    processing_enabled: webhookProcessingEnabled(),
    api_key_configured: !!client?.granolaApiKey,
    secret_configured: !!client?.granolaWebhookSecret,
  });
});
router.head('/webhooks/granola/:clientId', (req, res) => res.status(204).end());

router.post('/webhooks/granola/:clientId', rawJson, async (req, res) => {
  const clientId = String(req.params.clientId || '').trim();
  const log = createSafeLogger(clientId || 'SYSTEM', null, 'granola_webhook');
  const rawBuf = req.body;
  const rawStr = Buffer.isBuffer(rawBuf) ? rawBuf.toString('utf8') : String(rawBuf || '');

  // 1) The tenant must exist and carry a signing secret — then verify BEFORE trusting anything.
  let client = null;
  try {
    client = await clientService.getClientById(clientId);
  } catch (e) {
    log.error(`GRANOLA-WEBHOOK client lookup failed for ${clientId}: ${e.message}`);
    return res.status(500).json({ ok: false, error: 'client lookup failed' });
  }
  if (!client || !client.granolaWebhookSecret) {
    log.warn(`GRANOLA-WEBHOOK ${!client ? 'unknown client' : 'no signing secret stored'} (${clientId}) — rejecting`);
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!verifyGranolaSignature(req, rawStr, client.granolaWebhookSecret)) {
    log.warn(`GRANOLA-WEBHOOK signature verify failed for ${clientId}`);
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  let body;
  try {
    body = rawStr ? JSON.parse(rawStr) : {};
  } catch (_e) {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }

  const type = typeof body.type === 'string' ? body.type : (typeof body.event === 'string' ? body.event : null);
  const noteId = body.note_id != null ? String(body.note_id)
    : body.data?.note_id != null ? String(body.data.note_id)
    : body.data?.id != null ? String(body.data.id) : null;
  log.info(`GRANOLA-WEBHOOK client=${clientId} type=${type || 'n/a'} note=${noteId || 'n/a'}`);

  // 2) Process gates. Ack 200 either way — verified-but-ignored is fine.
  if (!webhookProcessingEnabled()) {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: 'GRANOLA_WEBHOOK_ENABLED not true' });
  }
  // note.generated = first filing; note.regenerated = Granola re-ran the summary/transcript — worth
  // re-attempting ONLY if we never landed a transcript (dedup below decides). Edits/shares ignored.
  if (type && type !== 'note.generated' && type !== 'note.regenerated') {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: `ignored type ${type}` });
  }
  if (!noteId) {
    return res.status(200).json({ ok: true, received: true, processed: false, reason: 'no note id in payload' });
  }

  // 3) Dedup — a Granola retry (24h backoff) or a regenerate of an already-filed note is a no-op.
  try {
    if (await granolaNoteIngested(noteId)) {
      log.info(`GRANOLA-WEBHOOK note=${noteId} already ingested — skipping`);
      return res.status(200).json({ ok: true, received: true, processed: false, reason: 'already ingested', note_id: noteId });
    }
  } catch (e) {
    log.warn(`GRANOLA-WEBHOOK dedup check failed for ${noteId}: ${e.message} — proceeding (ingest re-checks nothing worse than a dup attempt)`);
  }

  // 4) Ingest. GRANOLA_INGEST_ENABLED still gates the write inside. Always 200-ack — Granola's
  //    retry + note.regenerated give natural re-attempts for transient failures.
  try {
    const result = await ingestGranolaNote({ noteId, coachClientId: clientId });
    if (result.ok && result.review) {
      log.info(`GRANOLA-WEBHOOK note=${noteId}: ${(result.filed || []).length} chunk(s) filed, ${result.held.length} HELD FOR REVIEW (${result.held.map((h) => h.verdict).join(', ')}), ${(result.dropped || []).length} dropped`);
    } else if (result.ok && result.held) {
      log.info(`GRANOLA-WEBHOOK note=${noteId} HELD in the capture window until ${result.releaseAt || 'release'} — transcript not fetched`);
    } else if (result.ok && result.skipped) {
      log.info(`GRANOLA-WEBHOOK note=${noteId} declined by capture policy (${result.skipped}) — nothing stored`);
    } else if (result.ok) {
      log.info(`GRANOLA-WEBHOOK ingested note=${noteId} -> meeting_id=${result.meetingId}${result.mode === 'split' ? ` (split: ${(result.filed || []).length} filed, ${(result.dropped || []).length} dropped)` : ''}`);
    } else {
      log.warn(`GRANOLA-WEBHOOK ingest not completed for ${noteId}: ${result.error}`);
    }
    return res.status(200).json({
      ok: true,
      received: true,
      processed: !!(result.ok && result.meetingId),
      held: !!result.held && !result.review,
      review: !!result.review,
      filed: (result.filed || []).length || undefined,
      dropped: (result.dropped || []).length || undefined,
      policy_skipped: result.skipped || null,
      note_id: noteId,
      meeting_id: result.meetingId || null,
      ingest_error: result.ok ? null : (result.error || null),
    });
  } catch (e) {
    log.error(`GRANOLA-WEBHOOK ingest threw for ${noteId}: ${e.message}`);
    return res.status(200).json({ ok: true, received: true, processed: false, note_id: noteId, ingest_error: e.message });
  }
});

module.exports = router;
