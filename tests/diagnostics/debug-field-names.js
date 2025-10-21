// debug-field-names.js
// Utility script to verify field names in Airtable tables
// Run with: node debug-field-names.js <clientId>

require('dotenv').config();
const { getClientBase } = require('./config/airtableClient');
const clientService = require('./services/clientService');
const airtableService = require('./services/airtableService');

// Table constants - these are what the code expects
const EXPECTED = {
  CLIENT_RUN_RESULTS_TABLE: 'Client Run Results',
  RUN_ID_FIELD: 'Run ID'
};

// Check what's actually in airtableService.js
console.log('\n===== CONFIGURED TABLE/FIELD NAMES =====');
console.log(`airtableService.CLIENT_RUN_RESULTS_TABLE = ${airtableService.CLIENT_RUN_RESULTS_TABLE}`);
console.log(`Expected: ${EXPECTED.CLIENT_RUN_RESULTS_TABLE}`);
console.log(`Match: ${airtableService.CLIENT_RUN_RESULTS_TABLE === EXPECTED.CLIENT_RUN_RESULTS_TABLE ? '✅ YES' : '❌ NO'}`);

// Main function
async function checkFieldNames(clientId) {
  try {
    console.log(`\n===== CHECKING FIELD NAMES FOR CLIENT: ${clientId} =====`);
    
    // Get client info
    console.log('\nResolving client...');
    const client = await clientService.getClientById(clientId);
    if (!client) {
      console.error(`Client not found: ${clientId}`);
      return;
    }
    console.log(`Found client: ${client.clientName} (${clientId}), baseId=${client.airtableBaseId}`);
    
    // Get client base
    console.log('\nConnecting to client base...');
    const base = await getClientBase(clientId);
    console.log('Base connection established');
    
    // Check tables in the base
    console.log('\n===== AVAILABLE TABLES =====');
    try {
      // This won't work in Airtable API v2, but let's try
      const tables = await base.tables();
      console.log(tables.map(t => t.name));
    } catch (e) {
      console.log('Cannot list tables in Airtable API v2. Checking specific tables...');
    }
    
    // Try to access the Client Run Results table
    console.log(`\n===== CHECKING '${EXPECTED.CLIENT_RUN_RESULTS_TABLE}' TABLE =====`);
    try {
      const records = await base(EXPECTED.CLIENT_RUN_RESULTS_TABLE).select({
        maxRecords: 1
      }).firstPage();
      
      console.log(`✅ Table exists! Found ${records.length} records`);
      
      // If we found records, check their fields
      if (records.length > 0) {
        console.log('\n===== AVAILABLE FIELDS =====');
        const record = records[0];
        const fields = Object.keys(record.fields);
        console.log(fields);
        
        // Check if the Run ID field exists
        const hasRunIdField = fields.includes(EXPECTED.RUN_ID_FIELD);
        console.log(`\nDoes '${EXPECTED.RUN_ID_FIELD}' field exist? ${hasRunIdField ? '✅ YES' : '❌ NO'}`);
        
        // Show the value of the Run ID field
        if (hasRunIdField) {
          console.log(`Value: ${record.fields[EXPECTED.RUN_ID_FIELD]}`);
        } else {
          // Check for similar fields
          console.log('\nSearching for similar field names:');
          const similarFields = fields.filter(f => 
            f.toLowerCase().includes('run') || 
            f.toLowerCase().includes('id')
          );
          
          if (similarFields.length > 0) {
            console.log('Possible similar fields:');
            similarFields.forEach(field => {
              console.log(`- ${field}: ${record.fields[field]}`);
            });
          } else {
            console.log('No similar fields found');
          }
        }
      }
    } catch (e) {
      console.error(`❌ Error accessing table: ${e.message}`);
      
      // Try to see if there's a similar table name
      try {
        console.log('\nSearching for similar table names...');
        // Try common variations
        const variations = [
          'Client Run Results',
          'ClientRunResults',
          'Client_Run_Results',
          'client run results',
          'client_run_results',
          'Run Results',
          'RunResults'
        ];
        
        for (const tableName of variations) {
          try {
            const records = await base(tableName).select({
              maxRecords: 1
            }).firstPage();
            console.log(`✅ Found table '${tableName}' with ${records.length} records`);
          } catch (e) {
            if (!e.message.includes('Could not find')) {
              console.error(`Error checking '${tableName}': ${e.message}`);
            }
          }
        }
      } catch (e) {
        console.error(`Error searching for tables: ${e.message}`);
      }
    }
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
  }
}

// Get client ID from command line args
const clientId = process.argv[2];

if (!clientId) {
  console.error('Please provide a client ID as a command line argument');
  console.log('Example: node debug-field-names.js client123');
  process.exit(1);
}

// Run the main function
checkFieldNames(clientId)
  .then(() => console.log('\nDone!'))
  .catch(err => {
    console.error('\nFatal error:');
    console.error(err);
  })
  .finally(() => process.exit(0));