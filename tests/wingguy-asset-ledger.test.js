/**
 * Tests for the asset ledger + usage gate (the "check email history before sending anything
 * twice" rules made enforceable — Wingguy records what IT sent instead of reading mailboxes).
 *
 * Covers: detectAssets() ({{asset:key}} resolution + literal-URL detection + retired/unknown
 * handling) · recordAssetSends/getLeadAssetHistory/getAssetSendSummary against an injected
 * in-memory fake pool — no real database. ⚠ Synthetic content only (public repo).
 *
 * Run: node tests/wingguy-asset-ledger.test.js
 */
const assert = require('assert');
const store = require('../services/wingguyRulesStore');
const { detectAssets } = require('../services/wingguyMailMcp');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

// ---------------------------------------------------------------------------
// In-memory fake pool — just the ledger SQL shapes.
// ---------------------------------------------------------------------------
class FakeDb {
  constructor() { this.ledger = []; this.nextId = 1; }
  connect() {
    return Promise.resolve({ query: (sql, params) => this.query(sql, params || []), release() {} });
  }
  async query(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s) || /^CREATE /i.test(s) || /^(DROP|ALTER) /i.test(s)) return { rows: [] };
    if (s.includes('INSERT INTO wingguy_asset_ledger')) {
      const [tenant_id, lead_email, asset_key, draft_id, thread_id, subject] = params;
      this.ledger.push({ id: this.nextId++, sent_at: new Date(2026, 6, this.nextId), tenant_id, lead_email, asset_key, draft_id, thread_id, subject });
      return { rows: [] };
    }
    if (s.includes('FROM wingguy_asset_ledger') && s.includes('GROUP BY')) {
      const [tenant, leads, keys] = params;
      const groups = new Map();
      for (const r of this.ledger) {
        if (r.tenant_id !== tenant || !leads.includes(r.lead_email) || !keys.includes(r.asset_key)) continue;
        const k = `${r.lead_email}|${r.asset_key}`;
        const g = groups.get(k) || { lead_email: r.lead_email, asset_key: r.asset_key, last_sent_at: r.sent_at, times: 0 };
        g.times++; if (r.sent_at > g.last_sent_at) g.last_sent_at = r.sent_at;
        groups.set(k, g);
      }
      return { rows: [...groups.values()] };
    }
    if (s.includes('FROM wingguy_asset_ledger')) {
      const [tenant, lead, cap] = params;
      const rows = this.ledger
        .filter((r) => r.tenant_id === tenant && r.lead_email === lead)
        .sort((a, b) => b.id - a.id)
        .slice(0, cap);
      return { rows };
    }
    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 120)}`);
  }
}

(async () => {
  // --- Pure core: detectAssets ----------------------------------------------
  console.log('detectAssets() — token resolution + literal-URL detection:');
  const lib = [
    { asset_key: 'intro-deck', url: 'https://example.com/deck', status: 'active' },
    { asset_key: 'old-video', url: 'https://example.com/old', status: 'retired' },
    { asset_key: 'signup', url: 'https://example.com/signup', status: 'active' },
  ];
  await check('resolves {{asset:key}} to the stored URL and reports the key', () => {
    const r = detectAssets('<p>See <a href="{{asset:intro-deck}}">the deck</a></p>', lib);
    assert.strictEqual(r.html, '<p>See <a href="https://example.com/deck">the deck</a></p>');
    assert.deepStrictEqual(r.assetKeys, ['intro-deck']);
    assert.deepStrictEqual(r.unresolved, []);
  });
  await check('detects a literal library URL pasted into the body', () => {
    const r = detectAssets('<a href="https://example.com/signup">sign up</a>', lib);
    assert.deepStrictEqual(r.assetKeys, ['signup']);
  });
  await check('a retired asset neither resolves nor matches', () => {
    const r = detectAssets('{{asset:old-video}} and https://example.com/old', lib);
    assert.deepStrictEqual(r.assetKeys, []);
    assert.deepStrictEqual(r.unresolved, ['old-video']);
  });
  await check('an unknown token is reported unresolved, body untouched', () => {
    const r = detectAssets('try {{asset:nope}}', lib);
    assert.ok(r.html.includes('{{asset:nope}}'));
    assert.deepStrictEqual(r.unresolved, ['nope']);
  });
  await check('a non-library URL is ignored', () => {
    const r = detectAssets('<a href="https://elsewhere.com/x">x</a>', lib);
    assert.deepStrictEqual(r.assetKeys, []);
  });
  await check('token + literal of the same asset counts once', () => {
    const r = detectAssets('{{asset:signup}} or https://example.com/signup', lib);
    assert.deepStrictEqual(r.assetKeys, ['signup']);
  });

  // --- Ledger against the fake pool -----------------------------------------
  console.log('asset ledger — record / history / summary:');
  const db = new FakeDb();
  store.__setTestPool(db);

  await check('recordAssetSends writes one row per lead × asset (deduped, lowercased)', async () => {
    const r = await store.recordAssetSends({
      tenantId: 'Test-Tenant',
      leadEmails: ['Lead@Example.com', 'lead@example.com', 'two@example.com'],
      assetKeys: ['intro-deck', 'signup'],
      draftId: 'd1', threadId: 't1', subject: 'Hello',
    });
    assert.strictEqual(r.rows, 4); // 2 unique leads × 2 assets
    assert.strictEqual(db.ledger.length, 4);
    assert.ok(db.ledger.every((x) => x.lead_email === x.lead_email.toLowerCase()));
  });
  await check('getLeadAssetHistory returns the lead\'s rows newest first', async () => {
    await store.recordAssetSends({ tenantId: 'Test-Tenant', leadEmails: ['lead@example.com'], assetKeys: ['signup'], draftId: 'd2', subject: 'Again' });
    const rows = await store.getLeadAssetHistory({ tenantId: 'Test-Tenant', leadEmail: 'LEAD@example.com' });
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].draft_id, 'd2');
  });
  await check('getAssetSendSummary reports only pairs that have rows, with counts', async () => {
    const summary = await store.getAssetSendSummary({
      tenantId: 'Test-Tenant',
      leadEmails: ['lead@example.com', 'fresh@example.com'],
      assetKeys: ['signup', 'intro-deck', 'never-sent'],
    });
    const key = (r) => `${r.lead_email}|${r.asset_key}`;
    const map = new Map(summary.map((r) => [key(r), r]));
    assert.strictEqual(map.get('lead@example.com|signup').times, 2);
    assert.strictEqual(map.get('lead@example.com|intro-deck').times, 1);
    assert.ok(!summary.some((r) => r.lead_email === 'fresh@example.com'));
    assert.ok(!summary.some((r) => r.asset_key === 'never-sent'));
  });
  await check('other tenants\' rows are invisible', async () => {
    const rows = await store.getLeadAssetHistory({ tenantId: 'Other-Tenant', leadEmail: 'lead@example.com' });
    assert.strictEqual(rows.length, 0);
  });
  await check('empty inputs short-circuit without touching the pool', async () => {
    const r = await store.recordAssetSends({ tenantId: 'Test-Tenant', leadEmails: [], assetKeys: ['x'] });
    assert.deepStrictEqual(r, { ok: true, rows: 0 });
    const s = await store.getAssetSendSummary({ tenantId: 'Test-Tenant', leadEmails: ['a@b.c'], assetKeys: [] });
    assert.deepStrictEqual(s, []);
  });

  store.__setTestPool(null);
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
  process.exit(failures ? 1 : 0);
})();
