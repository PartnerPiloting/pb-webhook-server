// Quick script to query Error 17 from Airtable Error Log
const { getMasterClientsBase } = require('./config/airtableClient');
const { ERROR_LOG_FIELDS, MASTER_TABLES } = require('./constants/airtableUnifiedConstants');

async function queryError17() {
  try {
    const masterBase = getMasterClientsBase();
    
    // Query the specific record ID from the logs
    const recordId = 'reculhB1TtyclXFM1';
    
    console.log(`\n🔍 Querying Error Log record: ${recordId}\n`);
    
    const record = await masterBase(MASTER_TABLES.ERROR_LOG).find(recordId);
    
    console.log('📋 ERROR DETAILS:');
    console.log('================');
    console.log(`Error ID: ${record.get(ERROR_LOG_FIELDS.ERROR_ID)}`);
    console.log(`Timestamp: ${record.get(ERROR_LOG_FIELDS.TIMESTAMP)}`);
    console.log(`Severity: ${record.get(ERROR_LOG_FIELDS.SEVERITY)}`);
    console.log(`Error Type: ${record.get(ERROR_LOG_FIELDS.ERROR_TYPE)}`);
    console.log(`Status: ${record.get(ERROR_LOG_FIELDS.STATUS)}`);
    console.log(`\nMessage: ${record.get(ERROR_LOG_FIELDS.ERROR_MESSAGE)}`);
    console.log(`\nStack Trace:\n${record.get(ERROR_LOG_FIELDS.STACK_TRACE)}`);
    console.log(`\nFile: ${record.get(ERROR_LOG_FIELDS.FILE_PATH)}`);
    console.log(`Line: ${record.get(ERROR_LOG_FIELDS.LINE_NUMBER)}`);
    console.log(`Function: ${record.get(ERROR_LOG_FIELDS.FUNCTION_NAME)}`);
    
    const contextJson = record.get(ERROR_LOG_FIELDS.CONTEXT_JSON);
    if (contextJson) {
      console.log(`\nContext JSON:\n${JSON.stringify(JSON.parse(contextJson), null, 2)}`);
    }
    
    console.log('\n================\n');
    
  } catch (error) {
    console.error('❌ Failed to query error:', error.message);
    console.error(error.stack);
  }
}

queryError17().then(() => process.exit(0));
