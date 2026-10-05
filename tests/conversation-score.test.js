/**
 * Tests for the conversation score (services/conversationScore.js) - Reconnect, brick 2.
 *
 * Covers: buildSystem() (the client's paragraph goes in, nobody's name is hard-coded) ·
 * profileSig() / pickTodo() (a thread is read once; a changed thread is re-read; a changed
 * paragraph is re-read only when asked) · transcript() · normaliseItem() · scoreBatch() with a
 * fake model (refs map back to people, bad JSON is retried, a refusal stores nothing).
 * Pure functions and fakes - no Claude, no Postgres. ⚠ Synthetic content only.
 *
 * Run: node tests/conversation-score.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const cs = require('../services/conversationScore');

const nowMs = Date.UTC(2026, 9, 5);
const person = (key, extra = {}) => ({ person_key: key, member_id: key, name: 'Pat Person', headline: 'Director at Somewhere', msgs_in: 1, msgs_out: 2, last_msg_at: '2025-06-01T00:00:00.000Z', ...extra });
const m = (when, mine, body) => ({ sent_at: when, is_sender: mine, body });

(async () => {
  console.log('buildSystem');
  await check('carries the client paragraph and the client name, and no one else\'s', () => {
    const s = cs.buildSystem({ coachName: 'Matt Example', who: 'I want people who run purchasing.', guidance: '' });
    assert.ok(s.includes('I want people who run purchasing.'));
    assert.ok(s.includes("judge from Matt's side"));
    assert.ok(!/Guy/.test(s));
    for (const e of cs.ENDINGS) assert.ok(s.includes(`- ${e}:`), `missing ending ${e}`);
    assert.ok(s.includes(cs.DEFAULT_GUIDANCE.split('\n')[0]));
  });
  await check('custom guidance replaces the default', () => {
    const s = cs.buildSystem({ coachName: 'Matt Example', who: 'x', guidance: 'warmth: my own scale' });
    assert.ok(s.includes('warmth: my own scale'));
    assert.ok(!s.includes(cs.DEFAULT_GUIDANCE.split('\n')[1]));
  });

  console.log('pickTodo');
  const sigA = cs.profileSig({ who: 'A' });
  const sigB = cs.profileSig({ who: 'B' });
  const p1 = person('k1'); const p2 = person('k2'); const p3 = person('k3');
  const stored = (p, sig) => [p.person_key, { person_key: p.person_key, thread_sig: cs.threadSig(p), profile_sig: sig }];

  await check('a different paragraph is a different sig; the same one is stable', () => {
    assert.notStrictEqual(sigA, sigB);
    assert.strictEqual(sigA, cs.profileSig({ who: ' A ' }));
  });
  await check('never read -> read; already read and unchanged -> left alone', () => {
    const r = cs.pickTodo([p1, p2], new Map([stored(p1, sigA)]), sigA);
    assert.deepStrictEqual(r.todo.map((p) => p.person_key), ['k2']);
    assert.strictEqual(r.upToDate, 1);
  });
  await check('a thread that has changed is read again', () => {
    const moved = person('k1', { last_msg_at: '2025-07-01T00:00:00.000Z', msgs_in: 2 });
    const r = cs.pickTodo([moved], new Map([stored(p1, sigA)]), sigA);
    assert.strictEqual(r.todo.length, 1);
  });
  await check('a changed paragraph is counted but NOT re-read unless asked', () => {
    const scores = new Map([stored(p1, sigA), stored(p2, sigA), stored(p3, sigB)]);
    const quiet = cs.pickTodo([p1, p2, p3], scores, sigB);
    assert.strictEqual(quiet.todo.length, 0);
    assert.strictEqual(quiet.staleProfile, 2);
    const asked = cs.pickTodo([p1, p2, p3], scores, sigB, { rescore: true });
    assert.deepStrictEqual(asked.todo.map((p) => p.person_key), ['k1', 'k2']);
  });

  console.log('transcript / normaliseItem / spread');
  await check('last 8 messages in date order, speakers labelled, earlier ones counted', () => {
    const msgs = [];
    for (let i = 1; i <= 10; i++) msgs.push(m(`2025-05-${String(i).padStart(2, '0')}T00:00:00.000Z`, i % 2 === 0, `message ${i}`));
    const t = cs.transcript(person('k1', { msgs_in: 5, msgs_out: 5 }), msgs.reverse(), 'Matt', nowMs);
    assert.ok(t.includes('(2 earlier messages omitted; 5 from them and 5 from Matt in total)'));
    assert.ok(!t.includes('message 2\n') && t.includes('[2025-05-03] THEM: message 3'));
    assert.ok(t.includes('[2025-05-10] MATT: message 10'));
    assert.ok(t.indexOf('message 3') < t.indexOf('message 10'));
    assert.ok(/Days since last message: \d+/.test(t));
  });
  await check('an empty message is shown as such, and long ones are cut', () => {
    const t = cs.transcript(person('k1'), [m('2025-05-01T00:00:00.000Z', false, ''), m('2025-05-02T00:00:00.000Z', true, 'x'.repeat(900))], 'Matt', nowMs);
    assert.ok(t.includes('THEM: (no text - attachment or reaction)'));
    assert.ok(!t.includes('x'.repeat(501)));
  });
  await check('scores are forced into the fixed shape', () => {
    assert.deepStrictEqual(cs.normaliseItem({ ending: 'made_up', warmth: 9, why: ' w ', anchor: ' a ' }), { ending: 'other', warmth: 5, why: 'w', pick_up_on: 'a' });
    assert.strictEqual(cs.normaliseItem({ ending: 'declined', warmth: 'nope' }).warmth, 1);
  });
  await check('a sample is spread across the list', () => {
    const list = Array.from({ length: 100 }, (_, i) => i);
    assert.deepStrictEqual(cs.spread(list, 4), [0, 25, 50, 75]);
    assert.strictEqual(cs.spread(list, 500).length, 100);
  });

  console.log('scoreBatch');
  const refFrom = (params) => [...params.messages[0].content.matchAll(/### ref (\w+)/g)].map((x) => x[1]);
  const reply = (items) => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: JSON.stringify({ items }) }] });
  const msgsBy = new Map([['k1', [m('2025-05-01T00:00:00.000Z', false, 'hello')]], ['k2', [m('2025-05-01T00:00:00.000Z', false, 'hi')]]]);

  await check('each result lands on the right person', async () => {
    const llm = { messages: { create: async (params) => {
      const [a, b] = refFrom(params);
      return reply([
        { ref: b, ending: 'declined', warmth: 1, why: 'no', anchor: '' },
        { ref: a, ending: 'not_now', warmth: 4, why: 'later', anchor: 'the trip' },
        { ref: 'unknown', ending: 'other', warmth: 3, why: '', anchor: '' },
      ]);
    } } };
    const r = await cs.scoreBatch(llm, 'sys', [p1, p2], msgsBy, 'Matt', nowMs);
    assert.strictEqual(r.byKey.size, 2);
    assert.strictEqual(r.byKey.get('k1').ending, 'not_now');
    assert.strictEqual(r.byKey.get('k1').pick_up_on, 'the trip');
    assert.strictEqual(r.byKey.get('k2').ending, 'declined');
  });
  await check('unparseable output is retried', async () => {
    let calls = 0;
    const llm = { messages: { create: async (params) => {
      calls++;
      if (calls === 1) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] };
      return reply([{ ref: refFrom(params)[0], ending: 'other', warmth: 2, why: '', anchor: '' }]);
    } } };
    const r = await cs.scoreBatch(llm, 'sys', [p1], msgsBy, 'Matt', nowMs);
    assert.strictEqual(calls, 2);
    assert.strictEqual(r.byKey.size, 1);
  });
  await check('a refusal scores nobody', async () => {
    const llm = { messages: { create: async () => ({ stop_reason: 'refusal', usage: {}, content: [] }) } };
    const r = await cs.scoreBatch(llm, 'sys', [p1], msgsBy, 'Matt', nowMs);
    assert.strictEqual(r.byKey.size, 0);
    assert.strictEqual(r.refused, true);
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
