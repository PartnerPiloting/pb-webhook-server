/**
 * Add "Launch Date" field to the master Clients table.
 *
 * When a client's system went live. Read by clientService (client.launchDate) and used by
 * the Top Scoring Leads "connection vintage" filter to split existing-network (connected
 * before launch) from new-since-launch leads. Admin-set per client; blank => vintage filter
 * behaves as "All".
 *
 * Uses the Airtable Metadata API. Idempotent (skips if the field already exists).
 *
 * Usage:
 *   node scripts/add-launch-date-field.js --dry-run   # list tables + preview, no changes
 *   node scripts/add-launch-date-field.js             # add the field
 *
 * Prerequisites:
 *   - AIRTABLE_API_KEY (with schema write permissions)
 *   - MASTER_CLIENTS_BASE_ID
 */

require('dotenv').config();

const FIELD_NAME = 'Launch Date';
// clientService reads the master table as 'Clients' (MASTER_TABLES.CLIENTS).
const TABLE_NAME = 'Clients';

// Date-only field (no time component).
const FIELD_DEFINITION = {
  name: FIELD_NAME,
  type: 'date',
  options: { dateFormat: { name: 'iso' } }
};

async function getTables(baseId) {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
  });
  if (!response.ok) {
    throw new Error(`Failed to get tables for base ${baseId}: ${response.status} - ${await response.text()}`);
  }
  const data = await response.json();
  return data.tables || [];
}

async function addField(baseId, tableId, fieldDefinition) {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(fieldDefinition)
  });
  if (!response.ok) {
    throw new Error(`Failed to add field: ${response.status} - ${await response.text()}`);
  }
  return response.json();
}

async function run() {
  console.log(`Add "${FIELD_NAME}" field to master "${TABLE_NAME}" table\n`);

  const dryRun = process.argv.slice(2).includes('--dry-run');
  if (dryRun) console.log('DRY RUN — no changes will be made\n');

  if (!process.env.AIRTABLE_API_KEY) { console.error('AIRTABLE_API_KEY not set'); process.exit(1); }
  const baseId = process.env.MASTER_CLIENTS_BASE_ID;
  if (!baseId) { console.error('MASTER_CLIENTS_BASE_ID not set'); process.exit(1); }

  const tables = await getTables(baseId);
  console.log(`Tables in master base ${baseId}: ${tables.map(t => t.name).join(', ')}\n`);

  const table = tables.find(t => t.name === TABLE_NAME);
  if (!table) {
    console.error(`Table "${TABLE_NAME}" not found. Adjust TABLE_NAME to one of the above and re-run.`);
    process.exit(1);
  }

  const exists = (table.fields || []).some(f => f.name === FIELD_NAME);
  if (exists) { console.log(`Field "${FIELD_NAME}" already exists — nothing to do.`); return; }

  if (dryRun) { console.log(`Would add date field "${FIELD_NAME}" to table "${TABLE_NAME}" (${table.id}).`); return; }

  await addField(baseId, table.id, FIELD_DEFINITION);
  console.log(`Field "${FIELD_NAME}" added to "${TABLE_NAME}".`);
}

run().catch((err) => { console.error('Fatal error:', err.message); process.exit(1); });
