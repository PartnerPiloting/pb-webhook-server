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

const { planDisconnects, pendingForMachine, markQueued, disconnectAction, buildDisconnects } = require('../services/reconnectDisconnects');
const rq = require('../services/reconnectQueue');

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
  await check('the client\'s own flag is listed whatever the conversation said', () => {
    const r = plan([row('b', { ending: 'declined' }), row('a', { ending: 'not_now', status: 'disconnect', source: 'client', connected_at: '2026-06-01T00:00:00.000Z' })]);
    assert.deepStrictEqual(keys(r.pending), ['a', 'b']);
    assert.strictEqual(r.pending[0].tag, 'You flagged');
    assert.strictEqual(r.pending[0].source, 'client');
  });
  await check('highest profile score first, unscored last, and a high scorer is guarded', () => {
    const rows = [row('a', { ending: 'declined' }), row('b', { ending: 'declined', lead_rec_id: 'recB' }), row('c', { ending: 'their_pitch', lead_rec_id: 'recC' }), row('d', { ending: 'declined', lead_rec_id: 'recD' })];
    const r = plan(rows, { scoresByLead: new Map([['recB', 41.6], ['recC', 88.2], ['recD', '']]) });
    assert.deepStrictEqual(keys(r.pending), ['c', 'b', 'a', 'd']);
    assert.deepStrictEqual(r.pending.map((p) => p.profileScore), [88, 42, null, null]);
    assert.deepStrictEqual(r.pending.map((p) => p.guard), [true, false, false, false]);
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

  console.log('going tonight / handed over');
  await check('approved and not yet collected = going tonight; collected = handed over; removed = gone', () => {
    const r = plan([
      row('a', { status: 'disconnect', source: 'client', approved_at: '2026-10-05T00:00:00.000Z' }),
      row('b', { status: 'disconnect', source: 'system', approved_at: '2026-10-05T00:00:00.000Z', queued_at: '2026-10-05T13:50:00.000Z' }),
      row('c', { status: 'disconnect', source: 'system', approved_at: '2026-10-04T00:00:00.000Z', queued_at: '2026-10-04T13:50:00.000Z', removed_at: '2026-10-04T15:00:00.000Z' }),
    ]);
    assert.deepStrictEqual(keys(r.approved), ['a']);
    assert.strictEqual(r.handedOver, 1);
    assert.strictEqual(r.pending.length, 0);
  });

  console.log('the switch');
  const ON = { clientId: 'T', reconnect: 'Yes', reconnectDisconnects: 'Yes' };
  await check('disconnects needs BOTH switches', () => {
    assert.strictEqual(rq.disconnectsOn(ON), true);
    assert.strictEqual(rq.disconnectsOn({ reconnect: 'Yes' }), false);
    assert.strictEqual(rq.disconnectsOn({ reconnectDisconnects: 'Yes' }), false);
    assert.strictEqual(rq.disconnectsOn(null), false);
  });
  await check('switch off -> the Disconnect click is refused and the machine is handed nobody', async () => {
    const r = await rq.reconnectAction('T', 'k1', 'disconnect', { clientOverride: { clientId: 'T', reconnect: 'Yes' } });
    assert.deepStrictEqual(r, { ok: false, error: 'disconnects_not_enabled' });
    assert.deepStrictEqual(await pendingForMachine({ clientId: 'T', reconnect: 'Yes' }), []);
  });

  console.log('the machine pick-up');
  const fakeDb = (rows, rowCount = 1) => { const calls = []; return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows: /SELECT st\.person_key/.test(sql) ? rows : [], rowCount }; } }; };
  await check('the machine gets proper profile links for approved people only', async () => {
    const db = fakeDb([{ person_key: 'a', public_identifier: 'pat-person', profile_url: 'https://www.linkedin.com/in/ACoAxyz' }, { person_key: 'b', public_identifier: null, profile_url: 'https://www.linkedin.com/in/someone/' }, { person_key: 'c', public_identifier: null, profile_url: 'https://www.linkedin.com/sales/lead/ACwA' }]);
    rq._setPool(db);
    const people = await pendingForMachine(ON);
    assert.deepStrictEqual(people, [{ key: 'a', link: 'https://www.linkedin.com/in/pat-person/' }, { key: 'b', link: 'https://www.linkedin.com/in/someone/' }]);
    const sql = db.calls.find((c) => /SELECT st\.person_key/.test(c.sql)).sql;
    assert.ok(/approved_at IS NOT NULL/.test(sql) && /queued_at IS NULL/.test(sql) && /removed_at IS NULL/.test(sql));
  });
  await check('confirming marks only approved, uncollected people of that client', async () => {
    const db = fakeDb([], 2); rq._setPool(db);
    const r = await markQueued('T', ['a', 'a', 'b', '']);
    assert.strictEqual(r.count, 2);
    const call = db.calls.find((c) => /UPDATE reconnect_state SET queued_at/.test(c.sql));
    assert.deepStrictEqual(call.params, ['T', ['a', 'b']]);
    assert.ok(/approved_at IS NOT NULL AND queued_at IS NULL/.test(call.sql));
  });
  await check('Undo (keep) cannot pull back someone Linked Helper already has', async () => {
    const calls = [];
    rq._setPool({ query: async (sql, params) => { calls.push(sql); if (/SELECT person_key, lead_rec_id/.test(sql)) return { rows: [{ person_key: 'a', lead_rec_id: null }] }; return { rows: [], rowCount: 0 }; } });
    const r = await disconnectAction('T', 'keep', ['a']);
    assert.strictEqual(r.count, 0);
    assert.ok(calls.some((s) => /WHERE reconnect_state\.queued_at IS NULL/.test(s)));
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
