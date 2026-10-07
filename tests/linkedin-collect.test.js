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

  console.log('the month end');
  const D = 24 * H;
  const conn = (daysAgo, extra = {}) => ({ clientId: 'Pat-Client', clientName: 'Pat Client', recordId: 'recPat', unipileAccountId: 'mail-1', unipileLinkedinAccountId: 'li-1', linkedinConnectedAt: iso(T0 - daysAgo * D), ...extra });

  await check('nothing before day 25; a warning from day 25, once; the end at day 30', () => {
    assert.strictEqual(lc.monthEndStep(conn(10), null, T0), null);
    assert.strictEqual(lc.monthEndStep(conn(25.5), null, T0), 'warn');
    assert.strictEqual(lc.monthEndStep(conn(27), { notified_ending_at: iso(T0) }, T0), null);
    assert.strictEqual(lc.monthEndStep(conn(30.1), { notified_ending_at: iso(T0) }, T0), 'end');
  });
  await check('a client paying to keep the connection is left alone, and so is one with no date', () => {
    assert.strictEqual(lc.monthEndStep(conn(45, { linkedinFeed: 'Yes' }), null, T0), null);
    assert.strictEqual(lc.monthEndStep({ clientId: 'X' }, null, T0), null);
  });
  const monthDb = (row) => { const calls = []; return { calls, query: async (sql, params) => { calls.push({ sql, params }); if (/SELECT \* FROM linkedin_collect_status/.test(sql)) return { rows: row ? [row] : [] }; if (/min\(sent_at\)/.test(sql)) return { rows: [{ oldest: null }] }; return { rows: [], rowCount: 1 }; } }; };

  await check('day 25: Guy is warned with the date, and nothing is switched off', async () => {
    const db = monthDb(null); lc._setPool(db);
    const mails = []; let removed = false;
    const r = await lc.monthEnd(conn(26), { nowMs: T0, deps: { sendAlertEmail: async (s, h, to, o) => mails.push({ s, t: o.text }), deleteUnipileAccount: async () => { removed = true; } } });
    assert.strictEqual(r.step, 'warn');
    assert.strictEqual(mails.length, 1);
    assert.ok(mails[0].s.includes('ends on') && mails[0].t.includes('LinkedIn Feed'));
    assert.strictEqual(removed, false);
    assert.ok(db.calls.some((c) => /notified_ending_at/.test(c.sql)));
  });
  await check('day 30: last collect and top-up FIRST, then switch off, clear the record, email', async () => {
    const db = monthDb({ tenant_id: 'Pat-Client', account_id: 'li-1', state: 'complete', messages: 900, notified_ending_at: iso(T0 - 5 * D) }); lc._setPool(db);
    const order = []; const mails = []; let cleared = null;
    const r = await lc.monthEnd(conn(31, { reconnect: 'Yes' }), { nowMs: T0, deps: {
      sync: async (t, o) => { order.push(`collect relations=${o.relations}`); return { ok: true, relationsComplete: true, summary: { messages: 950, withMessages: 210, connections: 900 } }; },
      score: async () => { order.push('read'); return { ok: true, read: 12, costUsd: 0.05 }; },
      leads: async () => { order.push('leads'); return { ok: true, created: 4, updated: 1 }; },
      deleteUnipileAccount: async (id) => { order.push(`switch off ${id}`); return 'deleted'; },
      updateMaster: async (f) => { order.push('clear record'); cleared = f; },
      sendAlertEmail: async (s, h, to, o) => { order.push('email'); mails.push(o.text); },
    } });
    assert.deepStrictEqual(order, ['collect relations=true', 'read', 'leads', 'switch off li-1', 'clear record', 'email']);
    assert.deepStrictEqual(cleared, { 'Unipile LinkedIn Account ID': null });
    assert.strictEqual(r.ok, true);
    assert.ok(mails[0].includes('read 12 conversations and added 4 people'));
  });
  await check('it will never switch off the mail-and-calendar connection', async () => {
    lc._setPool(monthDb(null));
    let removed = false;
    const r = await lc.monthEnd(conn(31, { unipileLinkedinAccountId: 'mail-1' }), { nowMs: T0, deps: { deleteUnipileAccount: async () => { removed = true; }, sendAlertEmail: async () => {} } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(removed, false);
  });
  await check('a dry run says what it would do and does none of it', async () => {
    const db = monthDb(null); lc._setPool(db);
    let touched = false;
    const r = await lc.monthEnd(conn(31), { nowMs: T0, dryRun: true, deps: { deleteUnipileAccount: async () => { touched = true; }, sendAlertEmail: async () => { touched = true; } } });
    assert.deepStrictEqual({ step: r.step, dryRun: r.dryRun }, { step: 'end', dryRun: true });
    assert.strictEqual(touched, false);
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
  await check('first batch in, client has a key -> client gets the steps, coach copied, and Guy is told', async () => {
    lc._setPool(fakeDb(null));
    const alerts = []; const sent = [];
    const r = await lc.collectOne(client({ clientFirstName: 'Pat', clientEmailAddress: 'pat@example.com', anthropicApiKey: 'sk-test' }), {
      nowMs: T0, coach: { name: 'Casey Coach', email: 'casey@example.com' },
      deps: { sync: okSync({ messages: 900, withMessages: 200, connections: 900 }), sendAlertEmail: async (s, h, to, o) => alerts.push(o.text), sendClientEmail: async (m) => sent.push(m) },
    });
    assert.strictEqual(r.clientEmailed, true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, 'pat@example.com');
    assert.strictEqual(sent[0].cc, 'casey@example.com');
    assert.strictEqual(sent[0]['h:Reply-To'], 'casey@example.com');
    assert.ok(sent[0].text.startsWith('Hi Pat,'));
    assert.ok(sent[0].text.includes('set up my reconnect list'));
    assert.ok(sent[0].text.endsWith('Cheers,\nCasey'));
    assert.ok(!/—/.test(sent[0].text), 'no em dashes');
    assert.ok(sent[0].from.startsWith('Casey Coach <'));
    assert.ok(alerts[0].includes('Wingguy has emailed them the steps'));
  });
  await check('first batch in, no Claude key -> client NOT emailed, and Guy is told why', async () => {
    lc._setPool(fakeDb(null));
    const alerts = []; const sent = [];
    const r = await lc.collectOne(client({ clientEmailAddress: 'pat@example.com' }), {
      nowMs: T0, deps: { sync: okSync({ messages: 900, withMessages: 200, connections: 900 }), sendAlertEmail: async (s, h, to, o) => alerts.push(o.text), sendClientEmail: async (m) => sent.push(m) },
    });
    assert.strictEqual(r.clientEmailed, false);
    assert.strictEqual(sent.length, 0);
    assert.ok(alerts[0].includes('NOT been emailed') && alerts[0].includes('Claude key'));
    assert.strictEqual(lc.clientEmailBlocker({ clientEmailAddress: 'a@b.c', managedClaudeKey: true }), null);
  });
  await check('client email fails -> the collect still succeeds and Guy is told to send it himself', async () => {
    lc._setPool(fakeDb(null));
    const alerts = [];
    const r = await lc.collectOne(client({ clientEmailAddress: 'pat@example.com', anthropicApiKey: 'sk-test' }), {
      nowMs: T0, deps: { sync: okSync({ messages: 900, withMessages: 200, connections: 900 }), sendAlertEmail: async (s, h, to, o) => alerts.push(o.text), sendClientEmail: async () => { throw new Error('mailgun 400'); } },
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.clientEmailed, false);
    assert.ok(alerts[0].includes('failed (mailgun 400)'));
  });
  await check('the client is never emailed on a later day (ready already sent)', async () => {
    lc._setPool(fakeDb({ tenant_id: 'Pat-Client', account_id: 'li-1', state: 'ready', messages: 500, first_batch_at: iso(T0), last_growth_at: iso(T0), notified_ready_at: iso(T0) }));
    const sent = [];
    await lc.collectOne(client({ clientEmailAddress: 'pat@example.com', anthropicApiKey: 'sk-test' }), {
      nowMs: T0 + 24 * H, deps: { sync: okSync({ messages: 900, withMessages: 200, connections: 900 }), sendAlertEmail: async () => {}, sendClientEmail: async (m) => sent.push(m) },
    });
    assert.strictEqual(sent.length, 0);
  });
  await check('a client already working their list gets no "ready" email', async () => {
    lc._setPool(fakeDb(null));
    const mails = [];
    const r = await lc.collectOne(client({ reconnect: 'Yes' }), { nowMs: T0, deps: { sync: okSync({ messages: 500, withMessages: 100, connections: 900 }), sendAlertEmail: async (s) => mails.push(s), score: async () => ({ ok: true, read: 0 }), leads: async () => ({ ok: true }) } });
    assert.strictEqual(r.state, 'ready');
    assert.strictEqual(mails.length, 0);
    assert.strictEqual(r.emailed, false);
  });
  await check('a client whose list is ON gets the day\'s arrivals read and added', async () => {
    lc._setPool(fakeDb({ tenant_id: 'Pat-Client', account_id: 'li-1', state: 'ready', messages: 500, first_batch_at: iso(T0), last_growth_at: iso(T0), notified_ready_at: iso(T0) }));
    const order = [];
    const r = await lc.collectOne(client({ reconnect: 'Yes' }), { nowMs: T0 + 24 * H, deps: {
      sync: okSync({ messages: 900, withMessages: 200, connections: 900 }),
      score: async () => { order.push('read'); return { ok: true, read: 40, costUsd: 0.16 }; },
      leads: async (t, o) => { order.push(`leads dryRun=${o.dryRun}`); return { ok: true, created: 7, updated: 3 }; },
    } });
    assert.deepStrictEqual(order, ['read', 'leads dryRun=false']);
    assert.deepStrictEqual(r.topUp, { ok: true, read: 40, costUsd: 0.16, created: 7, updated: 3 });
  });
  await check('a client who has NOT said yes is only collected - nothing is read or added', async () => {
    lc._setPool(fakeDb(null));
    let touched = false;
    const r = await lc.collectOne(client(), { nowMs: T0, deps: {
      sync: okSync({ messages: 900, withMessages: 200, connections: 900 }), sendAlertEmail: async () => {},
      score: async () => { touched = true; return { ok: true }; }, leads: async () => { touched = true; return { ok: true }; },
    } });
    assert.strictEqual(touched, false);
    assert.strictEqual(r.topUp, undefined);
  });
  await check('a top-up that fails does not fail the collect, and leads are not touched after a failed read', async () => {
    lc._setPool(fakeDb(null));
    let leadsCalled = false;
    const r = await lc.collectOne(client({ reconnect: 'Yes' }), { nowMs: T0, deps: {
      sync: okSync({ messages: 900, withMessages: 200, connections: 900 }),
      score: async () => ({ ok: false, error: 'no paragraph yet' }), leads: async () => { leadsCalled = true; return { ok: true }; },
    } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.topUp.ok, false);
    assert.strictEqual(leadsCalled, false);
    const thrown = await lc.topUp('T', { score: async () => { throw new Error('boom'); } });
    assert.deepStrictEqual(thrown, { ok: false, error: 'boom' });
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
