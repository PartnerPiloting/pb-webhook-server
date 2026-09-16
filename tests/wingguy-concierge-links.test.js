/**
 * The concierge sheet's minted links and the Unipile connect callback.
 *
 * Why this exists: the sheet exists so the coach never assembles a line by hand in front of a
 * client's screen. Every line it prints has a shape that was learned on a real machine (token
 * as a header, PowerShell-native, -File not -Command), and the Unipile callback writes provider
 * fields onto a client's row on the strength of a signed URL. Both must stay exactly right:
 *   - the install lines are byte-identical to what scripts/extension-install-command.js printed
 *     before the builder was shared (pinned here so the two can never drift)
 *   - the notify token is bound to one client, expires, and refuses tampering
 *   - the callback sets exactly the five fields step 2 of the checklist prescribes, and ignores
 *     anything else Unipile might send (wrong status, mismatched name, missing account id)
 *
 * Run: node tests/wingguy-concierge-links.test.js
 */
const assert = require('assert');

process.env.UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || 'test-key-for-signing';
process.env.UNIPILE_DSN = process.env.UNIPILE_DSN || 'api4.unipile.com:13456';
process.env.PUBLIC_BASE_URL = 'https://example.test';
delete process.env.EXTENSION_DIST_SERVER;

const { buildInstallCommands } = require('../services/extensionInstallCommand');
const hosted = require('../services/unipileHostedAuth');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

