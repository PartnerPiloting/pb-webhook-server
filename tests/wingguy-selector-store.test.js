/**
 * Tests for the Wingguy selector store (services/wingguySelectorStore.js) — the LinkedIn landmark
 * overrides that turn "LinkedIn renamed something" from a release into a database row.
 *
 * WHAT THESE DO AND DON'T COVER. They test the PLUMBING: versioning, tenant shadowing, rollback,
 * the unknown-key gate, and the health writes. They deliberately do NOT test whether any selector
 * still matches LinkedIn — that can only be answered against a real, logged-in LinkedIn page, and a
 * fixture-based "selector test" would pass forever while the product was broken in the field. The
 * in-extension self-check (runSelfCheck in content-wingguy.js) is what covers that, on real pages.
 *
 * The last test is the one most likely to catch a real bug: SELECTOR_DEFAULTS in the extension and
 * KNOWN_KEYS in the store must name the same landmarks. If they drift, a fix gets stored under a key
 * the extension ignores — the store says saved, the extension says nothing happened, and everything
 * looks fine right up until the outage it was supposed to fix.
 *
 * Run: node tests/wingguy-selector-store.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const store = require('../services/wingguySelectorStore');

// --- in-memory fake pool: emulates just the SQL shapes this store issues --------------------
class FakeDb {
  constructor() { this.selectors = []; this.health = []; this.nextId = 1; }
  connect() {
    return Promise.resolve({ query: (sql, params) => this.query(sql, params || []), release() {} });
  }
  async query(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s) || /^CREATE /i.test(s)) return { rows: [] };

    if (s.startsWith('INSERT INTO wingguy_selector_health')) {
      this.health.push({
        tenant_id: params[0], selector_key: params[1], surface: params[2],
        found: params[3], source: params[4], shape: params[5], extension_version: params[6],
      });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO wingguy_selectors')) {
      const row = {
        id: this.nextId++, tenant_id: params[0], selector_key: params[1], selector_value: params[2],
        version: params[3], note: params[4], created_by: params[5], retired_at: null,
        created_at: new Date(),
      };
      this.selectors.push(row);
      return { rows: [{ id: row.id, version: row.version }], rowCount: 1 };
    }
    // The live read: shared rows ∪ this tenant's, shared first so tenant rows shadow them.
    if (s.includes('FROM wingguy_selectors') && s.includes('(tenant_id IS NULL OR tenant_id = $1)')) {
      const rows = this.selectors
        .filter((r) => !r.retired_at && (r.tenant_id === null || r.tenant_id === params[0]))
        .sort((a, b) => (a.tenant_id === null ? 0 : 1) - (b.tenant_id === null ? 0 : 1) || a.id - b.id);
      return { rows };
    }
    // "what's the current active row for (key, tenant)?"
    if (s.startsWith('SELECT id, version FROM wingguy_selectors')) {
      const rows = this.selectors
        .filter((r) => !r.retired_at && r.selector_key === params[0] && r.tenant_id === params[1])
        .sort((a, b) => b.id - a.id).slice(0, 1);
      return { rows };
    }
    if (s.startsWith('UPDATE wingguy_selectors SET retired_at = now() WHERE id = $1')) {
      const row = this.selectors.find((r) => r.id === params[0]);
      if (row) row.retired_at = new Date();
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (s.startsWith('UPDATE wingguy_selectors SET retired_at = now() WHERE selector_key = $1')) {
      const hit = this.selectors.filter((r) => !r.retired_at && r.selector_key === params[0] && r.tenant_id === params[1]);
      hit.forEach((r) => { r.retired_at = new Date(); });
      return { rows: [], rowCount: hit.length };
    }
    if (s.includes('FROM wingguy_selectors') && s.includes('ORDER BY id DESC LIMIT $2')) {
      const rows = this.selectors
        .filter((r) => params[0] === null || r.selector_key === params[0])
        .sort((a, b) => b.id - a.id).slice(0, params[1]);
      return { rows };
    }
    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 110)}`);
  }
}

(async () => {
  console.log('Wingguy selector store\n');

  let db;
  const reset = () => { db = new FakeDb(); store.__setTestPool(db); };

  // --- versioning -------------------------------------------------------------------------
  await check('first write is version 1', async () => {
    reset();
    const r = await store.setSelector({ key: 'profile_name', value: 'main h1', note: 'initial' });
    assert.strictEqual(r.version, 1);
    assert.strictEqual(db.selectors.length, 1);
  });

  await check('a correction retires the old row and inserts n+1 (nothing is overwritten)', async () => {
    reset();
    await store.setSelector({ key: 'profile_name', value: 'main h1' });
    const r2 = await store.setSelector({ key: 'profile_name', value: 'main h2', note: 'LinkedIn renamed it' });
    assert.strictEqual(r2.version, 2);
    assert.strictEqual(db.selectors.length, 2, 'both versions should still exist');
    const active = db.selectors.filter((x) => !x.retired_at);
    assert.strictEqual(active.length, 1, 'exactly one active row per key');
    assert.strictEqual(active[0].selector_value, 'main h2');
  });

  await check('the live read serves only the active value', async () => {
    reset();
    await store.setSelector({ key: 'profile_name', value: 'main h1' });
    await store.setSelector({ key: 'profile_name', value: 'main h2' });
    const live = await store.getSelectors({ tenantId: 'Guy-Wilson' });
    assert.strictEqual(live.profile_name.value, 'main h2');
    assert.strictEqual(live.profile_name.version, 2);
  });

  // --- the unknown-key gate ---------------------------------------------------------------
  await check('an unknown landmark key is refused, not stored', async () => {
    reset();
    await assert.rejects(
      () => store.setSelector({ key: 'profile_nmae', value: 'main h1' }),   // typo
      /Unknown selector key/
    );
    assert.strictEqual(db.selectors.length, 0);
  });

  await check('an empty value is refused', async () => {
    reset();
    await assert.rejects(() => store.setSelector({ key: 'profile_name', value: '   ' }), /value is required/);
  });

  // --- tenant shadowing (built now, unused today) ------------------------------------------
  await check("a tenant's own override shadows the shared row for that tenant only", async () => {
    reset();
    await store.setSelector({ key: 'profile_name', value: 'shared h1' });                       // shared
    await store.setSelector({ key: 'profile_name', value: 'julian h1', tenantId: 'Julian' });   // override

    const julian = await store.getSelectors({ tenantId: 'Julian' });
    assert.strictEqual(julian.profile_name.value, 'julian h1');
    assert.strictEqual(julian.profile_name.tenant, 'Julian');

    const guy = await store.getSelectors({ tenantId: 'Guy-Wilson' });
    assert.strictEqual(guy.profile_name.value, 'shared h1', 'other tenants must be untouched');
  });

  await check('a tenant override has its own version chain', async () => {
    reset();
    await store.setSelector({ key: 'profile_name', value: 'shared h1' });
    const a = await store.setSelector({ key: 'profile_name', value: 'j1', tenantId: 'Julian' });
    const b = await store.setSelector({ key: 'profile_name', value: 'j2', tenantId: 'Julian' });
    assert.strictEqual(a.version, 1);
    assert.strictEqual(b.version, 2, 'the tenant chain must not inherit the shared version');
  });

  // --- rollback ----------------------------------------------------------------------------
  await check('retiring a tenant override falls back to the shared row', async () => {
    reset();
    await store.setSelector({ key: 'profile_name', value: 'shared h1' });
    await store.setSelector({ key: 'profile_name', value: 'julian h1', tenantId: 'Julian' });
    await store.retireSelector({ key: 'profile_name', tenantId: 'Julian' });
    const julian = await store.getSelectors({ tenantId: 'Julian' });
    assert.strictEqual(julian.profile_name.value, 'shared h1');
  });

  await check("retiring the shared row leaves the key absent (the extension's default takes over)", async () => {
    reset();
    await store.setSelector({ key: 'profile_name', value: 'shared h1' });
    await store.retireSelector({ key: 'profile_name' });
    const live = await store.getSelectors({ tenantId: 'Guy-Wilson' });
    assert.ok(!('profile_name' in live), 'an absent key is how the built-in default wins');
  });

  // --- no database at all ------------------------------------------------------------------
  await check('no DATABASE_URL returns null, not an empty set (the two mean different things)', async () => {
    store.__setTestPool(null);
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      assert.strictEqual(await store.getSelectors({ tenantId: 'Guy-Wilson' }), null);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  // --- health ------------------------------------------------------------------------------
  await check('health writes record found/missed with the source of each landmark', async () => {
    reset();
    await store.recordHealth({
      tenantId: 'Julian',
      extensionVersion: '0.2.3',
      checks: [
        { key: 'profile_name', surface: 'profile', found: true, source: 'server' },
        { key: 'profile_headline', surface: 'profile', found: false, source: 'default', shape: 'div.foo' },
      ],
    });
    assert.strictEqual(db.health.length, 2);
    assert.strictEqual(db.health[0].source, 'server');
    assert.strictEqual(db.health[1].found, false);
    assert.strictEqual(db.health[1].shape, 'div.foo');
  });

  await check('health ignores landmarks it does not recognise', async () => {
    reset();
    const out = await store.recordHealth({
      tenantId: 'Julian',
      checks: [
        { key: 'profile_name', surface: 'profile', found: true },
        { key: 'something_invented', surface: 'profile', found: false },
      ],
    });
    assert.strictEqual(out.recorded, 1);
    assert.strictEqual(db.health.length, 1);
  });

  await check('an unrecognised surface is filed as "other" rather than dropped', async () => {
    reset();
    await store.recordHealth({ tenantId: 'X', checks: [{ key: 'profile_name', surface: 'wat', found: true }] });
    assert.strictEqual(db.health[0].surface, 'other');
  });

  await check('a health source other than "server" is recorded as "default"', async () => {
    reset();
    await store.recordHealth({ tenantId: 'X', checks: [{ key: 'profile_name', found: true, source: 'nonsense' }] });
    assert.strictEqual(db.health[0].source, 'default');
  });

  // --- the drift check -----------------------------------------------------------------------
  await check('the extension and the store name exactly the same landmarks', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'wingguy-extension', 'content-wingguy.js'), 'utf8'
    );
    const block = src.match(/const SELECTOR_DEFAULTS = \{([\s\S]*?)\n  \};/);
    assert.ok(block, 'SELECTOR_DEFAULTS block not found in content-wingguy.js');
    const extKeys = [...block[1].matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]).sort();
    const storeKeys = [...store.KNOWN_KEYS].sort();
    assert.deepStrictEqual(
      extKeys, storeKeys,
      `landmark lists have drifted.\n  extension: ${extKeys.join(', ')}\n  store:     ${storeKeys.join(', ')}`
    );
  });

  await check('every landmark the extension ships has a non-empty default', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'wingguy-extension', 'content-wingguy.js'), 'utf8'
    );
    const block = src.match(/const SELECTOR_DEFAULTS = \{([\s\S]*?)\n  \};/)[1];
    for (const m of block.matchAll(/^\s{4}([a-z_]+):\s*'([^']*)'/gm)) {
      assert.ok(m[2].trim().length > 0, `${m[1]} ships with an empty default — nothing to fall back to`);
    }
  });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
  process.exit(failures ? 1 : 0);
})();
