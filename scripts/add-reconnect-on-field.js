/**
 * Add "Reconnect On" field to client Leads tables (the follow-up ENGINE's date store).
 *
 * `Reconnect On` is a dedicated date field the follow-up sweep reads: a lead whose Reconnect On
 * has arrived surfaces at the DEFERRAL DUE tier (above "went quiet"); a future date PARKS the lead
 * from cadence nudges until then. It is ENGINE-WRITTEN ONLY (via wingguy_set_reconnect on a
 * propose-then-confirm) — the human never hand-types it, and it is deliberately NOT the rotted
 * legacy `Follow-Up Date` (that stays ignored by the engine). See docs/PREP-ME-FOR-TODAY-FEATURE.md.
 *
 * Usage:
 *   node scripts/add-reconnect-on-field.js --template           # Client Template base only
 *   node scripts/add-reconnect-on-field.js --client=Guy-Wilson  # one specific client
 *   node scripts/add-reconnect-on-field.js --all                # all clients with a base
 *   node scripts/add-reconnect-on-field.js --dry-run            # preview, no changes
 *
 * Prerequisites:
 *   - AIRTABLE_API_KEY (with schema write permissions)
 *   - MASTER_CLIENTS_BASE_ID (unless using --template only)
 */

require('dotenv').config();
const Airtable = require('airtable');

// ============================================
// CONFIGURATION
// ============================================

const FIELD_NAME = 'Reconnect On';
const LEADS_TABLE_NAME = 'Leads';

// Template base ID - "My Leads - Client Template"
const TEMPLATE_BASE_ID = 'app6W6k9GiDUlktvt';

// Field definition for Airtable Metadata API - a plain date field (no time component)
const FIELD_DEFINITION = {
  name: FIELD_NAME,
  type: 'date',
  options: {
    dateFormat: { name: 'iso', format: 'YYYY-MM-DD' }
  }
};

// ============================================
// HELPERS
// ============================================

async function getClients(filterClientId = null, allClients = false) {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
    .base(process.env.MASTER_CLIENTS_BASE_ID);

  const clients = [];

  // NB the master base's table is named 'Clients' (constants/airtableUnifiedConstants.js
  // MASTER_TABLES.CLIENTS) — 'Client Master' is the RECORD concept, not the table name, and
  // Airtable reports an unknown table as "not authorized" (deliberately vague).
  await base('Clients').select({
    fields: ['Client ID', 'Airtable Base ID']
  }).eachPage((records, fetchNextPage) => {
    for (const record of records) {
      const clientId = record.get('Client ID');
      const baseId = record.get('Airtable Base ID');

      // Skip if no base ID
      if (!baseId) continue;

      // Filter by specific client if provided
      if (filterClientId && clientId !== filterClientId) continue;

      clients.push({ clientId, baseId });
    }
    fetchNextPage();
  });

  return clients;
}

async function getTableId(baseId, tableName) {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
  });

  if (!response.ok) {
    throw new Error(`Failed to get tables for base ${baseId}: ${response.status}`);
  }

  const data = await response.json();
  const table = data.tables.find(t => t.name === tableName);

  if (!table) {
    throw new Error(`Table "${tableName}" not found in base ${baseId}`);
  }

  return table.id;
}

async function checkFieldExists(baseId, tableId, fieldName) {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
  });

  if (!response.ok) {
    throw new Error(`Failed to get tables: ${response.status}`);
  }

  const data = await response.json();
  const table = data.tables.find(t => t.id === tableId);

  if (!table) return false;

  return table.fields.some(f => f.name === fieldName);
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
    const error = await response.text();
    throw new Error(`Failed to add field: ${response.status} - ${error}`);
  }

  return await response.json();
}

// ============================================
// MAIN
// ============================================

async function run() {
  console.log('🔧 Add "Reconnect On" Field to Client Leads Tables\n');

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const allClients = args.includes('--all');
  const templateOnly = args.includes('--template');
  const clientArg = args.find(a => a.startsWith('--client='));
  const specificClient = clientArg ? clientArg.split('=')[1] : null;

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  if (!process.env.AIRTABLE_API_KEY) {
    console.error('❌ AIRTABLE_API_KEY not set');
    process.exit(1);
  }

  // Handle template-only mode
  if (templateOnly) {
    console.log('📋 Template mode - adding to Client Template base only\n');
    const clients = [{ clientId: 'Client Template', baseId: TEMPLATE_BASE_ID }];
    await processClients(clients, dryRun);
    return;
  }

  if (!specificClient && !allClients) {
    console.error('❌ Specify a scope: --template, --client=<id>, or --all');
    process.exit(1);
  }

  if (!process.env.MASTER_CLIENTS_BASE_ID) {
    console.error('❌ MASTER_CLIENTS_BASE_ID not set');
    process.exit(1);
  }

  try {
    console.log('📋 Loading clients...');
    const clients = await getClients(specificClient, allClients);

    if (clients.length === 0) {
      console.log('⚠️  No clients found matching criteria');
      return;
    }

    await processClients(clients, dryRun);

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  }
}

async function processClients(clients, dryRun) {
  console.log(`📊 Found ${clients.length} client(s) to process:\n`);
  clients.forEach(c => console.log(`   - ${c.clientId} (Base: ${c.baseId})`));
  console.log('');

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const client of clients) {
    process.stdout.write(`Processing ${client.clientId}... `);

    try {
      const tableId = await getTableId(client.baseId, LEADS_TABLE_NAME);
      const exists = await checkFieldExists(client.baseId, tableId, FIELD_NAME);

      if (exists) {
        console.log('⏭️  Field already exists, skipping');
        skipCount++;
        continue;
      }

      if (dryRun) {
        console.log('✅ Would add field (dry run)');
        successCount++;
        continue;
      }

      await addField(client.baseId, tableId, FIELD_DEFINITION);
      console.log('✅ Field added successfully');
      successCount++;

    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary:');
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ⏭️  Skipped (already exists): ${skipCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);

  if (dryRun) {
    console.log('\n🔍 This was a dry run. Run without --dry-run to make changes.');
  }
}

run();
