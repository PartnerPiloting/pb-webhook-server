/**
 * airtableRepository.js
 * A unified data access layer for all Airtable operations.
 * All database operations should go through this repository.
 */

const { getClientBase, getMasterClientsBase } = require('./airtableClient');
const { TABLES, FIELDS, STATUS } = require('../../domain/models/constants');
const { Logger } = require('../logging/logger');

const logger = new Logger('SYSTEM', null, 'airtable_repo');

/**
 * Airtable Repository - Handles all data access operations
 */
class AirtableRepository {
  
  /**
   * Create a new run record
   * @param {string} runId - The run ID
   * @param {string} clientId - The client ID
   * @param {string} clientName - The client name
   * @returns {Promise<Object>} The created record
   */
  async createRunRecord(runId, clientId, clientName) {
    const log = new Logger(clientId, runId, 'run_record');
    log.debug(`Creating run record for client ${clientId}`);
    
    try {
      const clientBase = await getClientBase(clientId);
      const timestamp = new Date().toISOString();
      
      // Create the record
      const records = await clientBase(TABLES.CLIENT_RUN_RESULTS).create([
        {
          fields: {
            [FIELDS.RUN_RESULTS.RUN_ID]: runId,
            [FIELDS.RUN_RESULTS.CLIENT_ID]: clientId,
            [FIELDS.RUN_RESULTS.STATUS]: STATUS.RUN_RECORD.RUNNING,
            [FIELDS.RUN_RESULTS.START_TIME]: timestamp
          }
        }
      ]);
      
      log.info(`Created run record: ${records[0].id}`);
      return records[0];
    } catch (error) {
      log.error(`Error creating run record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Update a run record
   * @param {string} runId - The run ID
   * @param {string} clientId - The client ID
   * @param {Object} updates - The fields to update
   * @returns {Promise<Object>} The updated record
   */
  async updateRunRecord(runId, clientId, updates) {
    const log = new Logger(clientId, runId, 'run_record');
    log.debug(`Updating run record for client ${clientId}`);
    
    try {
      const clientBase = await getClientBase(clientId);
      
      // Find the record
      const records = await clientBase(TABLES.CLIENT_RUN_RESULTS).select({
        filterByFormula: `{${FIELDS.RUN_RESULTS.RUN_ID}} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        throw new Error(`Run record not found for runId: ${runId}`);
      }
      
      // Update the record
      const updatedRecord = await clientBase(TABLES.CLIENT_RUN_RESULTS).update(records[0].id, updates);
      
      log.debug(`Updated run record: ${updatedRecord.id}`);
      return updatedRecord;
    } catch (error) {
      log.error(`Error updating run record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Complete a run record
   * @param {string} runId - The run ID
   * @param {string} clientId - The client ID
   * @param {boolean} success - Whether the run was successful
   * @param {string} [notes] - Optional notes
   * @returns {Promise<Object>} The updated record
   */
  async completeRunRecord(runId, clientId, success, notes = '') {
    const log = new Logger(clientId, runId, 'run_record');
    log.debug(`Completing run record for client ${clientId}, success: ${success}`);
    
    const status = success ? STATUS.RUN_RECORD.COMPLETED : STATUS.RUN_RECORD.FAILED;
    const timestamp = new Date().toISOString();
    
    try {
      const clientBase = await getClientBase(clientId);
      
      // Find the record
      const records = await clientBase(TABLES.CLIENT_RUN_RESULTS).select({
        filterByFormula: `{${FIELDS.RUN_RESULTS.RUN_ID}} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        throw new Error(`Run record not found for runId: ${runId}`);
      }
      
      // Update the record
      const updates = {
        [FIELDS.RUN_RESULTS.STATUS]: status,
        [FIELDS.RUN_RESULTS.END_TIME]: timestamp
      };
      
      if (notes) {
        updates[FIELDS.RUN_RESULTS.ERROR_MESSAGE] = notes;
      }
      
      const updatedRecord = await clientBase(TABLES.CLIENT_RUN_RESULTS).update(records[0].id, updates);
      
      log.info(`Completed run record: ${updatedRecord.id}, status: ${status}`);
      return updatedRecord;
    } catch (error) {
      log.error(`Error completing run record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Create a job tracking record
   * @param {string} runId - The run ID
   * @param {number} stream - The stream number
   * @returns {Promise<Object>} The created record
   */
  async createJobRecord(runId, stream = 1) {
    const log = new Logger('SYSTEM', runId, 'job_record');
    log.debug(`Creating job tracking record: ${runId}`);
    
    try {
      const base = getMasterClientsBase();
      const startTimestamp = new Date().toISOString();
      
      // Check if record already exists
      const existingRecords = await base(TABLES.JOB_TRACKING).select({
        filterByFormula: `{${FIELDS.JOB_TRACKING.RUN_ID}} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (existingRecords && existingRecords.length > 0) {
        log.warn(`Job tracking record already exists for ${runId}`);
        return existingRecords[0];
      }
      
      // Create the record
      const records = await base(TABLES.JOB_TRACKING).create([
        {
          fields: {
            [FIELDS.JOB_TRACKING.RUN_ID]: runId,
            [FIELDS.JOB_TRACKING.START_TIME]: startTimestamp,
            [FIELDS.JOB_TRACKING.STATUS]: STATUS.RUN_RECORD.RUNNING,
            [FIELDS.JOB_TRACKING.STREAM]: stream,
            [FIELDS.JOB_TRACKING.CLIENTS_PROCESSED]: 0,
            [FIELDS.JOB_TRACKING.CLIENTS_WITH_ERRORS]: 0,
            [FIELDS.JOB_TRACKING.TOTAL_PROFILES_EXAMINED]: 0,
            [FIELDS.JOB_TRACKING.SUCCESSFUL_PROFILES]: 0,
            [FIELDS.JOB_TRACKING.TOTAL_POSTS_HARVESTED]: 0,
            [FIELDS.JOB_TRACKING.POSTS_EXAMINED]: 0,
            [FIELDS.JOB_TRACKING.POSTS_SCORED]: 0,
            [FIELDS.JOB_TRACKING.PROFILE_SCORING_TOKENS]: 0,
            [FIELDS.JOB_TRACKING.POST_SCORING_TOKENS]: 0,
            [FIELDS.JOB_TRACKING.SYSTEM_NOTES]: `Run initiated at ${startTimestamp}`
          }
        }
      ]);
      
      log.info(`Created job tracking record: ${records[0].id}`);
      return records[0];
    } catch (error) {
      log.error(`Error creating job tracking record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Complete a job tracking record
   * @param {string} runId - The run ID
   * @param {boolean} success - Whether the job was successful
   * @param {string} [notes] - Optional notes
   * @returns {Promise<Object>} The updated record
   */
  async completeJobRecord(runId, success = true, notes = '') {
    const log = new Logger('SYSTEM', runId, 'job_record');
    log.debug(`Completing job tracking record: ${runId}, success: ${success}`);
    
    try {
      const base = getMasterClientsBase();
      const endTimestamp = new Date().toISOString();
      
      // Find the record
      const records = await base(TABLES.JOB_TRACKING).select({
        filterByFormula: `{${FIELDS.JOB_TRACKING.RUN_ID}} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        throw new Error(`Job tracking record not found for runId: ${runId}`);
      }
      
      // Update the record
      const updates = {
        [FIELDS.JOB_TRACKING.STATUS]: success ? STATUS.RUN_RECORD.COMPLETED : STATUS.RUN_RECORD.FAILED,
        [FIELDS.JOB_TRACKING.END_TIME]: endTimestamp
      };
      
      if (notes) {
        updates[FIELDS.JOB_TRACKING.SYSTEM_NOTES] = `${records[0].get(FIELDS.JOB_TRACKING.SYSTEM_NOTES) || ''}\n${notes}`;
      }
      
      const updatedRecord = await base(TABLES.JOB_TRACKING).update(records[0].id, updates);
      
      log.info(`Completed job tracking record: ${updatedRecord.id}`);
      return updatedRecord;
    } catch (error) {
      log.error(`Error completing job tracking record: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Update job tracking metrics from client run records
   * @param {string} runId - The master run ID (without client suffix)
   * @returns {Promise<Object>} The updated job record
   */
  async updateJobAggregates(runId) {
    const log = new Logger('SYSTEM', runId, 'job_aggregates');
    log.debug(`Updating aggregate metrics for job: ${runId}`);
    
    try {
      const base = getMasterClientsBase();
      
      // Find all client run records for this job
      const clientRunResults = await base('Client Run Results').select({
        filterByFormula: `SEARCH("${runId}", {${FIELDS.RUN_RESULTS.RUN_ID}})`,
      }).all();
      
      log.debug(`Found ${clientRunResults.length} client run records`);
      
      // Calculate aggregates
      const aggregates = clientRunResults.reduce((acc, record) => {
        // Count clients
        acc.clientsProcessed++;
        
        // Count errors
        if (record.get(FIELDS.RUN_RESULTS.STATUS) === STATUS.RUN_RECORD.FAILED) {
          acc.clientsWithErrors++;
        }
        
        // Sum numeric fields
        const numericFields = [
          'Total Leads Scored',
          'Total Posts Harvested', 
          'Total Posts Scored',
          'Token Usage',
          'Scoring Cost'
        ];
        
        numericFields.forEach(field => {
          const value = record.get(field);
          if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)))) {
            acc.metrics[field] = (acc.metrics[field] || 0) + Number(value);
          }
        });
        
        return acc;
      }, { 
        clientsProcessed: 0, 
        clientsWithErrors: 0, 
        metrics: {} 
      });
      
      // Find the job tracking record
      const jobRecords = await base(TABLES.JOB_TRACKING).select({
        filterByFormula: `{${FIELDS.JOB_TRACKING.RUN_ID}} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (!jobRecords || jobRecords.length === 0) {
        throw new Error(`Job tracking record not found for runId: ${runId}`);
      }
      
      // Update the record
      const updates = {
        [FIELDS.JOB_TRACKING.CLIENTS_PROCESSED]: aggregates.clientsProcessed,
        [FIELDS.JOB_TRACKING.CLIENTS_WITH_ERRORS]: aggregates.clientsWithErrors,
        [FIELDS.JOB_TRACKING.TOTAL_PROFILES_EXAMINED]: aggregates.metrics['Total Leads Scored'] || 0,
        [FIELDS.JOB_TRACKING.SUCCESSFUL_PROFILES]: aggregates.metrics['Total Leads Scored'] || 0,
        [FIELDS.JOB_TRACKING.TOTAL_POSTS_HARVESTED]: aggregates.metrics['Total Posts Harvested'] || 0,
        [FIELDS.JOB_TRACKING.POSTS_EXAMINED]: aggregates.metrics['Total Posts Scored'] || 0,
        [FIELDS.JOB_TRACKING.POSTS_SCORED]: aggregates.metrics['Total Posts Scored'] || 0,
        [FIELDS.JOB_TRACKING.PROFILE_SCORING_TOKENS]: aggregates.metrics['Token Usage'] || 0,
        [FIELDS.JOB_TRACKING.POST_SCORING_TOKENS]: 0 // Will be updated separately
      };
      
      const updatedRecord = await base(TABLES.JOB_TRACKING).update(jobRecords[0].id, updates);
      
      log.info(`Updated job tracking aggregates: ${updatedRecord.id}`);
      return updatedRecord;
    } catch (error) {
      log.error(`Error updating job aggregates: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  // Lead operations will be added next...
}

module.exports = new AirtableRepository();