/**
 * Tests for the deep client brief behind the weekly emails (services/clientTouchBrief.js), what the
 * planner does with it (first things first, fit, custom email, the fact guard on both days), and what
 * a build costs (services/clientTouchCost.js). Fakes only - no Airtable, no Postgres, no Mailgun, no
 * Claude. ⚠ Synthetic content only (the client below is invented, shaped like the 22 Oct deep read).
 *
 * Run: node tests/client-touch-brief.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.stack.split('\n').slice(0, 3).join('\n    ')}`); }
};

const briefs = require('../services/clientTouchBrief');
const cost = require('../services/clientTouchCost');
const planner = require('../services/clientTouchPlanner');
const routes = require('../routes/clientTouchRoutes');

const DAY = 86400000;
const AT = Date.parse('2026-11-01T22:00:00Z'); // Monday 2 Nov, 8am Brisbane

/** A fake Claude: answers by what the system prompt is asking for; counts calls; reports usage. */
function fakeLlm(answers = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        const s = params.system || '';
        const kind = /digest ONE recorded call/.test(s) ? 'digest' : /keep the working brief/.test(s) ? 'brief' : /personal email from Guy Wilson/.test(s) ? 'note'
          : /Decide whether it FITS/.test(s) ? 'fit' : /nothing on his approved shelf fits/.test(s) ? 'custom' : /List every FACTUAL claim/.test(s) ? 'guard' : 'other';
        calls.push({ kind, model: params.model, user: params.messages[0].content });
        const a = typeof answers[kind] === 'function' ? answers[kind](params) : answers[kind];
        return { content: [{ type: 'text', text: JSON.stringify(a || {}) }], usage: { input_tokens: 1000, output_tokens: 200 } };
      },
    },
  };
}

/** In-memory plan store: briefs, digests, state, rows. */
function memStore(rows = []) {
  const state = new Map(); const briefsT = new Map(); const digests = new Map();
  return {
    rows, state, briefsT, digests,
    getBrief: async (id) => briefsT.get(id) || null,
    saveBrief: async (id, basis, payload) => { briefsT.set(id, { clientId: id, basis, payload }); return true; },
    digestsFor: async (ids) => new Map(ids.filter((i) => digests.has(i)).map((i) => [i, digests.get(i)])),
    saveDigest: async ({ meetingId, digest }) => { digests.set(String(meetingId), digest); return true; },
    getState: async (k) => (state.has(k) ? state.get(k) : null),
    setState: async (k, v) => { state.set(k, v); return true; },
    plansFor: async () => rows,
    skips: async () => new Map(),
    planFor: async (w, id) => rows.find((r) => r.clientId === id) || null,
    setPlanStatus: async (w, id, status, extra = {}) => { const r = rows.find((x) => x.clientId === id); if (r) { r.status = status; if (extra.hold !== undefined) r.hold = extra.hold; } return r; },
    setPlanPickField: async (w, id, field, value) => { const r = rows.find((x) => x.clientId === id); if (r) r.pick = { ...r.pick, [field]: value }; return r; },
  };
}

const CLIENT = { clientId: 'Ash-Test', clientName: 'Ash Tester', clientFirstName: 'Ash', clientEmailAddress: 'ash@example.com', touchNote: '' };

const BRIEF_ANSWER = {
  summary: 'Campaign never launched. You owe him the account mix-up answer and an introduction.',
  true_now: ['his campaign has NOT launched - invitations are not going out', 'his LinkedIn history is in: 1,200 past conversations'],
  owed: [
    { id: 'account-mixup', what: 'close the loop on the account mix-up', promised_on: '2026-10-14', quote: 'purely my fault', source: 'call 14 Oct', important: true, why: 'his data is the whole reason he is careful' },
    { id: 'send-link', what: 'send the slides link', promised_on: '2026-10-14', quote: 'I will send the slides', source: 'call 14 Oct', important: false, why: '' },
  ],
  waiting_on: ['the account mix-up answer'],
  wins: [{ what: 'finished his Masters', date: '2026-10-14' }],
  on_their_mind: ['his data — he does defence work'],
  how_to_write: ['one-line replies'],
  never_say: ['your invitations are going out'],
};

