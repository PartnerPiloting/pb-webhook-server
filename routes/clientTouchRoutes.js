// routes/clientTouchRoutes.js
// Guy's Monday screen - the weekly client touch planner on the client board
// (docs/CLIENT-TOUCH-PLANNER.md, "Guy's Monday screen"). Coach only, same auth as the board:
// the caller is whoever the portal token resolves to, and every row is one of THEIR clients.
//
//   GET  /                        the screen for the Monday Guy is working towards - built a week
//                                 ahead (?week=YYYY-MM-DD for another)
//   POST /build                   build / rebuild that Monday's proposals (rows Guy has acted on are kept;
//                                 {clientIds:[...]} limits it; {force:true} redoes acted-on rows)
//   GET  /:clientId/preview       the full HTML of one email as it would go
//   POST /:clientId/approve       approve as drafted
//   POST /:clientId/edit          {opening, subject} - Guy's words, then approved
//   POST /:clientId/skip          {whyNot, home, until?} - not this week (and why, filed to its home)
//   POST /:clientId/swap          {kind, key, title?, bodyHtml?} - a different piece this week (a pin + rebuild)
//   POST /:clientId/pin           {kind, key, title?, bodyHtml?, week?} - pin for a week (default next week)
//   POST /:clientId/unpin         {week}
//   POST /:clientId/note          {append} - a line onto the client's Touch Note
//   POST /pin-everyone            {kind, key, title, bodyHtml, week?} - a one-off for everyone
//   POST /why-not                 {clientId?, pieceKey?, home, words} - the "why not" box on its own
//   POST /:clientId/keep          a HELD row (or one approved after its Monday went): Guy has looked -
//                                 approve it and send it now (the never-send checks still run)
//   POST /send-approved           send every approved row now (each re-checked) - the Monday 8am
//                                 run does this by itself; this is the by-hand door
//   GET  /introductions           this week's suggested pairs (built on first ask, then cached)
//
// Mounted from index.js at /api/client-board/touch-plan (before the board's /:clientId routes).

const express = require('express');
const { authenticateUserWithTestMode } = require('../middleware/authMiddleware');
const planner = require('../services/clientTouchPlanner');
const planStore = require('../services/clientTouchPlanStore');
const clientService = require('../services/clientService');
const { createLogger } = require('../utils/contextLogger');

const router = express.Router();
const parseJson = express.json({ limit: '1mb' });

function coachOnly(req, res, next) {
  if (!req.client || req.assistant) return res.status(403).json({ success: false, error: 'Coach access only' });
  return next();
}

