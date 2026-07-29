/**
 * Register (or list) a Granola webhook for ONE client — the once-per-client setup step for the
 * Granola transcript provider.
 *
 * What it does: using the CLIENT's Granola API key (from the 'Granola API Key' field on the
 * Clients master), registers our per-client endpoint for note.generated + note.regenerated.
 * Granola returns the signing secret ONCE, in this response only — the script prints it with
 * instructions to paste into the client's 'Granola Webhook Secret' field. Without that stored
 * secret the webhook route rejects every delivery (401), so registration isn't live until the
 * paste happens. (Deliberate: the secret is a credential; a human puts it where credentials live.)
 *
 * Usage (server env — run via Render one-off job, like the other scripts):
 *   node scripts/register-granola-webhook.js --client=Some-Client            # register
 *   node scripts/register-granola-webhook.js --client=Some-Client --list     # list existing registrations
 *   node scripts/register-granola-webhook.js --client=Some-Client --url=https://... # override endpoint URL
 *
 * Defaults: endpoint URL = ${PUBLIC_BASE_URL || https://pb-webhook-server.onrender.com}/webhooks/granola/<clientId>
 *
 * ⚠ The registration endpoint path is per docs.granola.ai (POST /v1/webhooks). Built before the
 * first live client — if Granola's API differs on first contact, GRANOLA_API_BASE and the paths
 * here are the only knobs.
 */

require('dotenv').config();
const clientService = require('../services/clientService');

const GRANOLA_API_BASE = (process.env.GRANOLA_API_BASE || 'https://api.granola.ai/v1').replace(/\/$/, '');

function arg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

async function main() {
  const clientId = arg('client');
  if (!clientId || clientId === true) {
    console.error('Usage: node scripts/register-granola-webhook.js --client=<Client-ID> [--list] [--url=<endpoint>]');
    process.exit(1);
  }

  const client = await clientService.getClientById(String(clientId));
  if (!client) { console.error(`Client not found: ${clientId}`); process.exit(1); }
  if (!client.granolaApiKey) {
    console.error(`Client ${clientId} has no 'Granola API Key' on the Clients master. The client creates one in Granola (Business plan required) and you paste it there first.`);
    process.exit(1);
  }

  const headers = { Authorization: `Bearer ${client.granolaApiKey}`, 'Content-Type': 'application/json' };

  if (arg('list')) {
    const res = await fetch(`${GRANOLA_API_BASE}/webhooks`, { headers });
    const text = await res.text();
    console.log(`GET ${GRANOLA_API_BASE}/webhooks -> ${res.status}`);
    console.log(text);
    return;
  }

  const base = (process.env.PUBLIC_BASE_URL || 'https://pb-webhook-server.onrender.com').replace(/\/$/, '');
  const url = (typeof arg('url') === 'string' ? arg('url') : `${base}/webhooks/granola/${encodeURIComponent(client.clientId)}`);

  const res = await fetch(`${GRANOLA_API_BASE}/webhooks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, events: ['note.generated', 'note.regenerated'] }),
  });
  const text = await res.text();
  console.log(`POST ${GRANOLA_API_BASE}/webhooks -> ${res.status}`);
  console.log(text);
  if (res.ok) {
    console.log('');
    console.log('=== NEXT STEP (required — the secret above is shown ONCE) ===');
    console.log(`1. Copy the signing secret from the response above.`);
    console.log(`2. Paste it into the 'Granola Webhook Secret' field on ${client.clientId}'s row in the Clients master.`);
    console.log(`3. Probe ${url} (GET) — expect secret_configured: true.`);
    console.log(`4. Flip GRANOLA_WEBHOOK_ENABLED=true (observe), then GRANOLA_INGEST_ENABLED=true (write).`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
