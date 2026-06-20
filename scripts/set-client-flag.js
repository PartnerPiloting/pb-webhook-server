/**
 * Set a single field's value on one client's row in the master Clients table.
 *
 * This is how you flip per-client feature switches (e.g. roll out a portal tab
 * client-by-client) from a script instead of the Airtable UI.
 *
 * Usage (run via Render one-off job — needs the server env):
 *   node scripts/set-client-flag.js --client=Guy-Wilson --field="Thanks for Connecting" --value=Yes
 *   node scripts/set-client-flag.js --client=Guy-Wilson --field="Connection Lookback Days" --value=14
 *
 * Prerequisites: AIRTABLE_API_KEY, MASTER_CLIENTS_BASE_ID.
 */

require('dotenv').config();
const Airtable = require('airtable');

const MASTER_TABLE = 'Clients';
const CLIENT_ID_FIELD = 'Client ID';

function arg(key) {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${key}=`));
  return a ? a.split('=').slice(1).join('=') : null;
}

async function run() {
  const clientId = arg('client');
  const field = arg('field');
  const value = arg('value');

  if (!clientId || !field || value === null) {
    console.error('usage: --client=ID --field="Field Name" --value=VALUE');
    process.exit(1);
  }
  if (!process.env.AIRTABLE_API_KEY) { console.error('❌ AIRTABLE_API_KEY not set'); process.exit(1); }
  if (!process.env.MASTER_CLIENTS_BASE_ID) { console.error('❌ MASTER_CLIENTS_BASE_ID not set'); process.exit(1); }

  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
    .base(process.env.MASTER_CLIENTS_BASE_ID);

  const recs = await base(MASTER_TABLE)
    .select({ filterByFormula: `{${CLIENT_ID_FIELD}} = '${clientId}'`, maxRecords: 1 })
    .firstPage();

  if (!recs.length) {
    console.error(`❌ client "${clientId}" not found in ${MASTER_TABLE}`);
    process.exit(1);
  }

  const before = recs[0].get(field);
  await base(MASTER_TABLE).update(recs[0].id, { [field]: value });
  console.log(`✅ ${clientId}: "${field}" ${before === undefined ? '(empty)' : `"${before}"`} → "${value}"`);
}

run().catch((err) => { console.error('❌', err.message); process.exit(1); });
