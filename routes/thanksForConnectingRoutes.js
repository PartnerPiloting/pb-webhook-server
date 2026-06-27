// routes/thanksForConnectingRoutes.js
// "Thanks for Connecting" worklist — the connection-follow-up queue.
//
// Replaces Guy's manual scan of LinkedIn recent-connections with a generated, inbox-zero
// worklist of who he's just connected with and still owes a thanks-for-connecting note.
// New connections already land in the Portal (Leads table) with a Date Connected via the
// LH webhook; this is a VIEW + a status to tick on top of that existing ingestion backbone.
//
// Rollout is GUY-FIRST then client-by-client, gated by the per-client master switch
// "Thanks for Connecting" (Yes/No). The portal only shows the tab when the gate is on
// (surfaced via /api/auth/test features.thanksForConnecting); this route ALSO enforces the
// gate server-side (defence in depth). A process-level kill-switch
// ENABLE_THANKS_FOR_CONNECTING (default true) can hard-disable it everywhere.
//
// Endpoints (mounted at /api/thanks-for-connecting):
//   GET   /status          public; { ok, enabled }
//   GET   /worklist        the queue (view=outstanding|all, optional days override)
//   PATCH /lead/:id        set a lead's Thanks Status (Messaged | Let go | clear)

const express = require('express');
const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'thanks_for_connecting' });
const airtableClient = require('../config/airtableClient.js');
const { getClientById } = require('../services/clientService');
const { LEAD_FIELDS } = require('../constants/airtableUnifiedConstants');

const THANKS_STATUS_FIELD = 'Thanks Status';
const VALID_STATUSES = ['Messaged', 'Skipped'];
// The option was originally "Let go", renamed to "Skipped" (2026-06-21). Airtable's metadata API
// can't rename a select choice, so instead we WRITE "Skipped" with typecast (Airtable auto-creates
// the option) and normalize any legacy "Let go" value to "Skipped" on read. The stale "Let go"
// choice can be deleted by hand in Airtable later; it's cosmetic.
const STATUS_ALIASES = { 'Let go': 'Skipped' };
const normalizeStatus = (s) => (s ? (STATUS_ALIASES[s] || s) : null);
const DEFAULT_LOOKBACK_DAYS = 14; // ≈ the LH connection window; bounds the queue + solves cold-start flood
const MAX_ITEMS = 1000;           // safety cap on a single worklist fetch (keeps the MOST RECENT — see sort below)

