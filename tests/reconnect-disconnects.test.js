/**
 * Tests for the Potential disconnects list (services/reconnectDisconnects.js) - Reconnect, brick 5.
 *
 * Covers planDisconnects(): the client's own flags and system suggestions (a decline or their
 * pitch) are listed; "never replied" alone is never a reason; nobody connected in the last year
 * and no client is suggested; anyone already decided about is left alone; approved people move to
 * the approved list and removed ones disappear. Pure - no Postgres. ⚠ Synthetic content only.
 *
 * Run: node tests/reconnect-disconnects.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { planDisconnects } = require('../services/reconnectDisconnects');

const nowMs = Date.UTC(2026, 9, 6);
const row = (key, extra = {}) => ({
  person_key: key, name: `Person ${key}`, headline: 'Director', profile_url: `https://www.linkedin.com/in/${key}`,
  connected_at: '2023-01-15T00:00:00.000Z', is_connection: true, ending: null, why: '', status: null, source: null, approved_at: null, removed_at: null, ...extra,
});
const keys = (list) => list.map((p) => p.key);
const plan = (rows, opts = {}) => planDisconnects(rows, { nowMs, ...opts });

(async () => {
  console.log('planDisconnects');

  await check('a decline and a pitch are suggested, with the reason', () => {
    const r = plan([row('a', { ending: 'declined', why: 'Said not interested.' }), row('b', { ending: 'their_pitch' })]);
    assert.deepStrictEqual(keys(r.pending), ['a', 'b']);
    assert.strictEqual(r.pending[0].tag, 'Declined');
    assert.strictEqual(r.pending[0].why, 'Said not interested.');
    assert.strictEqual(r.pending[1].tag, 'Their pitch');
    assert.strictEqual(r.pending[0].source, 'system');
  });
  await check('any other ending - and no conversation at all - is never suggested', () => {
    const r = plan([row('a', { ending: 'closed_politely' }), row('b', { ending: 'not_now' }), row('c', { ending: null })]);
    assert.strictEqual(r.pending.length, 0);
  });
  await check('nobody connected in the last year is suggested', () => {
    const r = plan([row('a', { ending: 'declined', connected_at: '2026-03-01T00:00:00.000Z' }), row('b', { ending: 'declined', connected_at: '2025-09-01T00:00:00.000Z' })]);
    assert.deepStrictEqual(keys(r.pending), ['b']);
  });
  await check('a client is never suggested, and neither is a non-connection', () => {
    const r = plan([row('a', { ending: 'declined', name: 'Casey Client' }), row('b', { ending: 'declined', is_connection: false })], { clientNames: new Set(['casey client']) });
    assert.strictEqual(r.pending.length, 0);
  });
  await check('someone the client already decided about is not suggested again', () => {
    const r = plan(['kept', 'done', 'never', 'skipped'].map((status, i) => row(`p${i}`, { ending: 'declined', status })));
    assert.strictEqual(r.pending.length, 0);
  });
  await check('the client\'s own flag is listed whatever the conversation said, and comes first', () => {
    const r = plan([row('b', { ending: 'declined' }), row('a', { ending: 'not_now', status: 'disconnect', source: 'client', connected_at: '2026-06-01T00:00:00.000Z' })]);
    assert.deepStrictEqual(keys(r.pending), ['a', 'b']);
    assert.strictEqual(r.pending[0].tag, 'You flagged');
    assert.strictEqual(r.pending[0].source, 'client');
  });
  await check('approved people move to the approved list; removed ones are gone', () => {
    const r = plan([
      row('a', { status: 'disconnect', source: 'system', ending: 'declined', approved_at: '2026-10-05T00:00:00.000Z' }),
      row('b', { status: 'disconnect', source: 'client', approved_at: '2026-10-05T00:00:00.000Z', removed_at: '2026-10-06T00:00:00.000Z' }),
    ]);
    assert.strictEqual(r.pending.length, 0);
    assert.deepStrictEqual(keys(r.approved), ['a']);
    assert.strictEqual(r.approved[0].linkedin, 'https://www.linkedin.com/in/a');
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
