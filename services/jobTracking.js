/**
 * services/jobTracking.js
 * 
 * Unified job tracking service that serves as a single source of truth
 * for all job tracking operations across the system.
 * 
 * This class uses a standardized approach to job IDs, tracking records,
 * and client-specific run records to ensure consistency and prevent
 * duplicate entries.
 */

const { StructuredLogger } = require('../utils/structuredLogger');
const baseManager = require('./airtable/baseManager');

// Table constants
const JOB_TRACKING_TABLE = 'Job Tracking';
const CLIENT_RUN_RESULTS_TABLE = 'Client Run Results';

// Default logger
const logger = new StructuredLogger('SYSTEM', null, 'job_tracking');

/**
 * JobTracking class - single source of truth for job tracking operations
 */
class JobTracking {
  /**
   * Generate a standardized run ID in YYMMDD-HHMMSS format
   * @returns {string} A timestamp-based run ID
   */
  static generateRunId() {
    const now = new Date();
    const year = String(now.getFullYear()).slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
  }

  /**
   * Add client suffix to a base run ID
   * @param {string} baseRunId - Base run ID (YYMMDD-HHMMSS)
   * @param {string} clientId - Client ID to add as suffix
   * @returns {string} Run ID with client suffix
   */
  static addClientSuffix(baseRunId, clientId) {
    if (!baseRunId || !clientId) {
      logger.warn(`Cannot add client suffix with missing values. baseRunId: ${baseRunId}, clientId: ${clientId}`);
      return baseRunId;
    }
    
    // Format: YYMMDD-HHMMSS-ClientName
    return `${baseRunId}-${clientId}`;
  }

