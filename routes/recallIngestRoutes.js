/**
 * Recall.ai ingest — must mount BEFORE express.json() so HMAC uses raw body.
 * POST /webhooks/recall
 */

const express = require('express');
const crypto = require('crypto');
const { createSafeLogger } = require('../utils/loggerHelper');
const { verifyRequestFromRecall } = require('../utils/verifyRecallWebhook');
const {
  persistRecallWebhookEvent,
  upsertRecallMeeting,
  appendRecallUtterance,
  recordRecallPresence,
  upsertRecallMeetingParticipant,
  addMeetingLead,
} = require('../services/recallWebhookDb');
const {
  recallEventType,
  extractRecallIds,
  innerRecallData,
  titleFromRecallPayload,
  formatRecallUtteranceBlock,
  wordsToText,
  utteranceBounds,
} = require('../services/recallPayloadText');
const {
  DEFAULT_COACH_CLIENT_ID,
  participantEmail,
  linkRecallParticipantEmail,
} = require('../services/recallLeadLinkService');

const router = express.Router();
const rawJson = express.raw({ type: 'application/json' });

const RECALL_SKIP_AUTH_HARDCODED = false;

function normalizeHeaderMap(req) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    out[String(k).toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v || '');
  }
  return out;
}

function timingSafeEqualString(a, b) {
  if (a == null || b == null) return false;
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function recallVerificationSecret() {
  return (process.env.RECALL_VERIFICATION_SECRET || process.env.RECALL_WEBHOOK_VERIFICATION_SECRET || '').trim();
}

function recallBearerSecret() {
  return (process.env.RECALL_WEBHOOK_INBOUND_SECRET || process.env.PB_WEBHOOK_SECRET || '').trim();
}

function recallSkipAuth() {
  if (RECALL_SKIP_AUTH_HARDCODED) return true;
  const v = (process.env.RECALL_WEBHOOK_SKIP_AUTH || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function recallQueryTokenOk(req) {
  const expected = (process.env.RECALL_WEBHOOK_QUERY_TOKEN || '').trim();
  if (!expected) return false;
  const q = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  return timingSafeEqualString(q, expected);
}

async function tryLinkParticipantToLead(meetingId, participant, coachClientId) {
  const email = participantEmail(participant);
  if (!email) return;
  const pid = participant?.id != null ? Number(participant.id) : null;
  if (!Number.isFinite(pid)) return;

  const speakerLabel = `Participant ${pid}`;
  const { leadId, matchMethod } = await linkRecallParticipantEmail(email, { coachClientId });
  const name = typeof participant.name === 'string' ? participant.name.trim() : '';

  await upsertRecallMeetingParticipant({
    meetingId,
    platformParticipantId: pid,
    speakerLabel,
    verifiedName: name || null,
    verifiedEmail: email,
    role: leadId ? 'client' : 'unknown',
    airtableLeadId: leadId || null,
    coachClientId,
    matchMethod: matchMethod || 'ingest',
  });

  if (leadId) {
    await addMeetingLead(meetingId, leadId, coachClientId, 'recall_email');
  }
}

router.get('/webhooks/recall', (req, res) => {
  const log = createSafeLogger('SYSTEM', null, 'recall_webhook');
  if (recallSkipAuth()) {
    return res.status(200).json({ ok: true, recall_webhook: true, probe: true });
  }
  const whsec = recallVerificationSecret();
  if (whsec.startsWith('whsec_')) {
    try {
      verifyRequestFromRecall({
        secret: whsec,
        headers: normalizeHeaderMap(req),
        payload: null,
      });
      return res.status(200).json({ ok: true, recall_webhook: true, verified: true });
    } catch (e) {
      log.warn(`RECALL-WEBHOOK GET verify failed: ${e.message}`);
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }
  const bearer = recallBearerSecret();
  const auth = (req.get('authorization') || '').trim();
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (bearer && timingSafeEqualString(token, bearer)) {
    return res.status(200).json({ ok: true, recall_webhook: true });
  }
  if (recallQueryTokenOk(req)) {
    return res.status(200).json({ ok: true, recall_webhook: true });
  }
  return res.status(401).json({ ok: false, error: 'unauthorized' });
});

router.head('/webhooks/recall', (req, res) => res.status(204).end());

router.post('/webhooks/recall', rawJson, async (req, res) => {
  const log = createSafeLogger('SYSTEM', null, 'recall_webhook');
  const rawBuf = req.body;
  const rawStr = Buffer.isBuffer(rawBuf) ? rawBuf.toString('utf8') : String(rawBuf || '');

  const skipAuth = recallSkipAuth();
  if (!skipAuth) {
    const whsec = recallVerificationSecret();
    let verified = false;
    if (whsec.startsWith('whsec_')) {
      try {
        verifyRequestFromRecall({
          secret: whsec,
          headers: normalizeHeaderMap(req),
          payload: rawStr,
        });
        verified = true;
      } catch (e) {
        log.warn(`RECALL-WEBHOOK signature verify failed: ${e.message}`);
      }
    }
    if (!verified) {
      const bearer = recallBearerSecret();
      const auth = (req.get('authorization') || '').trim();
      const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      if (bearer && timingSafeEqualString(token, bearer)) verified = true;
      if (!verified && recallQueryTokenOk(req)) verified = true;
    }
    if (!verified) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  let body;
  try {
    body = rawStr ? JSON.parse(rawStr) : {};
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }

  const event = recallEventType(body);
  const { botId, recordingId } = extractRecallIds(body);
  log.info(`RECALL-WEBHOOK event=${event || 'n/a'} bot=${botId || 'n/a'} recording=${recordingId || 'n/a'}`);

  if (!botId || !recordingId) {
    return res.status(200).json({ ok: true, received: true, note: 'no bot/recording ids — stored only if db ok' });
  }

  let webhookId = null;
  let meetingId = null;
  try {
    const pr = await persistRecallWebhookEvent({
      event,
      botId,
      recordingId,
      payload: body,
    });
    if (pr.ok) webhookId = pr.postgres_id;
  } catch (e) {
    log.error(`RECALL-WEBHOOK persist event failed: ${e.message}`);
  }

  try {
    const ur = await upsertRecallMeeting({
      botId,
      recordingId,
      title: titleFromRecallPayload(body),
    });
    if (ur.ok) meetingId = ur.meeting_id;
  } catch (e) {
    log.warn(`RECALL-WEBHOOK upsert meeting failed: ${e.message}`);
  }

  const coachClientId = DEFAULT_COACH_CLIENT_ID;
  const inner = innerRecallData(body);

  if (meetingId && event === 'transcript.data' && inner && typeof inner === 'object') {
    const participant = inner.participant;
    const words = inner.words;
    const chunk = formatRecallUtteranceBlock(participant, words);
    const text = wordsToText(words).trim();
    const { startRel, endRel } = utteranceBounds(words);
    const pid = participant?.id != null ? Number(participant.id) : null;

    if (chunk && Number.isFinite(pid)) {
      try {
        await appendRecallUtterance({
          meetingId,
          platformParticipantId: pid,
          participantNameSnapshot: typeof participant?.name === 'string' ? participant.name : null,
          utteranceText: text,
          startRel,
          endRel,
          transcriptChunk: chunk,
        });
        await upsertRecallMeetingParticipant({
          meetingId,
          platformParticipantId: pid,
          speakerLabel: `Participant ${pid}`,
          verifiedName: typeof participant?.name === 'string' ? participant.name.trim() || null : null,
          role: 'unknown',
          coachClientId,
          matchMethod: 'transcript_seen',
        });
        await tryLinkParticipantToLead(meetingId, participant, coachClientId);
      } catch (e) {
        log.warn(`RECALL-WEBHOOK transcript ingest failed: ${e.message}`);
      }
    }
  }

  if (meetingId && inner && typeof inner === 'object' && inner.participant) {
    const pe = event || '';
    if (pe === 'participant_events.join' || pe === 'participant_events.leave') {
      const pid = inner.participant.id != null ? Number(inner.participant.id) : null;
      const ts = inner.timestamp;
      const absIso = ts && typeof ts.absolute === 'string' ? ts.absolute : null;
      const rel = ts && ts.relative != null ? Number(ts.relative) : null;
      if (Number.isFinite(pid)) {
        try {
          await recordRecallPresence({
            meetingId,
            platformParticipantId: pid,
            eventKind: pe.endsWith('join') ? 'join' : 'leave',
            absIso,
            relSeconds: Number.isFinite(rel) ? rel : null,
          });
          if (pe === 'participant_events.join') {
            await tryLinkParticipantToLead(meetingId, inner.participant, coachClientId);
          }
        } catch (e) {
          log.warn(`RECALL-WEBHOOK presence failed: ${e.message}`);
        }
      }
    }
  }

  return res.status(200).json({
    ok: true,
    received: true,
    event: event || null,
    bot_id: botId,
    recording_id: recordingId,
    webhook_event_id: webhookId,
    meeting_id: meetingId,
  });
});

module.exports = router;
