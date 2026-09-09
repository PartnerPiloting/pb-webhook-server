/**
 * Tests for the Wingguy monitor's landmark alert rules (services/wingguyMonitor.js).
 *
 * The rules are pure (pickLandmarkFindings takes the per-tenant/version slices the SQL produces),
 * so this needs no database. What it pins down:
 *
 *   - the 2026-09-09 false alarm cannot recur: an OPTIONAL landmark (SOFT_KEYS) missing for one
 *     client with nothing found — Julian on three brand-new "new message" threads — is not a finding;
 *   - a hard landmark missing for one client still is;
 *   - the cross-tenant "zero finds anywhere" rule still fires for hard landmarks spread thin, and for
 *     soft landmarks only when two or more machines are blind;
 *   - SOFT_KEYS in the store is the same list as the `soft: true` entries of SELF_CHECK_PLAN in the
 *     extension. If they drift, either a real rename on a newly-soft landmark goes unalerted, or a
 *     newly-hard one goes back to crying wolf.
 *
 * Run: node tests/wingguy-monitor.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { pickLandmarkFindings } = require('../services/wingguyMonitor');
const { SOFT_KEYS, KNOWN_KEYS } = require('../services/wingguySelectorStore');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const slice = (selector_key, tenant, misses, founds, extra = {}) => ({
  selector_key, tenant, surface: 'messaging', version: '0.3.17',
  misses: String(misses), founds: String(founds), retried: '0',
  first_miss: misses ? '2026-09-08T23:02:45.450Z' : null,
  last_miss: misses ? '2026-09-08T23:06:54.803Z' : null,
  ...extra,
});

(async () => {
  console.log('wingguy-monitor: landmark alert rules');

  await check('the 2026-09-09 alarm: soft landmarks missed 3/3 by one client, found by another → nothing', () => {
    const rows = [
      slice('message_body', 'Julian-Davis', 3, 0),
      slice('message_group_name', 'Julian-Davis', 3, 0),
      slice('message_body', 'Guy-Wilson', 0, 21, { version: '0.3.19' }),
      slice('message_group_name', 'Guy-Wilson', 0, 21, { version: '0.3.19' }),
      slice('composer_box', 'Julian-Davis', 0, 3),
      slice('convo_container', 'Julian-Davis', 0, 3),
    ];
    assert.deepStrictEqual(pickLandmarkFindings(rows), []);
  });

  await check('a soft landmark missed by ONE client with no finds anywhere → still nothing (one quiet day on new threads)', () => {
    const rows = [slice('message_body', 'Julian-Davis', 5, 0)];
    assert.deepStrictEqual(pickLandmarkFindings(rows), []);
  });

  await check('a soft landmark with zero finds anywhere and 2+ machines blind → cross-tenant finding', () => {
    const rows = [slice('message_body', 'Julian-Davis', 2, 0), slice('message_body', 'Dean-Hobin', 2, 0, { version: '0.3.18' })];
    const out = pickLandmarkFindings(rows);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].tenant, '(all tenants)');
    assert.strictEqual(out[0].misses, 4);
    assert.match(out[0].note, /optional landmark/);
    assert.strictEqual(out[0].tenants, 'Julian-Davis, Dean-Hobin');
  });

  await check('a hard landmark missed 3/3 by one client → per-tenant finding, even when others find it', () => {
    const rows = [slice('convo_header', 'Julian-Davis', 3, 0), slice('convo_header', 'Guy-Wilson', 0, 21)];
    const out = pickLandmarkFindings(rows);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].tenant, 'Julian-Davis');
    assert.strictEqual(out[0].selector_key, 'convo_header');
  });

  await check('a hard landmark under the per-tenant bar but dead everywhere → cross-tenant finding', () => {
    const rows = [slice('profile_name', 'A', 2, 0, { surface: 'profile' }), slice('profile_name', 'B', 1, 0, { surface: 'profile', version: '0.3.19' })];
    const out = pickLandmarkFindings(rows);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].tenant, '(all tenants)');
    assert.match(out[0].note, /strongest/);
    assert.strictEqual(out[0].versions, '0.3.17, 0.3.19');
  });

  await check('a hard landmark that is mostly found is below the miss-rate bar → nothing', () => {
    const rows = [slice('convo_header', 'Guy-Wilson', 3, 20)];
    assert.deepStrictEqual(pickLandmarkFindings(rows), []);
  });

  await check('thresholds are overridable (the env knobs)', () => {
    const rows = [slice('convo_header', 'Guy-Wilson', 2, 0)];
    assert.strictEqual(pickLandmarkFindings(rows).length, 0);
    assert.strictEqual(pickLandmarkFindings(rows, { missMin: 2 }).length, 1);
  });

  await check('every SOFT_KEY is a KNOWN_KEY', () => {
    const unknown = SOFT_KEYS.filter((k) => !KNOWN_KEYS.includes(k));
    assert.deepStrictEqual(unknown, [], `not in KNOWN_KEYS: ${unknown.join(', ')}`);
  });

  await check('SOFT_KEYS matches the soft entries of SELF_CHECK_PLAN in the extension', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'wingguy-extension', 'content-wingguy.js'), 'utf8');
    const start = src.indexOf('const SELF_CHECK_PLAN = {');
    assert.ok(start > 0, 'SELF_CHECK_PLAN not found in content-wingguy.js');
    const end = src.indexOf('\n  };', start);
    const block = src.slice(start, end);
    const softInExtension = [];
    for (const m of block.matchAll(/\{\s*key:\s*'([a-z_]+)'([^}]*)\}/g)) {
      if (/\bsoft:\s*true\b/.test(m[2])) softInExtension.push(m[1]);
    }
    assert.ok(softInExtension.length > 0, 'no soft entries parsed from SELF_CHECK_PLAN');
    assert.deepStrictEqual([...SOFT_KEYS].sort(), [...new Set(softInExtension)].sort());
  });

  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
})();
