// routes/rescoreRoutes.js
// On-demand rescore feature (per-client, gated by master "Rescore Enabled").
// - GET  /api/rescore/status              -> { enabled, credits }
// - GET  /api/rescore/estimate            -> count + cost + fits-credits for a scope
// - POST /api/rescore/run                 -> preview|commit; enforces + debits credits; before/after
//
// Two modes (see docs/RESCORE-FEATURE-PLAN.md):
//   preview -> non-destructive (persist:false): recompute + return scores, write nothing.
//   commit  -> writes new scores back (persist:true) -> flows to Top Scoring Leads.
// Two scopes:
//   sample  -> stratified, DATA-DRIVEN bands (thirds by rank of the client's own scores).
//   months  -> Scoring Status='Scored' AND Date Scored within the last N months.
//
// Both modes debit credits (real AI work). ~3,400 tokens/lead, ~1c/lead on Gemini 2.5 Pro.

const express = require('express');
const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'rescore' });
const clientService = require('../services/clientService');
const gemini = require('../config/geminiClient');
const batchScorer = require('../batchScorer');

const TOKENS_PER_LEAD = 3400;   // measured average
const USD_PER_LEAD = 0.008;     // ~1c/lead on Gemini 2.5 Pro
const MAX_SYNC = 120;           // TEMP: synchronous cap until the async/progress path (next stage)
const SAMPLE_MAX = 100;
const SAMPLE_DEFAULT = 50;

