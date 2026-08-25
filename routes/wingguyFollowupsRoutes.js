// routes/wingguyFollowupsRoutes.js
// The Follow-Ups screen's API — the portal face of the Wingguy queue.
// Brick 2 of docs/FOLLOWUPS-SCREEN-PLAN.md (approved 2026-08-15).
//
// Modelled on routes/thanksForConnectingRoutes.js: same client identification (x-client-id from
// the portal), same server-side per-client gate (defence in depth — the tab is hidden when the
// gate is off, but the API refuses too), same process-level kill-switch env.
//
// THE RULE THAT MATTERS: this file contains NO queue logic and NO second write path. The queue is
// buildQueue() (the same call chat renders from), the story is the dossier store (the same rows
// chat serves), and every action is the same function the chat tools call. Two implementations of
// any of these is how the queue and the dossier came to contradict each other (the Vikas
// draft-contradiction, 2026-08-15).
//
// Endpoints (mounted at /api/followups):
//   GET  /status            public; { ok, enabled }
//   GET  /queue             the structured queue + who the live re-check hid and why
//   GET  /story             a person's dossier payload as JSON (+ staleness); refresh=1 queues a rebuild
//   POST /action            { name, email?, src?, action: drop|park|done, parkDate? }

const express = require('express');
const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'followups_screen' });
const { getClientById } = require('../services/clientService');

