// services/clientTouchIntroductions.js
//
// "Introductions to make" on Guy's Monday screen (docs/CLIENT-TOUCH-PLANNER.md, Guy 22 Oct):
// each week, one to three suggested PAIRS of clients who would clearly benefit from meeting and
// have NOT already been introduced, each with a one-line why drawn from what each has said they
// want (their client note, Coach Notes) and their most recent call with Guy.
//
// Rules in code: pairwise only, never "all these people"; never a pair the Referrals table already
// knows (referralService.alreadyIntroduced - a Promised row counts); space each person's
// introductions about a week apart (an 'intro' touch in the last 7 days for either side rules
// them out this week); running clients only (someone mid-onboarding has enough on). Guy approves a
// pair in chat and Wingguy drafts the introduction the usual way - nothing is drafted or sent here.
//
// Client-to-client only for now. Client-to-wider-network needs a readable record of who in Guy's
// network wants what, which does not exist yet.

const clientService = require('./clientService');
const referrals = require('./referralService');
const touchStore = require('./clientTouchStore');
const planStore = require('./clientTouchPlanStore');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'PLANNER', clientId: 'SYSTEM', operation: 'client_touch_intros' });
const MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5-5';
const MAX_PAIRS = 3;
const SPACING_DAYS = 7;

// ---------------------------------------------------------------------------------------------
// Pure

/** Pairs that are allowed this week: not already introduced, neither side introduced in the last week. */
function allowedPairs(clients, { rows = [], recentIntro = new Set() } = {}) {
  const out = [];
  for (let i = 0; i < clients.length; i++) {
    for (let j = i + 1; j < clients.length; j++) {
      const a = clients[i]; const b = clients[j];
      if (recentIntro.has(a.clientId) || recentIntro.has(b.clientId)) continue;
      if (referrals.alreadyIntroduced(a, b, rows, clients)) continue;
      out.push([a.clientId, b.clientId]);
    }
  }
  return out;
}

function buildPrompt(profiles, allowed) {
  const system = [
    'You help Guy Wilson, a network-building coach, decide which two of his clients to introduce to each other this week. You see what each client does and wants, in their own words from calls and notes.',
    `Suggest at most ${MAX_PAIRS} PAIRS - only pairs where both people would clearly get something from meeting, said in one plain sentence each. Pairwise only: never a group.`,
    'Only choose from the ALLOWED PAIRS list. If no pair is clearly worth it, return an empty list - a weak introduction costs Guy credibility with both people.',
    'Australian English, plain, no hype, no exclamation marks, short spaced dashes " - " only.',
    'Answer with ONE JSON object: {"pairs": [{"a": "<clientId>", "b": "<clientId>", "why": "<one sentence>"}]}',
  ].join('\n');
  const lines = ['CLIENTS:'];
  for (const p of profiles) {
    lines.push(`--- ${p.clientId} (${p.clientName})`);
    if (p.note) lines.push(`Note: ${p.note}`);
    if (p.coachNotes) lines.push(`Coach notes: ${p.coachNotes}`);
    if (p.lastCall) lines.push(`Last call (${p.lastCall.date || ''}): ${p.lastCall.summary || ''}`);
  }
  lines.push('', 'ALLOWED PAIRS:');
  for (const [a, b] of allowed) lines.push(`${a} + ${b}`);
  return { system, user: lines.join('\n') };
}

function parsePairs(text, allowed) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  let j;
  try { j = JSON.parse(m[0]); } catch (_) { return []; }
  const ok = new Set(allowed.map(([a, b]) => `${a}|${b}`));
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(j.pairs) ? j.pairs : []) {
    const a = String(p.a || '').trim(); const b = String(p.b || '').trim();
    const key = ok.has(`${a}|${b}`) ? `${a}|${b}` : (ok.has(`${b}|${a}`) ? `${b}|${a}` : null);
    if (!key || seen.has(a) || seen.has(b)) continue; // one introduction per person per week
    seen.add(a); seen.add(b);
    out.push({ a: key.split('|')[0], b: key.split('|')[1], why: String(p.why || '').replace(/\s*[\u2013\u2014]\s*/g, ' - ').trim() });
    if (out.length >= MAX_PAIRS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

/** This week's suggestions - built once per week (cached in planner state), rebuilt on refresh. */
async function suggestionsFor(coachClientId, week, { refresh = false, deps = {} } = {}) {
  const key = `intros:${coachClientId}:${week}`;
  if (!refresh) {
    const cached = await planStore.getState(key);
    if (cached) { try { return JSON.parse(cached); } catch (_) { /* rebuild */ } }
  }
  const coach = await clientService.getClientById(coachClientId);
  const all = await clientService.getAllClients();
  const mine = all.filter((c) => c.coach === coachClientId && c.status === 'Active' && c.coachingStatus !== 'Paused');
  const running = mine.filter((c) => c.coachingStatus === 'Graduated' || !(c.launchDate || c.wingguyEnabled));
  const rows = await referrals.listAllReferrals().catch((e) => { logger.warn(`referrals skipped: ${e.message}`); return []; });
  const since = new Date(Date.now() - SPACING_DAYS * 86400000);
  const recent = new Set((await touchStore.touchesSince(since, { kinds: ['intro'] })).map((t) => t.client_id));
  const allowed = allowedPairs(running, { rows, recentIntro: recent });
  const empty = { weekOf: week, pairs: [], considered: running.length, allowed: allowed.length, builtAt: new Date().toISOString() };
  if (!allowed.length) { await planStore.setState(key, JSON.stringify(empty)); return empty; }

  const { gatherMeetings } = require('./clientTouchOpening');
  const profiles = [];
  for (const c of running) {
    const meetings = deps.meetings ? deps.meetings(c) : await gatherMeetings(coachClientId, c).catch(() => []);
    const last = meetings[0] || null;
    profiles.push({ clientId: c.clientId, clientName: c.clientName, note: c.touchNote || '', coachNotes: c.coachNotes || '', lastCall: last ? { date: last.date, summary: (last.summary || (last.transcript || '').slice(0, 1200)) } : null });
  }
  let llm = deps.llm;
  if (!llm) { try { llm = require('../config/anthropicClient').resolveClientAnthropic(coach).llm; } catch (_) { llm = null; } }
  if (!llm) return { ...empty, error: 'no Claude key for the coach' };
  const prompt = buildPrompt(profiles, allowed);
  let pairs = [];
  try {
    // Room for the model's thinking as well as the answer (a tight max_tokens cut the openings off, 22 Oct).
    const response = await llm.messages.create({ model: MODEL_ID, max_tokens: 16000, output_config: { effort: 'low' }, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] });
    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    pairs = parsePairs(text, allowed);
  } catch (e) {
    logger.warn(`introduction suggestions failed: ${e.message}`);
    return { ...empty, error: e.message };
  }
  const names = new Map(running.map((c) => [c.clientId, c.clientName]));
  const out = { ...empty, pairs: pairs.map((p) => ({ a: { clientId: p.a, clientName: names.get(p.a) }, b: { clientId: p.b, clientName: names.get(p.b) }, why: p.why })) };
  await planStore.setState(key, JSON.stringify(out));
  return out;
}

module.exports = { suggestionsFor, allowedPairs, buildPrompt, parsePairs, MAX_PAIRS, SPACING_DAYS };
