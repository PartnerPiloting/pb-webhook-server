/**
 * Zoho Calendar OAuth connect flow (step 4 of docs/zoho-calendar-adapter-plan.md).
 *
 *   GET /auth/zoho/start?clientId=<id>&token=<portal token>
 *       Authorizes the initiator (the token must be THIS client's Portal Token), then redirects to
 *       Zoho's consent screen with offline access so the callback gets a long-lived refresh token.
 *   GET /auth/zoho/callback?code=..&state=..&accounts-server=..
 *       Verifies the signed state, exchanges the code at the account's home data-centre, and writes
 *       the refresh token + DC onto the client's record + sets Calendar Provider='zoho'.
 *
 * The refresh token / domain the adapter (services/calendarProvider.js) reads land in the generic
 * fields Calendar Provider Token / Calendar Provider Domain. One platform Zoho app serves all
 * tenants: ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET (env). Access tokens are refreshed on demand there.
 *
 * SECURITY: /start requires the client's Portal Token (the real per-client secret), and `state` is
 * HMAC-signed with ZOHO_CLIENT_SECRET (genuinely secret, always present when the flow is usable) +
 * a 15-min expiry, so /callback can't be forged for an arbitrary clientId. Set ZOHO_REDIRECT_URI to
 * the exact URI registered on the Zoho app (defaults to the prod callback).
 */

const express = require('express');
const crypto = require('crypto');
const clientService = require('../services/clientService');

const router = express.Router();

const SCOPES = 'ZohoCalendar.calendar.READ,ZohoCalendar.event.ALL';
const STATE_TTL_MS = 15 * 60 * 1000;

// Where the OAuth login starts. A Zoho app is tied to the DATA CENTRE it's registered in, so this
// must match the app's DC: set ZOHO_ACCOUNTS_BASE=https://accounts.zoho.com.au for an AU app (the
// pilot — Julian + the test account are AU). Defaults to the US DC. Zoho then routes the user to
// their home DC and returns `accounts-server` on the callback, which the token exchange uses.
function authInitBase() {
  return (process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com').replace(/\/$/, '');
}
function stateSecret() {
  return process.env.ZOHO_STATE_SECRET || process.env.ZOHO_CLIENT_SECRET || '';
}
function redirectUri() {
  return process.env.ZOHO_REDIRECT_URI || 'https://pb-webhook-server.onrender.com/auth/zoho/callback';
}
function signState(clientId) {
  const payload = `${clientId}.${Date.now() + STATE_TTL_MS}`;
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}
function verifyState(state) {
  try {
    const [clientId, exp, sig] = Buffer.from(String(state || ''), 'base64url').toString('utf8').split('.');
    if (!clientId || !exp || !sig) return null;
    const expected = crypto.createHmac('sha256', stateSecret()).update(`${clientId}.${exp}`).digest('hex').slice(0, 32);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (Date.now() > Number(exp)) return null;
    return clientId;
  } catch (_) { return null; }
}
function page(title, body) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title><style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;` +
    `margin:60px auto;padding:0 20px;color:#333;line-height:1.5}h1{font-size:20px}.ok{color:#137333}.err{color:#c5221f}</style>` +
    `</head><body>${body}</body></html>`;
}

// Step 1 of the browser flow — authorize the initiator, then bounce to Zoho consent.
router.get('/start', async (req, res) => {
  const clientId = String(req.query.clientId || '').trim();
  const token = String(req.query.token || '').trim();
  if (!process.env.ZOHO_CLIENT_ID || !stateSecret()) {
    return res.status(500).send(page('Not configured', '<h1>Zoho isn\'t configured yet</h1><p>The server is missing ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET.</p>'));
  }
  if (!clientId || !token) {
    return res.status(400).send(page('Missing details', '<h1>Missing details</h1><p>This connect link needs a client id and token.</p>'));
  }
  let client = null;
  try { client = await clientService.getClientByPortalToken(token); } catch (_) { /* fall through to 403 */ }
  if (!client || client.clientId !== clientId) {
    return res.status(403).send(page('Not authorized', '<h1 class="err">Not authorized</h1><p>That connect link isn\'t valid for this client.</p>'));
  }
  const u = new URL(`${authInitBase()}/oauth/v2/auth`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', process.env.ZOHO_CLIENT_ID);
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('access_type', 'offline'); // → refresh token
  u.searchParams.set('prompt', 'consent');       // force a refresh token even on re-auth
  u.searchParams.set('state', signState(clientId));
  return res.redirect(u.toString());
});

// Step 2 — Zoho redirects back here with the code + the account's home data-centre.
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const accountsServer = String(req.query['accounts-server'] || req.query.accounts_server || authInitBase()).replace(/\/$/, '');
  if (error) return res.status(400).send(page('Connect failed', `<h1 class="err">Zoho connect failed</h1><p>${String(error).slice(0, 120)}</p>`));
  const clientId = verifyState(state);
  if (!clientId) return res.status(400).send(page('Link expired', '<h1 class="err">This connect link has expired or is invalid</h1><p>Please start again from the link you were sent.</p>'));
  if (!code) return res.status(400).send(page('Connect failed', '<h1 class="err">No authorization code returned by Zoho.</h1>'));

  // Exchange the code for tokens at the account's OWN data-centre (not necessarily .com).
  const tokenUrl = new URL(`${accountsServer}/oauth/v2/token`);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('client_id', process.env.ZOHO_CLIENT_ID);
  tokenUrl.searchParams.set('client_secret', process.env.ZOHO_CLIENT_SECRET);
  tokenUrl.searchParams.set('redirect_uri', redirectUri());
  tokenUrl.searchParams.set('code', String(code));
  let tok = {};
  try {
    const r = await fetch(tokenUrl.toString(), { method: 'POST', headers: { Accept: 'application/json' } });
    tok = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(400).send(page('Connect failed', `<h1 class="err">Token exchange failed</h1><p>${JSON.stringify(tok).slice(0, 160)}</p>`));
  } catch (e) {
    return res.status(502).send(page('Connect failed', `<h1 class="err">Couldn't reach Zoho</h1><p>${e.message}</p>`));
  }
  if (!tok.refresh_token) {
    return res.status(400).send(page('Connect incomplete', '<h1 class="err">Zoho didn\'t return a refresh token</h1><p>Please try again — the app must request offline access.</p>'));
  }
  // Derive the DC suffix from the home accounts-server host (accounts.zoho.com.au → com.au).
  const domainSuffix = accountsServer.replace(/^https?:\/\/accounts\.zoho\./i, '').replace(/\/.*$/, '') || 'com';

  const client = await clientService.getClientById(clientId);
  if (!client || !client.id) return res.status(404).send(page('Client not found', '<h1 class="err">Client record not found.</h1>'));
  const patchUrl = `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients/${client.id}`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        'Calendar Provider Token': tok.refresh_token,
        'Calendar Provider Domain': domainSuffix,
        'Calendar Provider': 'zoho',
      },
    }),
  });
  if (!patchRes.ok) {
    const t = await patchRes.text();
    return res.status(500).send(page('Almost there', `<h1 class="err">Couldn't save the connection</h1><p>${t.slice(0, 160)}</p>`));
  }
  return res.send(page('Connected', `<h1 class="ok">Your Zoho calendar is connected ✓</h1>` +
    `<p>${client.clientName || clientId} is all set — Wingguy can read your availability and book meetings straight into Zoho. You can close this tab.</p>`));
});

module.exports = router;
