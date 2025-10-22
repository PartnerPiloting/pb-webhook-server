/**
 * scripts/clean-template-base.js
 * 
 * Clean a newly duplicated template base by removing all records from data tables
 * while keeping configuration tables (scoring attributes) intact.
 * 
 * Usage:
 *   Basic: node scripts/clean-template-base.js <template-base-id>
 *   Deep clean: node scripts/clean-template-base.js <template-base-id> --deep-clean
 * 
 * Basic mode:
 *   - Clears data from Leads, Connection Request Parameters
 *   - Updates Credentials with default threshold values
 *   - Keeps seed data in Scoring Attributes tables
 * 
 * Deep clean mode (--deep-clean):
 *   - Does everything in basic mode
 *   - PERMANENTLY DELETES unused legacy tables via Airtable Metadata API
 *   - Tables deleted: Connections, Boolean Searches, Concept Dictionary, Name Parsing Rules,
 *     Project Tasks, Attributes Blob, Campaigns, Instructions + Thoughts, Test Post Scoring,
 *     Scoring Attributes 06 08 25
 *   - Falls back to record clearing if API deletion fails
 * 
 * Example:
 *   node scripts/clean-template-base.js appABC123XYZ456
 *   node scripts/clean-template-base.js appABC123XYZ456 --deep-clean
 */

require('dotenv').config();
const Airtable = require('airtable');

// Tables to CLEAR (delete all records)
const TABLES_TO_CLEAR = [
  'Leads',
  'Connection Request Parameters' // LinkedHelper connection automation
];

// Tables to UPDATE (modify records but don't delete)
const TABLES_TO_UPDATE = {
  'Credentials': {
    description: 'Update single record with default threshold values',
    handler: updateCredentialsDefaults
  }
};

// Tables to KEEP (leave records intact - seed data)
const TABLES_TO_KEEP = [
  'Scoring Attributes',
  'Post Scoring Attributes',
  'Post Scoring Instructions'
];

/**
 * Update Credentials table with default threshold values
 */
async function updateCredentialsDefaults(base, tableName) {
  console.log(`   Processing: ${tableName}`);
  
  const records = await base(tableName).select().all();
  
  if (records.length === 0) {
    console.log(`      ⚠️  No records found - creating default record`);
    await base(tableName).create({
      'AI Score Threshold Input': 50,
      'Posts Threshold Percentage': 30,
      'Last LH Leads Export': null
    });
    console.log(`      ✅ Created default Credentials record`);
    return;
  }
  
  if (records.length > 1) {
    console.log(`      ⚠️  Multiple records found (${records.length}) - updating first, deleting others`);
    // Delete extra records
    const recordsToDelete = records.slice(1).map(r => r.id);
    for (let i = 0; i < recordsToDelete.length; i += 10) {
      await base(tableName).destroy(recordsToDelete.slice(i, i + 10));
    }
  }
  
  // Update the first/only record
  const record = records[0];
  await base(tableName).update(record.id, {
    'AI Score Threshold Input': 50,
    'Posts Threshold Percentage': 30,
    'Last LH Leads Export': null
  });
  
  console.log(`      ✅ Updated with default values (AI threshold: 50, Posts threshold: 30%)`);
}

