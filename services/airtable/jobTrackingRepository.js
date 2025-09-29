/**
 * services/airtable/jobTrackingRepository.js
 * 
 * Repository for job tracking operations in the Master Clients base.
 * Handles CRUD operations for job tracking records.
 */

const { StructuredLogger } = require('../../utils/structuredLogger');
const baseManager = require('./baseManager');
const runIdService = require('./runIdService');

// Default logger
const logger = new StructuredLogger('SYSTEM', null, 'job_tracking_repository');

/**
 * Create a job tracking record in the Master Clients base
 * @param {Object} params - Job tracking parameters
 * @param {string} params.runId - Run ID for the job (with or without client suffix)
 * @param {string} [params.clientId] - Optional client ID for the job
 * @param {Object} [params.initialData] - Initial data for the job
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Created job tracking record
 */
async function createJobTrackingRecord(params) {
  const { runId, clientId, initialData = {}, options = {} } = params;
  const logger = options.logger || new StructuredLogger(clientId || 'SYSTEM', null, 'job_tracking_repository');
  
  if (!runId) {
    logger.error("Run ID is required to create job tracking record");
    throw new Error("Run ID is required to create job tracking record");
  }
  
  try {
    // Get the base run ID (strip client suffix if present)
    const baseRunId = runIdService.stripClientSuffix(runId);
    
    // Start time for the job
    const startTime = new Date().toISOString();
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Check if record already exists
    const existingRecords = await masterBase('Job Tracking').select({
      filterByFormula: `{Run ID} = '${baseRunId}'`
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      logger.warn(`Job tracking record for ${baseRunId} already exists. Not creating duplicate.`);
      return {
        id: existingRecords[0].id,
        runId: baseRunId,
        clientId,
        startTime: existingRecords[0].get('Start Time'),
        status: existingRecords[0].get('Status')
      };
    }
    
    // Create the record
    const record = await masterBase('Job Tracking').create({
      'Run ID': baseRunId,
      // 'Client ID' field removed as it doesn't exist in the Job Tracking table
      // 'Job Type' field removed as it doesn't exist in the Job Tracking table
      'Start Time': startTime,
      'Status': 'Running',
      ...initialData
    });
    
    logger.debug(`Created job tracking record for ${baseRunId}`);
    
    return {
      id: record.id,
      runId: baseRunId,
      clientId,
      startTime,
      status: 'Running'
    };
  } catch (error) {
    logger.error(`Error creating job tracking record: ${error.message}`);
    throw error;
  }
}

/**
 * Update a job tracking record
 * @param {Object} params - Update parameters
 * @param {string} params.runId - Run ID for the job
 * @param {Object} params.updates - Fields to update
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Updated job tracking record
 */
async function updateJobTrackingRecord(params) {
  const { runId, updates, options = {} } = params;
  const logger = options.logger || new StructuredLogger(updates.clientId || 'SYSTEM', null, 'job_tracking_repository');
  
  if (!runId) {
    logger.error("Run ID is required to update job tracking record");
    throw new Error("Run ID is required to update job tracking record");
  }
  
  try {
    // Get the base run ID (strip client suffix if present)
    const baseRunId = runIdService.stripClientSuffix(runId);
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Find the record by Run ID
    const records = await masterBase('Job Tracking').select({
      filterByFormula: `{Run ID} = '${baseRunId}'`
    }).firstPage();
    
    if (!records || records.length === 0) {
      logger.error(`Job tracking record not found for ${baseRunId} (base: ${baseRunId}). Updates will not be applied.`);
      
      // Don't try to create a new record, just return a placeholder with error info
      return {
        error: 'Job tracking record not found',
        runId: baseRunId,
        clientId: updates.clientId,
        status: 'Error',
        errorMessage: 'Job tracking record not found'
      };
    }
    
    const recordId = records[0].id;
    
    // Prepare update fields
    const updateFields = {};
    
    // Map common update fields to Airtable field names
    if (updates.status) updateFields['Status'] = updates.status;
    if (updates.endTime) updateFields['End Time'] = updates.endTime;
    if (updates.error) updateFields['Error'] = updates.error;
    if (updates.progress) updateFields['Progress'] = updates.progress;
    if (updates.itemsProcessed) updateFields['Items Processed'] = updates.itemsProcessed;
    if (updates.notes) updateFields['Notes'] = updates.notes;
    
    // Add any other custom fields from updates
    Object.keys(updates).forEach(key => {
      if (!['status', 'endTime', 'error', 'progress', 'itemsProcessed', 'notes', 'clientId'].includes(key)) {
        updateFields[key] = updates[key];
      }
    });
    
    // Update the record
    await masterBase('Job Tracking').update(recordId, updateFields);
    
    logger.debug(`Updated job tracking record for ${baseRunId}`);
    
    return {
      id: recordId,
      runId: baseRunId,
      ...updates
    };
  } catch (error) {
    logger.error(`Error updating job tracking record: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a job tracking record
 * @param {Object} params - Completion parameters
 * @param {string} params.runId - Run ID for the job
 * @param {string} [params.status='Completed'] - Final status for the job
 * @param {Object} [params.metrics] - Completion metrics
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Completed job tracking record
 */
async function completeJobTrackingRecord(params) {
  const { runId, status = 'Completed', metrics = {}, options = {} } = params;
  
  try {
    const endTime = new Date().toISOString();
    
    // Update with completion status and metrics
    return await updateJobTrackingRecord({
      runId,
      updates: {
        status,
        endTime,
        ...metrics
      },
      options
    });
  } catch (error) {
    logger.error(`Error completing job tracking record: ${error.message}`);
    throw error;
  }
}

/**
 * Check if a job tracking record exists
 * @param {Object} params - Query parameters
 * @param {string} params.runId - Run ID to check
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<boolean>} Whether the record exists
 */
async function jobTrackingRecordExists(params) {
  const { runId, options = {} } = params;
  const logger = options.logger || new StructuredLogger('SYSTEM', null, 'job_tracking_repository');
  
  if (!runId) {
    logger.error("Run ID is required to check job tracking record");
    throw new Error("Run ID is required to check job tracking record");
  }
  
  try {
    // Get the base run ID (strip client suffix if present)
    const baseRunId = runIdService.stripClientSuffix(runId);
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Find the record by Run ID
    const records = await masterBase('Job Tracking').select({
      filterByFormula: `{Run ID} = '${baseRunId}'`
    }).firstPage();
    
    return records && records.length > 0;
  } catch (error) {
    logger.error(`Error checking job tracking record: ${error.message}`);
    throw error;
  }
}

module.exports = {
  createJobTrackingRecord,
  updateJobTrackingRecord,
  completeJobTrackingRecord,
  jobTrackingRecordExists
};