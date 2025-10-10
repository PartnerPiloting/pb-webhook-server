/**
 * Debug script to see actual Production Issues data
 */

const Airtable = require('airtable');
require('dotenv').config();

const MASTER_CLIENTS_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(MASTER_CLIENTS_BASE_ID);

async function debugIssues() {
  console.log('\n🔍 Fetching ALL Production Issues...\n');
  
  try {
    const records = await base('Production Issues')
      .select({
        maxRecords: 50,
        sort: [{ field: 'Issue ID', direction: 'desc' }]
      })
      .all();
    
    console.log(`Found ${records.length} total issues\n`);
    
    // Group by status
    const byStatus = {};
    records.forEach(r => {
      const status = r.get('Status') || 'NO_STATUS';
      byStatus[status] = (byStatus[status] || 0) + 1;
    });
    
    console.log('By Status:');
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    console.log('\n📋 Recent ERROR severity issues:\n');
    
    const errorRecords = records.filter(r => r.get('Severity') === 'ERROR');
    errorRecords.slice(0, 10).forEach(r => {
      console.log(`Issue #${r.get('Issue ID')}`);
      console.log(`  Status: ${r.get('Status')}`);
      console.log(`  Pattern: ${r.get('Pattern Matched')}`);
      console.log(`  Message: ${r.get('Error Message')?.substring(0, 150)}...`);
      console.log(`  Run ID: ${r.get('Run ID')}`);
      console.log('');
    });
    
    // Test the search pattern
    console.log('\n🔍 Testing search pattern: "Client run record not found"\n');
    const searchRecords = await base('Production Issues')
      .select({
        filterByFormula: `SEARCH("Client run record not found", {Error Message}) > 0`
      })
      .all();
    
    console.log(`Found ${searchRecords.length} records matching pattern:`);
    searchRecords.forEach(r => {
      console.log(`  Issue #${r.get('Issue ID')} - Status: ${r.get('Status')}`);
    });
    
    // Check how many are NOT FIXED
    const unfixedRecords = await base('Production Issues')
      .select({
        filterByFormula: `AND(
          SEARCH("Client run record not found", {Error Message}) > 0,
          {Status} != "FIXED"
        )`
      })
      .all();
    
    console.log(`\nOf those, ${unfixedRecords.length} are NOT FIXED`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

debugIssues();
