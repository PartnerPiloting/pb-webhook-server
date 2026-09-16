// routes/wingguyUnansweredRoutes.js
// "Unanswered messages" worklist - the people who wrote to you and never got a reply.
//
// Sibling of Thanks for Connecting, and deliberately the same shape: a generated, inbox-zero
// worklist with a status to tick, rather than a coach scrolling their own LinkedIn inbox trying
// to remember where they got to. The difference is the source - TFC reads the Leads base, this
// reads a store fed by the coach's own LinkedIn messages export (services/wingguyUnansweredStore).
//
// WHY IT MATTERS (Guy, 2026-09-16): anyone running outreach at volume generates replies faster
// than they follow them through. Those dropped conversations are the warmest leads they have and
// no tool has ever shown them. It costs no Linked Helper actions and needs no campaign, so it
// works for every client from day one regardless of what else they have set up.
//
// ROLLOUT is GUY-FIRST via an env allowlist (WINGGUY_UNANSWERED_CLIENTS) rather than a new
// per-client Airtable field - new Leads-base fields only ever go out through
// scripts/ensure-client-fields.js, and this does not need one yet. ENABLE_WINGGUY_UNANSWERED
// (default true) is the process-level kill switch.
//
// Endpoints (mounted at /api/unanswered):
//   GET    /status            public; { ok, enabled }
//   POST   /import            multipart upload of LinkedIn's messages.csv (field name: file)
//   GET    /worklist          the queue; fires triage in the background for anything unjudged
//   GET    /thread/:key       the recent exchange, oldest first - context for drafting a reply
//   PATCH  /thread/:key       { dismissed: true|false }

const express = require('express');
const multer = require('multer');
const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'wingguy_unanswered' });
const { getClientById } = require('../services/clientService');
const store = require('../services/wingguyUnansweredStore');
const { judgeThreads } = require('../services/wingguyUnansweredJudge');

// LinkedIn's messages.csv is the whole of a person's message history. Guy's own is years deep and
// Matt Armour's covers 3.5 years of agency outbound, so the ceiling has to be generous - but it
// is still a bound, because an unbounded upload into memory is how a small service falls over.
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

