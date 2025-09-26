/**
 * runRecordService.js
 * Unified service for tracking run records.
 * Implements the "Create once, update many, error if missing" pattern.
 */

const airtableRepository = require('../../infrastructure/airtable/airtableRepository');
const { normalizeRunId, addClientSuffix, stripClientSuffix } = require('../models/runIdGenerator');
const { Logger } = require('../../infrastructure/logging/logger');

/**
 * Service for managing run records across the system
 */
class RunRecordService {
  /**
   * Create a run record for a client
   * @param {string} runId - Run ID for the job
   * @param {string} clientId - Client ID
   * @param {string} clientName - Client name
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} The created record
   */
  async createRunRecord(runId, clientId, clientName, options = {}) {
    const logger = options.logger || new Logger(clientId, runId, 'run_record');
    const source = options.source || 'unknown';
    
    logger.debug(`Creating run record from source ${source}`);
    
    try {
      // Normalize the run ID
      const baseRunId = stripClientSuffix(runId);
      const standardRunId = addClientSuffix(baseRunId, clientId);
      
      logger.debug(`Using standardized run ID: ${standardRunId}`);
      
      return await airtableRepository.createRunRecord(standardRunId, clientId, clientName);
    } catch (error) {
      logger.error(`Error creating run record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Update a run record
   * @param {string} runId - Run ID for the job
   * @param {string} clientId - Client ID
   * @param {Object} updates - Updates to apply
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} The updated record
   */
  async updateRunRecord(runId, clientId, updates, options = {}) {
    const logger = options.logger || new Logger(clientId, runId, 'run_record');
    const source = options.source || 'unknown';
    
    logger.debug(`Updating run record from source ${source}`);
    
    try {
      // Normalize the run ID
      const baseRunId = stripClientSuffix(runId);
      const standardRunId = addClientSuffix(baseRunId, clientId);
      
      logger.debug(`Using standardized run ID: ${standardRunId}`);
      
      return await airtableRepository.updateRunRecord(standardRunId, clientId, updates);
    } catch (error) {
      logger.error(`Error updating run record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Complete a run record
   * @param {string} runId - Run ID for the job
   * @param {string} clientId - Client ID
   * @param {string|boolean} status - Status or success boolean
   * @param {string} notes - Notes to append
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} The updated record
   */
  async completeRunRecord(runId, clientId, status, notes = '', options = {}) {
    const logger = options.logger || new Logger(clientId, runId, 'run_record');
    const source = options.source || 'unknown';
    
    logger.debug(`Completing run record from source ${source}`);
    
    try {
      // Handle status as string or boolean
      const success = typeof status === 'boolean' ? status : (status === 'Completed' || status === 'Success');
      
      // Normalize the run ID
      const baseRunId = stripClientSuffix(runId);
      const standardRunId = addClientSuffix(baseRunId, clientId);
      
      logger.debug(`Using standardized run ID: ${standardRunId}`);
      
      return await airtableRepository.completeRunRecord(standardRunId, clientId, success, notes);
    } catch (error) {
      logger.error(`Error completing run record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Create a job tracking record (without client ID)
   * @param {string} runId - The job run ID
   * @param {number} stream - Stream number
   * @returns {Promise<Object>} The created record
   */
  async createJobRecord(runId, stream = 1) {
    const logger = new Logger('SYSTEM', runId, 'job_record');
    
    try {
      // Clean/standardize the run ID (strip any client suffix)
      const baseRunId = stripClientSuffix(runId);
      
      logger.debug(`Creating job tracking record with ID: ${baseRunId}`);
      
      return await airtableRepository.createJobRecord(baseRunId, stream);
    } catch (error) {
      logger.error(`Error creating job record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Complete a job record
   * @param {string} runId - The job run ID
   * @param {boolean} success - Whether the job succeeded
   * @param {string} notes - Optional notes
   * @returns {Promise<Object>} The updated record
   */
  async completeJobRecord(runId, success = true, notes = '') {
    const logger = new Logger('SYSTEM', runId, 'job_record');
    
    try {
      // Clean/standardize the run ID (strip any client suffix)
      const baseRunId = stripClientSuffix(runId);
      
      logger.debug(`Completing job tracking record with ID: ${baseRunId}`);
      
      return await airtableRepository.completeJobRecord(baseRunId, success, notes);
    } catch (error) {
      logger.error(`Error completing job record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Update aggregate metrics for a job run
   * @param {string} runId - The job run ID
   * @returns {Promise<Object>} The updated record
   */
  async updateJobAggregates(runId) {
    const logger = new Logger('SYSTEM', runId, 'job_aggregates');
    
    try {
      // Clean/standardize the run ID (strip any client suffix)
      const baseRunId = stripClientSuffix(runId);
      
      logger.debug(`Updating aggregate metrics for job: ${baseRunId}`);
      
      return await airtableRepository.updateJobAggregates(baseRunId);
    } catch (error) {
      logger.error(`Error updating job aggregates: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Update client metrics for a specific operation
   * @param {string} runId - Run ID
   * @param {string} clientId - Client ID
   * @param {Object} metrics - Metrics to update
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Updated record
   */
  async updateClientMetrics(runId, clientId, metrics, options = {}) {
    const logger = options.logger || new Logger(clientId, runId, 'client_metrics');
    const source = options.source || 'unknown';
    
    logger.debug(`Updating client metrics from source ${source}`);
    
    try {
      // Normalize the run ID
      const baseRunId = stripClientSuffix(runId);
      const standardRunId = addClientSuffix(baseRunId, clientId);
      
      logger.debug(`Using standardized run ID: ${standardRunId}`);
      
      return await airtableRepository.updateRunRecord(standardRunId, clientId, metrics);
    } catch (error) {
      logger.error(`Error updating client metrics: ${error.message}`, error.stack);
      throw error;
    }
  }
}

module.exports = new RunRecordService();