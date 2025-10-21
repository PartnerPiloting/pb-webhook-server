/**
 * Check Production Issues for INVALID_VALUE_FOR_COLUMN errors
 */

require('dotenv').config();
const Airtable = require('airtable');

async function checkErrors() {
  if (!process.env.MASTER_CLIENTS_BASE_ID || !process.env.AIRTABLE_API_KEY) {
    console.error('Missing MASTER_CLIENTS_BASE_ID or AIRTABLE_API_KEY');
    process.exit(1);
  }

  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_CLIENTS_BASE_ID);

  console.log('Checking Production Issues for INVALID_VALUE_FOR_COLUMN errors...\n');

  try {
    const records = await base('Production Issues')
      .select({
        filterByFormula: "AND({Status} != 'FIXED', FIND('INVALID_VALUE_FOR_COLUMN', {Error Message}) > 0)",
        fields: ['Error Message', 'Context', 'Stack Trace Link', 'Run ID', 'Timestamp', 'Severity'],
        sort: [{ field: 'Timestamp', direction: 'desc' }],
        maxRecords: 10
      })
      .all();

    console.log(`Found ${records.length} INVALID_VALUE_FOR_COLUMN errors:\n`);

    for (const record of records) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Run ID: ${record.get('Run ID')}`);
      console.log(`Severity: ${record.get('Severity')}`);
      console.log(`Timestamp: ${record.get('Timestamp')}`);
      console.log(`\nFull Error Message:`);
      console.log(record.get('Error Message'));
      
      const context = record.get('Context');
      if (context) {
        console.log(`\n📋 Context (25 lines before/after):`);
        console.log(context.substring(0, 1000));
        if (context.length > 1000) {
          console.log('... (truncated)');
        }
      }
      
      const stackTraceLinks = record.get('Stack Trace Link');
      if (stackTraceLinks && stackTraceLinks.length > 0) {
        console.log(`\n✅ HAS STACK TRACE: ${stackTraceLinks.length} trace(s) linked`);
        
        for (const link of stackTraceLinks) {
          try {
            const stackRecord = await base('Stack Traces').find(link);
            const stackTrace = stackRecord.get('Stack Trace');
            console.log('\n📍 STACK TRACE:');
            console.log(stackTrace?.substring(0, 800));
            if (stackTrace && stackTrace.length > 800) {
              console.log('... (truncated)');
            }
          } catch (err) {
            console.log(`❌ Could not fetch stack trace: ${err.message}`);
          }
        }
      } else {
        console.log('\n❌ NO STACK TRACE');
      }
      console.log('\n');
    }

    if (records.length === 0) {
      console.log('✅ No INVALID_VALUE_FOR_COLUMN errors found!');
    }

  } catch (error) {
    console.error('Error fetching records:', error.message);
    process.exit(1);
  }
}

checkErrors().catch(console.error);
