/**
 * test-run-record-service.js
 * 
 * A simple test script to verify the run record service works correctly.
 * This tests the core functionality of creating, updating, and completing run records.
 */

require('dotenv').config();
const { Logger } = require('../infrastructure/logging/logger');
const runRecordService = require('../domain/services/runRecordService');
const { generateRunId } = require('../domain/models/runIdGenerator');

// Create a logger
const logger = new Logger('TEST', null, 'test-run-record');

/**
 * Test the run record service
 * @param {string} clientId - The client ID to test with
 */
async function testRunRecordService(clientId) {
  logger.info('Starting run record service test');
  
  try {
    // Step 1: Generate a unique run ID for testing
    const runId = generateRunId();
    logger.info(`Generated run ID: ${runId}`);
    
    // Step 2: Create a job record (master tracking record)
    logger.info('Creating job record...');
    await runRecordService.createJobRecord(runId, 1);
    logger.info('Job record created successfully');
    
    // Step 3: Create a client-specific run record
    logger.info(`Creating client run record for client ${clientId}...`);
    await runRecordService.createRunRecord(runId, clientId, 'Test Client', { 
      source: 'test-script',
      logger 
    });
    logger.info('Client run record created successfully');
    
    // Step 4: Update the run record with test metrics
    logger.info('Updating run record with test metrics...');
    await runRecordService.updateRunRecord(runId, clientId, {
      'Total Leads Scored': 10,
      'Token Usage': 5000,
      'System Notes': 'Test update from test script'
    }, {
      source: 'test-script',
      logger
    });
    logger.info('Run record updated successfully');
    
    // Step 5: Complete the run record
    logger.info('Completing run record...');
    await runRecordService.completeRunRecord(runId, clientId, true, 'Test completed successfully', {
      source: 'test-script',
      logger
    });
    logger.info('Run record completed successfully');
    
    // Step 6: Update the job aggregates
    logger.info('Updating job aggregates...');
    await runRecordService.updateJobAggregates(runId);
    logger.info('Job aggregates updated successfully');
    
    // Step 7: Complete the job record
    logger.info('Completing job record...');
    await runRecordService.completeJobRecord(runId, true, 'Test job completed');
    logger.info('Job record completed successfully');
    
    logger.info('Run record service test completed successfully');
    return true;
  } catch (error) {
    logger.error(`Test failed: ${error.message}`, error.stack);
    return false;
  }
}

/**
 * Main entry point
 */
async function main() {
  // Check if client ID is provided
  const clientId = process.argv[2];
  if (!clientId) {
    console.log('Usage: node test-run-record-service.js <clientId>');
    process.exit(1);
  }
  
  logger.info(`Testing with client ID: ${clientId}`);
  const success = await testRunRecordService(clientId);
  
  if (success) {
    logger.info('✅ All tests passed');
    process.exit(0);
  } else {
    logger.error('❌ Test failed');
    process.exit(1);
  }
}

// Run the test if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { testRunRecordService };