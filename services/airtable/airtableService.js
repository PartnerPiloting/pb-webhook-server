/**
 * services/airtable/airtableService.js
 * 
 * Main entry point for application code to interact with Airtable data.
 * Provides a unified interface to all Airtable operations through repositories.
 */

const { createSystemLogger } = require('../../utils/contextLogger');
const baseManager = require('./baseManager');
const leadRepository = require('./leadRepository');
const clientRepository = require('./clientRepository');
// Use unified services for run ID and job tracking
const runIdService = require('../../services/unifiedRunIdService');
const { JobTracking } = require('../../services/jobTracking');
const runRecordService = require('../../services/runRecordServiceV2');

// Import constants for standardized field names
const { FIELD_NAMES } = require('../../utils/airtableFieldValidator');
const { CLIENT_RUN_STATUS_VALUES } = require('../../constants/airtableUnifiedConstants');

// Default logger
const logger = createSystemLogger(null, 'airtable_service');

/**
 * Initialize the Airtable service
 * @returns {boolean} Whether initialization was successful
 */
function initialize() {
  try {
    // Ensure Airtable API is configured
    const configResult = baseManager.configureAirtable();
    if (!configResult) {
      logger.error("Failed to configure Airtable API");
      return false;
    }
    
    // Test connection to master clients base
    const masterBase = baseManager.getMasterClientsBase();
    if (!masterBase) {
      logger.error("Failed to connect to master clients base");
      return false;
    }
    
    logger.debug("Airtable service initialized successfully");
    return true;
  } catch (error) {
    logger.error(`Error initializing Airtable service: ${error.message}`);
    return false;
  }
}

/**
 * Get a client by ID
 * @param {string} clientId - Client ID to retrieve
 * @returns {Promise<Object|null>} Client data or null if not found
 */
async function getClient(clientId) {
  return await clientRepository.getClientById(clientId);
}

/**
 * Get all clients
 * @returns {Promise<Array>} Array of all clients
 */
async function getAllClients() {
  return await clientRepository.getAllClients();
}

/**
 * Get leads for a client with optional filtering
 * @param {Object} params - Query parameters
 * @param {string} params.clientId - Client ID
 * @param {Object} [params.filter] - Filter options
 * @param {string} [params.view] - Airtable view name
 * @param {number} [params.maxRecords] - Maximum records to return
 * @param {string[]} [params.fields] - Fields to include
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Array>} Array of lead records
 */
async function getLeads(params) {
  return await leadRepository.getLeads(params);
}

/**
 * Get a specific lead by ID
 * @param {Object} params - Query parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.leadId - Lead ID
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Lead record
 */
async function getLeadById(params) {
  return await leadRepository.getLeadById(params);
}

/**
 * Update a lead record
 * @param {Object} params - Update parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.leadId - Lead ID
 * @param {Object} params.updates - Fields to update
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Updated lead record
 */
async function updateLead(params) {
  return await leadRepository.updateLead(params);
}

/**
 * Update multiple leads in batch
 * @param {Object} params - Batch update parameters
 * @param {string} params.clientId - Client ID
 * @param {Array} params.records - Records to update
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Array>} Updated lead records
 */
async function updateLeadsInBatch(params) {
  return await leadRepository.updateLeadsInBatch(params);
}

/**
 * Create a run record for a client operation
 * @param {Object} params - Run record parameters
 * @param {string} params.clientId - Client ID
 * @param {string} [params.runId] - Optional existing run ID
 * @param {Object} [params.initialData] - Initial data for the record
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Created run record with standardized run ID
 */
async function createRunRecord(params) {
  const { clientId, runId: existingRunId, initialData = {}, options = {} } = params;
  
  try {
    // Get or generate a run ID
    const runId = existingRunId || runIdService.getOrCreateRunId(clientId, { forceNew: true });
    
    // Get client info
    const client = await getClient(clientId);
    const clientName = client ? client.clientName : clientId;
    
    // Create the run record using the runRecordService with proper source
    // Ensure options includes source parameter to pass authorization check
    const enhancedOptions = {
      ...options,
      source: options.source || 'airtable_service' // Add default source if not provided
    };
    
    return await runRecordService.createClientRunRecord({
      clientId,
      runId,
      clientName,
      initialData,
      options: enhancedOptions
    });
  } catch (error) {
    logger.error(`Error creating run record for client ${clientId}: ${error.message}`);
    throw error;
  }
}

