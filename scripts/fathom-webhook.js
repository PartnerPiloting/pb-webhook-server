#!/usr/bin/env node
/**
 * Fathom webhook registration helper — sets up (or tears down) the "new meeting content ready"
 * push that replaces the poll lag. Run on Render (one-off job) where the Fathom API key lives.
 *
 * Fathom signs webhooks with the Svix HMAC scheme (same as Recall): registering returns a
 * `whsec_…` signing secret. Copy that into env FATHOM_WEBHOOK_SECRET on Render, set
 * FATHOM_WEBHOOK_ENABLED=true (and ensure FATHOM_LIVE_FROM is set), and the push goes live.
 * The receiving route is routes/fathomWebhookRoutes.js (POST /webhooks/fathom).
 *
 * USAGE (Render one-off job, or locally with FATHOM_API_KEY / .env.local):
 *   node scripts/fathom-webhook.js --list
 *   node scripts/fathom-webhook.js --register https://pb-webhook-server.onrender.com/webhooks/fathom
 *   node scripts/fathom-webhook.js --delete <webhookId>
 *
 * Options:
 *   --client <id>   coach/tenant client id (default RECALL_COACH_CLIENT_ID or Guy-Wilson)
 *
 * Notes:
 *   - Fathom requires at least one content type on a webhook; we set include_summary:true. The
 *     receiver IGNORES the body beyond recording_id (it re-fetches the meeting), so this is just
 *     to satisfy the API — it doesn't affect what we store.
 *   - triggered_for defaults to ["my_recordings"] (the coach's own meetings).
 *   - This script only talks to Fathom's API; it writes nothing to our DB.
 */

try { require('dotenv').config({ path: '.env.local' }); } catch (_) { /* optional */ }
try { require('dotenv').config(); } catch (_) { /* optional */ }

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const LIST = process.argv.includes('--list');
const REGISTER_URL = argVal('--register');
const DELETE_ID = argVal('--delete');
const COACH = (argVal('--client') || process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

async function resolveApiKey() {
  if (process.env.FATHOM_API_KEY && process.env.FATHOM_API_KEY.trim()) {
    return process.env.FATHOM_API_KEY.trim();
  }
  const clientService = require('../services/clientService');
  const client = await clientService.getClientById(COACH);
  if (client && client.fathomApiKey) return String(client.fathomApiKey).trim();
  return null;
}

async function fathomFetch(key, path, opts = {}) {
  const res = await fetch(`${FATHOM_API_BASE}${path}`, {
    ...opts,
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON */ }
  return { res, json, text };
}

async function listWebhooks(key) {
  const { res, json, text } = await fathomFetch(key, '/webhooks');
  if (!res.ok) { console.error(`Fathom API ${res.status} ${res.statusText}\n${text}`); process.exit(1); }
  const items = (json && (json.items || json.data || json.webhooks)) || [];
  console.log(`\n=== ${items.length} registered Fathom webhook(s) ===\n`);
  if (items.length === 0) console.log('  (none)\n');
  for (const w of items) {
    console.log(`  id=${w.id}`);
    console.log(`     url           : ${w.url || w.destination_url || '?'}`);
    console.log(`     triggered_for : ${(w.triggered_for || []).join(', ') || '?'}`);
    console.log(`     includes      : transcript=${!!w.include_transcript} summary=${!!w.include_summary} crm=${!!w.include_crm_matches} actions=${!!w.include_action_items}`);
    console.log(`     created_at    : ${w.created_at || '?'}\n`);
  }
}

async function registerWebhook(key, url) {
  const payload = {
    destination_url: url,
    triggered_for: ['my_recordings'],
    include_summary: true, // at least one include_* must be true; receiver ignores the body anyway
  };
  console.log(`\n🔗 Registering Fathom webhook`);
  console.log(`   url    : ${url}`);
  console.log(`   coach  : ${COACH}\n`);
  const { res, json, text } = await fathomFetch(key, '/webhooks', { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) { console.error(`Fathom API ${res.status} ${res.statusText}\n${text}`); process.exit(1); }
  const secret = json && json.secret;
  console.log(`   ✅ Created webhook id=${json && json.id}`);
  console.log(`\n   ┌─────────────────────────────────────────────────────────────────────┐`);
  console.log(`   │ Set these on Render, then redeploy:                                  │`);
  console.log(`   │   FATHOM_WEBHOOK_SECRET = ${secret || '(not returned — check response below)'}`);
  console.log(`   │   FATHOM_WEBHOOK_ENABLED = true                                      │`);
  console.log(`   │ (and confirm FATHOM_LIVE_FROM is already set)                        │`);
  console.log(`   └─────────────────────────────────────────────────────────────────────┘\n`);
  if (!secret) console.log(`   Full response:\n${JSON.stringify(json, null, 2)}\n`);
}

async function deleteWebhook(key, id) {
  console.log(`\n🗑  Deleting Fathom webhook id=${id}\n`);
  const { res, text } = await fathomFetch(key, `/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) { console.error(`Fathom API ${res.status} ${res.statusText}\n${text}`); process.exit(1); }
  console.log(`   ✅ Deleted webhook id=${id}\n`);
}

async function main() {
  const key = await resolveApiKey();
  if (!key) { console.error(`\nNo Fathom API key (env FATHOM_API_KEY or Client Master for ${COACH}).\n`); process.exit(1); }

  if (LIST) return listWebhooks(key);
  if (REGISTER_URL) return registerWebhook(key, REGISTER_URL);
  if (DELETE_ID) return deleteWebhook(key, DELETE_ID);

  console.error('\nUsage: node scripts/fathom-webhook.js --list');
  console.error('       node scripts/fathom-webhook.js --register <destinationUrl>');
  console.error('       node scripts/fathom-webhook.js --delete <webhookId>\n');
  process.exit(1);
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