function parseBoolFlag(val, defaultValue = false) {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

module.exports = function mountWingguyFollowups(app) {
  const router = express.Router();

  // Process-level kill-switch; the REAL rollout control is the per-client `Followup Brief` gate.
  const ENABLED = parseBoolFlag(process.env.ENABLE_FOLLOWUPS_SCREEN, true);
  logger.info(`[FollowupsScreen] Mounted. ENABLED=${ENABLED}`);

  // The tenant comes from the VERIFIED identity (portal token, assistant token
  // or dev key - authenticateUserWithTestMode below), never from a raw header
  // or query param: the queue is CRM material, and before 2026-08-25 anyone who
  // knew a client id could read it unauthenticated.
  function getClientId(req) {
    return req.client?.clientId || null;
  }

  // The screen's gate IS the feature's gate: `Followup Brief` = Yes turns on the overnight stores
  // this screen is a window onto (Guy's tab rule, 2026-08-15 — one switch, not two). A keyless
  // client with the flag on still sees the screen; the queue it shows will be empty with the
  // brief's stored "your Claude key isn't set up yet" reason, which is the message we WANT them
  // to meet (ae05af87).
  async function resolveGate(clientId) {
    if (!ENABLED || !clientId) return null;
    let client;
    try {
      client = await getClientById(clientId);
    } catch (e) {
      logger.warn(`followupsScreen: getClientById failed for ${clientId}: ${e?.message || e}`);
      return null;
    }
    if (!client || String(client.followupBrief || '').trim() !== 'Yes') return null;
    return { client };
  }

  // Everything below /status requires an authenticated identity - the same
  // portal-token middleware as the rest of the portal (assistant tokens
  // resolve to their client, dev key works for admin).
  const { authenticateUserWithTestMode } = require('../middleware/authMiddleware');

  // Public status (responds even if disabled / gate off)
  router.get('/status', (req, res) => {
    res.json({
      ok: true,
      enabled: ENABLED,
      env: process.env.NODE_ENV || 'development',
      commit: process.env.RENDER_GIT_COMMIT || 'local'
    });
  });

  // The queue, as data. Heavy draft bodies stay OUT of the list payload — the Draft button opens
  // the signed draft page, which serves the text itself (and is the page chat already links).
  router.get('/queue', authenticateUserWithTestMode, async (req, res) => {
    const clientId = getClientId(req);
    const gate = await resolveGate(clientId);
    if (!gate) return res.status(403).json({ error: 'feature_not_enabled' });
    try {
      const { buildQueue } = require('../services/wingguyMailMcp');
      const { draftUrl } = require('../services/wingguyDraftLink');
      const q = await buildQueue(clientId);
      const items = q.items.map((it) => ({
        name: it.name,
        recId: it.recId || null,
        email: it.email || null,
        linkedin: it.linkedin || null,
        src: it.src,                 // 'today' | 'backlog'
        kind: it.kind,               // 'draft' | 'park' | 'attention' | 'reopen'
        whyLine: it.whyLine || '',
        jog: it.jog || '',
        quietDays: it.quietDays ?? null,
        channel: it.channel || null,
        parkDate: it.parkDate || null,
        parkPassed: !!it.parkPassed,
        draftState: it.draftState,   // 'ready' | 'wg-angle' | 'pending' | 'error' | 'none' — honest by construction
        wgAngle: it.draftState === 'wg-angle' ? (it.wgAngle || null) : null,
        draftUrl: (it.draftState === 'ready' || it.draftState === 'wg-angle') ? draftUrl(clientId, it.name) : null,
        builtAt: it.builtAt || null,
      }));
      // Tell the screen when Claude-prepared parts (overnight brief, stories,
      // drafts) can't run for this client: no stored key + no managed plan =
      // blocked by the one-door rule, never billed to the platform key. Without
      // this the screen just looks mysteriously unprepared.
      let keyNotice = null;
      try {
        const { resolveClientAnthropic } = require('../config/anthropicClient');
        const lane = resolveClientAnthropic(gate.client);
        if (lane.lane === 'none-blocked') keyNotice = lane.message;
      } catch (_) { /* notice is best-effort */ }

      res.json({
        ok: true,
        count: items.length,
        keyNotice,
        items,
        // WHO the live re-check hid and why — the aggregate-only version made a vanished
        // top-of-queue person unexplainable (Kay Ridge, 2026-08-15). The screen shows these
        // behind a "N already handled" chip.
        hidden: {
          counts: {
            messaged: q.suppressed.messaged,
            booked: q.suppressed.booked,
            ceased: q.suppressed.ceased,
            parked: q.suppressed.parked,
            dismissed: q.dismissedCount,
          },
          items: q.suppressed.items,
        },
        briefPreparedAt: q.briefPreparedAt,
        backlogCreatedAt: q.backlogCreatedAt,
      });
    } catch (e) {
      logger.error(`followupsScreen: queue error for ${clientId}: ${e?.message || e}`);
      res.status(500).json({ error: 'queue_failed', details: e?.message || String(e) });
    }
  });

  // The story so far — the dossier payload, verbatim from the store (it is already JSON).
  // Staleness: the dossier's built_at vs the newest LinkedIn line in the lead's Notes — one cheap
  // Airtable read. Deliberately LinkedIn-only for now: the email side would cost a mailbox read
  // per expand, and the overnight rebuild (fingerprint-checked) covers it within a day.
  // refresh=1 queues the standard dossier pass in the background (rebuilds ONLY people whose
  // thread changed, on the client's own key) — the screen re-polls builtAt to see it land.
  router.get('/story', authenticateUserWithTestMode, async (req, res) => {
    const clientId = getClientId(req);
    const gate = await resolveGate(clientId);
    if (!gate) return res.status(403).json({ error: 'feature_not_enabled' });
    const name = String(req.query.name || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!name && !email) return res.status(400).json({ error: 'name_or_email_required' });
    try {
      const dossier = require('../services/wingguyDossier');
      if (parseBoolFlag(req.query.refresh)) {
        // Fire-and-forget, same shape as chat's wingguy_prepare_brief background rebuild.
        setImmediate(() => dossier.prepareDossiers(clientId)
          .then((r) => logger.info(`followupsScreen: refresh dossiers for ${clientId}: ${JSON.stringify(r)}`))
          .catch((e) => logger.warn(`followupsScreen: refresh dossiers failed for ${clientId}: ${e?.message || e}`)));
      }
      // Same lookup order as chat's wingguy_dossier: keyed row, name match, live CRM fallback.
      let row = null;
      if (email || name) row = await dossier.getDossierRow(clientId, (email || name).toLowerCase());
      if (!row && name) row = await dossier.findDossierByName(clientId, name);
      if (!row) {
        const live = await dossier.buildLiveMiniDossier(clientId, { name, email });
        if (live && live.multiple) return res.status(300).json({ error: 'multiple_matches', candidates: live.multiple });
        if (live && live.payload) return res.json({ ok: true, source: 'live-mini', builtAt: live.payload.builtAt || null, stale: false, story: live.payload });
        return res.status(404).json({ error: 'not_found' });
      }
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      // Staleness check — best-effort; a failure serves the story unmarked rather than not at all.
      let stale = false;
      try {
        const clientService = require('../services/clientService');
        const { parseLinkedInLast } = require('../services/wingguyMailMcp');
        const coach = gate.client;
        if (coach.airtableBaseId && (payload.email || email || name)) {
          const base = clientService.getClientBase(coach.airtableBaseId);
          const esc = (s) => String(s).replace(/"/g, '\\"');
          const formula = (payload.email || email)
            ? `LOWER({Email}) = "${esc(String(payload.email || email).toLowerCase())}"`
            : `FIND(LOWER("${esc(name)}"), LOWER({First Name} & " " & {Last Name})) > 0`;
          const recs = await base('Leads').select({ filterByFormula: formula, fields: ['First Name', 'Notes'], maxRecords: 1 }).all();
          if (recs.length) {
            const last = parseLinkedInLast(recs[0].fields['Notes'], recs[0].fields['First Name']);
            if (last && last.ms && row.built_at && last.ms > new Date(row.built_at).getTime()) stale = true;
          }
        }
      } catch (e) { logger.warn(`followupsScreen: staleness check skipped: ${e?.message || e}`); }
      res.json({ ok: true, source: 'store', builtAt: row.built_at, stale, refreshing: parseBoolFlag(req.query.refresh), story: payload });
    } catch (e) {
      logger.error(`followupsScreen: story error for ${clientId}: ${e?.message || e}`);
      res.status(500).json({ error: 'story_failed', details: e?.message || String(e) });
    }
  });

  // Actions — the same three levers chat has, through the same functions. Nothing here sends
  // a message; Draft is a link (the signed draft page), not an endpoint.
  router.post('/action', authenticateUserWithTestMode, async (req, res) => {
    const clientId = getClientId(req);
    const gate = await resolveGate(clientId);
    if (!gate) return res.status(403).json({ error: 'feature_not_enabled' });
    const { name, email, src, action, parkDate } = req.body || {};
    if (!name && !email) return res.status(400).json({ error: 'name_or_email_required' });
    try {
      const mcp = require('../services/wingguyMailMcp');
      const backlog = require('../services/wingguyBacklogAudit');
      const dismissed = require('../services/wingguyFollowupsDismissed');
      // The chat tool functions aren't exported individually — dispatch through the same
      // TOOL_DEFS table chat uses, unwrapped ({ text, isError } straight from the tool).
      const call = (tool, args) => {
        const def = mcp.TOOL_DEFS.find((d) => d.name === tool);
        if (!def) throw new Error(`tool ${tool} not found`);
        return def.run(args || {}, clientId);
      };

      if (action === 'drop') {
        // BOTH stores, always: the cease flag for the engine, done for the backlog worklist. A
        // cease alone left the person sitting on the backlog (Fault A, the Farhad/Tracey case).
        const r = await call('wingguy_cease_followups', { lead_email: email || undefined, lead_name: name || undefined, cease: true });
        if (r && r.isError) return res.status(400).json({ error: 'drop_failed', details: r.text });
        if (r && /More than one lead matches/i.test(String(r.text || ''))) return res.status(409).json({ error: 'ambiguous_lead', details: r.text });
        try { if (name) await backlog.markItem(clientId, name, 'done'); } catch (_) { /* no backlog row is fine */ }
        return res.json({ ok: true, action: 'drop', detail: r ? r.text : null });
      }

      if (action === 'park') {
        const d = String(parkDate || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'park_date_required', details: 'parkDate must be YYYY-MM-DD — the screen resolves "1 month"/"new year" itself.' });
        const r = await call('wingguy_set_reconnect', { lead_email: email || undefined, lead_name: name || undefined, reconnect_on: d });
        if (r && r.isError) return res.status(400).json({ error: 'park_failed', details: r.text });
        if (r && /More than one lead matches/i.test(String(r.text || ''))) return res.status(409).json({ error: 'ambiguous_lead', details: r.text });
        return res.json({ ok: true, action: 'park', parkDate: d, detail: r ? r.text : null });
      }

      if (action === 'done') {
        // Backlog rows have a real done state; today rows get the shared dismissed store (both
        // filtered inside buildQueue, so chat agrees). When src is unknown, try backlog first and
        // fall through — marking both for a person in both stores is harmless and self-consistent.
        let backlogDone = null;
        if (src !== 'today' && name) {
          try { backlogDone = await backlog.markItem(clientId, name, 'done'); } catch (_) { backlogDone = null; }
        }
        if (src === 'today' || !backlogDone) await dismissed.dismiss(clientId, name || email);
        return res.json({ ok: true, action: 'done' });
      }

      return res.status(400).json({ error: 'invalid_action', allowed: ['drop', 'park', 'done'] });
    } catch (e) {
      logger.error(`followupsScreen: action error for ${clientId}: ${e?.message || e}`);
      res.status(500).json({ error: 'action_failed', details: e?.message || String(e) });
    }
  });

  app.use('/api/followups', router);
};
