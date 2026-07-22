/**
 * Add the Unipile-migration config fields to the central Client Master table.
 *
 * Adds (idempotently) to the `Clients` table in MASTER_CLIENTS_BASE_ID, alongside the existing
 * `Nylas Grant ID` / `Calendar Provider` config fields:
 *   - "Unipile Account ID" (singleLineText) — the Unipile account_id; ONE id covers a tenant's
 *                                             calendar AND email (calendarProvider.js reads it for
 *                                             the 'unipile' branch).
 *   - "Email Provider"      (singleSelect nylas|unipile) — per-tenant mail backend, independent of
 *                                             the calendar provider. Blank => nylas (back-compat
 *                                             while mailProvider is Nylas-only).
 *
 * These live on the ONE central config table (not per-client Leads tables), so there is no Client
 * Template to mirror — unlike per-lead fields (cf. scripts/add-cease-fup-field.js).
 *
 * Usage:
 *   node scripts/add-unipile-fields.js --dry-run   # preview, no changes
 *   node scripts/add-unipile-fields.js             # add the fields
 *
 * Prereqs: AIRTABLE_API_KEY (schema-write scope), MASTER_CLIENTS_BASE_ID.
 */

require('dotenv').config();
const { MASTER_TABLES } = require('../constants/airtableUnifiedConstants');

const TABLE_NAME = MASTER_TABLES.CLIENTS; // 'Clients'

const FIELDS = [
  {
    name: 'Unipile Account ID',
    type: 'singleLineText',
    description: 'Unipile account_id for this tenant (covers calendar + email). Set when calendarProvider=unipile / emailProvider=unipile.',
  },
  {
    name: 'Email Provider',
    type: 'singleSelect',
    description: 'Mail backend for this tenant, independent of calendar. Blank => nylas.',
    options: { choices: [{ name: 'nylas' }, { name: 'unipile' }] },
  },
];

async function getTable(baseId, tableName) {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
  });
  if (!res.ok) throw new Error(`list tables HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const table = data.tables.find((t) => t.name === tableName);
  if (!table) throw new Error(`table "${tableName}" not found in base ${baseId}`);
  return table;
}

async function addField(baseId, tableId, def) {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(def),
  });
  if (!res.ok) throw new Error(`add field "${def.name}" HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`🔧 Add Unipile fields to Client Master table "${TABLE_NAME}"${dryRun ? '  (DRY RUN)' : ''}\n`);

  if (!process.env.AIRTABLE_API_KEY) { console.error('❌ AIRTABLE_API_KEY not set'); process.exit(1); }
  if (!process.env.MASTER_CLIENTS_BASE_ID) { console.error('❌ MASTER_CLIENTS_BASE_ID not set'); process.exit(1); }

  const baseId = process.env.MASTER_CLIENTS_BASE_ID;
  const table = await getTable(baseId, TABLE_NAME);
  console.log(`📋 base ${baseId} / table "${TABLE_NAME}" (${table.id})\n`);

  let added = 0; let skipped = 0;
  for (const def of FIELDS) {
    if (table.fields.some((f) => f.name === def.name)) {
      console.log(`⏭️  "${def.name}" already exists — skipping`);
      skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`✅ would add "${def.name}" (${def.type})`);
      added++;
      continue;
    }
    await addField(baseId, table.id, def);
    console.log(`✅ added "${def.name}" (${def.type})`);
    added++;
  }

  console.log(`\n${'='.repeat(50)}\n📊 ${dryRun ? 'would add' : 'added'}: ${added}   skipped: ${skipped}`);
  if (dryRun) console.log('🔍 dry run — re-run without --dry-run to apply.');
}

run().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
