/**
 * test-workflow-orchestrator.js
 * 
 * A test script to verify the complete workflow orchestration works correctly.
 * Tests the full process from lead scoring through post harvesting to post scoring.
 */

require('dotenv').config();
const { Logger } = require('../infrastructure/logging/logger');
const { WorkflowOrchestrator } = require('../domain/services/workflowOrchestrator');
const { AiService } = require('../infrastructure/ai/aiService');
const { AirtableClient } = require('../infrastructure/airtable/airtableClient');
const { generateRunId } = require('../domain/models/runIdGenerator');
const { STATUS } = require('../domain/models/constants');

// Create a logger
const logger = new Logger('TEST', null, 'test-workflow');

/**
 * Mock Apify client for testing
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
 * Test the workflow orchestrator with a real client
 * @param {string} clientId - The client ID to test with
 * @param {Object} options - Test options
 */
async function testWorkflowOrchestrator(clientId, options = {}) {
  logger.info('Starting workflow orchestrator test');
  
  try {
    // Generate a unique run ID for testing
    const runId = generateRunId();
    logger.info(`Generated run ID: ${runId}`);
    
    // Initialize dependencies
    const airtableClient = new AirtableClient();
    const aiService = new AiService();
    
    // Create mock Apify client
    const mockApifyClient = new MockApifyClient();
    
    // Create the workflow orchestrator
    const workflowOrchestrator = new WorkflowOrchestrator({
      airtableClient,
      aiService,
      apifyClient: mockApifyClient
    });
    
    // Set test options
    const testOptions = {
      ...options,
      runId,
      logger,
      // Optional: limit leads to process
      limit: options.limit || 5,
      // For testing only - if true, will skip actually calling AI models
      dryRun: options.dryRun || false
    };
    
    // Test the workflow
    logger.info(`Starting workflow for client ${clientId} with options:`, testOptions);
    const result = await workflowOrchestrator.processClient(clientId, testOptions);
    
    // Log the results
    logger.info(`Workflow result status: ${result.status}`);
    logger.info(`Operations executed: ${result.operations.length}`);
    logger.info(`Total tokens used: ${result.totalTokens}`);
    
    if (result.errors && result.errors.length > 0) {
      logger.error(`Workflow errors: ${result.errors.join('\n')}`);
    }
    
    // Log details of each operation
    result.operations.forEach(op => {
      logger.info(`Step ${op.step}: ${op.status}`);
      if (op.details) {
        const details = op.details;
        
        // Show relevant metrics based on step
        if (op.step === 'lead_scoring') {
          logger.info(`  Leads processed: ${details.leadsProcessed}, Scored: ${details.successful}, Failed: ${details.failed}`);
        } else if (op.step === 'post_harvesting') {
          logger.info(`  Leads processed: ${details.leadsProcessed}, Eligible: ${details.leadsEligible}, Posts harvested: ${details.postsHarvested}`);
        } else if (op.step === 'post_scoring') {
          logger.info(`  Leads processed: ${details.leadsProcessed}, Posts processed: ${details.postsProcessed}, Posts scored: ${details.postsScored}`);
        }
      }
    });
    
    // Verify success
    if (result.status === STATUS.COMPLETED || result.status === STATUS.PARTIAL) {
      logger.info('✅ Workflow completed successfully');
      return true;
    } else {
      logger.error('❌ Workflow failed');
      return false;
    }
  } catch (error) {
    logger.error(`Test failed: ${error.message}`, error.stack);
    return false;
  }
}

/**
 * Test processing multiple clients
 * @param {Array<string>} clientIds - Array of client IDs to test with
 * @param {Object} options - Test options
 */
async function testMultiClientWorkflow(clientIds, options = {}) {
  logger.info('Starting multi-client workflow test');
  
  try {
    // Initialize dependencies
    const airtableClient = new AirtableClient();
    const aiService = new AiService();
    const mockApifyClient = new MockApifyClient();
    
    // Create the workflow orchestrator
    const workflowOrchestrator = new WorkflowOrchestrator({
      airtableClient,
      aiService,
      apifyClient: mockApifyClient
    });
    
    // Set test options
    const testOptions = {
      ...options,
      logger,
      // Optional: limit leads to process
      limit: options.limit || 3,
      // For testing only - if true, will skip actually calling AI models
      dryRun: options.dryRun || true
    };
    
    // Test the workflow
    logger.info(`Starting multi-client workflow for ${clientIds.length} clients with options:`, testOptions);
    const result = await workflowOrchestrator.processMultipleClients(clientIds, testOptions);
    
    // Log the results
    logger.info(`Multi-client workflow completed`);
    logger.info(`Total clients: ${result.clientsTotal}, Successful: ${result.clientsSuccessful}, Failed: ${result.clientsFailed}`);
    logger.info(`Total tokens used: ${result.totalTokens}`);
    
    // Log result for each client
    result.clientResults.forEach(clientResult => {
      logger.info(`Client ${clientResult.clientId}: ${clientResult.status}`);
      if (clientResult.errors && clientResult.errors.length > 0) {
        logger.error(`  Errors: ${clientResult.errors.join('\n')}`);
      }
    });
    
    // Verify success
    if (result.clientsFailed === 0) {
      logger.info('✅ Multi-client workflow completed successfully');
      return true;
    } else {
      logger.warn(`⚠️ Multi-client workflow completed with ${result.clientsFailed} failed clients`);
      return result.clientsFailed < result.clientsTotal; // Return true if at least one client succeeded
    }
  } catch (error) {
    logger.error(`Test failed: ${error.message}`, error.stack);
    return false;
  }
}

/**
 * Main entry point
 */
async function main() {
  // Check command line arguments
  const command = process.argv[2];
  
  if (command === 'single') {
    // Single client test
    const clientId = process.argv[3];
    const dryRun = process.argv.includes('--dry-run');
    
    if (!clientId) {
      console.log('Usage: node test-workflow-orchestrator.js single <clientId> [--dry-run]');
      process.exit(1);
    }
    
    logger.info(`Testing single client workflow for ${clientId}, dry run: ${dryRun}`);
    const success = await testWorkflowOrchestrator(clientId, { dryRun });
    
    if (success) {
      logger.info('✅ Test passed');
      process.exit(0);
    } else {
      logger.error('❌ Test failed');
      process.exit(1);
    }
  } else if (command === 'multi') {
    // Multi-client test
    const clientIds = process.argv.slice(3).filter(arg => !arg.startsWith('--'));
    const dryRun = process.argv.includes('--dry-run');
    
    if (clientIds.length === 0) {
      console.log('Usage: node test-workflow-orchestrator.js multi <clientId1> <clientId2> ... [--dry-run]');
      process.exit(1);
    }
    
    logger.info(`Testing multi-client workflow for ${clientIds.join(', ')}, dry run: ${dryRun}`);
    const success = await testMultiClientWorkflow(clientIds, { dryRun });
    
    if (success) {
      logger.info('✅ Test passed');
      process.exit(0);
    } else {
      logger.error('❌ Test failed');
      process.exit(1);
    }
  } else {
    console.log('Usage: node test-workflow-orchestrator.js [single|multi] ...');
    console.log('  Single client: node test-workflow-orchestrator.js single <clientId> [--dry-run]');
    console.log('  Multi client: node test-workflow-orchestrator.js multi <clientId1> <clientId2> ... [--dry-run]');
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

module.exports = {
  testWorkflowOrchestrator,
  testMultiClientWorkflow
};