  /**
   * Create a job tracking record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Run ID for the job
   * @param {string} params.jobType - Type of job (e.g., 'scoring', 'post_harvesting')
   * @param {Object} [params.initialData={}] - Initial data for the record
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Created record info
   */
  static async createJob(params) {
    const { runId, jobType = 'job', initialData = {}, options = {} } = params;
    const log = options.logger || logger;
    
    if (!runId) {
      log.error("Run ID is required to create job tracking record");
      throw new Error("Run ID is required to create job tracking record");
    }
    
    try {
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Check if record already exists
      const existingRecords = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: `{Run ID} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (existingRecords && existingRecords.length > 0) {
        log.warn(`Job tracking record already exists for run ID ${runId}. Not creating duplicate.`);
        return {
          id: existingRecords[0].id,
          runId,
          alreadyExists: true
        };
      }
      
      // Default values
      const startTime = new Date().toISOString();
      
      // Prepare record data - only use fields that actually exist
      const recordData = {
        'Run ID': runId,
        'Status': 'Running',
        'Start Time': startTime,
        'Job Type': jobType,
        'System Notes': initialData['System Notes'] || ''
      };
      
      // Add any other verified fields from initialData
      if (initialData['Items Processed']) recordData['Items Processed'] = initialData['Items Processed'];
      if (initialData['Apify Run ID']) recordData['Apify Run ID'] = initialData['Apify Run ID'];
      if (initialData['Error']) recordData['Error'] = initialData['Error'];
      
      // Create the record
      const record = await masterBase(JOB_TRACKING_TABLE).create(recordData);
      
      log.debug(`Created job tracking record for ${runId}`);
      
      return {
        id: record.id,
        runId,
        startTime
      };
    } catch (error) {
      log.error(`Error creating job tracking record: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update a job tracking record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Run ID to update
   * @param {Object} params.updates - Updates to apply
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Updated record info
   */
  static async updateJob(params) {
    const { runId, updates = {}, options = {} } = params;
    const log = options.logger || logger;
    
    if (!runId) {
      log.error("Run ID is required to update job tracking record");
      throw new Error("Run ID is required to update job tracking record");
    }
    
    try {
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Find the record
      const records = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: `{Run ID} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        log.error(`Job tracking record not found for run ID ${runId}`);
        throw new Error(`Job tracking record not found for run ID ${runId}`);
      }
      
      const record = records[0];
      
      // Prepare update fields - only use fields that actually exist
      const updateFields = {};
      
      // Map common update fields to Airtable field names (only those that exist)
      if (updates.status) updateFields['Status'] = updates.status;
      if (updates.endTime) updateFields['End Time'] = updates.endTime;
      if (updates.error) updateFields['Error'] = updates.error;
      if (updates.itemsProcessed) updateFields['Items Processed'] = updates.itemsProcessed;
      
      // Handle System Notes field properly
      if (updates['System Notes']) {
        updateFields['System Notes'] = updates['System Notes'];
      } else if (updates.notes) {
        updateFields['System Notes'] = updates.notes;
      }
      
      // Add any other custom fields from updates, except formula fields
      // Careful with field names to ensure they exist
      const safeFields = [
        'Apify Run ID', 'Items Processed', 'Error',
        'Status', 'Start Time', 'End Time', 'Job Type', 'System Notes'
      ];
      
      Object.keys(updates).forEach(key => {
        if (safeFields.includes(key)) {
          updateFields[key] = updates[key];
        }
      });
      
      // Update the record
      await masterBase(JOB_TRACKING_TABLE).update(record.id, updateFields);
      
      log.debug(`Updated job tracking record for ${runId}`);
      
      return {
        id: record.id,
        runId,
        ...updates
      };
    } catch (error) {
      log.error(`Error updating job tracking record: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a client-specific run record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Base run ID
   * @param {string} params.clientId - Client ID
   * @param {Object} [params.initialData={}] - Initial data
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Created record info
   */
  static async createClientRun(params) {
    const { runId, clientId, initialData = {}, options = {} } = params;
    const log = options.logger || logger;
    
    if (!runId || !clientId) {
      log.error("Run ID and Client ID are required to create client run record");
      throw new Error("Run ID and Client ID are required to create client run record");
    }
    
    try {
      // Create client-specific run ID
      const clientRunId = JobTracking.addClientSuffix(runId, clientId);
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Check if record already exists
      const existingRecords = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: `{Run ID} = '${clientRunId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (existingRecords && existingRecords.length > 0) {
        log.warn(`Client run record already exists for ${clientRunId}. Not creating duplicate.`);
        return {
          id: existingRecords[0].id,
          runId: clientRunId,
          baseRunId: runId,
          clientId,
          alreadyExists: true
        };
      }
      
      // Default values
      const startTime = new Date().toISOString();
      
      // Prepare record data - only use fields that actually exist
      const recordData = {
        'Run ID': clientRunId,
        'Client ID': clientId,
        'Status': 'Running',
        'Start Time': startTime,
        'System Notes': initialData['System Notes'] || ''
      };
      
      // Add other verified fields that exist
      if (initialData['Apify Run ID']) recordData['Apify Run ID'] = initialData['Apify Run ID'];
      
      // Create the record
      const record = await masterBase(CLIENT_RUN_RESULTS_TABLE).create(recordData);
      
      log.debug(`Created client run record for ${clientRunId}`);
      
      return {
        id: record.id,
        runId: clientRunId,
        baseRunId: runId,
        clientId,
        startTime
      };
    } catch (error) {
      log.error(`Error creating client run record: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update a client-specific run record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Base run ID
   * @param {string} params.clientId - Client ID
   * @param {Object} params.updates - Updates to apply
   * @param {boolean} [params.createIfMissing=false] - Whether to create the record if it doesn't exist
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Updated record info
   */
  static async updateClientRun(params) {
    const { runId, clientId, updates = {}, createIfMissing = false, options = {} } = params;
    const log = options.logger || logger;
    
    if (!runId || !clientId) {
      log.error("Run ID and Client ID are required to update client run record");
      throw new Error("Run ID and Client ID are required to update client run record");
    }
    
    try {
      // Create client-specific run ID
      const clientRunId = JobTracking.addClientSuffix(runId, clientId);
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Find the record
      const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: `{Run ID} = '${clientRunId}'`,
        maxRecords: 1
      }).firstPage();
      
      // If record not found and createIfMissing is true, create it
      if ((!records || records.length === 0) && createIfMissing) {
        log.warn(`Client run record for ${clientRunId} not found, creating it...`);
        return await JobTracking.createClientRun({
          runId,
          clientId,
          initialData: updates,
          options
        });
      } else if (!records || records.length === 0) {
        log.error(`Client run record not found for ${clientRunId} and createIfMissing is false`);
        throw new Error(`Client run record not found for ${clientRunId}`);
      }
      
      const record = records[0];
      
      // Prepare update fields - only use fields that actually exist
      const updateFields = {};
      
      // Map common update fields to Airtable field names (only those that exist)
      if (updates.status) updateFields['Status'] = updates.status;
      if (updates.endTime) updateFields['End Time'] = updates.endTime;
      if (updates.leadsProcessed) updateFields['Leads Processed'] = updates.leadsProcessed;
      if (updates.postsProcessed) updateFields['Posts Processed'] = updates.postsProcessed;
      if (updates.errors) updateFields['Errors'] = updates.errors;
      
      // Handle System Notes properly
      if (updates['System Notes']) {
        updateFields['System Notes'] = updates['System Notes'];
      } else if (updates.notes) {
        updateFields['System Notes'] = updates.notes;
      }
      
      // Add token usage fields if they exist
      if (updates.tokenUsage) updateFields['Token Usage'] = updates.tokenUsage;
      if (updates.promptTokens) updateFields['Prompt Tokens'] = updates.promptTokens;
      if (updates.completionTokens) updateFields['Completion Tokens'] = updates.completionTokens;
      if (updates.totalTokens) updateFields['Total Tokens'] = updates.totalTokens;
      
      // Add API costs if they exist
      if (updates['Apify API Costs']) updateFields['Apify API Costs'] = updates['Apify API Costs'];
      
      // Update the record
      await masterBase(CLIENT_RUN_RESULTS_TABLE).update(record.id, updateFields);
      
      log.debug(`Updated client run record for ${clientRunId}`);
      
      return {
        id: record.id,
        runId: clientRunId,
        baseRunId: runId,
        clientId,
        ...updates
      };
    } catch (error) {
      log.error(`Error updating client run record: ${error.message}`);
      throw error;
    }
  }

  /**
   * Complete a job tracking record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Run ID to complete
   * @param {string} [params.status='Completed'] - Final status
   * @param {Object} [params.updates={}] - Additional updates
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Completed record info
   */
  static async completeJob(params) {
    const { runId, status = 'Completed', updates = {}, options = {} } = params;
    
    // Add completion details to updates
    const completeUpdates = {
      ...updates,
      status,
      endTime: updates.endTime || new Date().toISOString()
    };
    
    // Update the record with completion details
    return await JobTracking.updateJob({
      runId,
      updates: completeUpdates,
      options
    });
  }

  /**
   * Complete a client run record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Base run ID
   * @param {string} params.clientId - Client ID
   * @param {string} [params.status='Completed'] - Final status
   * @param {Object} [params.updates={}] - Additional updates
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Completed record info
   */
  static async completeClientRun(params) {
    const { runId, clientId, status = 'Completed', updates = {}, options = {} } = params;
    
    // Add completion details to updates
    const completeUpdates = {
      ...updates,
      status,
      endTime: updates.endTime || new Date().toISOString()
    };
    
    // Update the record with completion details
    return await JobTracking.updateClientRun({
      runId,
      clientId,
      updates: completeUpdates,
      options
    });
  }

  /**
   * Get job tracking record by run ID
   * @param {string} runId - Run ID to find
   * @returns {Promise<Object|null>} Job tracking record or null if not found
   */
  static async getJobById(runId) {
    try {
      const masterBase = baseManager.getMasterClientsBase();
      
      const records = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: `{Run ID} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        return null;
      }
      
      return records[0];
    } catch (error) {
      logger.error(`Error getting job by ID: ${error.message}`);
      return null;
    }
  }

  /**
   * Get client run record by client run ID
   * @param {string} runId - Base run ID
   * @param {string} clientId - Client ID
   * @returns {Promise<Object|null>} Client run record or null if not found
   */
  static async getClientRun(runId, clientId) {
    try {
      const clientRunId = JobTracking.addClientSuffix(runId, clientId);
      const masterBase = baseManager.getMasterClientsBase();
      
      const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: `{Run ID} = '${clientRunId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        return null;
      }
      
      return records[0];
    } catch (error) {
      logger.error(`Error getting client run: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Update client metrics for a run record without affecting End Time or Status
   * @param {Object} params - Parameters object
   * @param {string} params.runId - Run ID
   * @param {string} params.clientId - Client ID
   * @param {Object} params.metrics - Metrics to update
   * @param {Object} [params.options] - Additional options
   * @returns {Promise<Object>} Updated record info
   */
  static async updateClientMetrics(params) {
    const { runId, clientId, metrics = {}, options = {} } = params;
    const log = options.logger || logger;
    
    if (!runId || !clientId) {
      log.error("Run ID and Client ID are required to update client metrics");
      throw new Error("Run ID and Client ID are required to update client metrics");
    }
    
    try {
      // Make a copy of metrics to ensure we don't modify End Time or Status
      const filteredMetrics = { ...metrics };
      delete filteredMetrics['End Time'];
      delete filteredMetrics['Status'];
      
      // Log the metrics update
      log.debug(`Updating metrics for client ${clientId} with run ID ${runId}`, { metrics: filteredMetrics });
      
      // Use the standard updateClientRun method but with filtered metrics
      return await JobTracking.updateClientRun({
        runId,
        clientId,
        updates: {
          ...filteredMetrics,
          'Metrics Updated': new Date().toISOString()
        },
        createIfMissing: false,
        options
      });
    } catch (error) {
      log.error(`Error updating client metrics: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Complete all processing for a client (after lead scoring, post harvesting, and post scoring)
   * @param {Object} params - Parameters object
   * @param {string} params.runId - Run ID
   * @param {string} params.clientId - Client ID
   * @param {Object} params.finalMetrics - Final metrics from all processes
   * @param {Object} [params.options] - Additional options including isStandalone flag
   * @returns {Promise<Object>} Updated record info
   */
  static async completeClientProcessing(params) {
    const { runId, clientId, finalMetrics = {}, options = {} } = params;
    const log = options.logger || logger;
    const isStandalone = options.isStandalone === true;
    const source = options.source || 'unknown';
    
    if (!runId || !clientId) {
      log.error("Run ID and Client ID are required to complete client processing");
      throw new Error("Run ID and Client ID are required to complete client processing");
    }
    
    // For non-standalone runs, we should only update metrics, not complete the process
    // unless explicitly told to do so with the force flag
    if (!isStandalone && !options.force) {
      log.info(`Not completing client processing for ${clientId} - not a standalone run (source: ${source})`);
      
      // Just update metrics without End Time or Status
      return await JobTracking.updateClientMetrics({
        runId,
        clientId,
        metrics: finalMetrics,
        options: {
          ...options,
          source: `${source}_metrics_only`
        }
      });
    }
    
    try {
      // Determine final status based on metrics
      let status = 'Completed';
      const hasErrors = finalMetrics.errors && finalMetrics.errors > 0;
      const noLeadsProcessed = (!finalMetrics['Profiles Examined for Scoring'] || finalMetrics['Profiles Examined for Scoring'] === 0) &&
                              (!finalMetrics['Posts Examined for Scoring'] || finalMetrics['Posts Examined for Scoring'] === 0);
      
      if (noLeadsProcessed) {
        status = 'No Leads To Score';
      } else if (finalMetrics.failed) {
        status = 'Failed';
      }
      
      // Create updates object with End Time and Status
      const updates = {
        ...finalMetrics,
        'End Time': new Date().toISOString(),
        'Status': status,
        'Processing Completed': true
      };
      
      // Build comprehensive system notes
      const notes = [];
      if (hasErrors) {
        notes.push(`Completed with ${finalMetrics.errors} errors`);
      }
      if (finalMetrics['Profiles Successfully Scored']) {
        notes.push(`Scored ${finalMetrics['Profiles Successfully Scored']} profiles`);
      }
      if (finalMetrics['Posts Successfully Scored']) {
        notes.push(`Scored ${finalMetrics['Posts Successfully Scored']} posts`);
      }
      if (finalMetrics['Total Posts Harvested']) {
        notes.push(`Harvested ${finalMetrics['Total Posts Harvested']} posts`);
      }
      
      if (notes.length > 0) {
        const notesStr = `Final: ${notes.join(', ')}`;
        if (updates['System Notes']) {
          updates['System Notes'] += ` | ${notesStr}`;
        } else {
          updates['System Notes'] = notesStr;
        }
      }
      
      log.info(`Completing all processing for client ${clientId} with status: ${status} (standalone=${isStandalone}, source=${source})`);
      
      // Use the standard updateClientRun method
      return await JobTracking.updateClientRun({
        runId,
        clientId,
        updates,
        createIfMissing: false,
        options
      });
    } catch (error) {
      log.error(`Error completing client processing: ${error.message}`);
      throw error;
    }
  }
}

module.exports = JobTracking;