/**
 * Tests for the personal opening (services/clientTouchOpening.js) and the plan store's pure parts
 * (services/clientTouchPlanStore.js). Fakes only - no Claude, no Postgres, no mailbox.
 *
 * Run: node tests/client-touch-opening.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const op = require('../services/clientTouchOpening');
const store = require('../services/clientTouchPlanStore');

const client = { clientId: 'Rick-Wong', clientName: 'Rick Wong', clientFirstName: 'Rick', clientEmailAddress: 'rick@example.com' };
const coach = { clientId: 'Guy-Wilson', clientName: 'Guy Wilson' };
const pick = { title: 'Begin with the end in mind', dek: 'What the calls are for.', form: 'short', kindLine: 'a way of thinking' };
const facts = ['Invitations: NOT going out (campaign paused)', 'Last call with Guy: 12 days ago', 'Today tab: has records'];

(async () => {
  console.log('the prompt');
  await check('carries every craft rule, the live facts, the note, the calls, the emails and the standing instructions', () => {
    const p = op.buildPrompt({ client, pick, facts, note: 'Recognise on everything relationship. Short. No calendar links.', meetings: [{ date: '2026-10-14', title: 'Rick / Guy', summary: 'Wants the Brad intro', transcript: 'GUY: ...' }], emails: [{ date: '2026-10-15', dir: 'them', subject: 'Re: Brad', text: 'Thanks' }], rules: ['Never mention the weather'], today: '2026-10-26' });
    for (const c of op.CRAFT) assert.ok(p.system.includes(c.slice(0, 40)));
    assert.ok(p.system.includes('Never mention the weather'));
    assert.ok(p.user.includes('NOT going out'));
    assert.ok(p.user.includes('Recognise on everything'));
    assert.ok(p.user.includes('Wants the Brad intro'));
    assert.ok(p.user.includes('THEM: [Re: Brad]'));
    assert.ok(p.user.includes('"Begin with the end in mind"'));
  });
  await check('no note -> the prompt says so and asks for a plain teach frame', () => {
    const p = op.buildPrompt({ client, pick, facts, note: '', meetings: [], emails: [], rules: [], today: '2026-10-26' });
    assert.ok(p.user.includes('no note yet'));
    assert.ok(p.user.includes('(none found)'));
  });
  await check('house style in the prompt itself: no em dashes', () => {
    const p = op.buildPrompt({ client, pick, facts, note: '', meetings: [], emails: [], rules: [], today: '2026-10-26' });
    assert.ok(!/[–—]/.test(p.system + p.user));
  });

  console.log('the check on what comes back');
  await check('a good opening passes', () => {
    const r = op.checkOpening("Good to talk on Tuesday - you've seen this from the receiving end, with the Brad introduction. This one is about what the calls are for.");
    assert.strictEqual(r.ok, true); assert.strictEqual(r.sentences, 2);
  });
  await check('"we noticed you haven\'t" fails', () => {
    assert.ok(op.checkOpening("We noticed you haven't opened your Today tab.").problems.some((p) => /nudge/.test(p)));
  });
  await check('an em dash fails; a booking link fails; four sentences fail; praising the system fails', () => {
    assert.ok(op.checkOpening('Good to talk — this one is about calls.').problems.includes('em or en dash'));
    assert.ok(op.checkOpening('Grab a time at https://calendly.com/guy.').problems.includes('a link or booking offer'));
    assert.ok(op.checkOpening('One. Two. Three. Four.').problems.some((p) => /4 sentences/.test(p)));
    assert.ok(op.checkOpening('Wingguy picked this one for you.').problems.includes('mentions the system'));
    assert.ok(op.checkOpening('Great news!').problems.includes('exclamation mark'));
  });
  await check('empty fails', () => { assert.strictEqual(op.checkOpening('').ok, false); });
  await check('parseReply reads the JSON object out of a chatty reply', () => {
    const r = op.parseReply('Sure: {"opening": "Good to talk.", "factsUsed": ["call 12 days ago"], "confidence": 0.8} done');
    assert.strictEqual(r.opening, 'Good to talk.'); assert.deepStrictEqual(r.factsUsed, ['call 12 days ago']); assert.strictEqual(r.confidence, 0.8);
  });

  console.log('drafting');
  await check('with a fake Claude: the opening, its facts and the code check come back; the material was read', async () => {
    const llm = { messages: { create: async () => ({ content: [{ type: 'text', text: '{"opening":"Good to talk on Tuesday. This one is about what the calls are for.","factsUsed":["call"],"confidence":0.9}' }] }) } };
    const r = await op.draftOpening({ coach, client, pick, factLines: facts, note: '', today: '2026-10-26' }, { llm, meetings: [{ date: '2026-10-14' }], emails: [], rules: [] });
    assert.strictEqual(r.source, 'llm'); assert.strictEqual(r.check.ok, true); assert.strictEqual(r.meetingsRead, 1);
  });
  await check('no Claude key -> no opening, flagged, never thrown', async () => {
    const r = await op.draftOpening({ coach, client, pick, factLines: facts, note: '' }, { llm: null, meetings: [], emails: [], rules: [] });
    assert.strictEqual(r.source, 'none'); assert.strictEqual(r.opening, ''); assert.strictEqual(r.check.ok, false);
  });
  await check('a reply that breaks the craft is returned with its problems, not silently accepted', async () => {
    const llm = { messages: { create: async () => ({ content: [{ type: 'text', text: '{"opening":"We noticed you haven\'t logged in — grab a slot at https://calendly.com/x","factsUsed":[],"confidence":0.2}' }] }) } };
    const r = await op.draftOpening({ coach, client, pick, factLines: facts, note: '' }, { llm, meetings: [], emails: [], rules: [] });
    assert.strictEqual(r.check.ok, false); assert.ok(r.check.problems.length >= 3);
  });

  console.log('the plan store (pure parts)');
  await check('weekOf = the Monday of the Brisbane week', () => {
    assert.strictEqual(store.weekOf(new Date('2026-10-26T00:30:00+10:00')), '2026-10-26'); // Monday
    assert.strictEqual(store.weekOf(new Date('2026-10-28T12:00:00+10:00')), '2026-10-26'); // Wednesday
    assert.strictEqual(store.weekOf(new Date('2026-11-01T23:00:00+10:00')), '2026-10-26'); // Sunday night
    assert.strictEqual(store.weekOf(new Date('2026-10-25T20:00:00Z')), '2026-10-26');      // Monday 6am Brisbane
  });
  await check('the "why not" table: body -> IMPROVEMENTS, choice -> the design doc, person -> the note, openings -> the instructions', () => {
    assert.match(store.feedbackHome('body').where, /IMPROVEMENTS/);
    assert.match(store.feedbackHome('choice').where, /CLIENT-TOUCH-PLANNER/);
    assert.strictEqual(store.feedbackHome('person').live, true);
    assert.strictEqual(store.feedbackHome('openings').live, true);
    assert.throws(() => store.feedbackHome('vibes'));
  });
  await check('without DATABASE_URL every read is empty and every write is a no-op', async () => {
    delete process.env.DATABASE_URL;
    store.__setTestPool(null);
    assert.deepStrictEqual(await store.plansFor('2026-10-26'), []);
    assert.strictEqual(await store.upsertPlan({ weekOf: '2026-10-26', clientId: 'X' }), null);
    assert.strictEqual((await store.pinsFor('2026-10-26')).size, 0);
    assert.strictEqual(await store.claimWeekly('build', '2026-10-26'), false);
  });

  console.log('');
  if (failures) { console.error(`${failures} failing`); process.exit(1); }
  console.log('all passing');
})();
