/**
 * Tests for the daily LinkedIn history collect (services/linkedinCollect.js) - Reconnect.
 *
 * Covers nextStatus(): waiting -> ready (first batch, one email) -> collecting -> complete (two
 * quiet days, one email); stalled when nothing arrives for a day; growth after "complete" reopens
 * it; no email is ever sent twice. wantRelations(): the connections list is read on the first run
 * and weekly, not daily. buildEmail(). collectOne() with fakes: a finished client is skipped, a
 * failed copy is recorded and never throws, a client already working their list gets no "ready".
 * No Unipile, no Postgres, no mail. ⚠ Synthetic content only.
 *
 * Run: node tests/linkedin-collect.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const lc = require('../services/linkedinCollect');

const H = 3600000;
const T0 = Date.UTC(2026, 9, 6, 0, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

(async () => {
  console.log('nextStatus');

  await check('connected, nothing yet, under a day -> waiting, no email', () => {
    const r = lc.nextStatus(null, { messages: 0, nowMs: T0, connectedAtMs: T0 - 3 * H });
    assert.strictEqual(r.state, 'waiting');
    assert.strictEqual(r.notify, null);
  });
  await check('nothing after a day -> stalled, one email only', () => {
    const r = lc.nextStatus(null, { messages: 0, nowMs: T0, connectedAtMs: T0 - 30 * H });
    assert.strictEqual(r.state, 'stalled');
    assert.strictEqual(r.notify, 'stalled');
    const again = lc.nextStatus({ state: 'stalled', messages: 0, notified_stalled_at: iso(T0) }, { messages: 0, nowMs: T0 + 24 * H, connectedAtMs: T0 - 30 * H });
    assert.strictEqual(again.notify, null);
  });
  await check('the first batch -> ready, with the email', () => {
    const r = lc.nextStatus({ state: 'waiting', messages: 0 }, { messages: 11000, nowMs: T0, connectedAtMs: T0 - 5 * H });
    assert.strictEqual(r.state, 'ready');
    assert.strictEqual(r.notify, 'ready');
    assert.strictEqual(r.firstBatchAt, iso(T0));
  });
  await check('more arrives the next day -> collecting, no second ready email', () => {
    const prev = { state: 'ready', messages: 11000, first_batch_at: iso(T0), last_growth_at: iso(T0), notified_ready_at: iso(T0) };
    const r = lc.nextStatus(prev, { messages: 21000, nowMs: T0 + 24 * H, connectedAtMs: T0 - 5 * H });
    assert.strictEqual(r.state, 'collecting');
    assert.strictEqual(r.notify, null);
    assert.strictEqual(r.lastGrowthAt, iso(T0 + 24 * H));
  });
  await check('one quiet day is not the end; two quiet days is, with one email', () => {
    const prev = { state: 'collecting', messages: 21000, first_batch_at: iso(T0), last_growth_at: iso(T0), notified_ready_at: iso(T0) };
    const one = lc.nextStatus(prev, { messages: 21000, nowMs: T0 + 24 * H, connectedAtMs: 0 });
    assert.strictEqual(one.state, 'collecting');
    assert.strictEqual(one.notify, null);
    const two = lc.nextStatus(prev, { messages: 21000, nowMs: T0 + 48 * H, connectedAtMs: 0 });
    assert.strictEqual(two.state, 'complete');
    assert.strictEqual(two.notify, 'complete');
    const three = lc.nextStatus({ ...prev, state: 'complete', complete_at: iso(T0 + 48 * H), notified_complete_at: iso(T0 + 48 * H) }, { messages: 21000, nowMs: T0 + 72 * H, connectedAtMs: 0 });
    assert.strictEqual(three.notify, null);
  });
  await check('history that starts growing again after "complete" reopens it', () => {
    const prev = { state: 'complete', messages: 21000, first_batch_at: iso(T0), last_growth_at: iso(T0), complete_at: iso(T0 + 48 * H), notified_complete_at: iso(T0 + 48 * H) };
    const r = lc.nextStatus(prev, { messages: 24000, nowMs: T0 + 96 * H, connectedAtMs: 0 });
    assert.strictEqual(r.state, 'collecting');
    assert.strictEqual(r.completeAt, null);
  });

  console.log('wantRelations / buildEmail');
  await check('the connections list is read on the first run and weekly, not daily', () => {
    assert.strictEqual(lc.wantRelations(null, T0), true);
    assert.strictEqual(lc.wantRelations({ last_relations_at: iso(T0) }, T0 + 24 * H), false);
    assert.strictEqual(lc.wantRelations({ last_relations_at: iso(T0) }, T0 + 8 * 24 * H), true);
  });
  await check('the emails say what happened, with the numbers', () => {
    const c = { clientName: 'Pat Client', connections: 27150, conversations: 2950, oldestMsgAt: '2024-09-18T00:00:00.000Z' };
    const ready = lc.buildEmail('ready', c);
    assert.ok(ready.subject.includes('Pat Client is ready for a session'));
    assert.ok(ready.text.includes('27,150 connections') && ready.text.includes('2024-09-18'));
    assert.ok(lc.buildEmail('complete', c).text.includes('treated as complete'));
    assert.ok(lc.buildEmail('stalled', c).subject.includes('no history has arrived'));
    for (const k of ['ready', 'complete', 'stalled']) assert.ok(!/[—–]/.test(lc.buildEmail(k, c).text), 'short dashes only');
  });

  console.log('collectOne');
  const fakeDb = (row) => {
    const calls = [];
    return { calls, query: async (sql, params) => { calls.push({ sql, params }); if (/SELECT \* FROM linkedin_collect_status/.test(sql)) return { rows: row ? [row] : [] }; if (/min\(sent_at\)/.test(sql)) return { rows: [{ oldest: '2024-09-18T00:00:00.000Z' }] }; return { rows: [], rowCount: 1 }; } };
  };
  const client = (extra = {}) => ({ clientId: 'Pat-Client', clientName: 'Pat Client', unipileLinkedinAccountId: 'li-1', linkedinConnectedAt: iso(T0 - 5 * H), ...extra });
  const okSync = (summary) => async () => ({ ok: true, relationsComplete: true, summary });

  await check('first batch in -> stored as ready and Guy is emailed once', async () => {
    const db = fakeDb(null); lc._setPool(db);
    const mails = [];
    const r = await lc.collectOne(client(), { nowMs: T0, deps: { sync: okSync({ messages: 11000, withMessages: 2950, connections: 27150 }), sendAlertEmail: async (s) => mails.push(s) } });
    assert.strictEqual(r.state, 'ready');
    assert.strictEqual(r.emailed, true);
    assert.strictEqual(mails.length, 1);
    const upsert = db.calls.find((c) => /INSERT INTO linkedin_collect_status/.test(c.sql));
    assert.strictEqual(upsert.params[2], 'ready');
    assert.strictEqual(upsert.params[3], 27150);
  });
  await check('a client already working their list gets no "ready" email', async () => {
    lc._setPool(fakeDb(null));
    const mails = [];
    const r = await lc.collectOne(client({ reconnect: 'Yes' }), { nowMs: T0, deps: { sync: okSync({ messages: 500, withMessages: 100, connections: 900 }), sendAlertEmail: async (s) => mails.push(s) } });
    assert.strictEqual(r.state, 'ready');
    assert.strictEqual(mails.length, 0);
    assert.strictEqual(r.emailed, false);
  });
  await check('a finished client is skipped - nothing is read', async () => {
    lc._setPool(fakeDb({ tenant_id: 'Pat-Client', account_id: 'li-1', state: 'complete', messages: 21000 }));
    let called = false;
    const r = await lc.collectOne(client(), { nowMs: T0, deps: { sync: async () => { called = true; return { ok: true, summary: {} }; } } });
    assert.strictEqual(r.skipped, 'complete');
    assert.strictEqual(called, false);
  });
  await check('a failed copy is recorded on the client and never throws', async () => {
    const db = fakeDb(null); lc._setPool(db);
    const r = await lc.collectOne(client(), { nowMs: T0, deps: { sync: async () => { throw new Error('unipile HTTP 503'); } } });
    assert.strictEqual(r.ok, false);
    assert.ok(db.calls.some((c) => /INSERT INTO linkedin_collect_status/.test(c.sql) && (c.params || []).includes('unipile HTTP 503')));
  });
  await check('a dry run writes nothing and sends nothing', async () => {
    const db = fakeDb(null); lc._setPool(db);
    const mails = [];
    const r = await lc.collectOne(client(), { nowMs: T0, dryRun: true, deps: { sync: okSync({ messages: 11000, withMessages: 2950, connections: 27150 }), sendAlertEmail: async (s) => mails.push(s) } });
    assert.strictEqual(r.notify, 'ready');
    assert.strictEqual(mails.length, 0);
    assert.ok(!db.calls.some((c) => /INSERT INTO linkedin_collect_status/.test(c.sql)));
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
