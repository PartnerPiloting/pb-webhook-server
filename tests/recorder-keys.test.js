/**
 * Tests for the recorder key self-service (services/recorderKeys.js) - Fathom, Granola, Fireflies.
 * Covers: each probe sends the key the way that recorder wants it and reads the newest recording;
 * 401/403 = rejected, 429/5xx/network = transient; Fireflies' HTTP-200 auth error is caught;
 * Granola registration returns the once-shown secret; the Fireflies secret fits Fireflies' limit;
 * connecting one recorder clears the others; which recorder a client is on; mask and shape check.
 * No network. ⚠ Synthetic content only.
 *
 * Run: node tests/recorder-keys.test.js
 */
const assert = require('assert');
const rk = require('../services/recorderKeys');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const KEY = 'abcdefghijklmnop1234';

(async () => {
  console.log('probes');
  await check('fathom: X-Api-Key, newest meeting only, newest recording returned', async () => {
    let seen;
    const r = await rk.probe('fathom', ` ${KEY} `, { fetchImpl: async (url, opts) => { seen = { url, opts }; return reply(200, { items: [{ title: 'Catch-up with Pat', recording_start_time: '2026-10-03T01:00:00Z' }] })(); } });
    assert.deepStrictEqual(r, { ok: true, lastRecording: { title: 'Catch-up with Pat', at: '2026-10-03T01:00:00Z' } });
    assert.strictEqual(seen.opts.headers['X-Api-Key'], KEY);
    assert.ok(seen.url.includes('/meetings') && seen.url.includes('limit=1'));
  });
  await check('fathom: empty account -> ok, no recording yet', async () => {
    assert.deepStrictEqual(await rk.probe('fathom', KEY, { fetchImpl: reply(200, { items: [] }) }), { ok: true, lastRecording: null });
  });
  await check('granola: Bearer key on the webhook list', async () => {
    let seen;
    const r = await rk.probe('granola', KEY, { fetchImpl: async (url, opts) => { seen = { url, opts }; return reply(200, { data: [] })(); } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(seen.opts.headers.Authorization, `Bearer ${KEY}`);
    assert.ok(seen.url.endsWith('/webhook-endpoints'));
  });
  await check('fireflies: GraphQL with Bearer key, newest transcript returned', async () => {
    let seen;
    const r = await rk.probe('fireflies', KEY, { fetchImpl: async (url, opts) => { seen = opts; return reply(200, { data: { user: { email: 'pat@example.com' }, transcripts: [{ title: 'Pat intro', date: Date.UTC(2026, 9, 2) }] } })(); } });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.lastRecording, { title: 'Pat intro', at: '2026-10-02T00:00:00.000Z' });
    assert.strictEqual(seen.headers.Authorization, `Bearer ${KEY}`);
    assert.ok(JSON.parse(seen.body).query.includes('user'));
  });
  await check('fireflies: a bad key answered with HTTP 200 + auth error -> rejected', async () => {
    const r = await rk.probe('fireflies', KEY, { fetchImpl: reply(200, { errors: [{ message: 'Invalid API key', extensions: { code: 'invalid_auth' } }] }) });
    assert.strictEqual(r.reason, 'rejected');
  });
  await check('401/403 -> rejected; 429, 5xx, network -> transient; other -> error (every recorder)', async () => {
    for (const p of ['fathom', 'granola', 'fireflies']) {
      assert.strictEqual((await rk.probe(p, KEY, { fetchImpl: reply(401, {}) })).reason, 'rejected', p);
      assert.strictEqual((await rk.probe(p, KEY, { fetchImpl: reply(403, {}) })).reason, 'rejected', p);
      assert.strictEqual((await rk.probe(p, KEY, { fetchImpl: reply(429, {}) })).reason, 'transient', p);
      assert.strictEqual((await rk.probe(p, KEY, { fetchImpl: reply(503, {}) })).reason, 'transient', p);
      assert.strictEqual((await rk.probe(p, KEY, { fetchImpl: async () => { throw new Error('ECONNRESET'); } })).reason, 'transient', p);
      assert.strictEqual((await rk.probe(p, KEY, { fetchImpl: reply(404, {}) })).reason, 'error', p);
    }
  });

  console.log('the extra step');
  await check('granola registration: our per-client URL, both note events, returns the secret', async () => {
    let body;
    const r = await rk.registerGranolaWebhook(KEY, 'Pat-Client', { fetchImpl: async (url, opts) => { body = JSON.parse(opts.body); return reply(201, { id: 'wh1', signing_secret: 'whsec_123' })(); } });
    assert.deepStrictEqual(r, { ok: true, secret: 'whsec_123' });
    assert.ok(body.url.endsWith('/webhooks/granola/Pat-Client'));
    assert.deepStrictEqual(body.events, ['note.generated', 'note.regenerated']);
  });
  await check('granola registration refused (no Business plan) -> not ok, no secret', async () => {
    const r = await rk.registerGranolaWebhook(KEY, 'Pat-Client', { fetchImpl: reply(403, { message: 'plan' }) });
    assert.strictEqual(r.ok, false);
    assert.ok(!r.secret);
  });
  await check('the fireflies secret is 32 letters and digits, different each time', () => {
    const a = rk.mintFirefliesSecret(); const b = rk.mintFirefliesSecret();
    assert.ok(/^[A-Za-z0-9]{32}$/.test(a), a);
    assert.notStrictEqual(a, b);
  });

  console.log('the record');
  await check('connecting granola sets the provider, key and secret - and clears fathom and fireflies', () => {
    const f = rk.connectFields('granola', KEY, 'whsec_123');
    assert.strictEqual(f['Transcript Provider'], 'Granola');
    assert.strictEqual(f['Granola API Key'], KEY);
    assert.strictEqual(f['Granola Webhook Secret'], 'whsec_123');
    assert.strictEqual(f['Fathom API Key'], '');
    assert.strictEqual(f['Fireflies API Key'], '');
    assert.strictEqual(f['Fireflies Webhook Secret'], '');
  });
  await check('disconnecting touches only that recorder', () => {
    assert.deepStrictEqual(rk.disconnectFields('fathom'), { 'Fathom API Key': '' });
    assert.deepStrictEqual(rk.disconnectFields('fireflies'), { 'Fireflies API Key': '', 'Fireflies Webhook Secret': '' });
  });
  await check('which recorder: the provider field, else the key they hold, else fathom', () => {
    assert.strictEqual(rk.currentProvider({ transcriptProvider: 'Fireflies' }), 'fireflies');
    assert.strictEqual(rk.currentProvider({ granolaApiKey: KEY }), 'granola');
    assert.strictEqual(rk.currentProvider({}), 'fathom');
    assert.strictEqual(rk.currentProvider({ transcriptProvider: 'Zoom' }), 'fathom');
  });
  await check('mask shows only the last four; shape check refuses sentences and short pastes', () => {
    assert.strictEqual(rk.maskKey(KEY), '…1234');
    assert.strictEqual(rk.maskKey(''), '');
    assert.strictEqual(rk.looksLikeKey(KEY), true);
    assert.strictEqual(rk.looksLikeKey('short'), false);
    assert.strictEqual(rk.looksLikeKey('here is my key abcdefghijklmnop'), false);
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