(async () => {
  console.log('what a build costs');
  await check('prices: Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per million; an unknown model is priced as Sonnet', () => {
    assert.strictEqual(cost.costOf('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e5 }), 3);
    assert.ok(Math.abs(cost.costOf('claude-haiku-5-5', { input_tokens: 1e6, output_tokens: 1e6 }) - 0.6) < 1e-9);
    assert.strictEqual(cost.costOf('claude-mystery', { input_tokens: 1e6 }), 2);
  });
  await check('the meter adds every call by model and purpose; the line for Guy says the total', async () => {
    const m = cost.createMeter({ budget: 10 });
    const llm = m.wrap(fakeLlm(), 'brief');
    await llm.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 100, system: 's', messages: [{ role: 'user', content: 'u' }] });
    await m.wrap(fakeLlm(), 'digest').messages.create({ model: 'claude-haiku-5-5', max_tokens: 100, system: 's', messages: [{ role: 'user', content: 'u' }] });
    const s = m.summary();
    assert.strictEqual(s.calls, 2); assert.strictEqual(s.inputTokens, 2000); assert.strictEqual(s.outputTokens, 400);
    assert.strictEqual(s.byPurpose.brief.calls, 1); assert.ok(s.byModel['claude-haiku-5-5']);
    assert.match(cost.costLine(s), /^Claude cost of this build: US\$0\.00\d* \(2,000 tokens in, 400 out, 2 calls\) on your own server key|^Claude cost of this build: US\$0\.01/);
  });
  await check('past the budget the next call is refused before it is made, and every later call too', async () => {
    const m = cost.createMeter({ budget: 0.01 });
    const inner = fakeLlm();
    const llm = m.wrap(inner, 'brief');
    const big = 'x'.repeat(40000); // ~10k tokens = $0.02 on Sonnet
    await assert.rejects(() => llm.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 100, system: '', messages: [{ role: 'user', content: big }] }), (e) => e.name === 'BudgetError');
    assert.strictEqual(inner.calls.length, 0);
    await assert.rejects(() => llm.messages.create({ model: 'claude-haiku-5-5', max_tokens: 10, system: '', messages: [{ role: 'user', content: 'tiny' }] }), (e) => e.name === 'BudgetError');
    assert.match(m.summary().stopped, /past the US\$0\.01 limit/);
  });
  await check('the default budget is US$10, and CLIENT_TOUCH_BUILD_BUDGET_USD changes it', () => {
    const was = process.env.CLIENT_TOUCH_BUILD_BUDGET_USD;
    delete process.env.CLIENT_TOUCH_BUILD_BUDGET_USD; assert.strictEqual(cost.budgetUsd(), 10);
    process.env.CLIENT_TOUCH_BUILD_BUDGET_USD = '4'; assert.strictEqual(cost.budgetUsd(), 4);
    if (was === undefined) delete process.env.CLIENT_TOUCH_BUILD_BUDGET_USD; else process.env.CLIENT_TOUCH_BUILD_BUDGET_USD = was;
  });

  console.log('the brief');
  const material = (over = {}) => ({
    calls: [
      { id: '2', date: '2026-10-14', title: 'Ash & Guy', transcript: 'Guy: purely my fault, I will get back to you.' },
      { id: '1', date: '2026-07-01', title: 'Ash & Guy', transcript: 'Guy: welcome aboard.' },
    ],
    emails: [{ date: '2026-10-14', dir: 'you', subject: 'Your About section', text: 'A tightened version.' }],
    linkedin: [{ date: '2026-10-01', dir: 'them', text: 'Thanks Guy' }],
    dossier: null,
    ...over,
  });
  await check('recent calls are digested by Sonnet, calls older than 60 days by Haiku', () => {
    assert.strictEqual(briefs.digestModelFor({ date: '2026-10-14' }, AT), briefs.MODEL);
    assert.strictEqual(briefs.digestModelFor({ date: '2026-07-01' }, AT), 'claude-haiku-5-5');
  });
  await check('the basis changes when a call, an email, a LinkedIn message, a handled item or invitations change - not otherwise', () => {
    const b = briefs.basisFor(material(), { note: 'n', facts: { lastInviteSent: null } });
    assert.strictEqual(briefs.basisFor(material(), { note: 'n', facts: { lastInviteSent: null } }), b);
    assert.notStrictEqual(briefs.basisFor(material({ calls: [...material().calls, { id: '3', date: '2026-10-28' }] }), { note: 'n' }), b);
    assert.notStrictEqual(briefs.basisFor(material({ emails: [...material().emails, { date: '2026-10-29' }] }), { note: 'n' }), b);
    assert.notStrictEqual(briefs.basisFor(material(), { note: 'n', handled: [{ id: 'account-mixup', how: 'sent' }] }), b);
    assert.notStrictEqual(briefs.basisFor(material(), { note: 'n', facts: { lastInviteSent: '2026-10-30' } }), b);
  });
  await check('the brief is cleaned: no em dashes, stable ids, important is a real yes', () => {
    const b = briefs.normaliseBrief({ ...BRIEF_ANSWER, owed: [{ what: 'Paul Faix — the intro', important: 'true' }] });
    assert.strictEqual(b.owed[0].id, 'paul-faix-the-intro'); assert.strictEqual(b.owed[0].important, true);
    assert.ok(!/[–—]/.test(JSON.stringify(b)));
  });
  await check('first build: every call digested once, the brief built and stored; already-dealt-with items dropped', async () => {
    const ps = memStore();
    await ps.setState('owed-handled:Ash-Test', JSON.stringify([{ id: 'send-link', what: 'send the slides link', how: 'dismissed', at: '2026-10-20' }]));
    const llm = fakeLlm({ digest: { about: 'a call', guy_promised: [{ what: 'get back to him', quote: 'purely my fault' }] }, brief: BRIEF_ANSWER });
    const b = await briefs.briefFor({ clientId: 'Guy-Wilson' }, CLIENT, { facts: {}, factLines: ['Invitations: NOT going out yet'], llm, now: AT }, { planStore: ps, material: material() });
    assert.strictEqual(b.source, 'built');
    assert.strictEqual(llm.calls.filter((c) => c.kind === 'digest').length, 2);
    assert.deepStrictEqual(llm.calls.filter((c) => c.kind === 'digest').map((c) => c.model).sort(), [briefs.MODEL, 'claude-haiku-5-5'].sort());
    assert.deepStrictEqual(b.owed.map((o) => o.id), ['account-mixup']);
    const briefCall = llm.calls.find((c) => c.kind === 'brief');
    assert.ok(briefCall.user.includes('Invitations: NOT going out yet')); assert.ok(briefCall.user.includes('HANDLED BY GUY')); assert.ok(briefCall.user.includes('LINKEDIN MESSAGES'));
    assert.ok(ps.briefsT.get('Ash-Test'));
  });
  await check('next week, nothing new: last week\'s brief, no Claude call at all', async () => {
    const ps = memStore();
    const llm = fakeLlm({ digest: { about: 'x' }, brief: BRIEF_ANSWER });
    await briefs.briefFor({ clientId: 'Guy-Wilson' }, CLIENT, { llm, now: AT }, { planStore: ps, material: material() });
    const n = llm.calls.length;
    const again = await briefs.briefFor({ clientId: 'Guy-Wilson' }, CLIENT, { llm, now: AT + 7 * DAY }, { planStore: ps, material: material() });
    assert.strictEqual(again.source, 'cached'); assert.strictEqual(llm.calls.length, n);
  });
  await check('a new call: only that call is read; the brief is rebuilt with last week\'s in front of it', async () => {
    const ps = memStore();
    const llm = fakeLlm({ digest: { about: 'x' }, brief: BRIEF_ANSWER });
    await briefs.briefFor({ clientId: 'Guy-Wilson' }, CLIENT, { llm, now: AT }, { planStore: ps, material: material() });
    llm.calls.length = 0;
    const more = material({ calls: [{ id: '3', date: '2026-10-28', title: 'Ash & Guy', transcript: 'new' }, ...material().calls] });
    const b = await briefs.briefFor({ clientId: 'Guy-Wilson' }, CLIENT, { llm, now: AT }, { planStore: ps, material: more });
    assert.strictEqual(b.source, 'built');
    assert.strictEqual(llm.calls.filter((c) => c.kind === 'digest').length, 1);
    assert.ok(llm.calls.find((c) => c.kind === 'brief').user.includes("LAST WEEK'S BRIEF"));
  });
  await check('a budget stop inside the brief stops the brief (it is not swallowed)', async () => {
    const m = cost.createMeter({ budget: 0.0001 });
    await assert.rejects(() => briefs.briefFor({ clientId: 'Guy-Wilson' }, CLIENT, { llm: m.wrap(fakeLlm({ brief: BRIEF_ANSWER }), 'brief'), now: AT }, { planStore: memStore(), material: material() }), (e) => e.name === 'BudgetError');
  });
  await check('first things first: only the important items Guy has not dealt with', () => {
    const b = briefs.normaliseBrief(BRIEF_ANSWER);
    assert.deepStrictEqual(briefs.firstThingsDue(b).map((o) => o.id), ['account-mixup']);
    assert.deepStrictEqual(briefs.firstThingsDue(b, [{ id: 'account-mixup' }]), []);
  });

  console.log('the fact guard');
  await check('"your invitations are going out" only when Last Invite Sent says so, recently, and not paused', () => {
    const t = "Now that your invitations are going out, here's a thought.";
    assert.match(briefs.deterministicClaims(t, { lastInviteSent: null }, AT)[0], /Last Invite Sent is empty/);
    assert.match(briefs.deterministicClaims(t, { lastInviteSent: '2026-09-01' }, AT)[0], /last one went 2026-09-01/);
    assert.deepStrictEqual(briefs.deterministicClaims(t, { lastInviteSent: '2026-10-30T00:00:00Z', signals: { paused: false } }, AT), []);
    assert.match(briefs.deterministicClaims('Your campaign is running nicely.', { lastInviteSent: '2026-10-30', signals: { paused: true, live: 0 } }, AT)[0], /paused/);
    assert.match(briefs.deterministicClaims("Congratulations! You've started the process.", { lastInviteSent: null }, AT)[0], /Last Invite Sent is empty/);
  });
  await check('saying invitations are NOT going out is true for a client whose campaign has not launched - no flag', () => {
    assert.deepStrictEqual(briefs.deterministicClaims("The campaign hasn't launched, so no invitations are going out yet.", { lastInviteSent: null }, AT), []);
    assert.deepStrictEqual(briefs.deterministicClaims('Your invitations are not going out yet.', { lastInviteSent: null }, AT), []);
    assert.strictEqual(briefs.deterministicClaims("No rush on that. Your invitations are going out.", { lastInviteSent: null }, AT).length, 1);
    // a correction quotes the earlier mistake - that is not the claim being made again
    assert.deepStrictEqual(briefs.deterministicClaims("I need to correct my 15 Oct email. I said the first invitations were going out. They aren't.", { lastInviteSent: null }, AT), []);
  });
  await check('the personal note never starts with their name (the greeting has it)', async () => {
    const llm = fakeLlm({ note: { subject: 'S', body: 'Ash, on 7 Oct I said I would.', guy_checks: [] } });
    const n = await briefs.draftOwedNote(llm, { client: CLIENT, brief: briefs.normaliseBrief(BRIEF_ANSWER), items: [] });
    assert.strictEqual(n.text, 'On 7 Oct I said I would.');
  });
  await check('a next session is mentioned only when one is booked; dashes, links and the system are caught', () => {
    assert.match(briefs.deterministicClaims('See you on Wednesday the 11th.', {}, AT)[0], /none is booked/);
    assert.deepStrictEqual(briefs.deterministicClaims('See you on Wednesday the 11th.', { nextSessionAt: '2026-11-11' }, AT), []);
    const p = briefs.deterministicClaims('Big month — see https://x.y - Wingguy wrote this.', {}, AT);
    assert.ok(p.includes('an em or en dash') && p.includes('a link') && p.includes('mentions the system'));
  });
  await check('Claude checks every claim against the brief: unsupported and contradicted claims are problems', async () => {
    const llm = fakeLlm({ guard: { claims: [{ claim: 'you finished your Masters', verdict: 'supported' }, { claim: 'Paul is expecting your call', verdict: 'unsupported', why: 'nothing says so' }] } });
    const r = await briefs.checkClaims('Well done on the Masters. Paul is expecting your call.', { facts: {}, brief: briefs.normaliseBrief(BRIEF_ANSWER), llm, client: CLIENT, at: AT });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.problems.length, 1); assert.match(r.problems[0], /unsupported: "Paul is expecting your call"/);
    assert.strictEqual(r.by, 'code+claude');
  });
  await check('without Claude (or a brief) the code checks still run', async () => {
    const r = await briefs.checkClaims('Your invitations are going out.', { facts: {}, at: AT });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.by, 'code');
  });

  console.log('what the planner does with the brief');
  const brief = { ...briefs.normaliseBrief(BRIEF_ANSWER), source: 'built' };
  const nothingPick = { what: null, rule: 'waiting-for-invitations', reason: 'no invitation has gone out yet' };
  const deps = (answers) => { const llm = fakeLlm(answers); return { llm, llmFor: () => llm }; };
  const ANSWERS = {
    note: { subject: 'The account mix-up', body: 'You were right to flag it.\n\nHere is what happened.', guy_checks: ['confirm the shared link is switched off'] },
    guard: { claims: [] },
    custom: { subject: '1,200 conversations you already have', paragraphs: ['Well done on the Masters.', 'Your history is in - every one already knows you.'], why: 'uses what he has' },
    fit: { fits: false, why: 'it assumes his campaign is running' },
  };
  await check('Ashley\'s shape: owed something important + no invitations out -> a note first AND a custom email', async () => {
    const { llmFor } = deps(ANSWERS);
    const out = await planner.deepen({ pick: nothingPick, body: null, brief, client: CLIENT, facts: { group: 'running' }, week: '2026-11-02', firstWeekly: true, llmFor, at: AT });
    assert.strictEqual(out.firstThings.status, 'open');
    assert.deepStrictEqual(out.firstThings.items.map((o) => o.id), ['account-mixup']);
    assert.strictEqual(out.firstThings.note.subject, 'The account mix-up');
    assert.deepStrictEqual(out.firstThings.note.guyChecks, ['confirm the shared link is switched off']);
    assert.strictEqual(out.pick.what.kind, 'custom'); assert.strictEqual(out.pick.rule, 'custom');
    assert.strictEqual(out.pick.replaces.rule, 'waiting-for-invitations');
    assert.match(out.pick.reason, /^CUSTOM - nothing on the shelf fits/);
    assert.match(out.body.bodyHtml, /<p>Well done on the Masters\.<\/p>/);
  });
  await check('an approved piece that does not fit is replaced by a custom email; one that fits is left alone', async () => {
    const piece = { what: { kind: 'one-pager', key: 'the-energy-you-bring', title: 'The energy you bring' }, rule: 'next-in-order', reason: 'next' };
    const body = { title: 'The energy you bring', bodyHtml: '<p>Now your campaign is running...</p>' };
    const no = await planner.deepen({ pick: piece, body, brief: { ...brief, owed: [] }, client: CLIENT, facts: { group: 'running' }, week: '2026-11-02', llmFor: deps(ANSWERS).llmFor, at: AT });
    assert.strictEqual(no.pick.what.kind, 'custom'); assert.strictEqual(no.pick.replaces.what.key, 'the-energy-you-bring');
    assert.strictEqual(no.firstThings, null);
    const yes = await planner.deepen({ pick: piece, body, brief: { ...brief, owed: [] }, client: CLIENT, facts: { group: 'running' }, week: '2026-11-02', llmFor: deps({ ...ANSWERS, fit: { fits: true, why: 'fine' } }).llmFor, at: AT });
    assert.strictEqual(yes.pick, piece); assert.strictEqual(yes.body, body);
  });
  await check("Guy's pins are never replaced, even when they do not fit", async () => {
    const pinned = { what: { kind: 'one-pager', key: 'x', title: 'X' }, rule: 'pinned', reason: 'Guy pinned it' };
    const { llm, llmFor } = deps(ANSWERS);
    const out = await planner.deepen({ pick: pinned, body: { title: 'X', bodyHtml: '<p>x</p>' }, brief: { ...brief, owed: [] }, client: CLIENT, facts: { group: 'running' }, week: '2026-11-02', llmFor, at: AT });
    assert.strictEqual(out.pick, pinned); assert.ok(!llm.calls.some((c) => c.kind === 'fit'));
  });
  await check('nothing true to say -> no custom email, and the row says why', async () => {
    const out = await planner.deepen({ pick: nothingPick, body: null, brief: { ...brief, owed: [] }, client: CLIENT, facts: { group: 'running' }, week: '2026-11-02', llmFor: deps({ ...ANSWERS, custom: { subject: '', paragraphs: [], why: 'too little on record' } }).llmFor, at: AT });
    assert.strictEqual(out.pick, nothingPick); assert.strictEqual(out.customDeclined, 'too little on record');
  });
  await check('onboarding, "not this week" and left-out rows are never given a custom email', async () => {
    for (const p of [{ what: null, rule: 'onboarding', reason: 'x' }, { what: null, rule: 'not-this-week', reason: 'x' }, { what: null, leftOut: true, rule: 'left-out', reason: 'x' }]) {
      const out = await planner.deepen({ pick: p, body: null, brief: { ...brief, owed: [] }, client: CLIENT, facts: { group: 'running' }, week: '2026-11-02', llmFor: deps(ANSWERS).llmFor, at: AT });
      assert.strictEqual(out.pick, p);
    }
  });
  await check('a budget stop inside deepen stops the build (it is not swallowed)', async () => {
    const m = cost.createMeter({ budget: 0.000001 });
    const llm = m.wrap(fakeLlm(ANSWERS), 'x');
    await assert.rejects(() => planner.deepen({ pick: nothingPick, body: null, brief, client: CLIENT, facts: { group: 'running' }, week: '2026-11-02', llmFor: () => llm, at: AT }), (e) => e.name === 'BudgetError');
  });
  await check('the opening drafter is told what the brief knows - true now, wins, never say', () => {
    const lines = planner.briefFactLines(brief);
    assert.ok(lines.some((l) => /true now: his campaign has NOT launched/.test(l)));
    assert.ok(lines.some((l) => /NEVER say: your invitations are going out/.test(l)));
    assert.ok(lines.some((l) => /a recent win: finished his Masters/.test(l)));
  });
  await check('the guard reads a custom email whole, an opening plus the welcome\'s congratulations, never the fixed call opening', () => {
    assert.strictEqual(planner.guardText({ pick: { what: { kind: 'custom' } }, bodyHtml: '<p>One.</p><p>Two.</p>' }), 'One.\nTwo.');
    assert.match(planner.guardText({ pick: { what: { kind: 'one-pager' }, body: { template: 'first-email' } }, opening: 'Hi.' }), /^Congratulations!.*\nHi\.$/s);
    assert.strictEqual(planner.guardText({ pick: { what: { kind: 'call' }, opening: { source: 'fixed' } }, opening: planner.CALL_OPENING }), '');
  });

  console.log('the sending morning');
  const picker = require('../services/clientTouchPicker');
  const SHELF = require('../services/onePagerContent').listPieces();
  const facts = (over = {}) => ({
    clientId: 'Ash-Test', clientName: 'Ash Tester', status: 'Active', coachingStatus: 'Graduated', group: 'running',
    billingLapsed: false, unsubscribed: false, hasUnsubToken: true, address: 'ash@example.com', bounced: false, skipUntil: null, skipThisWeek: false,
    lastInviteSent: null, seriesStartDate: null, daysSinceLastCall: 10, daysSinceLastSubstantial: 10, sessionBooked: true, nextSessionAt: '2026-11-11',
    todayHasRecords: false, events: [], callProblems: [], stuckStop: null, stuckDays: 0, quietOrBusy: false, note: { length: 'full' },
    pin: null, pinForEveryone: null, nextSetupStep: null, signals: { paused: false, live: 0, lines: [] }, ...over,
  });
  await check('a custom email still stands when the picker would still say "no invitations yet"; not once they start', () => {
    const custom = { what: { kind: 'custom', key: 'custom:2026-11-02', title: 'S' }, rule: 'custom', replaces: { what: null, rule: 'waiting-for-invitations' } };
    const now = picker.pickFor(facts(), SHELF, [], { now: AT });
    assert.strictEqual(now.rule, 'waiting-for-invitations');
    assert.strictEqual(planner.stillAsBuilt(now, custom), true);
    const started = picker.pickFor(facts({ lastInviteSent: '2026-10-31T00:00:00Z' }), SHELF, [], { now: AT });
    assert.strictEqual(planner.stillAsBuilt(started, custom), false);
  });
  const mkTouch = () => { const recorded = []; return { recorded, touchesFor: async () => [], hasHad: async () => null, record: async (t) => { recorded.push(t); return { ok: true, inserted: true }; } }; };
  const mailerOk = () => { const sent = []; return { sent, sendSeriesEmail: async (m) => { sent.push(m); return { ok: true, id: 'm1' }; } }; };
  const ash = () => ({ clientId: 'Ash-Test', clientName: 'Ash Tester', clientFirstName: 'Ash', clientEmailAddress: 'ash@example.com', status: 'Active', coachingStatus: 'Graduated', emailUnsubToken: 'tok', emailUnsubscribed: false });
  const customRow = (over = {}) => ({
    clientId: 'Ash-Test', status: 'approved', subject: '1,200 conversations you already have', opening: '', facts: facts(),
    bodyHtml: '<p>Well done on the Masters.</p><p>Your history is in.</p>',
    pick: { what: { kind: 'custom', key: 'custom:2026-11-02', title: '1,200 conversations you already have' }, form: 'one-off', rule: 'custom', reason: 'CUSTOM', replaces: { what: null, rule: 'waiting-for-invitations' }, body: { title: '1,200 conversations you already have', dek: '', template: 'custom' }, brief, firstThings: null, thought: { slug: 's', title: 'T', text: 'Motion keeps people connected.' } },
    ...over,
  });
  const send = (rows, f = facts(), extra = {}) => {
    const ps = memStore(rows); const mailer = mailerOk(); const touch = mkTouch();
    return planner.sendApproved('Guy-Wilson', '2026-11-02', { mailer, touchStore: touch, planStore: ps, shelf: SHELF, guardLlm: null, clientService: { getClientById: async () => ash() }, freshFacts: async () => new Map([['Ash-Test', { facts: f, record: [] }]]), ...extra })
      .then((out) => ({ out, mailer, touch, ps }));
  };
  await check('an approved custom email goes: plain, no bold title, its thought, the first-email note; recorded as custom', async () => {
    const { out, mailer, touch } = await send([customRow()]);
    assert.strictEqual(out.sent, 1);
    const html = mailer.sent[0].html;
    assert.match(html, /Hi Ash,/); assert.match(html, /Well done on the Masters\./); assert.ok(!/<strong>1,200/.test(html));
    assert.match(html, /A thought for the week:<\/strong> Motion keeps people connected\./); assert.match(html, /from now on I'll send you a short email most weeks/);
    assert.strictEqual(touch.recorded[0].kind, 'custom'); assert.match(touch.recorded[0].meta.body, /Well done on the Masters/);
  });
  await check('a personal note still owed -> the weekly email is HELD, even if approved', async () => {
    const row = customRow(); row.pick.firstThings = { status: 'open', items: [{ id: 'account-mixup', what: 'close the loop on the account mix-up' }] };
    const { out, mailer, ps } = await send([row]);
    assert.strictEqual(out.sent, 0); assert.strictEqual(out.held, 1); assert.strictEqual(mailer.sent.length, 0);
    assert.match(ps.rows[0].hold.changed[0], /send the personal note first/);
  });
  await check('"Keep it - send now" does not get past an owed note either', async () => {
    const row = customRow(); row.pick.firstThings = { status: 'open', items: [] };
    const { out } = await send([row], facts(), { keep: new Set(['Ash-Test']) });
    assert.strictEqual(out.sent, 0);
  });
  await check('the fact guard on the sending morning holds an email whose claim stopped being true', async () => {
    const row = customRow({ bodyHtml: '<p>Now that your invitations are going out, have a look at who accepts.</p>' });
    const { out, mailer, ps } = await send([row]);
    assert.strictEqual(out.sent, 0); assert.strictEqual(out.held, 1); assert.strictEqual(mailer.sent.length, 0);
    assert.match(ps.rows[0].hold.changed[0], /fact guard: says their invitations are going out/);
    assert.strictEqual(ps.rows[0].pick.guard.stage, 'send');
  });

  console.log("Guy's answers on the screen");
  await check('"I\'ve sent it" records the note (not counted as a quiet week) and remembers the items as dealt with', async () => {
    const row = customRow({ status: 'proposed' }); row.pick.firstThings = { status: 'open', items: [{ id: 'account-mixup', what: 'close the loop' }], note: { subject: 'S', text: 'draft' } };
    const ps = memStore([row]); const touch = mkTouch();
    await planner.resolveFirstThings('2026-11-02', 'Ash-Test', { action: 'sent', text: 'My own words — sent.' }, { planStore: ps, touchStore: touch });
    assert.strictEqual(ps.rows[0].pick.firstThings.status, 'sent');
    assert.strictEqual(touch.recorded[0].kind, 'personal'); assert.strictEqual(touch.recorded[0].key, 'owed-note:2026-11-02'); assert.strictEqual(touch.recorded[0].meta.text, 'My own words - sent.');
    const handled = JSON.parse(ps.state.get('owed-handled:Ash-Test'));
    assert.deepStrictEqual(handled.map((h) => [h.id, h.how]), [['account-mixup', 'sent']]);
    const t = planner.lastTouches([{ kind: 'personal', key: 'owed-note:2026-11-02', sent_at: '2026-10-29T00:00:00Z', source: 'manual' }]);
    assert.strictEqual(t.lastPersonal, null);
  });
  await check('"Not needed" dismisses it - remembered, nothing recorded as sent', async () => {
    const row = customRow({ status: 'proposed' }); row.pick.firstThings = { status: 'open', items: [{ id: 'x', what: 'y' }] };
    const ps = memStore([row]); const touch = mkTouch();
    await planner.resolveFirstThings('2026-11-02', 'Ash-Test', { action: 'dismiss' }, { planStore: ps, touchStore: touch });
    assert.strictEqual(ps.rows[0].pick.firstThings.status, 'dismissed'); assert.strictEqual(touch.recorded.length, 0);
    assert.strictEqual(JSON.parse(ps.state.get('owed-handled:Ash-Test'))[0].how, 'dismissed');
  });
  await check('approve is refused while a note is owed, and past a guard flag only with "approve anyway"', () => {
    assert.match(routes.approveBlocked({ pick: { firstThings: { status: 'open' } } }), /personal note first/);
    assert.match(routes.approveBlocked({ pick: { guard: { ok: false, problems: ['x'] } } }), /fact guard found: x/);
    assert.strictEqual(routes.approveBlocked({ pick: { guard: { ok: false, problems: ['x'] } } }, { override: true }), null);
    assert.strictEqual(routes.approveBlocked({ pick: { firstThings: { status: 'sent' }, guard: { ok: true } } }), null);
  });
  await check("Guy's Monday email: notes to send first, the custom emails, the brief, and what the build cost", () => {
    const row = customRow({ status: 'proposed', facts: { ...facts(), clientName: 'Ash Tester' } }); row.pick.firstThings = { status: 'open', items: [{ id: 'a', what: 'close the loop on the account mix-up' }] };
    const pv = planner.buildPreview({ weekOf: '2026-11-02', rows: [row], cost: { usd: 1.84, inputTokens: 212400, outputTokens: 18300, calls: 41 } }, {});
    assert.match(pv.subject, /1 to approve, 1 note to send first/);
    assert.match(pv.html, /Send a personal note first \(1\)/); assert.match(pv.html, /close the loop on the account mix-up/);
    assert.match(pv.html, /Written for them \(1\)/); assert.match(pv.html, /CUSTOM: 1,200 conversations/);
    assert.match(pv.html, /Brief:<\/i> Campaign never launched/);
    assert.match(pv.html, /US\$1\.84 \(212,400 tokens in, 18,300 out, 41 calls\) on your own server key/);
    const stopped = planner.buildPreview({ weekOf: '2026-11-02', rows: [], cost: { usd: 10 }, stopped: 'over' }, {});
    assert.match(stopped.subject, /BUILD STOPPED at the cost limit/);
  });
  await check('the sending-morning report says what building the plan cost', () => {
    const r = planner.buildSendReport({ result: { results: [] }, buildCost: { usd: 2.5, inputTokens: 1000, outputTokens: 10, calls: 3 }, guardCost: { usd: 0.02, calls: 2 } });
    assert.match(r.html, /building this plan: Claude cost of this build: US\$2\.50/); assert.match(r.html, /this morning's fact check: US\$0\.02 \(2 calls\)/);
  });
  await check('"show me Ash\'s emails" in chat carries the note owed, the custom email and the brief', () => {
    const row = customRow({ status: 'proposed', weekOf: '2026-11-02' }); row.pick.firstThings = { status: 'open', items: [{ id: 'a', what: 'close the loop', promisedOn: '2026-10-14' }], note: { subject: 'S', text: 'Para one.\n\nPara two.' } };
    const o = planner.outlookFor(row, [], SHELF, { week: '2026-11-02' });
    const text = planner.formatOutlook('Ash Tester', o);
    assert.match(text, /SEND A PERSONAL NOTE FIRST - you owe them: close the loop \(2026-10-14\)/);
    assert.match(text, /drafted note - "S": Para one\. \/ Para two\./);
    assert.match(text, /CUSTOM EMAIL \(written for them - read closely\): Well done on the Masters\. \/ Your history is in\./);
    assert.match(text, /THE BRIEF/); assert.match(text, /never say: your invitations are going out/);
  });
  await check("the quality bar (Guy's Ashley email) is in house style - plain dashes, no exclamation marks", () => {
    const all = [briefs.QUALITY_BAR.subject, ...briefs.QUALITY_BAR.body].join(' ');
    assert.ok(!/[–—!]/.test(all));
  });

  console.log('');
  if (failures) { console.error(`${failures} failing`); process.exit(1); }
  console.log('all passing');
})();