function parseBoolFlag(val, defaultValue = false) {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

module.exports = function mountWingguyUnanswered(app) {
  const router = express.Router();

  const ENABLED = parseBoolFlag(process.env.ENABLE_WINGGUY_UNANSWERED, true);
  const ALLOWED = new Set(
    [process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson',
     ...String(process.env.WINGGUY_UNANSWERED_CLIENTS || '').split(',')]
      .map((s) => s.trim()).filter(Boolean)
  );
  logger.info(`[WingguyUnanswered] Mounted. ENABLED=${ENABLED} allowed=${[...ALLOWED].join(',')}`);

  function getClientId(req) {
    return req.headers['x-client-id'] || req.query.clientId || req.query.testClient || null;
  }

  // Returns the client record when this tenant may use the feature, else null.
  async function resolveGate(clientId) {
    if (!ENABLED || !clientId || !ALLOWED.has(String(clientId).trim())) return null;
    try {
      return (await getClientById(clientId)) || null;
    } catch (e) {
      logger.warn(`unanswered: getClientById failed for ${clientId}: ${e?.message || e}`);
      return null;
    }
  }

  router.get('/status', (req, res) => {
    res.json({
      ok: true,
      enabled: ENABLED,
      env: process.env.NODE_ENV || 'development',
      commit: process.env.RENDER_GIT_COMMIT || 'local',
    });
  });

  // Upload the LinkedIn messages export. Additive and re-runnable: messages dedupe on a content
  // fingerprint, so a later export only contributes what is new, and the derived thread state is
  // rebuilt from everything held - which is how a conversation the coach has since answered
  // drops off the list without anyone ticking anything.
  router.post('/import', upload.single('file'), async (req, res) => {
    const clientId = getClientId(req);
    const client = await resolveGate(clientId);
    if (!client) return res.status(403).json({ error: 'feature_not_enabled' });
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ error: 'no_file', hint: 'POST multipart/form-data with field "file" = messages.csv' });
    }
    try {
      const csv = req.file.buffer.toString('utf8');
      const result = await store.ingestExport(clientId, csv, { ownerName: req.body?.ownerName });
      if (!result.ok) {
        // owner_not_detected means we could not tell which name in the file is the coach. It is
        // recoverable by hand rather than fatal, so say so instead of failing opaquely.
        return res.status(422).json({
          error: result.reason,
          details: result.error || null,
          hint: result.reason === 'owner_not_detected'
            ? 'Re-post with ownerName set to the name that appears on your own sent messages.'
            : undefined,
        });
      }
      logger.info(`unanswered: imported for ${clientId} - ${result.messagesInserted} new message(s) across ${result.threads} thread(s)`);
      res.json({ ok: true, ...result });
    } catch (e) {
      logger.error('unanswered: import error', e?.message || e);
      res.status(500).json({ error: 'import_failed', details: e?.message || String(e) });
    }
  });

  // The worklist. Anything not yet triaged is sent for judgement in the BACKGROUND - the screen
  // never waits on the model. Those rows come back as pending and are resolved on the next load,
  // which is honest about what we have and have not looked at.
  router.get('/worklist', async (req, res) => {
    const clientId = getClientId(req);
    const client = await resolveGate(clientId);
    if (!client) return res.status(403).json({ error: 'feature_not_enabled' });

    const sinceDays = Number(req.query.days) > 0 ? Number(req.query.days) : 365;
    const includeAll = parseBoolFlag(req.query.all, false);
    try {
      const items = await store.listOpenThreads(clientId, { sinceDays, includeAll });
      const pending = items.filter((t) => !t.verdict).length;
      if (pending) {
        logger.info(`unanswered: triaging ${pending} thread(s) for ${clientId}`);
        judgeThreads(clientId, items, client)
          .then((r) => logger.info(`unanswered: triage done for ${clientId} - ${JSON.stringify(r)}`))
          .catch((e) => logger.warn(`unanswered: triage failed for ${clientId}: ${e?.message || e}`));
      }
      res.json({
        ok: true,
        sinceDays,
        pending,                                              // still being judged; refresh to see
        owedCount: items.filter((t) => t.verdict && t.verdict.startsWith('reply')).length,
        items,
      });
    } catch (e) {
      logger.error('unanswered: worklist error', e?.message || e);
      res.status(500).json({ error: 'worklist_failed', details: e?.message || String(e) });
    }
  });

  // The exchange behind one row, so a reply can be written in context rather than off a snippet.
  router.get('/thread/:key', async (req, res) => {
    const clientId = getClientId(req);
    const client = await resolveGate(clientId);
    if (!client) return res.status(403).json({ error: 'feature_not_enabled' });
    try {
      const messages = await store.getThreadMessages(clientId, req.params.key, Number(req.query.limit) || 20);
      res.json({ ok: true, threadKey: req.params.key, messages });
    } catch (e) {
      logger.error('unanswered: thread error', e?.message || e);
      res.status(500).json({ error: 'thread_failed', details: e?.message || String(e) });
    }
  });

  // Dismiss a row. Deliberately NOT "done" - answering someone in LinkedIn removes them by itself
  // on the next import or extension sweep, because the list is derived. This is only for "I have
  // read this and I am not replying", and it is tied to the current last message, so if that
  // person writes again they come back.
  router.patch('/thread/:key', async (req, res) => {
    const clientId = getClientId(req);
    const client = await resolveGate(clientId);
    if (!client) return res.status(403).json({ error: 'feature_not_enabled' });
    const dismissed = !!(req.body || {}).dismissed;
    try {
      const r = await store.setDismissed(clientId, req.params.key, dismissed);
      if (!r.ok) return res.status(500).json({ error: 'update_failed', details: r.error });
      res.json({ ok: true, threadKey: req.params.key, dismissed });
    } catch (e) {
      logger.error('unanswered: patch error', e?.message || e);
      res.status(500).json({ error: 'update_failed', details: e?.message || String(e) });
    }
  });

  app.use('/api/unanswered', router);
};