function parseBoolFlag(val, defaultValue = false) {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

module.exports = function mountThanksForConnecting(app, base) {
  const router = express.Router();

  // Process-level kill-switch. The REAL rollout control is the per-client Airtable gate
  // (default off for everyone but Guy), so this defaults ON and only force-disables.
  const ENABLED = parseBoolFlag(process.env.ENABLE_THANKS_FOR_CONNECTING, true);
  logger.info(`[ThanksForConnecting] Mounted. ENABLED=${ENABLED}`);

  function getClientId(req) {
    return req.headers['x-client-id'] || req.query.clientId || req.query.testClient || null;
  }

  async function getBaseForRequest(clientId) {
    if (clientId && typeof airtableClient.getClientBase === 'function') {
      try {
        return await airtableClient.getClientBase(clientId);
      } catch (e) {
        logger.warn(`thanksForConnecting: getClientBase failed for ${clientId}: ${e?.message || e}`);
      }
    }
    return base;
  }

  // Resolve the per-client gate + lookback; returns null when the client should NOT see this.
  async function resolveGate(clientId) {
    if (!ENABLED || !clientId) return null;
    let client;
    try {
      client = await getClientById(clientId);
    } catch (e) {
      logger.warn(`thanksForConnecting: getClientById failed for ${clientId}: ${e?.message || e}`);
      return null;
    }
    if (!client || client.thanksForConnectingEnabled !== true) return null;
    const lookbackDays = Number(client.connectionLookbackDays) > 0
      ? Number(client.connectionLookbackDays)
      : DEFAULT_LOOKBACK_DAYS;
    return { client, lookbackDays };
  }

  const esc = (s) => String(s).replace(/'/g, "\\'");

  function buildFormula(lookbackDays, outstandingOnly) {
    // "Connected" = has a Date Connected (Guy's funnel: blank = not connected, set = connected).
    // The {LinkedIn Connection Status} field is NOT a reliable signal here — its "Connected" value
    // is a stale historical state, while live inflow lands as "Candidate" with a fresh Date Connected
    // (confirmed against prod 2026-06-20). So we key the queue purely off {Date Connected}.
    // Window is bounded off {Date Connected} directly (DATETIME_DIFF) rather than the
    // {Days Since Connected} formula field — that field isn't present in every Leads base.
    const parts = [
      `NOT({${LEAD_FIELDS.DATE_CONNECTED}} = BLANK())`,
      `DATETIME_DIFF(TODAY(), {${LEAD_FIELDS.DATE_CONNECTED}}, 'days') <= ${lookbackDays}`
    ];
    if (outstandingOnly) {
      parts.push(`{${THANKS_STATUS_FIELD}} = BLANK()`);
    }
    return `AND(${parts.join(', ')})`;
  }

  function daysSince(dateConnected) {
    if (!dateConnected) return null;
    const t = new Date(dateConnected).getTime();
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }

  function mapItem(r) {
    const first = r.get(LEAD_FIELDS.FIRST_NAME) || '';
    const last = r.get(LEAD_FIELDS.LAST_NAME) || '';
    const dateConnected = r.get(LEAD_FIELDS.DATE_CONNECTED) || null;
    return {
      id: r.id,
      profileKey: r.get('Profile Key') || null,
      firstName: first,
      lastName: last,
      name: `${first} ${last}`.trim(),
      linkedinUrl: r.get(LEAD_FIELDS.LINKEDIN_PROFILE_URL) || null,
      headline: r.get(LEAD_FIELDS.HEADLINE) || '',
      company: r.get(LEAD_FIELDS.COMPANY_NAME) || '',
      jobTitle: r.get(LEAD_FIELDS.JOB_TITLE) || '',
      dateConnected,
      daysSinceConnected: daysSince(dateConnected),
      aiScore: r.get(LEAD_FIELDS.AI_SCORE) ?? null,
      thanksStatus: normalizeStatus(r.get(THANKS_STATUS_FIELD))
    };
  }

  // Public status (responds even if disabled / gate off)
  router.get('/status', (req, res) => {
    res.json({
      ok: true,
      enabled: ENABLED,
      env: process.env.NODE_ENV || 'development',
      commit: process.env.RENDER_GIT_COMMIT || 'local'
    });
  });

  // The worklist. view=outstanding (default, the draining queue) | all (status-badged recents).
  router.get('/worklist', async (req, res) => {
    const clientId = getClientId(req);
    const gate = await resolveGate(clientId);
    if (!gate) return res.status(403).json({ error: 'feature_not_enabled' });

    const view = String(req.query.view || 'outstanding').toLowerCase();
    const outstandingOnly = view !== 'all';
    // Allow a per-request override of the lookback (display filter only), clamped sane.
    let lookbackDays = gate.lookbackDays;
    if (req.query.days !== undefined) {
      const d = Number(req.query.days);
      // Allow a wide ceiling so an "All time" window in the UI works; MAX_ITEMS still caps the result.
      if (Number.isFinite(d) && d > 0) lookbackDays = Math.min(d, 36500);
    }

    try {
      const b = await getBaseForRequest(clientId);
      const formula = buildFormula(lookbackDays, outstandingOnly);
      const items = [];
      await new Promise((resolve, reject) => {
        b('Leads')
          .select({
            filterByFormula: formula,
            // Page MOST-RECENT first so that if the MAX_ITEMS cap trips on a wide window we keep the
            // recent connections (the ones worth thanking), not the oldest. The UI re-sorts for display
            // (default oldest-first = inbox-zero); a "thanks for connecting" note is only timely anyway.
            sort: [{ field: LEAD_FIELDS.DATE_CONNECTED, direction: 'desc' }],
            pageSize: 100
          })
          .eachPage(
            (records, fetchNextPage) => {
              for (const r of records) {
                if (items.length >= MAX_ITEMS) break;
                items.push(mapItem(r));
              }
              if (items.length >= MAX_ITEMS) return resolve();
              fetchNextPage();
            },
            (err) => (err ? reject(err) : resolve())
          );
      });

      // "N to thank" = the outstanding count regardless of which view is shown.
      const outstandingCount = outstandingOnly
        ? items.length
        : items.filter((it) => !it.thanksStatus).length;

      res.json({
        ok: true,
        view: outstandingOnly ? 'outstanding' : 'all',
        lookbackDays,
        outstandingCount,
        truncated: items.length >= MAX_ITEMS, // hit the cap — there may be older rows beyond this
        items
      });
    } catch (e) {
      logger.error('thanksForConnecting: worklist error', e?.message || e);
      res.status(500).json({ error: 'worklist_failed', details: e?.message || String(e) });
    }
  });

  // Tick a lead: { thanksStatus: 'Messaged' | 'Let go' | null }  (null/'' clears → Outstanding)
  router.patch('/lead/:id', async (req, res) => {
    const clientId = getClientId(req);
    const gate = await resolveGate(clientId);
    if (!gate) return res.status(403).json({ error: 'feature_not_enabled' });

    const id = req.params.id;
    let { thanksStatus } = req.body || {};
    if (thanksStatus === '') thanksStatus = null;
    if (thanksStatus !== null && STATUS_ALIASES[thanksStatus]) thanksStatus = STATUS_ALIASES[thanksStatus];
    if (thanksStatus !== null && !VALID_STATUSES.includes(thanksStatus)) {
      return res.status(400).json({ error: 'invalid_status', allowed: [...VALID_STATUSES, null] });
    }

    try {
      const b = await getBaseForRequest(clientId);
      // typecast so Airtable auto-creates the "Skipped" option in bases that still only have the
      // legacy "Let go" choice (metadata rename isn't supported by the API).
      await b('Leads').update(id, { [THANKS_STATUS_FIELD]: thanksStatus }, { typecast: true });
      res.json({ ok: true, id, thanksStatus });
    } catch (e) {
      logger.error('thanksForConnecting: patch error', e?.message || e);
      res.status(500).json({ error: 'update_failed', details: e?.message || String(e) });
    }
  });

  app.use('/api/thanks-for-connecting', router);
};