module.exports = function mountRescore(app) {
  const router = express.Router();

  async function resolve(req) {
    const clientId = req.headers['x-client-id'] || req.query.clientId || req.query.testClient;
    if (!clientId) return { error: 'client required', code: 400 };
    const status = await clientService.getRescoreCreditsStatus(clientId);
    if (!status) return { error: 'client not found', code: 404 };
    if (!status.enabled) return { error: 'Rescore not enabled for this client', code: 403 };
    const client = await clientService.getClientById(clientId);
    const base = clientService.getClientBase(client.airtableBaseId);
    return { clientId, client, base, status };
  }

  const creditsView = (s) => ({
    available: s.available, granted: s.granted, consumed: s.consumed,
    monthlyAccrual: s.monthlyAccrual, monthsElapsed: s.monthsElapsed
  });

  // Read up to 1,000 of the client's scored AI Scores and derive low/mid/high bands by RANK.
  async function readScoredScores(base) {
    const scored = [];
    await base('Leads').select({
      filterByFormula: `AND(({Scoring Status} = 'Scored'), NOT({AI Score} = BLANK()))`,
      fields: ['AI Score'], pageSize: 100
    }).eachPage((recs, next) => {
      for (const r of recs) { if (scored.length >= 1000) break; scored.push({ id: r.id, score: Number(r.get('AI Score')) }); }
      if (scored.length >= 1000) return; next();
    });
    scored.sort((a, b) => a.score - b.score);
    return scored;
  }

  // Pick `size` ids spread evenly across the three rank-bands.
  function stratifiedIds(scored, size) {
    const n = scored.length;
    if (n === 0) return [];
    const third = Math.floor(n / 3);
    const bands = [scored.slice(0, third), scored.slice(third, 2 * third), scored.slice(2 * third)];
    const per = Math.max(1, Math.round(size / 3));
    const out = [];
    for (const band of bands) {
      if (!band.length) continue;
      const step = Math.max(1, Math.floor(band.length / per));
      for (let i = 0; i < band.length && out.length < size; i += step) out.push(band[i].id);
    }
    return out.slice(0, size);
  }

  const escId = (id) => String(id).replace(/'/g, "");
  async function fetchFullByIds(base, ids) {
    if (!ids.length) return [];
    const out = [];
    // chunk the OR() formula to keep it well under Airtable's length limit
    for (let i = 0; i < ids.length; i += 50) {
      const slice = ids.slice(i, i + 50);
      const formula = `OR(${slice.map(id => `RECORD_ID()='${escId(id)}'`).join(', ')})`;
      const recs = await base('Leads').select({ filterByFormula: formula }).all();
      out.push(...recs);
    }
    return out;
  }

  function monthsFormula(months) {
    const m = Math.max(1, Math.min(24, parseInt(months, 10) || 1));
    return `AND(({Scoring Status} = 'Scored'), NOT({Date Scored} = BLANK()), IS_AFTER({Date Scored}, DATEADD(TODAY(), -${m}, 'months')))`;
  }

  // Build the scope: returns { records (full), oldById, count }.
  async function buildScope(base, { scope, size, months }) {
    if (scope === 'months') {
      const records = await base('Leads').select({ filterByFormula: monthsFormula(months) }).all();
      const oldById = {}; for (const r of records) oldById[r.id] = Number(r.get('AI Score'));
      return { records, oldById, count: records.length };
    }
    // default: sample
    const sz = Math.max(1, Math.min(SAMPLE_MAX, parseInt(size, 10) || SAMPLE_DEFAULT));
    const scored = await readScoredScores(base);
    const oldById = {}; for (const s of scored) oldById[s.id] = s.score;
    const ids = stratifiedIds(scored, sz);
    const records = await fetchFullByIds(base, ids);
    return { records, oldById, count: records.length };
  }

  // GET /status
  router.get('/status', async (req, res) => {
    try {
      const r = await resolve(req);
      if (r.error) return res.status(r.code).json({ ok: false, error: r.error, enabled: false });
      res.json({ ok: true, enabled: true, credits: creditsView(r.status) });
    } catch (e) {
      logger.error('rescore/status error', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /estimate?scope=sample&size=50  OR  ?scope=months&months=3
  router.get('/estimate', async (req, res) => {
    try {
      const r = await resolve(req);
      if (r.error) return res.status(r.code).json({ ok: false, error: r.error });
      const scope = req.query.scope === 'months' ? 'months' : 'sample';
      let count;
      if (scope === 'months') {
        count = 0;
        await r.base('Leads').select({ filterByFormula: monthsFormula(req.query.months), fields: ['AI Score'], pageSize: 100 })
          .eachPage((recs, next) => { count += recs.length; next(); });
      } else {
        const sz = Math.max(1, Math.min(SAMPLE_MAX, parseInt(req.query.size, 10) || SAMPLE_DEFAULT));
        const scored = await readScoredScores(r.base);
        count = Math.min(sz, scored.length);
      }
      res.json({
        ok: true, scope, count,
        estTokens: count * TOKENS_PER_LEAD,
        estCostUsd: Math.round(count * USD_PER_LEAD * 100) / 100,
        creditsAvailable: r.status.available,
        fits: count <= r.status.available
      });
    } catch (e) {
      logger.error('rescore/estimate error', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /run   body/query: mode=preview|commit, scope=sample|months, size, months
  router.post('/run', async (req, res) => {
    try {
      const r = await resolve(req);
      if (r.error) return res.status(r.code).json({ ok: false, error: r.error });

      const q = { ...req.query, ...(req.body || {}) };
      const mode = q.mode === 'commit' ? 'commit' : 'preview';
      const scope = q.scope === 'months' ? 'months' : 'sample';
      const persist = mode === 'commit';

      const { records, oldById, count } = await buildScope(r.base, { scope, size: q.size, months: q.months });
      if (count === 0) return res.json({ ok: true, mode, scope, count: 0, rows: [], summary: { message: 'No leads in scope.' } });
      if (count > MAX_SYNC) {
        return res.status(413).json({ ok: false, error: `Scope has ${count} leads; the synchronous run is capped at ${MAX_SYNC} for now (async run coming next).`, count });
      }
      if (count > r.status.available) {
        return res.status(402).json({ ok: false, error: 'Not enough credits', needed: count, available: r.status.available });
      }

      const result = await batchScorer.scoreRecordsNow({
        records, clientId: r.clientId, clientBase: r.base,
        dependencies: { vertexAIClient: gemini.vertexAIClient, geminiModelId: gemini.geminiModelId },
        persist, runId: `RESCORE-${mode}`
      });

      // Debit by leads actually scored (failures don't cost the client credits)
      const scored = result.successful || 0;
      const creditsAfter = await clientService.debitRescoreCredits(r.clientId, scored);

      // Build before/after
      const nameById = {}; for (const rec of records) nameById[rec.id] = `${rec.get('First Name') || ''} ${rec.get('Last Name') || ''}`.trim();
      const tier = Number(r.client.primaryFloor) || 70;
      let up = 0, down = 0, crossedUp = 0, crossedDown = 0;
      const rows = (result.perLead || []).map(p => {
        const oldScore = oldById[p.recordId];
        const delta = (typeof p.newScore === 'number' && typeof oldScore === 'number') ? Math.round((p.newScore - oldScore) * 100) / 100 : null;
        if (typeof delta === 'number') { if (delta > 0) up++; else if (delta < 0) down++; }
        if (typeof oldScore === 'number' && typeof p.newScore === 'number') {
          if (oldScore < tier && p.newScore >= tier) crossedUp++;
          if (oldScore >= tier && p.newScore < tier) crossedDown++;
        }
        return { name: nameById[p.recordId] || p.recordId, old: (typeof oldScore === 'number' ? oldScore : null), new: p.newScore, delta, status: p.status };
      }).sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0));

      res.json({
        ok: true, mode, scope, count, scored, persisted: result.persisted,
        tokensUsed: result.tokensUsed,
        credits: creditsView(creditsAfter),
        summary: { rescored: scored, movedUp: up, movedDown: down, crossedIntoTopTier: crossedUp, droppedBelowTier: crossedDown, tierLine: tier },
        rows
      });
    } catch (e) {
      logger.error('rescore/run error', e.message, e.stack);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.use('/api/rescore', router);
  logger.info('[Rescore] routes mounted at /api/rescore');
};
