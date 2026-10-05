/**
 * The "connect your LinkedIn" link and its callback (services/unipileHostedAuth.js) - Reconnect.
 *
 * The one thing that must never happen: a LinkedIn approval being written onto a client's
 * mail-and-calendar connection (their mail would then be read from their LinkedIn account).
 * So this pins that the two links cannot be confused:
 *   - a LinkedIn link offers LinkedIn only and calls back on its own path
 *   - a mail token is refused on the LinkedIn path, and a LinkedIn token on the mail path
 *   - the LinkedIn callback writes exactly two fields and never the mail/calendar ones
 *   - it refuses a non-LinkedIn account and an id that is already the client's mail connection
 * No network, no Airtable. ⚠ Synthetic content only.
 *
 * Run: node tests/linkedin-connect-link.test.js
 */
const assert = require('assert');

process.env.UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || 'test-key-for-signing';
process.env.UNIPILE_DSN = process.env.UNIPILE_DSN || 'api4.unipile.com:13456';
process.env.PUBLIC_BASE_URL = 'https://example.test';
delete process.env.EXTENSION_DIST_SERVER;

const hosted = require('../services/unipileHostedAuth');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const NOW = Date.UTC(2026, 9, 6, 1, 0, 0);
const OK = { status: 'CREATION_SUCCESS', account_id: 'li-acc-1', name: 'Pat-Client' };
const clientService = (extra = {}) => ({ getClientById: async (id) => (id === 'Pat-Client' ? { clientId: id, recordId: 'recPat', unipileAccountId: 'mail-acc-9', ...extra } : null) });
const run = async (token, body, extra = {}) => {
  const writes = [];
  const r = await hosted.handleLinkedinNotify(token, body, {
    now: NOW, clientService: clientService(), updateFields: async (id, f) => writes.push({ id, f }), accountType: async () => 'LINKEDIN', ...extra,
  });
  return { r, writes };
};
const liToken = () => hosted.signNotifyToken('Pat-Client', { now: NOW, purpose: hosted.LINKEDIN_PURPOSE });
const mailToken = () => hosted.signNotifyToken('Pat-Client', { now: NOW });

(async () => {
  console.log('\nThe link');

  await check('offers LinkedIn only and calls back on the LinkedIn path', async () => {
    let captured;
    const r = await hosted.mintHostedLink('Pat-Client', {
      now: NOW, linkedin: true,
      fetch: async (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200, text: async () => JSON.stringify({ url: 'https://account.unipile.com/x' }) }; },
    });
    assert.strictEqual(r.url, 'https://account.unipile.com/x');
    assert.deepStrictEqual(captured.body.providers, ['LINKEDIN']);
    assert.strictEqual(captured.body.name, 'Pat-Client');
    const m = captured.body.notify_url.match(/^https:\/\/example\.test\/api\/unipile\/notify-linkedin\/(.+)$/);
    assert.ok(m, `unexpected notify url ${captured.body.notify_url}`);
    assert.strictEqual(hosted.verifyNotifyToken(m[1], { now: NOW, purpose: hosted.LINKEDIN_PURPOSE }), 'Pat-Client');
  });
  await check('the mail-and-calendar link is unchanged', async () => {
    let captured;
    await hosted.mintHostedLink('Pat-Client', {
      now: NOW,
      fetch: async (url, opts) => { captured = JSON.parse(opts.body); return { ok: true, status: 200, text: async () => JSON.stringify({ url: 'https://account.unipile.com/y' }) }; },
    });
    assert.deepStrictEqual(captured.providers, ['GOOGLE', 'OUTLOOK']);
    assert.ok(/\/api\/unipile\/notify\/[^/]+$/.test(captured.notify_url));
  });

  console.log('\nThe tokens cannot be swapped');

  await check('a mail token is refused as a LinkedIn token, and the other way round', () => {
    assert.strictEqual(hosted.verifyNotifyToken(mailToken(), { now: NOW, purpose: hosted.LINKEDIN_PURPOSE }), null);
    assert.strictEqual(hosted.verifyNotifyToken(liToken(), { now: NOW }), null);
    assert.strictEqual(hosted.verifyNotifyToken(mailToken(), { now: NOW }), 'Pat-Client');
  });
  await check('a LinkedIn approval sent to the MAIL handler writes nothing', async () => {
    const writes = [];
    const r = await hosted.handleNotify(liToken(), OK, { now: NOW, clientService: clientService(), updateFields: async (id, f) => writes.push(f) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(writes.length, 0);
  });
  await check('a mail approval sent to the LINKEDIN handler writes nothing', async () => {
    const { r, writes } = await run(mailToken(), OK);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(writes.length, 0);
  });

  console.log('\nThe callback');

  await check('writes the LinkedIn account id and connected date - and nothing else', async () => {
    const { r, writes } = await run(liToken(), OK);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].id, 'recPat');
    assert.deepStrictEqual(writes[0].f, { 'Unipile LinkedIn Account ID': 'li-acc-1', 'LinkedIn Connected At': new Date(NOW).toISOString() });
    for (const k of ['Unipile Account ID', 'Calendar Provider', 'Email Provider', 'Calendar Read IDs']) assert.ok(!(k in writes[0].f), `must not write ${k}`);
  });
  await check('refuses an account that is not LinkedIn', async () => {
    const { r, writes } = await run(liToken(), OK, { accountType: async () => 'GOOGLE_OAUTH' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(writes.length, 0);
  });
  await check('refuses an id that is already the client\'s mail-and-calendar connection', async () => {
    const { r, writes } = await run(liToken(), { ...OK, account_id: 'mail-acc-9' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(writes.length, 0);
  });
  await check('ignores a wrong status, a missing id, another client\'s name, an expired token', async () => {
    for (const body of [{ ...OK, status: 'CREATION_FAIL' }, { ...OK, account_id: '' }, { ...OK, name: 'Someone-Else' }]) {
      const { r, writes } = await run(liToken(), body);
      assert.strictEqual(r.ok, false);
      assert.strictEqual(writes.length, 0);
    }
    const writes = [];
    const late = await hosted.handleLinkedinNotify(liToken(), OK, { now: NOW + hosted.NOTIFY_TTL_MS + 1000, clientService: clientService(), updateFields: async (id, f) => writes.push(f), accountType: async () => 'LINKEDIN' });
    assert.strictEqual(late.ok, false);
    assert.strictEqual(writes.length, 0);
  });
  await check('an unreadable account type is let through (the id is still recorded)', async () => {
    const { r, writes } = await run(liToken(), OK, { accountType: async () => '' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(writes.length, 1);
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
