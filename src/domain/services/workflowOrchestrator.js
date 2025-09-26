/**
 * workflowOrchestrator.js
 * 
 * This service orchestrates the complete LinkedIn lead management workflow:
 * 1. Lead scoring
 * 2. Post harvesting
 * 3. Post scoring
 * 
 * It can operate on a single client or process multiple clients in sequence.
 */

const { Logger } = require('../../infrastructure/logging/logger');
const { AirtableClient } = require('../../infrastructure/airtable/airtableClient');
const { AirtableRepository } = require('../../infrastructure/airtable/airtableRepository');
const { AiService } = require('../../infrastructure/ai/aiService');
const { RunRecordService } = require('./runRecordService');
const { LeadScoringService } = require('./leadScoringService');
const { PostHarvestingService } = require('./postHarvestingService');
const { PostScoringService } = require('./postScoringService');
const { generateRunId } = require('../models/runIdGenerator');
const { validateClient } = require('../models/validators');
const { STATUS, FIELDS, SERVICE_LEVELS } = require('../models/constants');

class WorkflowOrchestrator {
  /**
   * Create a WorkflowOrchestrator instance
   * 
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.airtableClient = options.airtableClient || new AirtableClient();
    this.aiService = options.aiService || new AiService();
    this.apifyClient = options.apifyClient;
    this.logger = null;
    this.repository = null;
    this.runRecordService = null;
    
    // Initialize services
    this.leadScoringService = new LeadScoringService({
      airtableClient: this.airtableClient,
      aiService: this.aiService
    });
    
    this.postHarvestingService = new PostHarvestingService({
      airtableClient: this.airtableClient,
      apifyClient: this.apifyClient
    });
    
    this.postScoringService = new PostScoringService({
      airtableClient: this.airtableClient,
      aiService: this.aiService
    });
  }
  
  /**
   * Initialize the orchestrator for a client
   * 
   * @param {string} clientId - The client ID
   * @param {string} runId - The run ID
   * @param {Object} options - Additional options
   * @returns {Promise<void>}
   */
  async initialize(clientId, runId, options = {}) {
    const logContext = options.logContext || 'WorkflowOrchestrator';
    
    // Set up logger
    this.logger = options.logger || new Logger(clientId, runId, logContext);
    
    // Initialize repository
    this.repository = new AirtableRepository({
      airtableClient: this.airtableClient,
      clientId,
      logger: this.logger
    });
    
    // Initialize run record service
    this.runRecordService = new RunRecordService({
      repository: this.repository,
      logger: this.logger
    });
    
    this.logger.info('Workflow orchestrator initialized');
  }
  
  /**
   * Process a single client through the full workflow
   * 
   * @param {string} clientId - The client ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Results of the workflow
   */
  async processClient(clientId, options = {}) {
    // Generate a unique run ID for this workflow
    const runId = options.runId || generateRunId();
    
    const results = {
      clientId,
      runId,
      status: STATUS.FAILED,
      operations: [],
      errors: [],
      startTime: new Date().toISOString(),
      endTime: null,
      totalTokens: 0
    };
    
    try {
      // Initialize orchestrator
      await this.initialize(clientId, runId, options);
      
      this.logger.info(`Starting workflow for client ${clientId} with run ID ${runId}`);
      
      // Create master run record
      const runRecord = await this.runRecordService.createOrUpdateRunRecord(runId, {
        status: STATUS.IN_PROGRESS,
        operation: 'complete_workflow',
        clientId,
        additionalData: {
          steps: ['lead_scoring', 'post_harvesting', 'post_scoring'],
          startTime: results.startTime
        }
      });
      
      // Validate client
      const client = await validateClient(clientId, {
        repository: this.repository,
        logger: this.logger
      });
      
      // Determine which steps to run based on service level
      const steps = this._determineWorkflowSteps(client);
      this.logger.info(`Workflow steps for client: ${steps.join(', ')}`);
      
      // Run each step in sequence
      for (const step of steps) {
        try {
          const stepResult = await this._runWorkflowStep(step, clientId, runId, options);
          
          results.operations.push({
            step,
            status: stepResult.status,
            details: stepResult
          });
          
          // Add tokens used if available
          if (stepResult.totalTokens) {
            results.totalTokens += stepResult.totalTokens;
          }
          
          if (stepResult.status === STATUS.FAILED) {
            this.logger.error(`Step ${step} failed for client ${clientId}`);
            if (stepResult.errors && stepResult.errors.length > 0) {
              results.errors.push(`${step}: ${stepResult.errors.join(', ')}`);
            } else {
              results.errors.push(`${step}: Unknown error`);
            }
          }
        } catch (stepError) {
          this.logger.error(`Error running step ${step}: ${stepError.message}`);
          results.operations.push({
            step,
            status: STATUS.FAILED,
            error: stepError.message
          });
          results.errors.push(`${step}: ${stepError.message}`);
        }
      }
      
      // Determine overall status
      const anyFailed = results.operations.some(op => op.status === STATUS.FAILED);
      results.status = anyFailed ? STATUS.PARTIAL : STATUS.COMPLETED;
      
      // Set end time
      results.endTime = new Date().toISOString();
      
      // Update master run record
      await this.runRecordService.updateRunRecord(runId, {
        status: results.status,
        message: `Workflow ${results.status} for client ${clientId}`,
        additionalData: {
          endTime: results.endTime,
          totalTokens: results.totalTokens,
          operations: results.operations.map(op => `${op.step}: ${op.status}`).join(', ')
        }
      });
      
      this.logger.info(`Workflow completed for client ${clientId} with status ${results.status}`);
      
      return results;
    } catch (error) {
      this.logger.error(`Workflow failed for client ${clientId}: ${error.message}`, error.stack);
      
      results.status = STATUS.FAILED;
      results.errors.push(error.message);
      results.endTime = new Date().toISOString();
      
      // Update master run record with failure status
      if (this.runRecordService) {
        try {
          await this.runRecordService.updateRunRecord(runId, {
            status: STATUS.FAILED,
            message: `Workflow failed: ${error.message}`,
            additionalData: {
              endTime: results.endTime,
              error: error.message
            }
          });
        } catch (runRecordError) {
          this.logger.error(`Failed to update run record: ${runRecordError.message}`);
        }
      }
      
      return results;
    }
  }
  
