// services/runRecordAdapterSimple.js
// Simplified adapter to the airtableServiceSimple implementation
// Using the "Create once, update many, error if missing" principle

const airtableServiceSimple = require('./airtableServiceSimple');
const runIdUtils = require('../utils/runIdUtils');
const { StructuredLogger } = require('../utils/structuredLogger');

/**
 * Create a run record - ONLY called at workflow start
 * @param {string} runId - Run ID for the job
 * @param {string} clientId - Client ID
 * @param {string} clientName - Client name
 * @param {Object} options - Options including logger and source
 * @returns {Promise<Object>} - The created record
 */
async function createRunRecord(runId, clientId, clientName, options = {}) {
  const logger = options.logger || new StructuredLogger(clientId || 'SYSTEM', null, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`[RunRecordAdapterSimple] Creating run record for client ${clientId} from source ${source}`);
  
  try {
    // Clean/standardize the run ID (strip any client suffix)
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    // Add client suffix for client-specific run ID
    const standardRunId = runIdUtils.addClientSuffix(baseRunId, clientId);
    
    logger.debug(`[RunRecordAdapterSimple] Using standardized run ID: ${standardRunId}`);
    
    // Direct call to the simple service
    return await airtableServiceSimple.createClientRunRecord(standardRunId, clientId, clientName);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error creating run record: ${error.message}`);
    throw error;
  }
}

/**
 * Update a run record - requires record to exist
 * @param {string} runId - Run ID for the job
 * @param {string} clientId - Client ID
 * @param {Object} updates - Updates to apply
 * @param {Object} options - Options including logger and source
 * @returns {Promise<Object>} - The updated record
 */
async function updateRunRecord(runId, clientId, updates, options = {}) {
  const logger = options.logger || new StructuredLogger(clientId || 'SYSTEM', null, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`[RunRecordAdapterSimple] Updating run record for client ${clientId} from source ${source}`);
  
  try {
    // Clean/standardize the run ID
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    // Add client suffix for client-specific run ID
    const standardRunId = runIdUtils.addClientSuffix(baseRunId, clientId);
    
    logger.debug(`[RunRecordAdapterSimple] Using standardized run ID: ${standardRunId}`);
    
    // Direct call to the simple service
    return await airtableServiceSimple.updateClientRun(standardRunId, clientId, updates);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error updating run record: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a run record - requires record to exist
 * @param {string} runId - Run ID for the job
 * @param {string} clientId - Client ID
 * @param {string|boolean} status - Status or success boolean
 * @param {string} notes - Notes to append
 * @param {Object} options - Options including logger and source
 * @returns {Promise<Object>} - The updated record
 */
async function completeRunRecord(runId, clientId, status, notes = '', options = {}) {
  const logger = options.logger || new StructuredLogger(clientId || 'SYSTEM', null, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`[RunRecordAdapterSimple] Completing run record for client ${clientId} from source ${source}`);
  
  try {
    // Handle status as string or boolean
    const success = typeof status === 'boolean' ? status : (status === 'Completed' || status === 'Success');
    
    // Clean/standardize the run ID
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    // Add client suffix for client-specific run ID
    const standardRunId = runIdUtils.addClientSuffix(baseRunId, clientId);
    
    logger.debug(`[RunRecordAdapterSimple] Using standardized run ID: ${standardRunId}`);
    
    // Direct call to the simple service
    return await airtableServiceSimple.completeClientRun(standardRunId, clientId, success, notes);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error completing run record: ${error.message}`);
    throw error;
  }
}

// Function to create a job tracking record (without client ID)
async function createJobRecord(runId, stream = 1) {
  try {
    // Clean/standardize the run ID (strip any client suffix)
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    console.log(`[RunRecordAdapterSimple] Creating job tracking record with ID: ${baseRunId}`);
    
    // Direct call to the simple service
    return await airtableServiceSimple.createJobTrackingRecord(baseRunId, stream);
  } catch (error) {
    console.error(`[RunRecordAdapterSimple] Error creating job record: ${error.message}`);
    throw error;
  }
}