function weekFrom(req) {
  const w = String((req.query && req.query.week) || (req.body && req.body.week) || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : planStore.planningWeek(new Date(), planner.SEND_HOUR);
}

/** The client must be one of the caller's. Returns the client or sends 403. */
async function ownClient(req, res) {
  const client = await clientService.getClientById(req.params.clientId);
  if (!client || client.coach !== req.client.clientId) {
    res.status(403).json({ success: false, error: 'Not your client' });
    return null;
  }
  return client;
}

function wrap(op, fn) {
  return async (req, res) => {
    const logger = createLogger({ runId: 'PLANNER', clientId: req.client ? req.client.clientId : 'SYSTEM', operation: op });
    try { await fn(req, res, logger); }
    catch (e) {
      logger.error(`${op} failed: ${e.message}`, e.stack);
      res.status(500).json({ success: false, error: e.message });
    }
  };
}

router.use(authenticateUserWithTestMode, coachOnly);

router.get('/', wrap('touch_plan_screen', async (req, res) => {
  const screen = await planner.screenFor(req.client.clientId, weekFrom(req));
  res.json({ success: true, ...screen });
}));

router.post('/build', parseJson, wrap('touch_plan_build', async (req, res, logger) => {
  const week = weekFrom(req);
  const clientIds = Array.isArray(req.body && req.body.clientIds) ? req.body.clientIds : null;
  // In the background - drafting every opening takes minutes; the panel polls the screen's `build`.
  const out = await planner.startBuild(req.client.clientId, week, { clientIds, force: !!(req.body && req.body.force) });
  logger.info(out.started ? `build ${week} started in the background` : `build ${week} already running since ${out.already.startedAt}`);
  res.json({ success: true, weekOf: week, started: out.started, startedAt: out.startedAt || (out.already && out.already.startedAt) });
}));

router.get('/introductions', wrap('touch_plan_intros', async (req, res) => {
  const intros = require('../services/clientTouchIntroductions');
  const out = await intros.suggestionsFor(req.client.clientId, weekFrom(req), { refresh: String(req.query.refresh || '') === '1' });
  res.json({ success: true, ...out });
}));

router.post('/pin-everyone', parseJson, wrap('touch_plan_pin_all', async (req, res) => {
  const { kind = 'one-off', key, title = '', bodyHtml = '', note = '' } = req.body || {};
  const week = weekFrom(req);
  if (!key) return res.status(400).json({ success: false, error: 'key is required' });
  await planStore.setPin({ clientId: '*', weekOf: week, kind, key, title, bodyHtml, note });
  res.json({ success: true, weekOf: week });
}));

router.post('/why-not', parseJson, wrap('touch_plan_why_not', async (req, res) => {
  const { clientId = null, pieceKey = null, home, words } = req.body || {};
  const filed = await fileWhyNot(req.client.clientId, { weekOf: weekFrom(req), clientId, pieceKey, home, words });
  res.json({ success: true, ...filed });
}));

router.post('/send-approved', parseJson, wrap('touch_plan_send', async (req, res, logger) => {
  const week = weekFrom(req);
  const out = await planner.sendApproved(req.client.clientId, week);
  logger.info(`send-approved ${week}: ${out.sent} sent, ${out.failed} failed, ${out.held} held`);
  res.json({ success: true, ...out });
}));

router.post('/:clientId/keep', parseJson, wrap('touch_plan_keep', async (req, res, logger) => {
  if (!(await ownClient(req, res))) return;
  const week = weekFrom(req);
  const row = await planStore.planFor(week, req.params.clientId);
  if (!row || !row.pick || !row.pick.what) return res.status(404).json({ success: false, error: 'No email prepared for this client that week.' });
  if (!['held', 'approved', 'edited', 'proposed', 'lapsed', 'failed'].includes(row.status)) return res.status(400).json({ success: false, error: `It is ${row.status} - nothing to send.` });
  await planStore.setPlanStatus(week, req.params.clientId, row.status === 'edited' ? 'edited' : 'approved', { hold: null });
  const out = await planner.sendApproved(req.client.clientId, week, { onlyClientIds: [req.params.clientId], keep: new Set([req.params.clientId]) });
  logger.info(`keep ${req.params.clientId} ${week}: ${out.sent} sent, ${out.held} held`);
  res.json({ success: true, ...out });
}));

// Guy picks a different thought for the week (or none). Stays approved if it was - same email, new thought.
router.post('/:clientId/thought', parseJson, wrap('touch_plan_thought', async (req, res) => {
  if (!(await ownClient(req, res))) return;
  const week = weekFrom(req);
  const slug = String((req.body && req.body.slug) || '').trim();
  let thought = null;
  if (slug) {
    const thoughts = require('../services/clientTouchThought');
    const nuggets = thoughts.loadNuggets();
    const piece = require('../services/onePagerContent').listPieces().find((p) => p.slug === slug && p.status === 'final');
    if (!piece || !nuggets[slug]) return res.status(400).json({ success: false, error: 'Not one of the thoughts' });
    const why = String((req.body && req.body.why) || '').replace(/[–—]/g, '-').trim();
    thought = { slug, title: piece.title, text: nuggets[slug], why: why || 'your choice', source: 'guy' };
  }
  const row = await planStore.setPlanThought(week, req.params.clientId, thought);
  res.json({ success: true, row });
}));

router.get('/:clientId/preview', wrap('touch_plan_preview', async (req, res) => {
  if (!(await ownClient(req, res))) return;
  const html = await planner.previewFor(weekFrom(req), req.params.clientId);
  if (!html) return res.status(404).send('No email prepared for this client this week.');
  res.type('html').send(html);
}));

router.post('/:clientId/approve', parseJson, wrap('touch_plan_approve', async (req, res) => {
  if (!(await ownClient(req, res))) return;
  const row = await planStore.setPlanStatus(weekFrom(req), req.params.clientId, 'approved');
  res.json({ success: true, row });
}));

router.post('/:clientId/edit', parseJson, wrap('touch_plan_edit', async (req, res) => {
  if (!(await ownClient(req, res))) return;
  const { opening, subject } = req.body || {};
  const row = await planStore.setPlanStatus(weekFrom(req), req.params.clientId, 'edited', { opening: typeof opening === 'string' ? opening : null, subject: typeof subject === 'string' && subject.trim() ? subject.trim() : null });
  res.json({ success: true, row });
}));

router.post('/:clientId/skip', parseJson, wrap('touch_plan_skip', async (req, res) => {
  if (!(await ownClient(req, res))) return;
  const week = weekFrom(req);
  const { whyNot = '', home = null, until = null } = req.body || {};
  if (until && /^\d{4}-\d{2}-\d{2}$/.test(until)) await planStore.setSkip(req.params.clientId, until, whyNot);
  const existing = await planStore.planFor(week, req.params.clientId);
  const row = await planStore.setPlanStatus(week, req.params.clientId, 'skipped', { whyNot: whyNot || null, whyNotHome: home || null });
  let filed = null;
  if (whyNot && home) filed = await fileWhyNot(req.client.clientId, { weekOf: week, clientId: req.params.clientId, pieceKey: existing && existing.pick && existing.pick.what ? existing.pick.what.key : null, home, words: whyNot });
  res.json({ success: true, row, filed });
}));

router.post('/:clientId/swap', parseJson, wrap('touch_plan_swap', async (req, res) => {
  if (!(await ownClient(req, res))) return;
  const week = weekFrom(req);
  const { kind = 'one-pager', key, title = '', bodyHtml = '', form = null } = req.body || {};
  if (!key) return res.status(400).json({ success: false, error: 'key is required' });
  await planStore.setPin({ clientId: req.params.clientId, weekOf: week, kind, key, title, bodyHtml, form });
  // A swap is a new email: back to "waiting for you" so the rebuild writes the new opening, subject
  // and body (a rebuild keeps everything on a row Guy has already approved or that was held).
  const existing = await planStore.planFor(week, req.params.clientId);
  if (existing && existing.status === 'sent') return res.status(400).json({ success: false, error: 'That one has already gone.' });
  if (existing) await planStore.setPlanStatus(week, req.params.clientId, 'proposed', { hold: null });
  const plan = await planner.buildPlan(req.client.clientId, { weekOf: week, clientIds: [req.params.clientId], force: true });
  res.json({ success: true, row: plan.rows[0] || null });
}));

router.post('/:clientId/pin', parseJson, wrap('touch_plan_pin', async (req, res) => {
  if (!(await ownClient(req, res))) return;
  const { kind = 'one-pager', key, title = '', bodyHtml = '', note = '', form = null } = req.body || {};
  if (!key) return res.status(400).json({ success: false, error: 'key is required' });
  const week = (req.body && req.body.week) || nextWeek();
  await planStore.setPin({ clientId: req.params.clientId, weekOf: week, kind, key, title, bodyHtml, note, form });
  res.json({ success: true, weekOf: week });
}));

router.post('/:clientId/unpin', parseJson, wrap('touch_plan_unpin', async (req, res) => {
  if (!(await ownClient(req, res))) return;
  await planStore.clearPin(req.params.clientId, weekFrom(req));
  res.json({ success: true });
}));

router.post('/:clientId/note', parseJson, wrap('touch_plan_note', async (req, res) => {
  const client = await ownClient(req, res);
  if (!client) return;
  const line = String((req.body && req.body.append) || '').trim();
  if (!line) return res.status(400).json({ success: false, error: 'append is required' });
  const next = appendNote(client.touchNote, line);
  const r = await clientService.updateTouchNote(client.id, next);
  res.json({ success: !!r.success, touchNote: next, error: r.error || null });
}));

/** Where a "why not" goes (the Tuning-by-approval table), applied at once where it can be. */
async function fileWhyNot(coachClientId, { weekOf, clientId, pieceKey, home, words }) {
  const w = String(words || '').trim();
  if (!w) throw new Error('words are required');
  const target = planStore.feedbackHome(home);
  let filedWhere = target.where;
  let filedAt = null;
  if (target.home === 'person' && clientId) {
    const client = await clientService.getClientById(clientId);
    if (client && client.coach === coachClientId) {
      const r = await clientService.updateTouchNote(client.id, appendNote(client.touchNote, w));
      if (r.success) { filedAt = new Date(); filedWhere = `Touch Note on ${client.clientName}'s record`; }
    }
  } else if (target.home === 'openings') {
    await planStore.addOpeningRule(w, `guy ${weekOf || ''}`.trim());
    filedAt = new Date();
    filedWhere = 'the opening instructions (used from next week)';
  }
  const fb = await planStore.addFeedback({ weekOf, clientId, pieceKey, home: target.home, words: w, filedWhere, filedAt });
  return { id: fb ? fb.id : null, home: target.home, where: filedWhere, applied: !!filedAt, laptop: !filedAt };
}

function appendNote(existing, line) {
  const today = new Date().toISOString().slice(0, 10);
  const base = String(existing || '').trim();
  return `${base ? `${base}\n` : ''}${today}: ${line}`;
}

/** The Monday after the one Guy is working towards - where "pin for next week" lands. */
function nextWeek() {
  return planStore.addWeeks(planStore.planningWeek(new Date(), planner.SEND_HOUR), 1);
}

module.exports = router;
module.exports.fileWhyNot = fileWhyNot;
module.exports.appendNote = appendNote;
