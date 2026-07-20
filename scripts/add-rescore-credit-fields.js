/**
 * Add rescore-credit fields to the master Clients table, and (optionally) seed a client.
 *
 * Fields (on master base 'Clients'):
 *   - Rescore Enabled          (singleSelect Yes/No) — per-client gate for the rescore feature
 *   - Rescore Credits Granted  (number) — starting allowance (typically 1500)
 *   - Rescore Credits Consumed (number) — running total of leads rescored
 *   - Rescore Credits Start    (date)   — when the allowance began (drives +200/month accrual)
 *
 * Idempotent: existing fields are skipped. Seeding a client only sets values if that client
 * isn't already enabled (so re-runs never clobber a live Consumed balance).
 *
 * Usage:
 *   node scripts/add-rescore-credit-fields.js --dry-run
 *   node scripts/add-rescore-credit-fields.js
 *   node scripts/add-rescore-credit-fields.js --seed=Ashley-Knowles --granted=1500
 *
 * Prereqs: AIRTABLE_API_KEY (schema write), MASTER_CLIENTS_BASE_ID.
 */

require('dotenv').config();

const TABLE_NAME = 'Clients';
const FIELDS = [
  { name: 'Rescore Enabled', type: 'singleSelect', options: { choices: [{ name: 'Yes', color: 'greenBright' }, { name: 'No', color: 'redBright' }] } },
  { name: 'Rescore Credits Granted', type: 'number', options: { precision: 0 } },
  { name: 'Rescore Credits Consumed', type: 'number', options: { precision: 0 } },
  { name: 'Rescore Credits Start', type: 'date', options: { dateFormat: { name: 'iso' } } }
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const seedArg = args.find(a => a.startsWith('--seed='));
const seedClientId = seedArg ? seedArg.split('=')[1] : null;
const grantedArg = args.find(a => a.startsWith('--granted='));
const granted = grantedArg ? Number(grantedArg.split('=')[1]) : 1500;

async function getTables(baseId) {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
  });
  if (!r.ok) throw new Error(`get tables: ${r.status} - ${await r.text()}`);
  return (await r.json()).tables || [];
}

async function addField(baseId, tableId, def) {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(def)
  });
  if (!r.ok) throw new Error(`add field ${def.name}: ${r.status} - ${await r.text()}`);
  return r.json();
}

async function run() {
  console.log(`Add rescore-credit fields to master "${TABLE_NAME}"${dryRun ? ' (DRY RUN)' : ''}\n`);
  if (!process.env.AIRTABLE_API_KEY) { console.error('AIRTABLE_API_KEY not set'); process.exit(1); }
  const baseId = process.env.MASTER_CLIENTS_BASE_ID;
  if (!baseId) { console.error('MASTER_CLIENTS_BASE_ID not set'); process.exit(1); }

  const tables = await getTables(baseId);
  const table = tables.find(t => t.name === TABLE_NAME);
  if (!table) { console.error(`Table "${TABLE_NAME}" not found. Have: ${tables.map(t => t.name).join(', ')}`); process.exit(1); }

  const existing = new Set((table.fields || []).map(f => f.name));
  for (const def of FIELDS) {
    if (existing.has(def.name)) { console.log(`skip (exists): ${def.name}`); continue; }
    if (dryRun) { console.log(`would add: ${def.name} (${def.type})`); continue; }
    await addField(baseId, table.id, def);
    console.log(`added: ${def.name}`);
  }

  if (!seedClientId) { console.log('\nNo --seed given; fields only.'); return; }

  // Seed a client (only if not already enabled — never clobber a live balance)
  const cs = require('../services/clientService');
  cs.clearCache();
  const client = await cs.getClientById(seedClientId);
  if (!client) { console.error(`\nSeed client ${seedClientId} not found`); return; }
  if (client.rescoreEnabled) { console.log(`\nSeed skip: ${seedClientId} already Rescore Enabled (granted=${client.rescoreCreditsGranted}, consumed=${client.rescoreCreditsConsumed}).`); return; }

  const today = new Date().toISOString().slice(0, 10);
  const fields = { 'Rescore Enabled': 'Yes', 'Rescore Credits Granted': granted, 'Rescore Credits Consumed': 0, 'Rescore Credits Start': today };
  if (dryRun) { console.log(`\nwould seed ${seedClientId}:`, JSON.stringify(fields)); return; }
  const base = cs.initializeClientsBase();
  await base(TABLE_NAME).update(client.id, fields);
  cs.clearCache();
  const status = await cs.getRescoreCreditsStatus(seedClientId);
  console.log(`\nseeded ${seedClientId}:`, JSON.stringify(status));
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
