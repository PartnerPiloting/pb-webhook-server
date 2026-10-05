// services/rescoreRunner.js
// The on-demand rescore ENGINE, shared by both doors:
//   - the portal's Re-score Leads card (routes/rescoreRoutes.js, /api/rescore/*)
//   - the Wingguy chat tool wingguy_scoring_test (services/wingguyScoringMcp.js)
// Moved out of the route 2026-10-05 so chat can run "Test on sample" too. One job store and one
// per-client baseline, so a test started from chat and one started in the portal compare
// against each other.
//
// Two modes (see docs/RESCORE-FEATURE-PLAN.md):
//   preview -> non-destructive (persist:false): recompute + return scores, write nothing.
//   commit  -> writes new scores back (persist:true) -> flows to Top Scoring Leads.
// Two scopes:
//   sample  -> stratified, DATA-DRIVEN bands (thirds by rank of the client's own scores).
//   months  -> Scoring Status='Scored' AND Date Scored within the last N months.
//
// Both modes debit credits (real AI work). ~3,400 tokens/lead, ~1c/lead on Gemini 2.5 Pro.

const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'rescore' });

const TOKENS_PER_LEAD = 3400;   // measured average
const USD_PER_LEAD = 0.008;     // ~1c/lead on Gemini 2.5 Pro
const SAMPLE_MAX = 100;
const SAMPLE_DEFAULT = 50;
const JOB_TTL_MS = 60 * 60 * 1000; // keep finished jobs pollable for 1h

// Lazy requires: clientService / gemini / batchScorer pull Airtable + Vertex config at load time.
const clientService = () => require('./clientService');

// Build the before/after report from the engine result + captured old scores.
function buildReport(result, oldById, nameById, tier) {
  let up = 0, down = 0, crossedUp = 0, crossedDown = 0;
  const rows = (result.perLead || []).map(p => {
    const oldScore = oldById[p.recordId];
    const delta = (typeof p.newScore === 'number' && typeof oldScore === 'number') ? Math.round((p.newScore - oldScore) * 100) / 100 : null;
    if (typeof delta === 'number') { if (delta > 0) up++; else if (delta < 0) down++; }
    if (typeof oldScore === 'number' && typeof p.newScore === 'number') {
      if (oldScore < tier && p.newScore >= tier) crossedUp++;
      if (oldScore >= tier && p.newScore < tier) crossedDown++;
    }
    return { recordId: p.recordId, name: nameById[p.recordId] || p.recordId, old: (typeof oldScore === 'number' ? oldScore : null), new: p.newScore, delta, status: p.status };
  }).sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0));
  const scored = result.successful || 0;
  return {
    scored, tokensUsed: result.tokensUsed, persisted: result.persisted,
    summary: { rescored: scored, movedUp: up, movedDown: down, crossedIntoTopTier: crossedUp, droppedBelowTier: crossedDown, tierLine: tier },
    rows
  };
}

// In-memory job store for async rescore runs. A server restart loses in-flight jobs
// (rare; acceptable for the gated test rollout). Finished jobs are pollable for JOB_TTL_MS.
const jobs = new Map();
let jobSeq = 0;
const newJobId = () => `rj_${Date.now().toString(36)}_${(jobSeq++).toString(36)}`;
const pruneJobs = () => { const now = Date.now(); for (const [id, j] of jobs) { if (now - j.startedAt > JOB_TTL_MS) jobs.delete(id); } };

// Per-client BASELINE: the last preview's scores, keyed by clientId. When the next preview
// covers the SAME lead set (idsKey matches), each row gains deltaVsPrevTest — and because
// batching is deterministic, that delta is PURE attribute-change signal (zero batch noise).
// A commit clears the baseline (stored scores are re-baselined). In-memory, same tradeoff
// as the job store.
const baselines = new Map();

