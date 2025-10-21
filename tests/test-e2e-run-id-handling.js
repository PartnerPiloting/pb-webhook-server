// test-e2e-run-id-handling.js
// End-to-end test of run ID handling across the system

require('dotenv').config();
const runIdUtils = require('./utils/runIdUtils');
const runIdGenerator = require('./utils/runIdGenerator');
const airtableService = require('./services/airtableService');
const recordCache = require('./services/recordCache');

/**
 * Tests the entire run ID handling flow:
 * 1. Generate a run ID
 * 2. Create job tracking record
 * 3. Process multiple clients with consistent client-specific run IDs
 * 4. Update aggregate metrics
 * 5. Complete the job
 */
async function testEndToEndRunIdHandling() {
  console.log('=== Testing End-to-End Run ID Handling ===\n');
  
  try {
    // Generate a run ID (similar to what batchScorer.js would do)
    // Note: generateRunId is synchronous, no need to await
    const baseRunId = runIdGenerator.generateRunId();
    console.log(`Generated base run ID: ${baseRunId}`);
    
    // Create job tracking record
    console.log('\n1. Creating job tracking record...');
    const jobRecord = await airtableService.createJobTrackingRecord(baseRunId, 1);
    console.log(`Job tracking record created with ID: ${jobRecord.id}`);
    console.log(`Run ID in record: ${jobRecord.get('Run ID')}`);
    
    // Test clients to process
    const clients = [
      { id: 'TEST-ABC', name: 'Test Client ABC' },
      { id: 'TEST-XYZ', name: 'Test Client XYZ' },
    ];
    
    console.log('\n2. Processing multiple clients...');
    for (const client of clients) {
      console.log(`\nProcessing client ${client.id}...`);
      
      // Create client run record
      console.log(`Creating client run record...`);
      const clientRecord = await airtableService.createClientRunRecord(baseRunId, client.id, client.name);
      console.log(`Client run record created with ID: ${clientRecord.id}`);
      console.log(`Run ID in record: ${clientRecord.get('Run ID')}`);
      
      // Verify it has the correct client suffix
      const expectedClientRunId = runIdUtils.addClientSuffix(baseRunId, client.id);
      console.log(`Expected client-specific run ID: ${expectedClientRunId}`);
      console.log(`Matches: ${clientRecord.get('Run ID') === expectedClientRunId ? 'YES' : 'NO'}`);
      
      // Update client run with some metrics
      console.log(`Updating client run with metrics...`);
      const updates = {
        'Profiles Examined for Scoring': 50,
        'Profiles Successfully Scored': 45,
        'Profile Scoring Tokens': 25000,
        'System Notes': `Test update at ${new Date().toISOString()}`
      };
      
      const updatedRecord = await airtableService.updateClientRun(baseRunId, client.id, updates);
      console.log(`Client run updated successfully with ID: ${updatedRecord.id}`);
      
      // Complete client run
      console.log(`Completing client run...`);
      const completedRecord = await airtableService.completeClientRun(baseRunId, client.id, true, 'Test completion');
      console.log(`Client run completed successfully with ID: ${completedRecord.id}`);
    }
    
    // Update aggregate metrics
    console.log('\n3. Updating aggregate metrics...');
    const aggregateRecord = await airtableService.updateAggregateMetrics(baseRunId);
    console.log(`Aggregate metrics updated successfully`);
    console.log(`Total clients processed: ${aggregateRecord.get('Clients Processed')}`);
    console.log(`Total profiles examined: ${aggregateRecord.get('Total Profiles Examined')}`);
    
    // Complete the job
    console.log('\n4. Completing job...');
    const completedJob = await airtableService.completeJobRun(baseRunId, true, 'End-to-end test completion');
    console.log(`Job completed successfully with status: ${completedJob.get('Status')}`);
    
    console.log('\n=== End-to-End Test Completed Successfully ===');
  } catch (error) {
    console.error('Error in end-to-end test:', error);
    throw error;
  }
}

// Run the test
testEndToEndRunIdHandling().catch(err => {
  console.error('Test failed with error:', err);
});