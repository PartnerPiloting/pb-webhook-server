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
const { validateClient, validateBatchSize } = require('../models/validators');
const { STATUS, FIELDS, SERVICE_LEVELS } = require('../models/constants');

class WorkflowOrchestrator {
  constructor(options = {}) {
    this.airtableClient = options.airtableClient || new AirtableClient();
    this.aiService = options.aiService || new AiService();
    this.apifyClient = options.apifyClient;
    this.logger = null;
    this.repository = null;
    this.runRecordService = null;
    
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
  
  async initialize(clientId, runId, options = {}) {
    const logContext = options.logContext || 'WorkflowOrchestrator';
    
    this.logger = options.logger || new Logger({
      context: logContext,
      clientId,
      runId
    });
    
    this.repository = new AirtableRepository({
      airtableClient: this.airtableClient,
      logger: this.logger,
      clientId
    });
    
    this.runRecordService = new RunRecordService({
      repository: this.repository,
      logger: this.logger
    });
    
    this.logger.info('Workflow orchestrator initialized');
  }
  
  async processClient(clientId, options = {}) {
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
      await this.initialize(clientId, runId, options);
      
      this.logger.info(`Starting workflow for client ${clientId} with run ID ${runId}`);
      
      const runRecord = await this.runRecordService.createOrUpdateRunRecord(runId, {
        status: STATUS.IN_PROGRESS,
        operation: 'complete_workflow',
        clientId,
        additionalData: {
          steps: ['lead_scoring', 'post_harvesting', 'post_scoring'],
          startTime: results.startTime
        }
      });
      
      const client = await this.repository.getClient(clientId);
      validateClient(client);
      
      const steps = [];
      
      if (client.status === 'Active') {
        steps.push('lead_scoring');
      }
      
      if (Number(client.serviceLevel) >= SERVICE_LEVELS.STANDARD) {
        steps.push('post_harvesting');
        steps.push('post_scoring');
      }
      
      for (const step of steps) {
        try {
          // Validate batch size for each step
          if (options.batchSize) {
            validateBatchSize(options.batchSize, step.toUpperCase());
          }
          
          const stepResult = await this._runWorkflowStep(step, clientId, runId, options);
          
          results.operations.push({
            step,
            status: stepResult.status,
            processed: stepResult.processed || 0,
            tokens: stepResult.tokens || 0
          });
          
          if (stepResult.tokens) {
            results.totalTokens += stepResult.tokens;
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
      
      const anyFailed = results.operations.some(op => op.status === STATUS.FAILED);
      results.status = anyFailed ? STATUS.PARTIAL : STATUS.COMPLETED;
      
      results.endTime = new Date().toISOString();
      
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
        } catch (updateError) {
          this.logger.error(`Failed to update run record: ${updateError.message}`);
        }
      }
      
      return results;
    }
  }
  
  async processMultipleClients(clientIds, options = {}) {
    const masterRunId = options.masterRunId || generateRunId();
    
    const batchResults = {
      masterRunId,
      clientResults: {},
      totalClients: clientIds.length,
      successful: 0,
      failed: 0,
      partial: 0,
      startTime: new Date().toISOString(),
      endTime: null
    };
    
    // Validate the batch size
    if (clientIds.length > 0) {
      validateBatchSize(clientIds.length, 'MULTI_CLIENT');
    }
    
    try {
      for (const clientId of clientIds) {
        try {
          const clientRunId = `${masterRunId}-${clientId}`;
          
          const clientResult = await this.processClient(clientId, {
            ...options,
            runId: clientRunId
          });
          
          batchResults.clientResults[clientId] = clientResult;
          
          if (clientResult.status === STATUS.COMPLETED) {
            batchResults.successful++;
          } else if (clientResult.status === STATUS.PARTIAL) {
            batchResults.partial++;
          } else {
            batchResults.failed++;
          }
        } catch (clientError) {
          this.logger.error(`Failed to process client ${clientId}: ${clientError.message}`);
          batchResults.clientResults[clientId] = {
            status: STATUS.FAILED,
            error: clientError.message
          };
          batchResults.failed++;
        }
      }
    } catch (error) {
      this.logger.error(`Batch processing failed: ${error.message}`);
    } finally {
      batchResults.endTime = new Date().toISOString();
    }
    
    return batchResults;
  }
  
  async _runWorkflowStep(step, clientId, masterRunId, options = {}) {
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
