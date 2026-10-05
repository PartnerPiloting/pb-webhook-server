// routes/rescoreRoutes.js
// On-demand rescore feature (per-client, gated by master "Rescore Enabled").
// - GET  /api/rescore/status              -> { enabled, credits }
// - GET  /api/rescore/estimate            -> count + cost + fits-credits for a scope
// - POST /api/rescore/run                 -> preview|commit; enforces + debits credits; before/after
//
// The engine (scopes, credits, jobs, baselines) lives in services/rescoreRunner.js, shared with
// the Wingguy chat tool wingguy_scoring_test. This file is only the HTTP door.

const express = require('express');
const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'rescore' });
const runner = require('../services/rescoreRunner');

module.exports = function mountRescore(app) {
  const router = express.Router();

  const resolve = (req) => runner.resolveClient(req.headers['x-client-id'] || req.query.clientId || req.query.testClient);

  // GET /status
  router.get('/status', async (req, res) => {
    try {
      const r = await resolve(req);
      if (r.error) return res.status(r.code).json({ ok: false, error: r.error, enabled: false });
      res.json({ ok: true, enabled: true, credits: runner.creditsView(r.status) });
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
      const est = await runner.estimate(r, { scope, size: req.query.size, months: req.query.months });
      res.json({ ok: true, ...est });
    } catch (e) {
      logger.error('rescore/estimate error', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /run   body/query: mode=preview|commit, scope=sample|months, size, months
  // Starts an async job and returns { jobId, total }. Poll GET /run/status?jobId=... .
  router.post('/run', async (req, res) => {
    try {
      const r = await resolve(req);
      if (r.error) return res.status(r.code).json({ ok: false, error: r.error });

      const q = { ...req.query, ...(req.body || {}) };
      const mode = q.mode === 'commit' ? 'commit' : 'preview';
      const scope = q.scope === 'months' ? 'months' : 'sample';

      const out = await runner.startRun(r, { mode, scope, size: q.size, months: q.months });
      if (out.empty) return res.json({ ok: true, jobId: null, total: 0, done: true, result: out.result });
      if (out.insufficient) {
        return res.status(402).json({ ok: false, error: 'Not enough credits', needed: out.needed, available: out.available });
      }
      res.json({ ok: true, jobId: out.jobId, mode: out.mode, scope: out.scope, total: out.total });
    } catch (e) {
      logger.error('rescore/run error', e.message, e.stack);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /run/status?jobId=...  -> progress + final result when done
  router.get('/run/status', (req, res) => {
    const job = runner.getJob(req.query.jobId);
    if (!job) return res.status(404).json({ ok: false, error: 'job not found (may have expired)' });
    res.json({
      ok: true, status: job.status, done: job.done, total: job.total,
      mode: job.mode, scope: job.scope, error: job.error,
      result: job.status === 'done' ? job.result : null
    });
  });

  app.use('/api/rescore', router);
  logger.info('[Rescore] routes mounted at /api/rescore');
};
