/**
 * services/airtable/runRecordRepository.js
 * 
 * Repository for run records operations in the Master Clients base.
 * Handles CRUD operations for client run records in the Client Run Results table.
 */

const { StructuredLogger } = require('../../utils/structuredLogger');
const baseManager = require('./baseManager');
const runIdService = require('./runIdService');
const jobTrackingRepository = require('./jobTrackingRepository');

// Default logger
const logger = new StructuredLogger('SYSTEM', null, 'run_record_repository');

/**
 * Create a client run record
 * @param {Object} params - Run record parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.runId - Run ID (with or without client suffix)
 * @param {string} [params.clientName] - Client name (will be looked up if not provided)
 * @param {Object} [params.initialData] - Initial data for the record
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Created run record
 */
async function createRunRecord(params) {
  const { clientId, runId, clientName, initialData = {}, options = {} } = params;
  const logger = options.logger || new StructuredLogger(clientId, null, 'run_record_repository');
  
  if (!clientId || !runId) {
    logger.error("Client ID and Run ID are required to create run record");
    throw new Error("Client ID and Run ID are required to create run record");
  }
  
  try {
    // Ensure runId has client suffix
    const standardRunId = runIdService.addClientSuffix(
      runIdService.stripClientSuffix(runId),
      clientId
    );
    
    // Get the base run ID
    const baseRunId = runIdService.stripClientSuffix(standardRunId);
    
    // Start time for the run
    const startTime = new Date().toISOString();
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Check if record already exists
    const existingRecords = await masterBase('Client Run Results').select({
      filterByFormula: `AND({Run ID} = '${standardRunId}', {Client ID} = '${clientId}')`
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      logger.warn(`Run record for ${standardRunId} already exists. Not creating duplicate.`);
      return {
        id: existingRecords[0].id,
        runId: standardRunId,
        baseRunId,
        clientId,
        clientName: existingRecords[0].get('Client Name'),
        startTime: existingRecords[0].get('Start Time'),
        status: existingRecords[0].get('Status')
      };
    }
    
    // Prepare fields for the record
    const fields = {
      'Run ID': standardRunId,
      'Base Run ID': baseRunId,
      'Client ID': clientId, // Reverted to 'Client ID' to match the actual field name in Airtable
      'Client Name': clientName || clientId, // Use clientId as fallback
      'Start Time': startTime,
      'Status': 'Running',
      ...initialData
    };
    
    // Create the run record
    const record = await masterBase('Client Run Results').create(fields);
    
    logger.debug(`Created run record for client ${clientId}: ${standardRunId}`);
    
    // Also create a job tracking record for this run
    try {
      await jobTrackingRepository.createJobTrackingRecord({
        runId: baseRunId,
        clientId,
        options: { logger }
      });
    } catch (jobError) {
      // Non-fatal, just log the error
      logger.warn(`Error creating job tracking record for ${baseRunId}: ${jobError.message}`);
    }
    
    return {
      id: record.id,
      runId: standardRunId,
      baseRunId,
      clientId,
      clientName: clientName || clientId,
      startTime,
      status: 'Running'
    };
  } catch (error) {
    logger.error(`Error creating run record: ${error.message}`);
    throw error;
  }
}

/**
 * Update a client run record
 * @param {Object} params - Update parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.runId - Run ID (with or without client suffix)
 * @param {Object} params.updates - Fields to update
 * @param {boolean} [params.createIfMissing=true] - Whether to create the record if it doesn't exist
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Updated run record
 */
async function updateRunRecord(params) {
  const { clientId, runId, updates, createIfMissing = true, options = {} } = params;
  const logger = options.logger || new StructuredLogger(clientId, null, 'run_record_repository');
  
  if (!clientId || !runId) {
    logger.error("Client ID and Run ID are required to update run record");
    throw new Error("Client ID and Run ID are required to update run record");
  }
  
  try {
    // Ensure runId has client suffix
    const standardRunId = runIdService.addClientSuffix(
      runIdService.stripClientSuffix(runId),
      clientId
    );
    
    // Get the base run ID
    const baseRunId = runIdService.stripClientSuffix(standardRunId);
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Find the record by Run ID and Client ID
    const records = await masterBase('Client Run Results').select({
      filterByFormula: `AND({Run ID} = '${standardRunId}', {Client ID} = '${clientId}')`
    }).firstPage();
    
    // If record not found and createIfMissing is true, create it
    if ((!records || records.length === 0) && createIfMissing) {
      logger.warn(`Run record for ${standardRunId} not found, creating it...`);
      
      // Create a new record with recovery information
      const createdRecord = await createRunRecord({
        clientId,
        runId: standardRunId,
        initialData: {
          'Recovery Note': 'Created during update attempt - original record missing',
          ...updates
        },
        options
      });
      
      return createdRecord;
    } else if (!records || records.length === 0) {
      const errorMsg = `Run record not found for ${standardRunId} and createIfMissing is false`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    const recordId = records[0].id;
    
    // Prepare update fields
    const updateFields = {};
    
    // Map common update fields to Airtable field names
    if (updates.status) updateFields['Status'] = updates.status;
    if (updates.endTime) updateFields['End Time'] = updates.endTime;
    if (updates.leadsProcessed) updateFields['Leads Processed'] = updates.leadsProcessed;
    if (updates.postsProcessed) updateFields['Posts Processed'] = updates.postsProcessed;
    if (updates.errors) updateFields['Errors'] = updates.errors;
    if (updates.notes) updateFields['Notes'] = updates.notes;
    if (updates.tokenUsage) updateFields['Token Usage'] = updates.tokenUsage;
    if (updates.promptTokens) updateFields['Prompt Tokens'] = updates.promptTokens;
    if (updates.completionTokens) updateFields['Completion Tokens'] = updates.completionTokens;
    if (updates.totalTokens) updateFields['Total Tokens'] = updates.totalTokens;
    
    // Add any other custom fields from updates
    Object.keys(updates).forEach(key => {
      // Don't duplicate standard fields that are already mapped
      if (!['status', 'endTime', 'leadsProcessed', 'postsProcessed', 'errors', 'notes', 
          'tokenUsage', 'promptTokens', 'completionTokens', 'totalTokens'].includes(key)) {
        updateFields[key] = updates[key];
      }
    });
    
    // Update the run record
    await masterBase('Client Run Results').update(recordId, updateFields);
    
    logger.debug(`Updated run record for client ${clientId}: ${standardRunId}`);
    
    // Also update the corresponding job tracking record
    try {
      await jobTrackingRepository.updateJobTrackingRecord({
        runId: baseRunId,
        updates: {
          clientId,
          status: updates.status,
          endTime: updates.endTime,
          progress: updates.progress || `${updates.leadsProcessed || 0} leads processed`,
          itemsProcessed: updates.leadsProcessed || updates.postsProcessed,
          error: updates.errors
        },
        options: { logger }
      });
    } catch (jobError) {
      // Non-fatal, just log the error
      logger.warn(`Error updating job tracking record for ${baseRunId}: ${jobError.message}`);
    }
    
    return {
      id: recordId,
      runId: standardRunId,
      baseRunId,
      clientId,
      ...updates
    };
  } catch (error) {
    logger.error(`Error updating run record: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a client run record
 * @param {Object} params - Completion parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.runId - Run ID (with or without client suffix)
 * @param {Object} [params.metrics] - Completion metrics
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Completed run record
 */
async function completeRunRecord(params) {
  const { clientId, runId, metrics = {}, options = {} } = params;
  const logger = options.logger || new StructuredLogger(clientId, null, 'run_record_repository');
  
  try {
    const endTime = new Date().toISOString();
    
    // Update with completion status and metrics
    return await updateRunRecord({
      clientId,
      runId,
      updates: {
        status: 'Completed',
        endTime,
        ...metrics
      },
      options
    });
  } catch (error) {
    logger.error(`Error completing run record: ${error.message}`);
    throw error;
  }
}

/**
 * Check if a run record exists
 * @param {Object} params - Query parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.runId - Run ID (with or without client suffix)
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<boolean>} Whether the record exists
 */
async function runRecordExists(params) {
  const { clientId, runId, options = {} } = params;
  const logger = options.logger || new StructuredLogger(clientId, null, 'run_record_repository');
  
  if (!clientId || !runId) {
    logger.error("Client ID and Run ID are required to check run record");
    throw new Error("Client ID and Run ID are required to check run record");
  }
  
  try {
    // Ensure runId has client suffix
    const standardRunId = runIdService.addClientSuffix(
      runIdService.stripClientSuffix(runId),
      clientId
    );
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Find the record by Run ID and Client ID
    const records = await masterBase('Client Run Results').select({
      filterByFormula: `AND({Run ID} = '${standardRunId}', {Client ID} = '${clientId}')`
    }).firstPage();
    
    return records && records.length > 0;
  } catch (error) {
    logger.error(`Error checking run record: ${error.message}`);
    throw error;
  }
}

module.exports = {
  createRunRecord,
  updateRunRecord,
  completeRunRecord,
  runRecordExists
};