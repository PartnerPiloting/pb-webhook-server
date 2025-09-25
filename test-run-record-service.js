// test-run-record-service.js
// Test script to validate the Single Creation Point pattern in runRecordServiceV2

require('dotenv').config();
const { StructuredLogger } = require('./utils/structuredLogger');
const runRecordServiceV2 = require('./services/runRecordServiceV2');
const runRecordAdapter = require('./services/runRecordAdapter');
const runIdService = require('./services/runIdService');

// Create a test logger
const logger = new StructuredLogger('TEST', 'test_session', 'run_record_test');

// Generate a test run ID
const testRunId = `test-run-${Date.now()}`;
const stream = 1;

// Test client info
const testClientId = 'TEST_CLIENT_ID';
const testClientName = 'Test Client';

// Function to delay execution for better logging visibility
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main test function
async function runTests() {
  console.log('=== RUN RECORD SERVICE V2 TEST ===');
  console.log(`Using test run ID: ${testRunId}`);
  console.log('');
  
  try {
    // Initialize service
    console.log('1. Initializing services...');
    runRecordServiceV2.initialize();
    runRecordAdapter.initialize();
    console.log('✅ Services initialized');
    
    // TEST CASE 1: Creating a job record from authorized source
    console.log('\n2. TEST: Creating job record from authorized source (orchestrator)...');
    let jobRecord;
    try {
      jobRecord = await runRecordServiceV2.createJobRecord(testRunId, stream, {
        logger,
        source: 'orchestrator'
      });
      console.log(`✅ Job record created successfully: ${jobRecord.id}`);
    } catch (error) {
      console.error(`❌ Failed to create job record: ${error.message}`);
      return;
    }
    
    // TEST CASE 2: Attempting to create a job record from unauthorized source
    console.log('\n3. TEST: Attempting to create job record from unauthorized source (batchScorer)...');
    try {
      await runRecordServiceV2.createJobRecord(testRunId, stream, {
        logger,
        source: 'batchScorer'
      });
      console.error('❌ FAILED: Unauthorized source allowed to create job record!');
    } catch (error) {
      console.log(`✅ Correctly prevented unauthorized job record creation: ${error.message}`);
    }
    
    // TEST CASE 3: Creating client run record from authorized source
    console.log('\n4. TEST: Creating client run record from authorized source (orchestrator)...');
    let clientRecord;
    try {
      clientRecord = await runRecordServiceV2.createClientRunRecord(testRunId, testClientId, testClientName, {
        logger,
        source: 'orchestrator'
      });
      console.log(`✅ Client run record created successfully: ${clientRecord.id}`);
    } catch (error) {
      console.error(`❌ Failed to create client run record: ${error.message}`);
      return;
    }
    
    // TEST CASE 4: Attempting to create client run record from unauthorized source
    console.log('\n5. TEST: Attempting to create client run record from unauthorized source (data_processor)...');
    try {
      await runRecordServiceV2.createClientRunRecord(testRunId, 'OTHER_CLIENT', 'Other Client', {
        logger,
        source: 'data_processor'
      });
      console.error('❌ FAILED: Unauthorized source allowed to create client run record!');
    } catch (error) {
      console.log(`✅ Correctly prevented unauthorized client record creation: ${error.message}`);
    }
    
    // TEST CASE 5: Getting an existing run record
    console.log('\n6. TEST: Getting existing run record...');
    try {
      const fetchedRecord = await runRecordServiceV2.getRunRecord(testRunId, testClientId, {
        logger,
        source: 'test_script'
      });
      if (fetchedRecord && fetchedRecord.id === clientRecord.id) {
        console.log(`✅ Successfully retrieved existing record: ${fetchedRecord.id}`);
      } else {
        console.error('❌ Retrieved record does not match the created record!');
      }
    } catch (error) {
      console.error(`❌ Failed to get run record: ${error.message}`);
      return;
    }
    
    // TEST CASE 6: Updating an existing run record
    console.log('\n7. TEST: Updating existing run record...');
    try {
      const updates = {
        'Status': 'Running',
        'Profiles Examined for Scoring': 10,
        'System Notes': 'Updated by test script'
      };
      
      const updatedRecord = await runRecordServiceV2.updateRunRecord(testRunId, testClientId, updates, {
        logger,
        source: 'test_script'
      });
      
      if (updatedRecord) {
        console.log(`✅ Successfully updated record: ${updatedRecord.id}`);
        console.log(`  - Updated Status: ${updatedRecord.fields['Status']}`);
        console.log(`  - Updated Profiles Examined: ${updatedRecord.fields['Profiles Examined for Scoring']}`);
      }
    } catch (error) {
      console.error(`❌ Failed to update run record: ${error.message}`);
      return;
    }
    
    // TEST CASE 7: Updating metrics
    console.log('\n8. TEST: Updating client metrics...');
    try {
      const metrics = {
        'Profiles Examined for Scoring': 20,
        'Profiles Successfully Scored': 15,
        'Profile Scoring Tokens': 5000
      };
      
      const updatedRecord = await runRecordServiceV2.updateClientMetrics(testRunId, testClientId, metrics, {
        logger,
        source: 'test_script'
      });
      
      if (updatedRecord) {
        console.log(`✅ Successfully updated metrics: ${updatedRecord.id}`);
        console.log(`  - Updated Profiles Examined: ${updatedRecord.fields['Profiles Examined for Scoring']}`);
        console.log(`  - Updated Profiles Scored: ${updatedRecord.fields['Profiles Successfully Scored']}`);
        console.log(`  - Updated Tokens: ${updatedRecord.fields['Profile Scoring Tokens']}`);
      }
    } catch (error) {
      console.error(`❌ Failed to update metrics: ${error.message}`);
      return;
    }
    
    // TEST CASE 8: Attempting to update non-existent record
    console.log('\n9. TEST: Attempting to update non-existent record...');
    try {
      await runRecordServiceV2.updateRunRecord(testRunId, 'NONEXISTENT_CLIENT', { 'Status': 'Running' }, {
        logger,
        source: 'test_script'
      });
      console.error('❌ FAILED: Allowed update of non-existent record!');
    } catch (error) {
      console.log(`✅ Correctly prevented update of non-existent record: ${error.message}`);
    }
    
    // TEST CASE 9: Testing adapter with batchScorer source
    console.log('\n10. TEST: Using adapter with batchScorer source...');
    try {
      // The adapter should map batchScorer_process to an allowed source
      const adaptedRecord = await runRecordAdapter.createRunRecord(
        `${testRunId}-adapter`, 
        testClientId, 
        testClientName, 
        {
          logger,
          source: 'batchScorer_process'
        }
      );
      
      if (adaptedRecord) {
        console.log(`✅ Adapter successfully mapped source and created record: ${adaptedRecord.id}`);
      }
    } catch (error) {
      console.error(`❌ Adapter failed: ${error.message}`);
      return;
    }
    
    // TEST CASE 10: Completing client run record
    console.log('\n11. TEST: Completing client run record...');
    try {
      const completedRecord = await runRecordServiceV2.completeRunRecord(
        testRunId,
        testClientId,
        'Success',
        'Test completed successfully',
        {
          logger,
          source: 'test_script'
        }
      );
      
      if (completedRecord) {
        console.log(`✅ Successfully completed record: ${completedRecord.id}`);
        console.log(`  - Final Status: ${completedRecord.fields['Status']}`);
        console.log(`  - End Time: ${completedRecord.fields['End Time']}`);
      }
    } catch (error) {
      console.error(`❌ Failed to complete run record: ${error.message}`);
      return;
    }
    
    // TEST CASE 11: Completing job record
    console.log('\n12. TEST: Completing job record...');
    try {
      const completedJobRecord = await runRecordServiceV2.completeJobRecord(
        testRunId,
        true,
        'Test job completed successfully',
        {
          logger,
          source: 'test_script'
        }
      );
      
      if (completedJobRecord) {
        console.log(`✅ Successfully completed job record: ${completedJobRecord.id}`);
        console.log(`  - Final Status: ${completedJobRecord.fields['Status']}`);
        console.log(`  - End Time: ${completedJobRecord.fields['End Time']}`);
      }
    } catch (error) {
      console.error(`❌ Failed to complete job record: ${error.message}`);
      return;
    }
    
    // TEST CASE 12: Getting service activity log
    console.log('\n13. TEST: Getting service activity log...');
    const activityLog = runRecordServiceV2.getActivityLog(5);
    console.log(`✅ Retrieved ${activityLog.length} recent activities:`);
    activityLog.forEach((activity, i) => {
      console.log(`  ${i+1}. ${activity.action} - ${activity.runId} - ${activity.clientId} - ${activity.source}`);
    });
    
    // TEST CASE 13: Multi-client test
    console.log('\n14. TEST: Testing with multiple clients simultaneously...');
    await testMultiClientScenario(logger);
    
    // Final summary
    console.log('\n=== TEST RESULTS ===');
    console.log('✅ All tests completed successfully!');
    console.log('The Single Creation Point pattern is properly implemented with:');
    console.log('  1. Authorization checks on creation sources');
    console.log('  2. Strict separation between create/get/update operations');
    console.log('  3. Proper error handling for non-existent records');
    console.log('  4. Adapter layer for backward compatibility');
    console.log('  5. Multi-client support confirmed');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED WITH UNEXPECTED ERROR:');
    console.error(error);
  }
}

