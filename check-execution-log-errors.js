/**
 * Quick script to check Production Issues for Execution Log errors and their stack traces
 */

require('dotenv').config();
const Airtable = require('airtable');

async function checkErrors() {
  if (!process.env.MASTER_CLIENTS_BASE_ID || !process.env.AIRTABLE_API_KEY) {
    console.error('Missing MASTER_CLIENTS_BASE_ID or AIRTABLE_API_KEY');
    process.exit(1);
  }

  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_CLIENTS_BASE_ID);

  console.log('Checking Production Issues for Execution Log errors...\n');

  try {
    const records = await base('Production Issues')
      .select({
        filterByFormula: "AND({Status} != 'FIXED', FIND('Execution Log', {Error Message}) > 0)",
        fields: ['Error Message', 'Stack Trace Link', 'Run ID', 'Timestamp', 'Severity'],
        sort: [{ field: 'Timestamp', direction: 'desc' }],
        maxRecords: 10
      })
      .all();

    console.log(`Found ${records.length} unfixed Execution Log errors:\n`);

    for (const record of records) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Run ID: ${record.get('Run ID')}`);
      console.log(`Severity: ${record.get('Severity')}`);
      console.log(`Timestamp: ${record.get('Timestamp')}`);
      console.log(`Error: ${record.get('Error Message')?.substring(0, 200)}...`);
      
      const stackTraceLinks = record.get('Stack Trace Link');
      if (stackTraceLinks && stackTraceLinks.length > 0) {
        console.log(`✅ HAS STACK TRACE: ${stackTraceLinks.length} trace(s) linked`);
        
        // Fetch the stack trace details
        for (const link of stackTraceLinks) {
          try {
            const stackRecord = await base('Stack Traces').find(link);
            const stackTrace = stackRecord.get('Stack Trace');
            console.log('\n📍 STACK TRACE:');
            console.log(stackTrace?.substring(0, 500));
            if (stackTrace && stackTrace.length > 500) {
              console.log('... (truncated)');
            }
          } catch (err) {
            console.log(`❌ Could not fetch stack trace: ${err.message}`);
          }
        }
      } else {
        console.log('❌ NO STACK TRACE');
      }
      console.log('');
    }

    if (records.length === 0) {
      console.log('✅ No unfixed Execution Log errors found!');
      console.log('This might mean the issue has been fixed.');
    }

  } catch (error) {
    console.error('Error fetching records:', error.message);
    process.exit(1);
  }
}

checkErrors().catch(console.error);
