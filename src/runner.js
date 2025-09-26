#!/usr/bin/env node
/**
 * runner.js
 * 
 * Main entry point for the LinkedIn lead management workflow.
 * This script replaces the original smart-resume-client-by-client.js script
 * with a clean, modular architecture.
 */

require('dotenv').config();
const { Logger } = require('./infrastructure/logging/logger');
const { WorkflowOrchestrator } = require('./domain/services/workflowOrchestrator');
const { AirtableClient } = require('./infrastructure/airtable/airtableClient');
const { AiService } = require('./infrastructure/ai/aiService');
const { generateRunId } = require('./domain/models/runIdGenerator');
const { STATUS } = require('./domain/models/constants');

// Setup logging
const masterRunId = generateRunId();
const logger = new Logger('RUNNER', masterRunId, 'WorkflowRunner');

// Track execution stats
const stats = {
  startTime: new Date(),
  endTime: null,
  clientsProcessed: 0,
  clientsSucceeded: 0,
  clientsFailed: 0,
  totalTokens: 0
};

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  clientId: null,
  processAll: false,
  dryRun: false,
  limit: null
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--client') {
    options.clientId = args[++i];
  } else if (arg === '--all') {
    options.processAll = true;
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  } else if (arg === '--limit') {
    options.limit = parseInt(args[++i], 10);
  } else if (arg === '--help' || arg === '-h') {
    showHelp();
    process.exit(0);
  }
}

/**
 * Show command line help
 */
function showHelp() {
  console.log(`
LinkedIn Lead Management Workflow Runner

Usage:
  node runner.js [options]

Options:
  --client <clientId>  Process a specific client
  --all               Process all active clients
  --dry-run           Run without making changes or calling AI APIs
  --limit <number>    Limit number of leads processed per client
  --help, -h          Show this help message
  
Examples:
  node runner.js --client recXYZ123      # Process a single client
  node runner.js --all                   # Process all active clients
  node runner.js --client recXYZ123 --dry-run  # Test run without changes
  `);
}

/**
 * Get all active clients
 * 
 * @returns {Promise<Array>} Array of client objects
 */
async function getActiveClients() {
  try {
    logger.info('Getting list of active clients');
    
    const airtableClient = new AirtableClient();
    const masterBase = await airtableClient.getMasterBase();
    
    const clients = await masterBase('Clients').select({
      filterByFormula: '{Status} = "Active"',
      fields: ['Client ID', 'Client Name', 'Status', 'Service Level']
    }).all();
    
    logger.info(`Found ${clients.length} active clients`);
    
    return clients;
  } catch (error) {
    logger.error(`Failed to get active clients: ${error.message}`);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    logger.info('=== LinkedIn Lead Management Workflow Runner ===');
    logger.info(`Run ID: ${masterRunId}`);
    logger.info(`Options: ${JSON.stringify(options)}`);
    
    // Initialize dependencies
    const airtableClient = new AirtableClient();
    const aiService = new AiService();
    
    // Create an Apify client if environment supports it
    let apifyClient = null;
    if (process.env.APIFY_API_TOKEN && process.env.APIFY_TASK_ID) {
      try {
        // This is a placeholder - in the real system you would import and use the Apify client
        // const { ApifyClient } = require('apify-client');
        // apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
        logger.info('Apify client initialized');
      } catch (apifyError) {
        logger.warn(`Failed to initialize Apify client: ${apifyError.message}. Post harvesting will be disabled.`);
      }
    } else {
      logger.warn('Apify credentials not found. Post harvesting will be disabled.');
    }
    
    // Create the workflow orchestrator
    const workflowOrchestrator = new WorkflowOrchestrator({
      airtableClient,
      aiService,
      apifyClient
    });
    
    // Execute workflow for a single client or all clients
    if (options.clientId) {
      // Single client mode
      logger.info(`Processing single client: ${options.clientId}`);
      
      const result = await workflowOrchestrator.processClient(options.clientId, {
        logger,
        dryRun: options.dryRun,
        limit: options.limit
      });
      
      // Update stats
      stats.clientsProcessed = 1;
      if (result.status === STATUS.COMPLETED || result.status === STATUS.PARTIAL) {
        stats.clientsSucceeded = 1;
      } else {
        stats.clientsFailed = 1;
      }
      stats.totalTokens += result.totalTokens || 0;
      
      logger.info(`Client ${options.clientId} processed with status: ${result.status}`);
      if (result.errors && result.errors.length > 0) {
        logger.error(`Errors: ${result.errors.join('\n')}`);
      }
    } else if (options.processAll) {
      // Multi-client mode
      const clients = await getActiveClients();
      
      if (clients.length === 0) {
        logger.warn('No active clients found');
        return;
      }
      
      logger.info(`Processing ${clients.length} clients`);
      
      // Extract client IDs
      const clientIds = clients.map(client => client.id);
      
      // Process all clients
      const result = await workflowOrchestrator.processMultipleClients(clientIds, {
        logger,
        dryRun: options.dryRun,
        limit: options.limit
      });
      
      // Update stats
      stats.clientsProcessed = result.clientsTotal;
      stats.clientsSucceeded = result.clientsSuccessful;
      stats.clientsFailed = result.clientsFailed;
      stats.totalTokens += result.totalTokens || 0;
      
      logger.info(`Multi-client processing completed`);
      logger.info(`Total: ${result.clientsTotal}, Successful: ${result.clientsSuccessful}, Failed: ${result.clientsFailed}`);
    } else {
      logger.error('No action specified. Use --client <clientId> or --all');
      showHelp();
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Workflow runner failed: ${error.message}`, error.stack);
    stats.clientsFailed = stats.clientsProcessed;
    process.exit(1);
  } finally {
    // Log final statistics
    stats.endTime = new Date();
    const duration = (stats.endTime - stats.startTime) / 1000;
    
    logger.info('=== Workflow Runner Complete ===');
    logger.info(`Duration: ${duration.toFixed(2)} seconds`);
    logger.info(`Clients processed: ${stats.clientsProcessed}`);
    logger.info(`Clients succeeded: ${stats.clientsSucceeded}`);
    logger.info(`Clients failed: ${stats.clientsFailed}`);
    logger.info(`Total tokens used: ${stats.totalTokens}`);
  }
}

// Run the main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});