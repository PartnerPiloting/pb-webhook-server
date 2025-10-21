/**
 * Check if Production Issues table has Stack Traces populated
 * This verifies the complete end-to-end flow is working
 */

require('dotenv').config();
const { getMasterClientsBase } = require('./config/airtableClient');

async function checkProductionIssues() {
  console.log('\n=== Checking Production Issues for Stack Traces ===\n');
  
  try {
    const masterBase = getMasterClientsBase();
    
    // Fetch recent Production Issues
    const records = await masterBase('Production Issues')
      .select({
        maxRecords: 20,
        sort: [{ field: 'Created At', direction: 'desc' }],
        fields: ['Run ID', 'Error Message', 'Stack Trace', 'Created At', 'Severity']
      })
      .all();
    
    console.log(`Found ${records.length} recent Production Issues\n`);
    
    let withStackTrace = 0;
    let withoutStackTrace = 0;
    let recentWithStackTrace = [];
    
    records.forEach((record, index) => {
      const runId = record.get('Run ID');
      const errorMsg = record.get('Error Message')?.substring(0, 60) || 'N/A';
      const stackTrace = record.get('Stack Trace');
      const createdAt = record.get('Created At');
      const severity = record.get('Severity');
      
      if (stackTrace) {
        withStackTrace++;
        recentWithStackTrace.push({
          runId,
          errorMsg,
          stackTraceLength: stackTrace.length,
          createdAt,
          severity
        });
      } else {
        withoutStackTrace++;
      }
    });
    
    console.log('=== SUMMARY ===');
    console.log(`✅ Issues WITH Stack Trace: ${withStackTrace}`);
    console.log(`❌ Issues WITHOUT Stack Trace: ${withoutStackTrace}`);
    
    if (recentWithStackTrace.length > 0) {
      console.log('\n=== Recent Issues WITH Stack Traces ===');
      recentWithStackTrace.slice(0, 5).forEach((issue, i) => {
        console.log(`\n${i + 1}. Run ID: ${issue.runId}`);
        console.log(`   Created: ${issue.createdAt}`);
        console.log(`   Severity: ${issue.severity}`);
        console.log(`   Error: ${issue.errorMsg}...`);
        console.log(`   Stack Trace Length: ${issue.stackTraceLength} chars`);
      });
      
      console.log('\n🎉 SUCCESS! Stack Traces ARE being populated in Production Issues!');
      console.log('The complete end-to-end flow is working!');
    } else {
      console.log('\n⚠️ No recent issues have Stack Traces populated yet.');
      console.log('This could mean:');
      console.log('1. Recent errors occurred before the fix was deployed');
      console.log('2. Need to wait for new errors to occur to see the fix in action');
    }
    
    // Check Stack Traces table too
    console.log('\n=== Checking Stack Traces Table ===');
    const stackTraceRecords = await masterBase('Stack Traces')
      .select({
        maxRecords: 10,
        sort: [{ field: 'Created At', direction: 'desc' }],
        fields: ['Timestamp', 'Run ID', 'Client ID', 'Error Message', 'Created At']
      })
      .all();
    
    console.log(`Found ${stackTraceRecords.length} recent Stack Trace records\n`);
    
    if (stackTraceRecords.length > 0) {
      console.log('Recent Stack Trace records:');
      stackTraceRecords.slice(0, 3).forEach((record, i) => {
        console.log(`\n${i + 1}. Timestamp: ${record.get('Timestamp')}`);
        console.log(`   Run ID: ${record.get('Run ID')}`);
        console.log(`   Client: ${record.get('Client ID')}`);
        console.log(`   Error: ${record.get('Error Message')?.substring(0, 60)}...`);
        console.log(`   Created: ${record.get('Created At')}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error checking Production Issues:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkProductionIssues()
  .then(() => {
    console.log('\n✅ Check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
