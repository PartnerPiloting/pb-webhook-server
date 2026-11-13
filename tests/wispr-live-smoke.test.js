/**
 * LIVE, read-only smoke test for the Wispr Flow feed - 13 Nov 2026.
 *
 * Touches the real internet and nothing else: it reads Wispr's public sign-in settings and knocks
 * on the connector WITHOUT a pass. It proves the addresses and the sign-in method the feed was
 * built on (services/wisprConfig.js, services/wisprAuth.js) still look the way they did on the day
 * it was proven. It signs in to nothing, uses no token, and changes nothing.
 *
 * Run it when a Wispr connection starts failing for everyone at once, or before connecting a new
 * client:   node tests/wispr-live-smoke.test.js
 *
 * Not part of any offline test run - it needs the network.
 */
const assert = require('assert');
const cfg = require('../services/wisprConfig');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

(async () => {
  console.log('Wispr sign-in server (public settings)');
  let meta = {};
  await check('publishes its settings', async () => {
    const res = await fetch(`${cfg.AUTH_BASE}/.well-known/oauth-authorization-server`);
    assert.strictEqual(res.status, 200);
    meta = await res.json();
    assert.strictEqual(meta.issuer, cfg.AUTH_BASE);
  });
  await check('the three addresses the feed uses are the ones it publishes', async () => {
    assert.strictEqual(meta.authorization_endpoint, cfg.AUTHORIZE_URL);
    assert.strictEqual(meta.token_endpoint, cfg.TOKEN_URL);
    assert.strictEqual(meta.registration_endpoint, cfg.REGISTER_URL);
  });
  await check('still allows: sign-in by code + PKCE S256, renewal with no user, a public client, offline access', async () => {
    assert.ok(meta.grant_types_supported.includes('authorization_code'));
    assert.ok(meta.grant_types_supported.includes('refresh_token'));
    assert.ok(meta.code_challenge_methods_supported.includes('S256'));
    assert.ok(meta.token_endpoint_auth_methods_supported.includes('none'));
    assert.ok(meta.response_types_supported.includes('code'));
    for (const s of cfg.SCOPE.split(' ')) assert.ok(meta.scopes_supported.includes(s), `scope ${s} no longer offered`);
  });

  console.log('Wispr connector (no pass)');
  await check('refuses a caller with no pass (401) and points at its sign-in settings', async () => {
    const res = await fetch(cfg.MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wingguy-smoke', version: '1.0.0' } } }),
    });
    assert.strictEqual(res.status, 401);
    const www = res.headers.get('www-authenticate') || '';
    assert.ok(/resource_metadata="/.test(www), `no resource_metadata in: ${www}`);
    assert.ok(/offline_access/.test(www), 'the connector no longer asks for offline_access');
  });
  await check('names the sign-in server the feed uses, for the exact connector address', async () => {
    const u = new URL(cfg.MCP_URL);
    const res = await fetch(`${u.origin}/.well-known/oauth-protected-resource${u.pathname}`);
    assert.strictEqual(res.status, 200);
    const pr = await res.json();
    assert.strictEqual(pr.resource, cfg.MCP_URL);
    assert.ok((pr.authorization_servers || []).includes(cfg.AUTH_BASE));
  });
  await check('the feed\'s own client reads that refusal as "unauthorized" (what triggers a renewal)', async () => {
    const { openWispr } = require('../services/wisprClient');
    await assert.rejects(() => openWispr('not-a-real-pass'), (e) => e.code === 'WISPR_UNAUTHORIZED');
  });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