async function resolveClient(clientId) {
  if (!clientId) return { error: 'client required', code: 400 };
  const cs = clientService();
  const status = await cs.getRescoreCreditsStatus(clientId);
  if (!status) return { error: 'client not found', code: 404 };
  if (!status.enabled) return { error: 'Rescore not enabled for this client', code: 403 };
  const client = await cs.getClientById(clientId);
  const base = cs.getClientBase(client.airtableBaseId);
  return { clientId, client, base, status };
}

const creditsView = (s) => ({
  available: s.available, granted: s.granted, consumed: s.consumed,
  monthlyAccrual: s.monthlyAccrual, monthsElapsed: s.monthsElapsed
});

// Read up to 1,000 of the client's scored AI Scores and derive low/mid/high bands by RANK.
// NOTE: the early-stop must resolve the promise explicitly — with Airtable's eachPage,
// returning without calling next() (or the done callback) leaves the await hanging forever.
// That exact bug made /estimate and /run hang for any client with >1,000 scored leads
// (Ashley at 291 never hit the cap; Guy's base did).
async function readScoredScores(base) {
  const scored = [];
  await new Promise((resolve, reject) => {
    base('Leads').select({
      filterByFormula: `AND(({Scoring Status} = 'Scored'), NOT({AI Score} = BLANK()))`,
      fields: ['AI Score'], pageSize: 100
    }).eachPage(
      (recs, next) => {
        for (const r of recs) { if (scored.length >= 1000) break; scored.push({ id: r.id, score: Number(r.get('AI Score')) }); }
        if (scored.length >= 1000) return resolve();
        next();
      },
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
  // Stable order: score, then record id as tie-break — so the same pool always yields the
  // same band split and the same stratified sample, run after run.
  scored.sort((a, b) => (a.score - b.score) || (a.id < b.id ? -1 : 1));
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
// DETERMINISTIC BATCHING: records are sorted by record id before scoring, so the same scope
// always forms the same Gemini batches. Proven 2026-07-25: identical batch => identical
// scores at temperature 0 (0.00 delta on 8/8); the historical ±20-40 "variance" was batch
// composition, not randomness. Stable order makes test-vs-test deltas pure attribute signal.
async function buildScope(base, { scope, size, months }) {
  if (scope === 'months') {
    const records = await base('Leads').select({ filterByFormula: monthsFormula(months) }).all();
    records.sort((a, b) => (a.id < b.id ? -1 : 1));
    const oldById = {}; for (const r of records) oldById[r.id] = Number(r.get('AI Score'));
    return { records, oldById, count: records.length };
  }
  // default: sample
  const sz = Math.max(1, Math.min(SAMPLE_MAX, parseInt(size, 10) || SAMPLE_DEFAULT));
  const scored = await readScoredScores(base);
  const oldById = {}; for (const s of scored) oldById[s.id] = s.score;
  const ids = stratifiedIds(scored, sz);
  const records = await fetchFullByIds(base, ids);
  records.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { records, oldById, count: records.length };
}

// How many leads a scope covers, and what it would cost. `r` = resolveClient() result.
async function estimate(r, { scope, size, months }) {
  let count;
  if (scope === 'months') {
    count = 0;
    await r.base('Leads').select({ filterByFormula: monthsFormula(months), fields: ['AI Score'], pageSize: 100 })
      .eachPage((recs, next) => { count += recs.length; next(); });
  } else {
    const sz = Math.max(1, Math.min(SAMPLE_MAX, parseInt(size, 10) || SAMPLE_DEFAULT));
    const scored = await readScoredScores(r.base);
    count = Math.min(sz, scored.length);
  }
  return {
    scope, count,
    estTokens: count * TOKENS_PER_LEAD,
    estCostUsd: Math.round(count * USD_PER_LEAD * 100) / 100,
    creditsAvailable: r.status.available,
    fits: count <= r.status.available
  };
}

// Start an async run. `r` = resolveClient() result. Returns one of:
//   { empty: true, result }                 - nothing in scope
//   { insufficient: true, needed, available } - not enough credits
//   { jobId, mode, scope, total }           - started; poll getJob(jobId)
async function startRun(r, { mode, scope, size, months }) {
  const persist = mode === 'commit';
  // Scope-building + credit enforcement happen synchronously (fast) before the job starts.
  const { records, oldById, count } = await buildScope(r.base, { scope, size, months });
  if (count === 0) return { empty: true, result: { mode, scope, count: 0, rows: [], summary: { message: 'No leads in scope.' } } };
  if (count > r.status.available) return { insufficient: true, needed: count, available: r.status.available };

  pruneJobs();
  const jobId = newJobId();
  const nameById = {}; for (const rec of records) nameById[rec.id] = `${rec.get('First Name') || ''} ${rec.get('Last Name') || ''}`.trim();
  const tier = Number(r.client.primaryFloor) || 70;
  const job = { id: jobId, clientId: r.clientId, mode, scope, status: 'running', total: count, done: 0, result: null, error: null, startedAt: Date.now() };
  jobs.set(jobId, job);

  // Kick off scoring in the background (do NOT await — the caller returns immediately).
  (async () => {
    try {
      const gemini = require('../config/geminiClient');
      const batchScorer = require('../batchScorer');
      const result = await batchScorer.scoreRecordsNow({
        records, clientId: r.clientId, clientBase: r.base,
        dependencies: { vertexAIClient: gemini.vertexAIClient, geminiModelId: gemini.geminiModelId },
        persist, runId: `RESCORE-${mode}`,
        onProgress: (done, total) => { job.done = done; job.total = total; }
      });
      // Debit by leads actually scored (failures don't cost the client credits).
      const creditsAfter = await clientService().debitRescoreCredits(r.clientId, result.successful || 0);
      const report = buildReport(result, oldById, nameById, tier);

      // Baseline compare (preview): if the previous preview covered the same lead set,
      // annotate deltaVsPrevTest — the noise-free "what did my attribute change do" signal.
      const idsKey = records.map(rec => rec.id).sort().join(',');
      let comparedToPreviousTest = false, previousTestAt = null;
      if (mode === 'preview') {
        const bl = baselines.get(r.clientId);
        if (bl && bl.idsKey === idsKey) {
          comparedToPreviousTest = true;
          previousTestAt = bl.at;
          let vsUp = 0, vsDown = 0, vsSame = 0;
          for (const row of report.rows) {
            const prev = bl.scoresById[row.recordId];
            row.prevTest = (typeof prev === 'number') ? prev : null;
            row.deltaVsPrevTest = (typeof prev === 'number' && typeof row.new === 'number')
              ? Math.round((row.new - prev) * 100) / 100 : null;
            if (typeof row.deltaVsPrevTest === 'number') {
              if (row.deltaVsPrevTest > 0) vsUp++; else if (row.deltaVsPrevTest < 0) vsDown++; else vsSame++;
            }
          }
          report.summary.vsPreviousTest = { movedUp: vsUp, movedDown: vsDown, unchanged: vsSame };
        }
        // This preview becomes the new baseline for the next test.
        const scoresById = {};
        for (const p of (result.perLead || [])) { if (typeof p.newScore === 'number') scoresById[p.recordId] = p.newScore; }
        baselines.set(r.clientId, { idsKey, at: Date.now(), scoresById });
      } else {
        // Commit re-baselines the stored scores; the old test baseline is stale.
        baselines.delete(r.clientId);
      }

      job.result = { mode, scope, count, credits: creditsView(creditsAfter), comparedToPreviousTest, previousTestAt, ...report };
      job.done = count;
      job.status = 'done';
    } catch (e) {
      logger.error('rescore job failed', e.message, e.stack);
      job.status = 'error';
      job.error = e.message;
    }
  })();

  return { jobId, mode, scope, total: count };
}

const getJob = (jobId) => jobs.get(jobId) || null;

module.exports = {
  resolveClient, creditsView, estimate, startRun, getJob,
  SAMPLE_DEFAULT, SAMPLE_MAX,
  // exported for tests
  buildReport, stratifiedIds,
};