  /**
   * Process multiple clients in sequence
   * 
   * @param {Array<string>} clientIds - Array of client IDs to process
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Results for all clients
   */
  async processMultipleClients(clientIds, options = {}) {
    // Generate a master run ID for the multi-client workflow
    const masterRunId = generateRunId();
    
    const results = {
      masterRunId,
      clientsTotal: clientIds.length,
      clientsSuccessful: 0,
      clientsFailed: 0,
      clientResults: [],
      startTime: new Date().toISOString(),
      endTime: null,
      totalTokens: 0
    };
    
    // Create a master logger
    const masterLogger = new Logger('MULTI', masterRunId, 'MultiClientWorkflow');
    masterLogger.info(`Starting multi-client workflow for ${clientIds.length} clients`);
    
    // Process each client in sequence
    for (const clientId of clientIds) {
      try {
        masterLogger.info(`Processing client ${clientId}`);
        
        // Generate a unique run ID for this client's workflow
        const clientRunId = `${masterRunId}-${clientId}`;
        
        // Process this client
        const clientResult = await this.processClient(clientId, {
          runId: clientRunId,
          logContext: `Client-${clientId}`,
          ...options
        });
        
        // Add to results
        results.clientResults.push(clientResult);
        
        // Update counts
        if (clientResult.status === STATUS.COMPLETED || clientResult.status === STATUS.PARTIAL) {
          results.clientsSuccessful++;
        } else {
          results.clientsFailed++;
        }
        
        // Add tokens
        results.totalTokens += clientResult.totalTokens || 0;
        
        masterLogger.info(`Completed client ${clientId} with status: ${clientResult.status}`);
      } catch (clientError) {
        masterLogger.error(`Error processing client ${clientId}: ${clientError.message}`);
        results.clientsFailed++;
        results.clientResults.push({
          clientId,
          status: STATUS.FAILED,
          error: clientError.message
        });
      }
    }
    
    // Set end time
    results.endTime = new Date().toISOString();
    
    masterLogger.info(`Multi-client workflow completed. Successful: ${results.clientsSuccessful}, Failed: ${results.clientsFailed}`);
    
    return results;
  }
  
  /**
   * Determine which workflow steps to run based on client service level
   * 
   * @param {Object} client - The client object
   * @returns {Array<string>} - Array of steps to run
   * @private
   */
  _determineWorkflowSteps(client) {
    const serviceLevel = client.fields[FIELDS.CLIENT_SERVICE_LEVEL] || SERVICE_LEVELS.BASIC;
    const steps = [];
    
    // All service levels get lead scoring
    steps.push('lead_scoring');
    
    // Enterprise and Pro get post harvesting and scoring
    if (serviceLevel === SERVICE_LEVELS.ENTERPRISE || serviceLevel === SERVICE_LEVELS.PRO) {
      steps.push('post_harvesting');
      steps.push('post_scoring');
    }
    
    return steps;
  }
  
  /**
   * Run a specific workflow step
   * 
   * @param {string} step - The step to run ('lead_scoring', 'post_harvesting', or 'post_scoring')
   * @param {string} clientId - The client ID
   * @param {string} masterRunId - The master run ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Result of the step
   * @private
   */
  async _runWorkflowStep(step, clientId, masterRunId, options = {}) {
    // Generate a step-specific run ID
    const stepRunId = `${masterRunId}-${step}`;
    
    try {
      this.logger.info(`Running step ${step} for client ${clientId}`);
      
      switch (step) {
        case 'lead_scoring':
          await this.leadScoringService.initialize(clientId, stepRunId, {
            logger: this.logger,
            logContext: `LeadScoring-${clientId}`
          });
          return await this.leadScoringService.scoreLeads(clientId, stepRunId, options);
          
        case 'post_harvesting':
          await this.postHarvestingService.initialize(clientId, stepRunId, {
            logger: this.logger,
            logContext: `PostHarvesting-${clientId}`
          });
          return await this.postHarvestingService.harvestPosts(clientId, stepRunId, options);
          
        case 'post_scoring':
          await this.postScoringService.initialize(clientId, stepRunId, {
            logger: this.logger,
            logContext: `PostScoring-${clientId}`
          });
          return await this.postScoringService.scorePosts(clientId, stepRunId, options);
          
        default:
          throw new Error(`Unknown workflow step: ${step}`);
      }
    } catch (error) {
      this.logger.error(`Error in step ${step}: ${error.message}`, error.stack);
      return {
        status: STATUS.FAILED,
        errors: [error.message]
      };
    }
  }
}

module.exports = { WorkflowOrchestrator };