/**
 * Update a run record for a client operation
 * @param {Object} params - Run record update parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.runId - Run ID
 * @param {Object} params.updates - Fields to update
 * @param {boolean} [params.createIfMissing=true] - Whether to create if missing
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Updated run record
 */
async function updateRunRecord(params) {
  const { clientId, runId, updates, createIfMissing = true, options = {} } = params;
  
  try {
    // Use the correct method in runRecordService
    return await runRecordService.updateClientMetrics({
      clientId,
      runId,
      metrics: updates,
      createIfMissing,
      options
    });
  } catch (error) {
    logger.error(`Error updating run record for client ${clientId}: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a run record for a client operation
 * @param {Object} params - Run record completion parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.runId - Run ID
 * @param {Object} [params.metrics] - Completion metrics
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Completed run record
 */
async function completeRunRecord(params) {
  const { clientId, runId, metrics = {}, options = {}, status } = params;
  
  try {
    // Use the runRecordService with standardized field names
    return await runRecordService.completeRunRecord({
      clientId,
      runId,
      ...metrics, // Include any metrics as fields
      options: options
    });
  } catch (error) {
    logger.error(`Error completing run record for client ${clientId}: ${error.message}`);
    throw error;
  }
}

/**
 * Generate a new run ID for a client
 * @param {string} clientId - Client ID
 * @param {Object} [options] - Options
 * @returns {string} Generated run ID
 */
function generateRunId(clientId, options = {}) {
  return runIdService.getOrCreateRunId(clientId, { forceNew: true, ...options });
}

/**
 * Get an existing run ID for a client or create a new one
 * @param {string} clientId - Client ID
 * @param {Object} [options] - Options
 * @returns {string} Run ID
 */
function getOrCreateRunId(clientId, options = {}) {
  return runIdService.getOrCreateRunId(clientId, options);
}

/**
 * Clear caches
 * @param {Object} [options] - Options for cache clearing
 * @param {boolean} [options.clients=false] - Clear clients cache
 * @param {boolean} [options.bases=false] - Clear base connections cache
 * @param {boolean} [options.runIds=false] - Clear active run IDs
 */
function clearCaches(options = {}) {
  if (options.clients) {
    clientRepository.clearClientsCache();
    logger.debug("Cleared clients cache");
  }
  
  if (options.bases) {
    baseManager.clearBaseCache();
    logger.debug("Cleared base connections cache");
  }
  
  if (options.runIds) {
    runIdService.clearAllRunIds();
    logger.debug("Cleared active run IDs");
  }
}

/**
 * Create a job tracking record
 * @param {Object} params - Job tracking parameters
 * @param {string} params.runId - Run ID for the job
 * @param {string} [params.clientId] - Client ID
 * @param {number|string} [params.stream=1] - Stream number for the job
 * @param {Object} [params.initialData] - Initial data for the job
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Created job tracking record
 */
async function createJobTrackingRecord(params) {
  const { runId, clientId, stream = 1, initialData = {}, options = {} } = params;
  
  try {
    return await JobTracking.createJob({
      runId,
      clientId,
      stream,
      ...initialData,
      options
    });
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
  
  try {
    return await JobTracking.updateJob({
      runId,
      updates,
      options
    });
  } catch (error) {
    logger.error(`Error updating job tracking record: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a job tracking record
 * @param {Object} params - Completion parameters
 * @param {string} params.runId - Run ID for the job
 * @param {string} [params.status='Completed'] - Final status
 * @param {Object} [params.metrics] - Completion metrics
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Completed job tracking record
 */
async function completeJobTrackingRecord(params) {
  const { runId, status = 'Completed', metrics = {}, options = {} } = params;
  
  try {
    return await JobTracking.completeJob({
      runId,
      status,
      systemNotes: metrics['System Notes'],
      options
    });
  } catch (error) {
    logger.error(`Error completing job tracking record: ${error.message}`);
    throw error;
  }
}

module.exports = {
  initialize,
  getClient,
  getAllClients,
  getLeads,
  getLeadById,
  updateLead,
  updateLeadsInBatch,
  createRunRecord,
  updateRunRecord,
  completeRunRecord,
  createJobTrackingRecord,
  updateJobTrackingRecord,
  completeJobTrackingRecord,
  generateRunId,
  getOrCreateRunId,
  clearCaches
};