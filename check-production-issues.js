require('dotenv').config();
const Airtable = require('airtable');

const base = new Airtable({apiKey: process.env.AIRTABLE_API_KEY}).base(process.env.MASTER_CLIENTS_BASE_ID);

console.log('Fetching recent Production Issues from last hour...\n');

base('Production Issues')
  .select({
    filterByFormula: 'DATETIME_DIFF(NOW(), {Timestamp}, "hours") < 1',
    sort: [{field: 'Timestamp', direction: 'desc'}],
    maxRecords: 50
  })
  .firstPage()
  .then(records => {
    if (records.length === 0) {
      console.log('❌ NO ERRORS FOUND in Production Issues table from the last hour');
      console.log('\nThis means Phase 1 bugs prevented errors from being logged.');
      console.log('OR the error logging system is not working yet.');
      return;
    }
    
    console.log(`✅ Found ${records.length} errors in the last hour:\n`);
    console.log('='.repeat(80));
    
    records.forEach((record, i) => {
      console.log(`\n${i+1}. [${record.get('Status') || 'NEW'}] ${record.get('Error Type') || 'Unknown Type'}`);
      console.log(`   Severity: ${record.get('Severity') || 'N/A'}`);
      console.log(`   Message: ${(record.get('Error Message') || 'N/A').substring(0, 100)}...`);
      console.log(`   Client: ${record.get('Client ID') || 'N/A'}`);
      console.log(`   Run ID: ${record.get('Run ID') || 'N/A'}`);
      console.log(`   File: ${record.get('File Path') || 'N/A'}`);
      console.log(`   Function: ${record.get('Function Name') || 'N/A'}`);
      console.log(`   Time: ${record.get('Timestamp') || 'N/A'}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log(`\nSummary: ${records.length} total errors recorded`);
  })
  .catch(err => {
    console.error('Error fetching Production Issues:', err.message);
    console.error('\nStack:', err.stack);
  });