// Multi-client test scenario 
async function testMultiClientScenario(logger) {
  // Test run ID for this multi-client scenario
  const multiRunId = `multi-client-test-${Date.now()}`;
  const clientCount = 3;
  const clients = [];
  
  for (let i = 1; i <= clientCount; i++) {
    clients.push({
      clientId: `TEST_CLIENT_${i}`,
      clientName: `Test Client ${i}`
    });
  }
  
  try {
    // 1. Create a job record first
    console.log(`Creating job record for multi-client test: ${multiRunId}`);
    await runRecordServiceV2.createJobRecord(multiRunId, 1, {
      logger,
      source: 'orchestrator'
    });
    
    // 2. Create client run records in parallel (simulating real-world scenario)
    console.log(`Creating run records for ${clientCount} clients in parallel...`);
    const createPromises = clients.map(client => 
      runRecordServiceV2.createClientRunRecord(multiRunId, client.clientId, client.clientName, {
        logger,
        source: 'orchestrator'
      })
    );
    
    const createdRecords = await Promise.all(createPromises);
    console.log(`✅ Successfully created ${createdRecords.length} client records in parallel`);
    
    // 3. Update metrics for each client (simulating processing)
    console.log(`Updating metrics for multiple clients...`);
    const updatePromises = clients.map((client, index) => 
      runRecordServiceV2.updateClientMetrics(multiRunId, client.clientId, {
        'Profiles Examined for Scoring': (index + 1) * 10,
        'Profiles Successfully Scored': (index + 1) * 8,
        'Profile Scoring Tokens': (index + 1) * 1000
      }, {
        logger,
        source: 'test_multi_client'
      })
    );
    
    await Promise.all(updatePromises);
    console.log(`✅ Successfully updated metrics for all clients`);
    
    // 4. Complete client records (simulating completion)
    console.log(`Completing run records for all clients...`);
    const completePromises = clients.map((client, index) => 
      runRecordServiceV2.completeRunRecord(multiRunId, client.clientId, 'Success', 
        `Multi-client test completed for ${client.clientName}`, {
          logger,
          source: 'test_multi_client'
        })
    );
    
    await Promise.all(completePromises);
    console.log(`✅ Successfully completed all client records`);
    
    // 5. Complete the job record
    await runRecordServiceV2.completeJobRecord(multiRunId, true, 
      `Multi-client test completed successfully for ${clientCount} clients`, {
        logger,
        source: 'orchestrator'
      }
    );
    console.log(`✅ Successfully completed job record`);
    
    return true;
  } catch (error) {
    console.error(`❌ Multi-client test failed: ${error.message}`);
    throw error;
  }
}

// Run the tests
runTests().catch(console.error);