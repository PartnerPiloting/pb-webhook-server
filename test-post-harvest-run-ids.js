// test-post-harvest-run-ids.js
// Test to verify the fix for post harvesting run IDs

require('dotenv').config();
const runIdUtils = require('./utils/runIdUtils');
const airtableService = require('./services/airtableService');

// Test configuration
const TEST_CLIENT_ID = 'Guy-Wilson';
const TEST_APIFY_RUN_ID = '8MSTBAfqMzuXPvgB3'; // The raw Apify run ID
const POST_COUNT = 40; // Number of posts to record

async function testPostHarvestRunIds() {
  console.log('🧪 Testing post harvest run ID handling');
  
  try {
    // Step 1: Ensure we generate the client-suffixed run ID correctly
    const clientSuffixedRunId = runIdUtils.addClientSuffix(TEST_APIFY_RUN_ID, TEST_CLIENT_ID);
    console.log(`Generated client-suffixed run ID: ${clientSuffixedRunId} (from ${TEST_APIFY_RUN_ID})`);
    
    // Step 2: Get or create a client run record with the suffixed ID
    console.log(`Creating/retrieving client run record for ${clientSuffixedRunId} and client ${TEST_CLIENT_ID}`);
    const record = await airtableService.createClientRunRecord(clientSuffixedRunId, TEST_CLIENT_ID, TEST_CLIENT_ID);
    console.log(`Client run record created/retrieved: ${record.id}`);
    
    // Step 3: Update the record with post harvesting results
    console.log(`Updating client run record with ${POST_COUNT} posts harvested`);
    const updatedRecord = await airtableService.updateClientRun(clientSuffixedRunId, TEST_CLIENT_ID, {
      'Total Posts Harvested': POST_COUNT
    });
    console.log(`Updated client run record: ${updatedRecord.id}`);
    
    // Step 4: Verify that the record was updated correctly
    console.log('Verifying update...');
    const masterBase = await airtableService.getMasterBase();
    const runRecords = await masterBase('Client Runs').select({
      filterByFormula: `{Run ID} = '${clientSuffixedRunId}'`
    }).all();
    
    if (runRecords.length === 0) {
      console.error('❌ No records found with the suffixed run ID');
    } else if (runRecords.length > 1) {
      console.error(`❌ Found ${runRecords.length} records with the same run ID (expected 1)`);
    } else {
      const harvestedPosts = runRecords[0].get('Total Posts Harvested');
      console.log(`✅ Found 1 record with ${harvestedPosts} posts harvested`);
      
      if (harvestedPosts == POST_COUNT) {
        console.log('✅ Post count matches expected value');
      } else {
        console.error(`❌ Post count mismatch: expected ${POST_COUNT}, got ${harvestedPosts}`);
      }
    }
    
    console.log('Test completed');
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    console.error(error);
  }
}

// Run the test
testPostHarvestRunIds();