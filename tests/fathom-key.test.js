/**
 * Tests for the Fathom key self-service checker (services/fathomKey.js).
 * Covers: the key is sent as X-Api-Key to the newest-meeting call; 401/403 = rejected; 429/5xx and
 * network failure = transient; the newest recording is returned as proof (or null for an empty
 * account); the mask shows only the last four; the shape check refuses obvious mis-pastes.
 * No network. ⚠ Synthetic content only.
 *
 * Run: node tests/fathom-key.test.js
 */
const assert = require('assert');
const fk = require('../services/fathomKey');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

(async () => {
  await check('a good key: sent as X-Api-Key, newest meeting only, newest recording returned', async () => {
    let seen;
    const r = await fk.probeFathomKey(' abcdefghijklmnop1234 ', { fetchImpl: async (url, opts) => { seen = { url, opts }; return reply(200, { items: [{ title: 'Catch-up with Pat', recording_start_time: '2026-10-03T01:00:00Z' }] })(); } });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.lastRecording, { title: 'Catch-up with Pat', at: '2026-10-03T01:00:00Z' });
    assert.strictEqual(seen.opts.headers['X-Api-Key'], 'abcdefghijklmnop1234');
    assert.ok(seen.url.includes('/meetings') && seen.url.includes('limit=1'));
  });
  await check('a good key on an empty account -> ok, no recording yet', async () => {
    const r = await fk.probeFathomKey('abcdefghijklmnop1234', { fetchImpl: reply(200, { items: [] }) });
    assert.deepStrictEqual(r, { ok: true, lastRecording: null });
  });
  await check('401 and 403 -> rejected', async () => {
    assert.strictEqual((await fk.probeFathomKey('k'.repeat(20), { fetchImpl: reply(401, {}) })).reason, 'rejected');
    assert.strictEqual((await fk.probeFathomKey('k'.repeat(20), { fetchImpl: reply(403, {}) })).reason, 'rejected');
  });
  await check('429, 5xx and a network failure -> transient, never throws', async () => {
    assert.strictEqual((await fk.probeFathomKey('k'.repeat(20), { fetchImpl: reply(429, {}) })).reason, 'transient');
    assert.strictEqual((await fk.probeFathomKey('k'.repeat(20), { fetchImpl: reply(503, {}) })).reason, 'transient');
    assert.strictEqual((await fk.probeFathomKey('k'.repeat(20), { fetchImpl: async () => { throw new Error('ECONNRESET'); } })).reason, 'transient');
  });
  await check('any other failure -> error with the status', async () => {
    assert.deepStrictEqual(await fk.probeFathomKey('k'.repeat(20), { fetchImpl: reply(404, {}) }), { ok: false, reason: 'error', status: 404 });
  });
  await check('the mask shows only the last four; blank stays blank', () => {
    assert.strictEqual(fk.maskFathomKey('abcdefghijklmnop1234'), '…1234');
    assert.strictEqual(fk.maskFathomKey(''), '');
  });
  await check('the shape check refuses spaces, short pastes and whole sentences', () => {
    assert.strictEqual(fk.looksLikeFathomKey('abcdefghijklmnop1234'), true);
    assert.strictEqual(fk.looksLikeFathomKey('short'), false);
    assert.strictEqual(fk.looksLikeFathomKey('here is my key abcdefghijklmnop'), false);
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
