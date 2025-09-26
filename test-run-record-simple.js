// test-run-record-simple.js
// Test script for the simplified run record service

require('dotenv').config();
const airtableServiceSimple = require('./services/airtableServiceSimple');
const runRecordAdapterSimple = require('./services/runRecordAdapterSimple');
const { generateRunId } = require('./utils/runIdGenerator');
const clientService = require('./services/clientService');

async function testSimpleRecordService() {
  console.log('=== TESTING SIMPLIFIED RUN RECORD SERVICE ===');
  
  try {
    // Generate a run ID for testing
    const runId = await generateRunId();
    console.log(`Generated run ID: ${runId}`);
    
    // Get a test client
    const clients = await clientService.getAllActiveClients();
    if (!clients || clients.length === 0) {
      throw new Error('No active clients found for testing');
    }
    
    const testClient = clients[0];
    console.log(`Using test client: ${testClient.clientName} (${testClient.clientId})`);
    
    // Step 1: Create a job tracking record
    console.log('\n=== Step 1: Create Job Tracking Record ===');
    const jobRecord = await runRecordAdapterSimple.createJobRecord(runId);
    console.log(`Created job record: ${jobRecord.id}`);
    
    // Step 2: Create a client run record
    console.log('\n=== Step 2: Create Client Run Record ===');
    const clientRunRecord = await runRecordAdapterSimple.createRunRecord(
      runId, 
      testClient.clientId, 
      testClient.clientName,
      { source: 'test_script' }
    );
    console.log(`Created client run record: ${clientRunRecord.id}`);
    
    // Step 3: Update the client run record
    console.log('\n=== Step 3: Update Client Run Record ===');
    const updateResult = await runRecordAdapterSimple.updateRunRecord(
      runId,
      testClient.clientId,
      {
        'Profiles Examined for Scoring': 10,
        'Profiles Successfully Scored': 8,
        'System Notes': 'Updated by test script'
      },
      { source: 'test_script' }
    );
    console.log(`Updated client run record: ${updateResult.id}`);
    
    // Step 4: Update aggregate metrics
    console.log('\n=== Step 4: Update Aggregate Metrics ===');
    const aggregateResult = await runRecordAdapterSimple.updateJobAggregates(runId);
    console.log('Updated aggregate metrics');
    
    // Step 5: Complete the client run
    console.log('\n=== Step 5: Complete Client Run ===');
    const completeClientResult = await runRecordAdapterSimple.completeRunRecord(
      runId,
      testClient.clientId,
      true,
      'Test completed successfully',
      { source: 'test_script' }
    );
    console.log(`Completed client run record: ${completeClientResult.id}`);
    
    // Step 6: Complete the job run
    console.log('\n=== Step 6: Complete Job Run ===');
    const completeJobResult = await runRecordAdapterSimple.completeJobRecord(
      runId,
      true,
      'Test job completed successfully'
    );
    console.log('Completed job record');
    
    console.log('\n=== TEST COMPLETED SUCCESSFULLY ===');
    
  } catch (error) {
    console.error('\n=== TEST FAILED ===');
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
  }
}

// Run the test
testSimpleRecordService().then(() => {
  console.log('Test script execution finished');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error in test script:', err);
  process.exit(1);
});