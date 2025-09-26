/**
 * test-post-harvesting-service.js
 * 
 * A test script to verify the post harvesting service works correctly.
 * Tests the ability to identify leads eligible for post harvesting and process them.
 */

require('dotenv').config();
const { Logger } = require('../infrastructure/logging/logger');
const { PostHarvestingService } = require('../domain/services/postHarvestingService');
const { generateRunId } = require('../domain/models/runIdGenerator');
const { AirtableClient } = require('../infrastructure/airtable/airtableClient');
const { STATUS, FIELDS, SERVICE_LEVELS } = require('../domain/models/constants');

// Create a logger
const logger = new Logger('TEST', null, 'test-post-harvesting');

/**
 * Mock Apify client
 */
class MockApifyClient {
  constructor() {
    this.runs = new Map();
  }
  
  async startTask({ taskId, input }) {
    const runId = `apify-run-${Date.now()}`;
    const run = {
      id: runId,
      status: 'RUNNING',
      taskId,
      input,
      startedAt: new Date().toISOString()
    };
    
    this.runs.set(runId, run);
    logger.info(`Mock Apify task started: ${runId}`);
    
    return run;
  }
  
  getRun(runId) {
    return this.runs.get(runId);
  }
}

/**
 * Test the post harvesting service
 * @param {string} clientId - The client ID to test with
 */
async function testPostHarvestingService(clientId) {
  logger.info('Starting post harvesting service test');
  
  try {
    // Generate a unique run ID for testing
    const runId = generateRunId();
    logger.info(`Generated run ID: ${runId}`);
    
    // Initialize Airtable client
    const airtableClient = new AirtableClient();
    
    // Create mock Apify client
    const mockApifyClient = new MockApifyClient();
    
    // Create the post harvesting service
    const postHarvestingService = new PostHarvestingService({
      airtableClient,
      apifyClient: mockApifyClient
    });
    
    // Initialize the service
    await postHarvestingService.initialize(clientId, runId, {
      logger
    });
    
    // Test harvestPosts method
    logger.info('Starting post harvesting test...');
    const result = await postHarvestingService.harvestPosts(clientId, runId, {
      logger,
      // Optional: limit number of leads to process
      limit: 5
    });
    
    // Log the results
    logger.info(`Post harvesting result: ${JSON.stringify(result, null, 2)}`);
    
    // Verify results
    if (result.status === STATUS.COMPLETED) {
      logger.info(`✅ Post harvesting completed successfully`);
      logger.info(`Leads processed: ${result.leadsProcessed}`);
      logger.info(`Leads eligible: ${result.leadsEligible}`);
      logger.info(`Posts harvested: ${result.postsHarvested}`);
    } else {
      logger.error(`❌ Post harvesting failed: ${result.errors.join(', ')}`);
      return false;
    }
    
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
    console.log('Usage: node test-post-harvesting-service.js <clientId>');
    process.exit(1);
  }
  
  logger.info(`Testing with client ID: ${clientId}`);
  const success = await testPostHarvestingService(clientId);
  
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

module.exports = { testPostHarvestingService };