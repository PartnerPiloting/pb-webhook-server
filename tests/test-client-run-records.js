// test-client-run-records.js
// Tests the creation and update of client run records with consistent run IDs

require('dotenv').config();
const runIdUtils = require('./utils/runIdUtils');
const airtableService = require('./services/airtableService');
const recordCache = require('./services/recordCache');

/**
 * Tests creating and updating client run records
 */
async function testClientRunRecords() {
  console.log('Testing client run record creation and updates with consistent run IDs...\n');
  
  // Generate a test run ID with timestamp
  const now = new Date();
  const dateStr = `${now.getFullYear().toString().substring(2)}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
  const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
  const baseRunId = `SR-${dateStr}-${timeStr}-T9999-S1`;
  
  console.log(`Base Run ID: ${baseRunId}`);
  
  // Test clients
  const clients = [
    { id: 'TEST-123', name: 'Test Client 123' },
    { id: 'TEST-456', name: 'Test Client 456' },
  ];

  // Initialize Airtable service
  console.log('Initializing Airtable service...');
  airtableService.initialize();
  
  // First create a job tracking record
  console.log('Creating job tracking record...');
  const jobRecord = await airtableService.createJobTrackingRecord(baseRunId, 1);
  console.log(`Job tracking record created with ID: ${jobRecord.id}`);
  
  // Create and update client records
  for (const client of clients) {
    console.log(`\nProcessing client ${client.id}...`);
    
    // Create client run record
    console.log(`Creating client run record for ${client.id}...`);
    const clientRecord = await airtableService.createClientRunRecord(baseRunId, client.id, client.name);
    console.log(`Client run record created with ID: ${clientRecord.id}`);
    console.log(`Run ID stored in record: ${clientRecord.get('Run ID')}`);
    
    // Check if the run ID has the client suffix
    const expectedClientRunId = runIdUtils.addClientSuffix(baseRunId, client.id);
    console.log(`Expected client run ID: ${expectedClientRunId}`);
    console.log(`Actual client run ID: ${clientRecord.get('Run ID')}`);
    console.log(`Matches expected: ${clientRecord.get('Run ID') === expectedClientRunId ? 'YES' : 'NO'}`);
    
    // Update client run with some metrics
    console.log(`Updating client run record for ${client.id}...`);
    const updates = {
      'Profiles Examined for Scoring': 10,
      'Profiles Successfully Scored': 8,
      'System Notes': `Test update at ${new Date().toISOString()}`
    };
    
    const updatedRecord = await airtableService.updateClientRun(baseRunId, client.id, updates);
    console.log(`Client run record updated with ID: ${updatedRecord.id}`);
    
    // Complete client run
    console.log(`Completing client run for ${client.id}...`);
    const completedRecord = await airtableService.completeClientRun(baseRunId, client.id, true, 'Test completion');
    console.log(`Client run completed with ID: ${completedRecord.id}`);
  }
  
  // Update aggregate metrics
  console.log('\nUpdating aggregate metrics...');
  const aggregateRecord = await airtableService.updateAggregateMetrics(baseRunId);
  console.log(`Aggregate metrics updated, clients processed: ${aggregateRecord.get('Clients Processed')}`);
  
  // Complete job
  console.log('\nCompleting job...');
  const completedJob = await airtableService.completeJobRun(baseRunId, true, 'Test job completion');
  console.log(`Job completed, status: ${completedJob.get('Status')}`);
  
  console.log('\nAll tests completed successfully!');
}

// Run the test
testClientRunRecords().catch(error => {
  console.error('Error in test:', error);
});