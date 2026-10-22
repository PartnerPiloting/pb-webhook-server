/**
 * Client touch record - services/clientTouchStore.js (2026-10-22).
 *
 * Covers: input validation · idempotent record (same touch twice = one row) · "has had" and
 * "keys had" reads · last-touch excludes the newsletter · the 6-day not-this-week test ·
 * no database = reads empty, writes no-op. In-memory fake pool, no real database.
 *
 * Run: node tests/client-touch-store.test.js
 */
const assert = require('assert');
const store = require('../services/clientTouchStore');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

// In-memory fake pool - emulates just the SQL shapes the store issues.
class FakeDb {
  constructor() { this.rows = []; this.nextId = 1; }
  connect() {
    return Promise.resolve({ query: (sql, params) => this.query(sql, params || []), release() {} });
  }
  async query(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^CREATE /i.test(s)) return { rows: [] };
    if (/^INSERT INTO client_touches/i.test(s)) {
      const [client_id, kind, key, form, version, sent_at, reason, source, recipient, meta] = params;
      const dup = this.rows.find((r) => r.client_id === client_id && r.kind === kind && r.key === key
        && r.sent_at.getTime() === new Date(sent_at).getTime());
      if (dup) return { rows: [] };
      const row = { id: this.nextId++, client_id, kind, key, form, version, sent_at: new Date(sent_at), reason, source, recipient, meta: meta ? JSON.parse(meta) : null };
      this.rows.push(row);
      return { rows: [{ id: row.id }] };
    }
    const byClient = (id) => this.rows.filter((r) => r.client_id === id);
    const newestFirst = (rows) => [...rows].sort((a, b) => b.sent_at - a.sent_at);
    if (s.includes('WHERE client_id = $1 AND kind = $2 AND key = $3')) {
      const rows = newestFirst(byClient(params[0]).filter((r) => r.kind === params[1] && r.key === params[2]));
      return { rows: rows.slice(0, 1) };
    }
    if (s.includes('GROUP BY key')) {
      const rows = byClient(params[0]).filter((r) => r.kind === params[1]);
      const firstByKey = new Map();
      for (const r of rows) if (!firstByKey.has(r.key) || firstByKey.get(r.key) > r.sent_at) firstByKey.set(r.key, r.sent_at);
      return { rows: [...firstByKey.entries()].sort((a, b) => a[1] - b[1]).map(([key, first_at]) => ({ key, first_at })) };
    }
    if (s.startsWith('SELECT MAX(sent_at)')) {
      const rows = byClient(params[0]).filter((r) => params[1].includes(r.kind));
      const last = rows.length ? new Date(Math.max(...rows.map((r) => r.sent_at.getTime()))) : null;
      return { rows: [{ last }] };
    }
    if (s.includes('WHERE sent_at >= $1')) {
      const since = new Date(params[0]);
      let rows = this.rows.filter((r) => r.sent_at >= since);
      if (params[1]) rows = rows.filter((r) => params[1].includes(r.kind));
      return { rows: newestFirst(rows) };
    }
    if (s.includes('WHERE client_id = $1 AND kind = ANY($2)')) {
      return { rows: newestFirst(byClient(params[0]).filter((r) => params[1].includes(r.kind))).slice(0, params[2]) };
    }
    if (s.includes('WHERE client_id = $1 ORDER BY')) {
      return { rows: newestFirst(byClient(params[0])).slice(0, params[1]) };
    }
    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 120)}`);
  }
}

(async () => {
  console.log('normaliseTouch() - validation:');
  await check('accepts a full one-pager touch and fills defaults', () => {
    const t = store.normaliseTouch({ clientId: 'Rick-Wong', kind: 'one-pager', key: 'first-discovery-call', sentAt: '2026-10-20T07:00:00Z' });
    assert.strictEqual(t.form, 'full');
    assert.strictEqual(t.source, 'planner');
    assert.strictEqual(t.sentAt.toISOString(), '2026-10-20T07:00:00.000Z');
  });
  await check('rejects an unknown kind', () =>
    assert.throws(() => store.normaliseTouch({ clientId: 'X', kind: 'newsletter', key: 'k' }), /invalid kind/));
  await check('rejects an unknown form', () =>
    assert.throws(() => store.normaliseTouch({ clientId: 'X', kind: 'habit', key: 'habit-1', form: 'long' }), /invalid form/));
  await check('rejects a missing client or key', () => {
    assert.throws(() => store.normaliseTouch({ kind: 'habit', key: 'habit-1' }), /clientId/);
    assert.throws(() => store.normaliseTouch({ clientId: 'X', kind: 'habit' }), /key/);
  });
  await check('rejects a bad date', () =>
    assert.throws(() => store.normaliseTouch({ clientId: 'X', kind: 'habit', key: 'habit-1', sentAt: 'yesterday-ish' }), /invalid sentAt/));
  await check('lowercases the recipient address', () => {
    const t = store.normaliseTouch({ clientId: 'X', kind: 'habit', key: 'habit-1', recipient: 'RWong@SalesXceleration.com' });
    assert.strictEqual(t.recipient, 'rwong@salesxceleration.com');
  });

  console.log('isWithinDays():');
  await check('6 days ago is within 6 days; 7 days ago is not', () => {
    const now = new Date('2026-10-26T00:00:00Z');
    assert.strictEqual(store.isWithinDays(new Date('2026-10-20T00:00:00Z'), 6, now), true);
    assert.strictEqual(store.isWithinDays(new Date('2026-10-19T00:00:00Z'), 6, now), false);
  });
  await check('a future date is not "within" the last N days', () => {
    assert.strictEqual(store.isWithinDays(new Date('2026-11-01T00:00:00Z'), 6, new Date('2026-10-26T00:00:00Z')), false);
  });

  console.log('record() + reads, with a fake pool:');
  const db = new FakeDb();
  store.__setTestPool(db);
  await check('records a touch and returns inserted:true', async () => {
    const r = await store.record({ clientId: 'Rick-Wong', kind: 'habit', key: 'habit-1', sentAt: '2026-10-13T22:00:00Z', source: 'backfill', recipient: 'rwong@salesxceleration.com' });
    assert.deepStrictEqual({ ok: r.ok, inserted: r.inserted }, { ok: true, inserted: true });
  });
  await check('the same touch again is not recorded twice (inserted:false, still ok)', async () => {
    const r = await store.record({ clientId: 'Rick-Wong', kind: 'habit', key: 'habit-1', sentAt: '2026-10-13T22:00:00Z', source: 'backfill' });
    assert.deepStrictEqual({ ok: r.ok, inserted: r.inserted }, { ok: true, inserted: false });
    assert.strictEqual(db.rows.length, 1);
  });
  await check('invalid input throws rather than being swallowed', async () => {
    await assert.rejects(() => store.record({ clientId: 'Rick-Wong', kind: 'bogus', key: 'x' }), /invalid kind/);
  });
  await store.record({ clientId: 'Rick-Wong', kind: 'mindset', key: 'Mindset Mastery: Let Them', sentAt: '2025-09-26T00:00:00Z', source: 'backfill' });
  await store.record({ clientId: 'Rick-Wong', kind: 'one-pager', key: 'first-discovery-call', form: 'full', version: 'abc123', sentAt: '2026-10-20T21:00:00Z', reason: 'opening run #1' });
  await store.record({ clientId: 'Rick-Wong', kind: 'one-pager', key: 'first-discovery-call', form: 'short', sentAt: '2026-12-15T21:00:00Z', reason: 'reinforce' });
  await store.record({ clientId: 'Steve-Nelson', kind: 'habit', key: 'habit-1', sentAt: '2026-10-15T21:00:00Z', source: 'backfill' });

  await check('hasHad() finds the piece and returns the most recent form', async () => {
    const row = await store.hasHad('Rick-Wong', 'one-pager', 'first-discovery-call');
    assert.ok(row);
    assert.strictEqual(row.form, 'short');
    assert.strictEqual(await store.hasHad('Rick-Wong', 'one-pager', 'connection-isnt-charm'), null);
  });
  await check('keysHad() lists each piece once, in first-sent order', async () => {
    assert.deepStrictEqual(await store.keysHad('Rick-Wong', 'one-pager'), ['first-discovery-call']);
    assert.deepStrictEqual(await store.keysHad('Rick-Wong', 'habit'), ['habit-1']);
    assert.deepStrictEqual(await store.keysHad('Steve-Nelson', 'mindset'), []);
  });
  await check('touchesFor() is newest first and can be narrowed by kind', async () => {
    const all = await store.touchesFor('Rick-Wong');
    assert.strictEqual(all.length, 4);
    assert.strictEqual(all[0].key, 'first-discovery-call');
    const habits = await store.touchesFor('Rick-Wong', { kinds: ['habit'] });
    assert.strictEqual(habits.length, 1);
  });
  await check('lastTouchAt() ignores the newsletter by default', async () => {
    const steveAll = await store.lastTouchAt('Steve-Nelson');
    assert.strictEqual(steveAll.toISOString(), '2026-10-15T21:00:00.000Z');
    await store.record({ clientId: 'Dean-Hobin', kind: 'mindset', key: 'Mindset Mastery: Deep Work', sentAt: '2025-09-19T00:00:00Z', source: 'backfill' });
    assert.strictEqual(await store.lastTouchAt('Dean-Hobin'), null);
    const withNewsletter = await store.lastTouchAt('Dean-Hobin', { kinds: store.KINDS });
    assert.strictEqual(withNewsletter.toISOString(), '2025-09-19T00:00:00.000Z');
  });
  await check('touchesSince() reads every client in one go', async () => {
    const rows = await store.touchesSince('2026-10-01T00:00:00Z');
    assert.deepStrictEqual(new Set(rows.map((r) => r.client_id)), new Set(['Rick-Wong', 'Steve-Nelson']));
    const habitsOnly = await store.touchesSince('2026-10-01T00:00:00Z', { kinds: ['habit'] });
    assert.strictEqual(habitsOnly.length, 2);
  });

  console.log('no database:');
  store.__setTestPool(null);
  delete process.env.DATABASE_URL;
  await check('reads return empty and writes no-op without DATABASE_URL', async () => {
    assert.deepStrictEqual(await store.touchesFor('Rick-Wong'), []);
    assert.strictEqual(await store.hasHad('Rick-Wong', 'habit', 'habit-1'), null);
    assert.strictEqual(await store.lastTouchAt('Rick-Wong'), null);
    assert.strictEqual(await store.touchedWithinDays('Rick-Wong', 6), false);
    const r = await store.record({ clientId: 'Rick-Wong', kind: 'habit', key: 'habit-2' });
    assert.strictEqual(r.ok, false);
  });

  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
})();
