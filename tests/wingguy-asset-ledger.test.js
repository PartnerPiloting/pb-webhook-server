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
const { detectAssets, findRetiredUrls, findLeftoverPlaceholders } = require('../services/wingguyMailMcp');

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
  // --- Placeholder guard: nothing templated past the door (2026-08-18) ------
  console.log('\nfindLeftoverPlaceholders() — template goo must not reach a mailbox:');
  await check('a clean body has no leftovers', () =>
    assert.deepStrictEqual(findLeftoverPlaceholders('<p>Talk soon,<br>Guy</p>'), []));
  await check('a literal {{signoff}} is caught', () =>
    assert.deepStrictEqual(findLeftoverPlaceholders('Talk soon,<br>{{signoff}}'), ['{{signoff}}']));
  await check('a resolved asset body passes; an unrelated variable in the same body is still caught', () => {
    const r = detectAssets('see {{asset:intro-deck}} — {{first_name}}', lib);
    assert.deepStrictEqual(r.unresolved, []); // the asset itself resolved fine
    assert.deepStrictEqual(findLeftoverPlaceholders(r.html), ['{{first_name}}']);
  });
  await check('duplicates report once', () =>
    assert.deepStrictEqual(findLeftoverPlaceholders('{{x}} and {{x}}'), ['{{x}}']));
  await check('optional-style {{?core_framing}} is caught too (rules syntax never belongs in a body)', () =>
    assert.deepStrictEqual(findLeftoverPlaceholders('a {{?core_framing}} b'), ['{{?core_framing}}']));

  await check('a non-library URL is ignored', () => {
    const r = detectAssets('<a href="https://elsewhere.com/x">x</a>', lib);
    assert.deepStrictEqual(r.assetKeys, []);
  });
  await check('token + literal of the same asset counts once', () => {
    const r = detectAssets('{{asset:signup}} or https://example.com/signup', lib);
    assert.deepStrictEqual(r.assetKeys, ['signup']);
  });

  // URL TWINS + PREFIXES (the 2026-07-17 live find: drafting cost_benefit_page also logged
  // signup_link, because both keys share one URL and the literal scan ran over the RESOLVED body,
  // where the token's own expansion matched its twin). The ledger's unit is the KEY.
  const twins = [
    { asset_key: 'cost_benefit_page', url: 'https://ash.com.au/benefits-page-v1/', status: 'active' },
    { asset_key: 'signup_link', url: 'https://ash.com.au/benefits-page-v1/', status: 'active' },
    { asset_key: 'pricing', url: 'https://ash.com.au/benefits-page-v1/pricing', status: 'active' },
    { asset_key: 'home', url: 'https://ash.com.au/', status: 'active' },
  ];
  await check('a token resolving to a shared URL logs ONLY the key referenced, not its twin', () => {
    const r = detectAssets('<a href="{{asset:cost_benefit_page}}">benefits</a>', twins);
    assert.deepStrictEqual(r.assetKeys, ['cost_benefit_page']);
  });
  await check('the twin token logs only itself too (symmetry)', () => {
    const r = detectAssets('<a href="{{asset:signup_link}}">join</a>', twins);
    assert.deepStrictEqual(r.assetKeys, ['signup_link']);
  });
  await check('a LITERAL shared URL is ambiguous — both twins log (no token said which)', () => {
    const r = detectAssets('<a href="https://ash.com.au/benefits-page-v1/">benefits</a>', twins);
    assert.deepStrictEqual(r.assetKeys.sort(), ['cost_benefit_page', 'signup_link']);
  });
  await check('a longer URL does not match the shorter asset it starts with', () => {
    const r = detectAssets('<a href="{{asset:pricing}}">pricing</a>', twins);
    assert.deepStrictEqual(r.assetKeys, ['pricing']);
  });
  await check('a bare-domain asset does not match every deeper URL', () => {
    const r = detectAssets('<a href="https://ash.com.au/benefits-page-v1/pricing">p</a>', twins);
    assert.ok(!r.assetKeys.includes('home'), `home should not match: ${r.assetKeys}`);
  });
  await check('a bare-domain asset still matches its own exact URL', () => {
    const r = detectAssets('<a href="https://ash.com.au/">home</a>', twins);
    assert.ok(r.assetKeys.includes('home'));
  });

  // RETIRED URLS ARE DEAD LINKS (2026-09-15: the old Australian Side Hustles benefits page was
  // still going out as the join link months after everything else moved to knowaguy.com.au).
  // Retiring a key stopped the token resolving but did nothing about the URL, which kept being
  // typed out literally from old mail and memory. findRetiredUrls is what makes retiring bite.
  console.log('retired links - the dead-link refusal:');
  const withDead = [
    { asset_key: 'signup_link', url: 'https://knowaguy.com.au/join', status: 'active' },
    { asset_key: 'retired_ash_signup_link', url: 'https://australiansidehustles.com.au/benefits-page-v1/', status: 'retired' },
    { asset_key: 'home', url: 'https://knowaguy.com.au/', status: 'active' },
  ];
  await check('a retired URL pasted literally is caught', () => {
    const hits = findRetiredUrls('<a href="https://australiansidehustles.com.au/benefits-page-v1/">Join here</a>', withDead);
    assert.deepStrictEqual(hits.map((h) => h.assetKey), ['retired_ash_signup_link']);
  });
  await check('the live replacement passes clean', () => {
    assert.deepStrictEqual(findRetiredUrls('<a href="https://knowaguy.com.au/join">Join here</a>', withDead), []);
  });
  await check('the token form of the live key passes clean too', () => {
    assert.deepStrictEqual(findRetiredUrls('<a href="{{asset:signup_link}}">Join here</a>', withDead), []);
  });
  await check('a retired URL still logs nothing in the ledger (detectAssets is unchanged)', () => {
    const r = detectAssets('<a href="https://australiansidehustles.com.au/benefits-page-v1/">x</a>', withDead);
    assert.deepStrictEqual(r.assetKeys, []);
  });
  await check('a longer path under a retired URL is not the retired link', () => {
    assert.deepStrictEqual(findRetiredUrls('https://australiansidehustles.com.au/benefits-page-v1/pricing', withDead), []);
  });
  await check('an active row sharing the URL wins - the same address is not dead', () => {
    const shared = [
      { asset_key: 'old_key', url: 'https://knowaguy.com.au/the-numbers', status: 'retired' },
      { asset_key: 'cost_benefit_page', url: 'https://knowaguy.com.au/the-numbers', status: 'active' },
    ];
    assert.deepStrictEqual(findRetiredUrls('see https://knowaguy.com.au/the-numbers', shared), []);
  });
  await check('a retired row with no URL is harmless', () => {
    assert.deepStrictEqual(findRetiredUrls('anything', [{ asset_key: 'k', url: null, status: 'retired' }]), []);
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
