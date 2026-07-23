/**
 * Add "Cease FUP" field to client Leads tables
 * 
 * This script uses the Airtable Metadata API to add the field programmatically.
 * 
 * Usage:
 *   node scripts/add-cease-fup-field.js --template         # Add to template base only
 *   node scripts/add-cease-fup-field.js                    # Add to all clients with Smart FUP = Yes
 *   node scripts/add-cease-fup-field.js --client=Guy-Wilson  # Add to specific client
 *   node scripts/add-cease-fup-field.js --all                # Add to all clients
 *   node scripts/add-cease-fup-field.js --dry-run            # Preview without making changes
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

const FIELD_NAME = 'Cease FUP';
const LEADS_TABLE_NAME = 'Leads';

// Template base ID - "My Leads - Client Template"
const TEMPLATE_BASE_ID = 'app6W6k9GiDlJktvt';

// Field definition for Airtable Metadata API - Single select Yes/No
const FIELD_DEFINITION = {
  name: FIELD_NAME,
  type: 'singleSelect',
  options: {
    choices: [
      { name: 'Yes', color: 'redBright' },
      { name: 'No', color: 'greenBright' }
    ]
  }
};

// ============================================
// HELPERS
// ============================================

async function getClients(filterClientId = null, smartFupOnly = true) {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
    .base(process.env.MASTER_CLIENTS_BASE_ID);
  
  const clients = [];
  
  await base('Clients').select({
    fields: ['Client ID', 'Airtable Base ID', 'Smart FUP']
  }).eachPage((records, fetchNextPage) => {
    for (const record of records) {
      const clientId = record.get('Client ID');
      const baseId = record.get('Airtable Base ID');
      const smartFup = record.get('Smart FUP');
      
      // Skip if no base ID
      if (!baseId) continue;
      
      // Filter by specific client if provided
      if (filterClientId && clientId !== filterClientId) continue;
      
      // Filter by Smart FUP = Yes if flag is set
      if (smartFupOnly && smartFup !== 'Yes') continue;
      
      clients.push({
        clientId,
        baseId,
        smartFup
      });
    }
    fetchNextPage();
  });
  
  return clients;
}

async function getTableId(baseId, tableName) {
  // Use Airtable Metadata API to get table ID
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: {
      'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
    }
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
    headers: {
      'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
    }
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
  console.log('🔧 Add "Cease FUP" Field to Client Leads Tables\n');
  
  // Parse arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const allClients = args.includes('--all');
  const templateOnly = args.includes('--template');
  const clientArg = args.find(a => a.startsWith('--client='));
  const specificClient = clientArg ? clientArg.split('=')[1] : null;
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  // Validate environment
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
  
  if (!process.env.MASTER_CLIENTS_BASE_ID) {
    console.error('❌ MASTER_CLIENTS_BASE_ID not set');
    process.exit(1);
  }
  
  try {
    // Get clients to process
    console.log('📋 Loading clients...');
    const smartFupOnly = !allClients && !specificClient;
    const clients = await getClients(specificClient, smartFupOnly);
    
    if (clients.length === 0) {
      console.log('⚠️  No clients found matching criteria');
      if (smartFupOnly) {
        console.log('   Hint: Set "Smart FUP" to "Yes" in Client Master, or use --all flag');
      }
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
  
  // Process each client
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  
  for (const client of clients) {
    process.stdout.write(`Processing ${client.clientId}... `);
    
    try {
      // Get table ID
      const tableId = await getTableId(client.baseId, LEADS_TABLE_NAME);
      
      // Check if field already exists
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
      
      // Add the field
      await addField(client.baseId, tableId, FIELD_DEFINITION);
      console.log('✅ Field added successfully');
      successCount++;
      
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      errorCount++;
    }
  }
  
  // Summary
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