// Function to complete a job (without client ID)
async function completeJobRecord(runId, success = true, notes = '') {
  try {
    // Clean/standardize the run ID (strip any client suffix)
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    console.log(`[RunRecordAdapterSimple] Completing job tracking record with ID: ${baseRunId}`);
    
    // Direct call to the simple service
    return await airtableServiceSimple.completeJobRun(baseRunId, success, notes);
  } catch (error) {
    console.error(`[RunRecordAdapterSimple] Error completing job record: ${error.message}`);
    throw error;
  }
}

// Update aggregate metrics for a job run
async function updateJobAggregates(runId) {
  try {
    // Clean/standardize the run ID (strip any client suffix)
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    console.log(`[RunRecordAdapterSimple] Updating aggregate metrics for job: ${baseRunId}`);
    
    // Direct call to the simple service
    return await airtableServiceSimple.updateAggregateMetrics(baseRunId);
  } catch (error) {
    console.error(`[RunRecordAdapterSimple] Error updating job aggregates: ${error.message}`);
    throw error;
  }
}

/**
 * Update client metrics for a run record (posts harvesting, scoring, etc.)
 * @param {string} runId - Run ID
 * @param {string} clientId - Client ID
 * @param {Object} metrics - Metrics to update
 * @param {Object} options - Options including logger and source
 * @returns {Promise<Object>} - The updated record
 */
async function updateClientMetrics(runId, clientId, metrics, options = {}) {
  const logger = options.logger || new StructuredLogger(clientId || 'SYSTEM', runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`[RunRecordAdapterSimple] Updating client metrics for ${runId} and client ${clientId}`);
  
  try {
    // Clean/standardize the run ID (strip any client suffix)
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    // Add client suffix for client-specific run ID
    const standardRunId = runIdUtils.addClientSuffix(baseRunId, clientId);
    
    // Merge metrics with necessary fields for update
    const updates = {
      ...metrics,
      'Metrics Updated': new Date().toISOString()
    };
    
    // Add note about update source
    const metricsUpdateNote = `Metrics updated at ${new Date().toISOString()} from ${source}`;
    if (updates['System Notes']) {
      updates['System Notes'] += `. ${metricsUpdateNote}`;
    } else {
      updates['System Notes'] = metricsUpdateNote;
    }
    
    // Use airtableServiceSimple to update the record
    return await airtableServiceSimple.updateClientRun(standardRunId, clientId, updates);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Failed to update metrics: ${error.message}`);
    throw error;
  }
}

module.exports = {
  createRunRecord,
  updateRunRecord,
  completeRunRecord,
  createJobRecord,
  completeJobRecord,
  updateJobAggregates,
  updateClientMetrics,
  
  /**
   * Create a client run record with object parameters
   * This function is used by apifyProcessRoutes.js and other modules that expect
   * to call createClientRunRecord with an object parameter
   * @param {Object} params - Parameters for run record creation
   * @returns {Promise<Object>} - The created record
   */
  createClientRunRecord: async function(params) {
    const logger = new StructuredLogger(params.clientId || 'SYSTEM', params.runId, 'run_record');
    
    logger.debug(`[RunRecordAdapterSimple] Creating client run record from object params`);
    
    try {
      // Extract parameters from the object
      const { runId, clientId, operation } = params;
      
      if (!runId || !clientId) {
        throw new Error('Missing required parameters: runId and clientId');
      }
      
      // Get the client name from clientId if available
      let clientName = clientId;
      try {
        const { getClientById } = require('../services/clientService');
        const client = await getClientById(clientId);
        if (client && client.name) {
          clientName = client.name;
        }
      } catch (e) {
        logger.warn(`Could not resolve client name for ${clientId}: ${e.message}`);
      }
      
      // Clean/standardize the run ID (strip any client suffix)
      const baseRunId = runIdUtils.stripClientSuffix(runId);
      
      // Add client suffix for client-specific run ID
      const standardRunId = runIdUtils.addClientSuffix(baseRunId, clientId);
      
      logger.debug(`[RunRecordAdapterSimple] Using standardized run ID: ${standardRunId}`);
      
      // Direct call to the simple service
      return await airtableServiceSimple.createClientRunRecord(standardRunId, clientId, clientName);
    } catch (error) {
      logger.error(`[RunRecordAdapterSimple] Error creating run record: ${error.message}`);
      throw error;
    }
  }
};