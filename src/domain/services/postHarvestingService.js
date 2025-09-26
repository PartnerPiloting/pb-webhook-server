/**
 * postHarvestingService.js
 * 
 * This service handles the harvesting of LinkedIn posts for leads.
 * It determines which leads are eligible for post harvesting based on service level,
 * creates run records, and manages the post harvesting process.
 */

const { Logger } = require('../../infrastructure/logging/logger');
const { AirtableRepository } = require('../../infrastructure/airtable/airtableRepository');
const { RunRecordService } = require('./runRecordService');
const { validateClient, isLeadEligibleForHarvesting, shouldHarvestPosts } = require('../models/validators');
const { STATUS, FIELDS, SERVICE_LEVELS } = require('../models/constants');

class PostHarvestingService {
  /**
   * Create a PostHarvestingService instance
   * 
   * @param {Object} options - Options for the service
   * @param {Object} options.airtableClient - Initialized Airtable client
   * @param {Object} options.apifyClient - Initialized Apify client
   */
  constructor(options = {}) {
    this.airtableClient = options.airtableClient;
    this.apifyClient = options.apifyClient;
    this.repository = null;
    this.runRecordService = null;
    this.logger = null;
  }
  
  /**
   * Initialize services required for post harvesting
   * 
   * @param {string} clientId - The client ID
   * @param {string} runId - The run ID
   * @param {Object} options - Additional options
   * @returns {Promise<void>}
   */
  async initialize(clientId, runId, options = {}) {
    const logContext = options.logContext || 'PostHarvestingService';
    
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
    
    this.logger.info('Post harvesting service initialized');
  }
  
  /**
   * Harvest posts for a client
   * 
   * @param {string} clientId - The client ID
   * @param {string} runId - The run ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Results of the post harvesting operation
   */
  async harvestPosts(clientId, runId, options = {}) {
    // Initialize the service if not already initialized
    if (!this.repository || !this.runRecordService) {
      await this.initialize(clientId, runId, options);
    }
    
    const results = {
      clientId,
      runId,
      status: STATUS.FAILED,
      leadsProcessed: 0,
      leadsEligible: 0,
      postsHarvested: 0,
      errors: [],
      timestamp: new Date().toISOString()
    };
    
    try {
      // Validate client
      const client = await validateClient(clientId, {
        repository: this.repository,
        logger: this.logger
      });
      
      // Check if post harvesting is allowed for this client
      if (!shouldHarvestPosts(client)) {
        throw new Error(`Client ${clientId} is not eligible for post harvesting: ${client.fields[FIELDS.CLIENT_SERVICE_LEVEL]} service level`);
      }
      
      this.logger.info(`Starting post harvesting for client ${clientId}`);
      
      // Create or update run record
      const runRecord = await this.runRecordService.createOrUpdateRunRecord(runId, {
        status: STATUS.IN_PROGRESS,
        operation: 'post_harvesting',
        clientId
      });
      
      // Get eligible leads for post harvesting
      const leads = await this._getLeadsForPostHarvesting(client);
      results.leadsProcessed = leads.length;
      
      if (leads.length === 0) {
        this.logger.info('No leads eligible for post harvesting');
        results.status = STATUS.COMPLETED;
        
        // Update run record with completion status
        await this.runRecordService.updateRunRecord(runId, {
          status: STATUS.COMPLETED,
          message: 'No leads eligible for post harvesting'
        });
        
        return results;
      }
      
      // Filter leads eligible for post harvesting
      const eligibleLeads = leads.filter(lead => isLeadEligibleForHarvesting(lead));
      results.leadsEligible = eligibleLeads.length;
      
      if (eligibleLeads.length === 0) {
        this.logger.info('No leads with valid LinkedIn profile URLs for post harvesting');
        results.status = STATUS.COMPLETED;
        
        // Update run record with completion status
        await this.runRecordService.updateRunRecord(runId, {
          status: STATUS.COMPLETED,
          message: 'No leads with valid LinkedIn profile URLs'
        });
        
        return results;
      }
      
      this.logger.info(`Found ${eligibleLeads.length} leads eligible for post harvesting`);
      
      // Process each eligible lead
      const harvestResults = await this._processLeadsForHarvesting(eligibleLeads, client, runId);
      
      // Update results
      results.postsHarvested = harvestResults.postsHarvested;
      if (harvestResults.errors.length > 0) {
        results.errors = harvestResults.errors;
      }
      
      // Update run record with completion status
      await this.runRecordService.updateRunRecord(runId, {
        status: STATUS.COMPLETED,
        message: `Harvested ${harvestResults.postsHarvested} posts for ${eligibleLeads.length} leads`,
        additionalData: {
          leadsProcessed: results.leadsProcessed,
          leadsEligible: results.leadsEligible,
          postsHarvested: results.postsHarvested
        }
      });
      
      results.status = STATUS.COMPLETED;
      this.logger.info(`Post harvesting completed for client ${clientId}`);
      
      return results;
    } catch (error) {
      this.logger.error(`Post harvesting failed: ${error.message}`, error.stack);
      results.errors.push(error.message);
      
      // Update run record with failure status
      if (this.runRecordService) {
        try {
          await this.runRecordService.updateRunRecord(runId, {
            status: STATUS.FAILED,
            message: `Post harvesting failed: ${error.message}`
          });
        } catch (runRecordError) {
          this.logger.error(`Failed to update run record: ${runRecordError.message}`);
        }
      }
      
      return results;
    }
  }
  
