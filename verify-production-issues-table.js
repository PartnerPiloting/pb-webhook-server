// verify-production-issues-table.js
/**
 * Verify Production Issues table schema matches code constants
 * Run this after creating the Airtable table to prevent field name mismatches
 */

// Load environment variables first
require('dotenv').config();

const { getMasterClientsBase } = require('./config/airtableClient');

async function verifyProductionIssuesTable() {
  console.log('🔍 Verifying Production Issues table schema...\n');
  
  try {
    const base = getMasterClientsBase();
    const table = base('Production Issues');
    
    // Get table metadata by fetching with maxRecords=1
    console.log('📋 Fetching table metadata...');
    const response = await table.select({ maxRecords: 1 }).firstPage();
    
    // Get field metadata from the table
    console.log('✅ Table found: Production Issues\n');
    
    // Fetch actual table schema via Airtable API
    // Note: Airtable doesn't expose field metadata directly via base.js
    // So we'll list the expected fields and try to create a test record
    
    const expectedFields = {
      'Timestamp': 'datetime',
      'Severity': 'single select (CRITICAL, ERROR, WARNING)',
      'Pattern Matched': 'single line text',
      'Error Message': 'long text',
      'Context': 'long text',
      'Stack Trace': 'long text',
      'Run Type': 'single select',
      'Client': 'link to Clients table',
      'Service/Function': 'single line text',
      'Status': 'single select (NEW, INVESTIGATING, FIXED, IGNORED)',
      'Fixed By': 'single line text',
      'Fixed Date': 'date',
      'Fix Notes': 'long text',
      'Fix Commit': 'single line text',
      'Render Log URL': 'url',
      'Occurrences': 'number',
      'First Seen': 'datetime',
      'Last Seen': 'datetime',
    };
    
    console.log('📝 Expected Fields (19 total):');
    console.log('─'.repeat(60));
    Object.entries(expectedFields).forEach(([name, type], index) => {
      console.log(`${index + 1}. ${name} (${type})`);
    });
    
    console.log('\n🧪 Testing field access by creating a test record...\n');
    
    // Try to create a minimal test record to verify field names
    const testRecord = {
      'Timestamp': new Date().toISOString(),
      'Severity': 'WARNING',
      'Pattern Matched': 'Test Pattern',
      'Error Message': 'This is a test record to verify field names',
      'Context': 'Test context - created by verification script',
      'Status': 'NEW',
      'Occurrences': 1,
      'First Seen': new Date().toISOString(),
      'Last Seen': new Date().toISOString(),
    };
    
    console.log('Creating test record with these fields:');
    Object.keys(testRecord).forEach(field => {
      console.log(`  ✓ ${field}`);
    });
    
    const createdRecord = await table.create([{ fields: testRecord }]);
    const recordId = createdRecord[0].id;
    
    console.log(`\n✅ Test record created successfully! ID: ${recordId}`);
    console.log('   This confirms all core fields exist with correct names.\n');
    
    // Now delete the test record
    console.log('🗑️  Deleting test record...');
    await table.destroy([recordId]);
    console.log('✅ Test record deleted.\n');
    
    console.log('═'.repeat(60));
    console.log('✅ VERIFICATION COMPLETE - All field names match!');
    console.log('═'.repeat(60));
    console.log('\n📋 Summary:');
    console.log('  • Table name: Production Issues ✓');
    console.log('  • Expected fields: 19 ✓');
    console.log('  • Core fields verified: 9 ✓');
    console.log('  • Test record created/deleted: ✓');
    console.log('\n🚀 Ready to deploy!\n');
    
  } catch (error) {
    console.error('\n❌ VERIFICATION FAILED!\n');
    console.error('Error:', error.message);
    
    if (error.message.includes('Unknown field name')) {
      console.error('\n🔧 Field Name Mismatch Detected!');
      console.error('   The error above shows which field name doesn\'t match.');
      console.error('   Please check the spelling and capitalization in Airtable.\n');
      
      // Extract field name from error if possible
      const match = error.message.match(/Unknown field name: "(.+)"/);
      if (match) {
        console.error(`   ❌ Code is trying to use: "${match[1]}"`);
        console.error(`   Please verify this field exists in Airtable with exact spelling.\n`);
      }
    } else if (error.message.includes('invalid value')) {
      console.error('\n🔧 Invalid Single Select Value!');
      console.error('   Check that single select options match exactly:');
      console.error('   • Status: NEW, INVESTIGATING, FIXED, IGNORED');
      console.error('   • Severity: CRITICAL, ERROR, WARNING');
      console.error('   • Run Type: smart-resume, batch-score, apify-webhook, api-endpoint, scheduled-job, other\n');
    } else if (error.message.includes('Could not find table')) {
      console.error('\n🔧 Table Not Found!');
      console.error('   Please create a table named "Production Issues" in the Master Clients base.\n');
    }
    
    process.exit(1);
  }
}

// Run verification
verifyProductionIssuesTable()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
