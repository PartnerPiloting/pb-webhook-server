#!/usr/bin/env node
/**
 * Register Wingguy with Wispr Flow's sign-in server - ONCE. (13 Nov 2026)
 *
 * Wispr's sign-in server lets any app register itself as a "public client" (no secret). This asks
 * for one, naming our callback addresses, and prints the client id Wispr hands back. Put that id in
 * the WISPR_OAUTH_CLIENT_ID env var on Render (prod and staging). It is not a secret.
 *
 * Re-running makes a SECOND registration - harmless, but then every client would have to connect
 * again under the new id. So only run it if the old id has stopped working.
 *
 *   node scripts/wispr-register-client.js            # registers prod + staging callbacks
 *   node scripts/wispr-register-client.js --dry      # prints what it would send
 */

const cfg = require('../services/wisprConfig');

const REDIRECTS = [
  'https://pb-webhook-server.onrender.com/auth/wispr/callback',
  'https://pb-webhook-server-staging.onrender.com/auth/wispr/callback',
];

(async () => {
  const body = {
    client_name: 'Wingguy',
    redirect_uris: REDIRECTS,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: cfg.SCOPE,
  };
  if (process.argv.includes('--dry')) {
    console.log(`Would POST to ${cfg.REGISTER_URL}:\n${JSON.stringify(body, null, 2)}`);
    return;
  }
  const res = await fetch(cfg.REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.client_id) {
    console.error(`Registration failed: HTTP ${res.status} ${data.error || ''} ${data.error_description || ''}`.trim());
    process.exit(1);
  }
  console.log(`Registered (HTTP ${res.status}).`);
  console.log(`client_id: ${data.client_id}`);
  console.log(`auth method: ${data.token_endpoint_auth_method || 'none'}; redirect URIs: ${(data.redirect_uris || []).join(', ')}`);
  console.log('Set WISPR_OAUTH_CLIENT_ID to that client_id on Render (prod and staging).');
})().catch((e) => { console.error(e.message); process.exit(1); });