  /**
   * Get leads eligible for post harvesting
   * 
   * @param {Object} client - The client object
   * @returns {Promise<Array>} - List of leads
   * @private
   */
  async _getLeadsForPostHarvesting(client) {
    try {
      const query = {
        view: 'All Leads', // Default view
        fields: [
          FIELDS.LEAD_ID,
          FIELDS.FULL_NAME,
          FIELDS.LINKEDIN_URL,
          FIELDS.LAST_POST_CHECK,
          FIELDS.POST_CHECK_STATUS
        ]
      };
      
      // Add filters based on post harvesting rules
      if (client.fields[FIELDS.CLIENT_HARVEST_VIEW]) {
        query.view = client.fields[FIELDS.CLIENT_HARVEST_VIEW];
      }
      
      this.logger.info(`Fetching leads from view: ${query.view}`);
      const leads = await this.repository.findRecords('Leads', query);
      
      return leads;
    } catch (error) {
      this.logger.error(`Error getting leads for post harvesting: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Process leads for post harvesting
   * 
   * @param {Array} leads - The leads to process
   * @param {Object} client - The client object
   * @param {string} runId - The run ID
   * @returns {Promise<Object>} - Results of processing
   * @private
   */
  async _processLeadsForHarvesting(leads, client, runId) {
    const result = {
      postsHarvested: 0,
      errors: []
    };
    
    if (!this.apifyClient) {
      throw new Error('Apify client is required for post harvesting');
    }
    
    try {
      // Determine batch size based on client service level
      const serviceLevel = client.fields[FIELDS.CLIENT_SERVICE_LEVEL];
      const batchSize = this._getBatchSizeForServiceLevel(serviceLevel);
      
      // Process in batches
      for (let i = 0; i < leads.length; i += batchSize) {
        const batch = leads.slice(i, i + batchSize);
        this.logger.info(`Processing batch ${i / batchSize + 1} of ${Math.ceil(leads.length / batchSize)}, size: ${batch.length}`);
        
        // Prepare LinkedIn URLs for Apify
        const profileUrls = batch.map(lead => lead.fields[FIELDS.LINKEDIN_URL]).filter(Boolean);
        
        if (profileUrls.length === 0) {
          continue;
        }
        
        // Start Apify task
        const apifyRunId = await this._startApifyTask(profileUrls, client, runId);
        
        if (!apifyRunId) {
          result.errors.push('Failed to start Apify task');
          continue;
        }
        
        // Update leads with post check status
        for (const lead of batch) {
          try {
            await this.repository.updateRecord('Leads', lead.id, {
              [FIELDS.POST_CHECK_STATUS]: STATUS.IN_PROGRESS,
              [FIELDS.LAST_POST_CHECK]: new Date().toISOString(),
              [FIELDS.POST_CHECK_RUN_ID]: runId
            });
          } catch (updateError) {
            this.logger.error(`Error updating lead ${lead.id} status: ${updateError.message}`);
            result.errors.push(`Error updating lead ${lead.id}: ${updateError.message}`);
          }
        }
        
        // Increment posts harvested
        result.postsHarvested += batch.length;
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Error processing leads for post harvesting: ${error.message}`, error.stack);
      result.errors.push(error.message);
      return result;
    }
  }
  
  /**
   * Start an Apify task for post harvesting
   * 
   * @param {Array<string>} profileUrls - LinkedIn profile URLs to process
   * @param {Object} client - The client object
   * @param {string} runId - The run ID
   * @returns {Promise<string|null>} - Apify run ID or null if failed
   * @private
   */
  async _startApifyTask(profileUrls, client, runId) {
    try {
      // Configuration for Apify task
      const taskInput = {
        profileUrls,
        maxPostCount: 10, // Default max posts per profile
        clientId: client.id,
        runId,
        webhookUrl: process.env.APIFY_WEBHOOK_URL || null
      };
      
      // Adjust max posts based on service level
      const serviceLevel = client.fields[FIELDS.CLIENT_SERVICE_LEVEL];
      if (serviceLevel === SERVICE_LEVELS.ENTERPRISE) {
        taskInput.maxPostCount = 20;
      } else if (serviceLevel === SERVICE_LEVELS.PRO) {
        taskInput.maxPostCount = 15;
      }
      
      this.logger.info(`Starting Apify task for ${profileUrls.length} profiles, max posts: ${taskInput.maxPostCount}`);
      
      // Call Apify to start the task
      // This is a placeholder for the actual Apify client call
      // In a real implementation, this would use the Apify SDK
      const apifyRun = await this.apifyClient.startTask({
        taskId: process.env.APIFY_TASK_ID,
        input: taskInput
      });
      
      this.logger.info(`Apify task started with run ID: ${apifyRun.id}`);
      
      return apifyRun.id;
    } catch (error) {
      this.logger.error(`Error starting Apify task: ${error.message}`, error.stack);
      return null;
    }
  }
  
  /**
   * Get batch size based on service level
   * 
   * @param {string} serviceLevel - Client service level
   * @returns {number} - Batch size
   * @private
   */
  _getBatchSizeForServiceLevel(serviceLevel) {
    switch (serviceLevel) {
      case SERVICE_LEVELS.ENTERPRISE:
        return 20;
      case SERVICE_LEVELS.PRO:
        return 10;
      case SERVICE_LEVELS.BASIC:
        return 5;
      default:
        return 5;
    }
  }
}

module.exports = { PostHarvestingService };