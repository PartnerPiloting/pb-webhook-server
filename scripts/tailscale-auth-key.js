/**
 * Mint a one-off Tailscale auth key for a machine build, so the build joins Guy's private network
 * by itself - nobody clicks a login link.
 *
 *   node scripts/tailscale-auth-key.js Steve-Nelson      prints ONE key (tskey-auth-...) on stdout
 *   node scripts/tailscale-auth-key.js --check           proves the credential works; mints nothing
 *
 * Use it in the build:
 *   TS_AUTHKEY=$(node scripts/tailscale-auth-key.js <Client-ID>)   then pass it to setup-ubuntu-vps.sh
 *
 * WHY (1 Oct 2026): Steve Nelson's build finished in 20 minutes and then sat for hours waiting for
 * Guy to click a `tailscale up` login link. Plain auth keys expire in 90 days at most, so keeping
 * one on file only moves the stall. An OAuth client does not expire; it mints a fresh key per build.
 * PROVEN the same evening: Steve's machine joined as lh-steve-nelson with a key from this script,
 * and Guy's laptop reached it (ssh + RDP port) under the tailnet's existing access rules.
 *
 * The key it mints: single use, pre-approved, valid for one hour, and tagged - a machine joined
 * with it belongs to the tag, not to a person, so its own key never expires either. Only the
 * short-lived key ever goes onto a client's machine; the OAuth secret stays on the laptop.
 *
 * Needs, in .env.local on the laptop (never in the repo, never on Render):
 *   TAILSCALE_OAUTH_CLIENT_ID
 *   TAILSCALE_OAUTH_CLIENT_SECRET   an OAuth client with the "Auth Keys: write" scope and the tag below
 *   TAILSCALE_MACHINE_TAG           optional, default tag:lh-machine (must exist in the tailnet's
 *                                   access controls, and be the tag picked on the OAuth client)
 */
require('dotenv').config();
try { require('dotenv').config({ path: '.env.local' }); } catch (_) { /* optional */ }

const API = 'https://api.tailscale.com/api/v2';
const KEY_LIFE_SECONDS = 3600;

function fail(message) {
  console.error(`tailscale-auth-key: ${message}`);
  process.exit(1);
}

async function accessToken(id, secret) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) fail(`Tailscale refused the OAuth credential (${res.status}). Check the two TAILSCALE_OAUTH_ lines in .env.local.`);
  return (await res.json()).access_token;
}

async function mintKey(token, tag, description) {
  const res = await fetch(`${API}/tailnet/-/keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      capabilities: { devices: { create: { reusable: false, ephemeral: false, preauthorized: true, tags: [tag] } } },
      expirySeconds: KEY_LIFE_SECONDS,
      description,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    fail(`Tailscale would not mint a key (${res.status}): ${body.slice(0, 300)}\n`
      + `Usual causes: the OAuth client lacks "Auth Keys: write", or ${tag} is not the tag chosen on it.`);
  }
  return (await res.json()).key;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) fail('say which client the key is for, e.g. node scripts/tailscale-auth-key.js Steve-Nelson (or --check)');

  const id = process.env.TAILSCALE_OAUTH_CLIENT_ID;
  const secret = process.env.TAILSCALE_OAUTH_CLIENT_SECRET;
  const tag = process.env.TAILSCALE_MACHINE_TAG || 'tag:lh-machine';
  if (!id || !secret) fail('TAILSCALE_OAUTH_CLIENT_ID / TAILSCALE_OAUTH_CLIENT_SECRET are not in .env.local - see the top of this file.');

  const token = await accessToken(id, secret);
  if (arg === '--check') {
    console.error(`tailscale-auth-key: credential ok; builds will join as ${tag}. Nothing minted.`);
    return;
  }
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(arg)) fail(`"${arg}" does not look like a Client ID`);

  // Tailscale allows only letters, digits, spaces, hyphens and underscores in a key description.
  const key = await mintKey(token, tag, `lh build ${arg}`);
  console.error(`tailscale-auth-key: one-off key for ${arg}, good for an hour, joins as ${tag}`);
  process.stdout.write(`${key}\n`);
}

main().catch((err) => fail(err.message));