(async () => {
  console.log('\nInstall lines');

  await check('windows line is PowerShell-native with the token as a header, never in the URL', () => {
    const { windows } = buildInstallCommands('AbC123token');
    assert.strictEqual(windows,
      "$t='AbC123token'; $p=Join-Path $env:TEMP 'wg.ps1'; " +
      "Invoke-WebRequest -Uri 'https://pb-webhook-server.onrender.com/extension/dist/installer' -Headers @{'x-portal-token'=$t} -OutFile $p -UseBasicParsing; " +
      "& powershell.exe -ExecutionPolicy Bypass -File $p -Install -Server 'https://pb-webhook-server.onrender.com' -Token $t");
    assert.ok(!windows.includes('powershell -Command'), 'no -Command wrapper');
    assert.ok(!windows.includes('Set-ExecutionPolicy'), 'bypass rides with the child, not the pasted line');
    assert.ok(!/installer\?.*token/i.test(windows), 'token must not appear in the URL');
  });

  await check('mac line matches the proven shape', () => {
    const { mac } = buildInstallCommands('AbC123token');
    assert.strictEqual(mac,
      "T='AbC123token'; curl -sS -H \"x-portal-token: $T\" 'https://pb-webhook-server.onrender.com/extension/dist/installer.sh' -o /tmp/wg.sh && " +
      "bash /tmp/wg.sh --install --server 'https://pb-webhook-server.onrender.com' --token \"$T\"");
  });

  await check('server override drops a trailing slash', () => {
    const { server, windows } = buildInstallCommands('tok', { server: 'https://staging.example/' });
    assert.strictEqual(server, 'https://staging.example');
    assert.ok(windows.includes("-Uri 'https://staging.example/extension/dist/installer'"));
  });

  await check('refuses a blank token or one that would break the quoting', () => {
    assert.throws(() => buildInstallCommands(''), /no portal token/);
    assert.throws(() => buildInstallCommands("a'b"), /quote or whitespace/);
    assert.throws(() => buildInstallCommands('a b'), /quote or whitespace/);
  });

  console.log('\nNotify token');

  await check('round-trips to the same client id', () => {
    const t = hosted.signNotifyToken('Alex-Solti', { now: 1000 });
    assert.strictEqual(hosted.verifyNotifyToken(t, { now: 2000 }), 'Alex-Solti');
  });

  await check('expires after NOTIFY_TTL_MS', () => {
    const t = hosted.signNotifyToken('Alex-Solti', { now: 1000 });
    assert.strictEqual(hosted.verifyNotifyToken(t, { now: 1000 + hosted.NOTIFY_TTL_MS + 1 }), null);
  });

  await check('refuses tampering with the client id, the expiry or the signature', () => {
    const t = hosted.signNotifyToken('Alex-Solti', { now: 1000 });
    const [cid, exp, sig] = Buffer.from(t, 'base64url').toString('utf8').split('.');
    const forge = (a, b, c) => Buffer.from(`${a}.${b}.${c}`).toString('base64url');
    assert.strictEqual(hosted.verifyNotifyToken(forge('Dean-Hobin', exp, sig), { now: 2000 }), null, 'client id');
    assert.strictEqual(hosted.verifyNotifyToken(forge(cid, Number(exp) + 99999, sig), { now: 2000 }), null, 'expiry');
    assert.strictEqual(hosted.verifyNotifyToken(forge(cid, exp, sig.replace(/^./, (ch) => (ch === 'a' ? 'b' : 'a'))), { now: 2000 }), null, 'signature');
    assert.strictEqual(hosted.verifyNotifyToken('not-a-token', { now: 2000 }), null);
    assert.strictEqual(hosted.verifyNotifyToken('', { now: 2000 }), null);
  });

  await check('signed with a different key does not verify', () => {
    const t = hosted.signNotifyToken('Alex-Solti', { now: 1000, key: 'other' });
    assert.strictEqual(hosted.verifyNotifyToken(t, { now: 2000 }), null);
  });

  console.log('\nHosted link request');

  await check('sends the documented body: create, both providers, our api_url, name = client id, notify_url signed for that client', async () => {
    let captured = null;
    const fakeFetch = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, text: async () => JSON.stringify({ object: 'HostedAuthUrl', url: 'https://account.unipile.com/x' }) };
    };
    const r = await hosted.mintHostedLink('Alex-Solti', { fetch: fakeFetch, now: 1000 });
    assert.strictEqual(r.url, 'https://account.unipile.com/x');
    assert.strictEqual(captured.url, 'https://api4.unipile.com:13456/api/v1/hosted/accounts/link');
    assert.strictEqual(captured.init.method, 'POST');
    assert.strictEqual(captured.init.headers['X-API-KEY'], process.env.UNIPILE_API_KEY);
    const body = JSON.parse(captured.init.body);
    assert.strictEqual(body.type, 'create');
    assert.deepStrictEqual(body.providers, ['GOOGLE', 'OUTLOOK']);
    assert.strictEqual(body.api_url, 'https://api4.unipile.com:13456');
    assert.strictEqual(body.name, 'Alex-Solti');
    assert.strictEqual(body.expiresOn, new Date(1000 + hosted.LINK_TTL_MS).toISOString());
    assert.strictEqual(r.expiresAt, body.expiresOn);
    const m = body.notify_url.match(/^https:\/\/example\.test\/api\/unipile\/notify\/([A-Za-z0-9_-]+)$/);
    assert.ok(m, `notify_url shape: ${body.notify_url}`);
    assert.strictEqual(hosted.verifyNotifyToken(m[1], { now: 2000 }), 'Alex-Solti');
  });

  await check('a refusal from Unipile surfaces as an error with the status', async () => {
    const fakeFetch = async () => ({ ok: false, status: 401, text: async () => '{"detail":"bad key"}' });
    await assert.rejects(hosted.mintHostedLink('Alex-Solti', { fetch: fakeFetch }), /HTTP 401/);
  });

  console.log('\nNotify callback');

  const fakeClientService = { getClientById: async (id) => (id === 'Alex-Solti' ? { clientId: id, id: 'recALEX' } : null) };

  await check('a CREATION_SUCCESS for the right client writes exactly the step-2 fields', async () => {
    const t = hosted.signNotifyToken('Alex-Solti', { now: 1000 });
    const writes = [];
    const r = await hosted.handleNotify(t, { status: 'CREATION_SUCCESS', account_id: 'acc_123', name: 'Alex-Solti' }, {
      now: 2000, clientService: fakeClientService, updateFields: async (rec, fields) => writes.push({ rec, fields }),
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].rec, 'recALEX');
    assert.deepStrictEqual(writes[0].fields, {
      'Unipile Account ID': 'acc_123',
      'Calendar Provider': 'unipile',
      'Email Provider': 'unipile',
      'Calendar Read IDs': 'all',
      'Calendar Email': null,
    });
  });

  await check('RECONNECTED is accepted too', async () => {
    const t = hosted.signNotifyToken('Alex-Solti', { now: 1000 });
    const writes = [];
    const r = await hosted.handleNotify(t, { status: 'RECONNECTED', account_id: 'acc_456' }, {
      now: 2000, clientService: fakeClientService, updateFields: async (rec, fields) => writes.push({ rec, fields }),
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(writes[0].fields['Unipile Account ID'], 'acc_456');
  });

  await check('ignores a bad token, a wrong status, a missing account id, and a name for another client - writing nothing', async () => {
    const t = hosted.signNotifyToken('Alex-Solti', { now: 1000 });
    const writes = [];
    const deps = { now: 2000, clientService: fakeClientService, updateFields: async (rec, fields) => writes.push({ rec, fields }) };
    assert.strictEqual((await hosted.handleNotify('garbage', { status: 'CREATION_SUCCESS', account_id: 'x' }, deps)).ok, false);
    assert.strictEqual((await hosted.handleNotify(t, { status: 'CREATION_FAILED', account_id: 'x' }, deps)).ok, false);
    assert.strictEqual((await hosted.handleNotify(t, { status: 'CREATION_SUCCESS' }, deps)).ok, false);
    assert.strictEqual((await hosted.handleNotify(t, { status: 'CREATION_SUCCESS', account_id: 'x', name: 'Dean-Hobin' }, deps)).ok, false);
    assert.strictEqual(writes.length, 0);
  });

  await check('an unknown client id in a valid token writes nothing', async () => {
    const t = hosted.signNotifyToken('Nobody-Here', { now: 1000 });
    const writes = [];
    const r = await hosted.handleNotify(t, { status: 'CREATION_SUCCESS', account_id: 'x' }, {
      now: 2000, clientService: fakeClientService, updateFields: async (rec, fields) => writes.push({ rec, fields }),
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(writes.length, 0);
  });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