async function cleanTemplateBase(templateBaseId, deepClean = false) {
  console.log('\n🧹 CLEANING TEMPLATE BASE');
  console.log('='.repeat(60));
  console.log(`Template Base ID: ${templateBaseId}`);
  console.log(`Mode: ${deepClean ? '🔥 DEEP CLEAN (includes table deletion)' : '🧼 BASIC CLEAN'}\n`);

  if (!templateBaseId || !templateBaseId.startsWith('app')) {
    console.error('❌ Error: Please provide a valid Airtable base ID (starts with "app")');
    console.log('\nUsage: node scripts/clean-template-base.js <base-id> [--deep-clean]');
    process.exit(1);
  }

  if (!process.env.AIRTABLE_API_KEY) {
    console.error('❌ Error: AIRTABLE_API_KEY not found in environment');
    process.exit(1);
  }

  const base = new Airtable({ 
    apiKey: process.env.AIRTABLE_API_KEY 
  }).base(templateBaseId);

  console.log('📊 Configuration:');
  console.log(`   Tables to CLEAR (delete records): ${TABLES_TO_CLEAR.join(', ')}`);
  console.log(`   Tables to UPDATE: ${Object.keys(TABLES_TO_UPDATE).join(', ')}`);
  console.log(`   Tables to KEEP (seed data): ${TABLES_TO_KEEP.join(', ')}`);
  if (deepClean) {
    console.log(`   Tables to DELETE entirely: ${TABLES_TO_DELETE.join(', ')}`);
  }
  console.log('');

  // First, validate all required tables exist
  console.log('🔍 Validating required table structure...\n');
  const allRequiredTables = [...TABLES_TO_CLEAR, ...Object.keys(TABLES_TO_UPDATE), ...TABLES_TO_KEEP];
  for (const tableName of allRequiredTables) {
    try {
      await base(tableName).select({ maxRecords: 1 }).firstPage();
      console.log(`   ✅ ${tableName}`);
    } catch (error) {
      console.error(`   ❌ ${tableName} - NOT FOUND`);
      console.error(`      Error: ${error.message}`);
      process.exit(1);
    }
  }

  console.log('\n🗑️  Clearing data tables (memory-safe batch processing)...\n');

  // Clear each data table with pagination to avoid memory issues
  for (const tableName of TABLES_TO_CLEAR) {
    try {
      console.log(`   Processing: ${tableName}`);
      
      let totalDeleted = 0;
      let hasMore = true;

      // Process in small batches to avoid memory issues with large tables
      while (hasMore) {
        // Fetch only 100 records at a time
        const batch = await base(tableName).select({
          maxRecords: 100
        }).firstPage();
        
        if (batch.length === 0) {
          if (totalDeleted === 0) {
            console.log(`      Already empty ✓`);
          }
          hasMore = false;
          break;
        }

        if (totalDeleted === 0) {
          console.log(`      Processing records in batches of 100...`);
        }

        // Delete in chunks of 10 (Airtable API limit)
        const BATCH_SIZE = 10;
        for (let i = 0; i < batch.length; i += BATCH_SIZE) {
          const chunk = batch.slice(i, i + BATCH_SIZE);
          const recordIds = chunk.map(r => r.id);
          await base(tableName).destroy(recordIds);
          totalDeleted += recordIds.length;
        }
        
        console.log(`      Deleted ${totalDeleted} records so far...`);
        
        // Check if there are more records
        const remaining = await base(tableName).select({ maxRecords: 1 }).firstPage();
        hasMore = remaining.length > 0;
      }

      if (totalDeleted > 0) {
        console.log(`      ✅ Cleared ${totalDeleted} total records\n`);
      }

    } catch (error) {
      console.error(`   ❌ Error clearing ${tableName}: ${error.message}`);
      process.exit(1);
    }
  }

  // Update configuration tables
  console.log('\n🔧 Updating configuration tables...\n');
  
  for (const [tableName, config] of Object.entries(TABLES_TO_UPDATE)) {
    try {
      await config.handler(base, tableName);
    } catch (error) {
      console.error(`   ❌ Error updating ${tableName}: ${error.message}`);
      process.exit(1);
    }
  }

  // Verify seed data tables still have data
  console.log('\n✅ Verifying seed data tables...\n');
  
  for (const tableName of TABLES_TO_KEEP) {
    try {
      const records = await base(tableName).select().all();
      console.log(`   ✅ ${tableName}: ${records.length} records preserved`);
    } catch (error) {
      console.error(`   ⚠️  ${tableName}: Error checking records`);
    }
  }

  // Deep clean: Delete ALL tables except core required ones
  if (deepClean) {
    console.log('\n🔥 DEEP CLEAN: Deleting all non-essential tables...\n');
    console.log('   ⚠️  WARNING: This will PERMANENTLY DELETE tables not in the core set!\n');
    
    // Define tables to preserve (everything else gets deleted)
    const TABLES_TO_PRESERVE = [
      ...TABLES_TO_CLEAR,
      ...Object.keys(TABLES_TO_UPDATE),
      ...TABLES_TO_KEEP
    ];
    
    console.log(`   ℹ️  Will preserve ${TABLES_TO_PRESERVE.length} core tables:`);
    TABLES_TO_PRESERVE.forEach(t => console.log(`      - ${t}`));
    console.log('');
    
    // Get table metadata to find all tables and their IDs
    const metadataUrl = `https://api.airtable.com/v0/meta/bases/${templateBaseId}/tables`;
    const headers = {
      'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    };
    
    let tableMetadata = [];
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(metadataUrl, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch base metadata: ${response.statusText}`);
      }
      const data = await response.json();
      tableMetadata = data.tables || [];
      
      console.log(`   📋 Found ${tableMetadata.length} total tables in base\n`);
    } catch (error) {
      console.log(`   ❌ Could not fetch table metadata: ${error.message}`);
      console.log('   ℹ️  Cannot proceed with deep clean without metadata API access\n');
      tableMetadata = [];
    }
    
    if (tableMetadata.length > 0) {
      // Find tables to delete (all tables NOT in TABLES_TO_PRESERVE)
      const tablesToDelete = tableMetadata.filter(table => 
        !TABLES_TO_PRESERVE.includes(table.name)
      );
      
      console.log(`   🗑️  Will delete ${tablesToDelete.length} tables:\n`);
      tablesToDelete.forEach(t => console.log(`      - ${t.name}`));
      console.log('');
      
      // Delete each unwanted table
      for (const tableInfo of tablesToDelete) {
        try {
          console.log(`   🗑️  ${tableInfo.name}: Deleting table permanently...`);
          
          const fetch = (await import('node-fetch')).default;
          const deleteUrl = `https://api.airtable.com/v0/meta/bases/${templateBaseId}/tables/${tableInfo.id}`;
          const deleteResponse = await fetch(deleteUrl, {
            method: 'DELETE',
            headers
          });
          
          if (deleteResponse.ok) {
            console.log(`      ✅ Table deleted permanently`);
          } else {
            const errorText = await deleteResponse.text();
            console.log(`      ⚠️  API returned ${deleteResponse.status}: ${errorText}`);
          }
        } catch (deleteError) {
          console.log(`      ❌ Error: ${deleteError.message}`);
        }
      }
      
      console.log('\n   ✅ Deep clean complete!');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ TEMPLATE BASE CLEANED SUCCESSFULLY!');
  console.log('='.repeat(60));
  console.log('\nNext steps:');
  console.log('1. Rename base in Airtable to "Template - Client Leads"');
  console.log('2. Use this base ID for future client onboarding');
  console.log(`\nTemplate Base ID: ${templateBaseId}\n`);
}

// Get base ID and flags from command line arguments
const args = process.argv.slice(2);
const templateBaseId = args.find(arg => !arg.startsWith('--'));
const deepClean = args.includes('--deep-clean');

if (!templateBaseId) {
  console.log('\n🧹 Template Base Cleaner');
  console.log('='.repeat(60));
  console.log('\nThis script cleans a newly duplicated template base by:');
  console.log('\n🧼 BASIC MODE (default):');
  console.log('  • Clear records: Leads, LinkedIn Posts, Connection Request Parameters');
  console.log('  • Update: Credentials (set default thresholds)');
  console.log('  • Keep seed data: Scoring Attributes, Post Scoring Attributes, Post Scoring Instructions');
  console.log('\n🔥 DEEP CLEAN MODE (--deep-clean flag):');
  console.log('  • Does everything in basic mode');
  console.log('  • PERMANENTLY DELETES legacy tables: Connections, Boolean Searches, Concept Dictionary,');
  console.log('    Name Parsing Rules, Project Tasks, Attributes Blob, Campaigns, Instructions + Thoughts,');
  console.log('    Test Post Scoring, Scoring Attributes 06 08 25');
  console.log('  • Uses Airtable Metadata API to delete tables entirely (not just records)');
  console.log('  • Falls back to record clearing if API deletion fails');
  console.log('\nUsage:');
  console.log('  node scripts/clean-template-base.js <template-base-id> [--deep-clean]');
  console.log('\nExamples:');
  console.log('  node scripts/clean-template-base.js appABC123XYZ456');
  console.log('  node scripts/clean-template-base.js appABC123XYZ456 --deep-clean');
  console.log('\nSteps:');
  console.log('  1. In Airtable: Duplicate Guy Wilson base WITH records');
  console.log('  2. Copy the new base ID from the URL');
  console.log('  3. Run this script with that base ID (use --deep-clean for production template)');
  console.log('  4. Rename the base to "Template - Client Leads"\n');
  process.exit(0);
}

// Run the cleanup
cleanTemplateBase(templateBaseId, deepClean).catch(error => {
  console.error('\n❌ FATAL ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
});
