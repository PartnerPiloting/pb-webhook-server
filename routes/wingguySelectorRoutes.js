// routes/wingguySelectorRoutes.js
//
// The landmark list Wingguy uses to read a LinkedIn page, served from Postgres so a LinkedIn markup
// change is a database row rather than a release plus every client reinstalling.
//
//   GET  /api/wingguy/selectors         — the live overrides for this client (extension reads on start)
//   POST /api/wingguy/selectors/health  — what the extension actually found in the field
//   GET  /api/wingguy/selectors/health  — the diagnostic read (owner only)
//
// Deliberately a SEPARATE router from /api/extension-config: that one reads Airtable and is still
// being called by the legacy Network Accelerator extension on machines where it's installed. Leaving
// it untouched means this work doesn't get tangled up in decommissioning the old extension.

const express = require('express');
const { createLogger } = require('../utils/contextLogger');
const { authenticateUserWithTestMode } = require('../middleware/authMiddleware');
const store = require('../services/wingguySelectorStore');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'wingguy-selectors' });

const OWNER_CLIENT_ID = (process.env.WINGGUY_PLATFORM_OWNER || 'Guy-Wilson').trim();

/** Any Wingguy-enabled client may read the landmarks and post health. Same gate as the draft routes. */
function requireWingguy(req, res, next) {
  const cid = req.client && String(req.client.clientId);
  const enabled = cid && (cid === OWNER_CLIENT_ID || !!req.client.wingguyEnabled);
  if (!enabled) {
    return res.status(403).json({ ok: false, error: 'Wingguy is not enabled for this account yet.' });
  }
  next();
}

/** The diagnostic read is Guy's alone — it spans every client's machines. */
function requireOwnerOnly(req, res, next) {
  const cid = req.client && String(req.client.clientId);
  if (cid !== OWNER_CLIENT_ID) {
    return res.status(403).json({ ok: false, error: 'Owner only.' });
  }
  next();
}

module.exports = function mountWingguySelectors(app) {
  const router = express.Router();

  router.use(authenticateUserWithTestMode);
  router.use(requireWingguy);

  // The live landmark set. An empty map is the NORMAL, healthy answer — it means nothing has needed
  // overriding yet and the extension should run on its built-in defaults. The extension must not
  // treat {} as a failure, and must not treat a 5xx here as anything worse than "keep the defaults".
  router.get('/', async (req, res) => {
    try {
      const selectors = await store.getSelectors({ tenantId: req.client.clientId });
      // null = no DATABASE_URL at all. Report it honestly rather than dressing it up as an empty
      // override set: the two look identical to the extension but mean very different things to us.
      if (selectors === null) {
        logger.warn('[Wingguy] selectors requested but no database is configured — serving empty');
        return res.json({ ok: true, selectors: {}, store: 'unavailable' });
      }
      res.json({ ok: true, selectors, store: 'live' });
    } catch (e) {
      logger.error(`[Wingguy] selectors read failed: ${e.message}`);
      // 200 with an empty set on purpose. A failure here must be indistinguishable, to the client,
      // from "nothing to override" — the extension carries working defaults either way, and an error
      // status would only tempt a future caller into surfacing it to the person using Wingguy.
      res.json({ ok: true, selectors: {}, store: 'error' });
    }
  });

  // What the extension found in the field. Fire-and-forget from the client's point of view.
  router.post('/health', async (req, res) => {
    try {
      const { checks, extensionVersion } = req.body || {};
      const out = await store.recordHealth({
        tenantId: req.client.clientId,
        checks,
        extensionVersion,
      });
      res.json({ ok: true, ...(out || { recorded: 0 }) });
    } catch (e) {
      logger.error(`[Wingguy] selector health write failed: ${e.message}`);
      res.json({ ok: false, recorded: 0 });   // never a 5xx: health is never worth alarming anyone over
    }
  });

  // The diagnostic read — "is anything actually broken out there".
  router.get('/health', requireOwnerOnly, async (req, res) => {
    try {
      const rows = await store.getHealthSummary({ hours: req.query.hours });
      res.json({ ok: true, hours: Number(req.query.hours) || 48, summary: rows || [] });
    } catch (e) {
      logger.error(`[Wingguy] selector health read failed: ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Every version of a landmark — what it is, what it was, and why it changed.
  router.get('/history', requireOwnerOnly, async (req, res) => {
    try {
      const rows = await store.getSelectorHistory({ key: req.query.key, limit: req.query.limit });
      res.json({ ok: true, history: rows || [] });
    } catch (e) {
      logger.error(`[Wingguy] selector history read failed: ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.use('/api/wingguy/selectors', router);
  logger.info('[Wingguy] Selector routes mounted at /api/wingguy/selectors');
};
