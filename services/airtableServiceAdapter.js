const { logCriticalError } = require("../utils/errorLogger");
/**
 * services/airtableServiceAdapter.js
 * 
 * Adapter layer to bridge the old airtableService.js implementation
 * with the new services/airtable/airtableService.js implementation.
 * 
 * This ensures consistent run ID generation and management during
 * the transition to the new architecture.
 */

const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
const airtableService = require('./airtableService');

// Default logger - using safe creation
const logger = createSafeLogger('SYSTEM', null, 'airtable_service_adapter');

/**
 * Initialize the Airtable service
 * @returns {boolean} Whether initialization was successful
 */
function initialize() {
  try {
    return airtableService.initialize();
  } catch (error) {
    logger.error(`Error initializing Airtable service: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (swallowed)', service: 'airtableServiceAdapter.js' }).catch(() => {});
    return false;
  }
}

/**
 * Create a job tracking record in the Master Clients base
 * Bridge function for compatibility with existing code
 * 
 * @param {string} runId - Run ID for the job
 * @param {string|number} stream - Stream identifier
 * @returns {Promise<Object>} Created job tracking record
 */
async function createJobTrackingRecord(runId, stream) {
  try {
    // Convert stream to a number if it's a string
    const streamNumber = typeof stream === 'string' ? parseInt(stream, 10) : stream;
    
    // Using the new service layer
    return await airtableService.createJobTrackingRecord({
      runId,
      initialData: {
        'Stream': streamNumber // Ensure stream is a number for Airtable's number field
      }
    });
  } catch (error) {
    logger.error(`Error creating job tracking record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'airtableServiceAdapter.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Update aggregate metrics for the current job
 * Bridge function for compatibility with existing code
 * 
 * @param {string} runId - Run ID for the job
 * @param {Object} [metrics] - Metrics to update
 * @returns {Promise<Object>} Updated job tracking record
 */
async function updateAggregateMetrics(runId, metrics = {}) {
  try {
    // Strip client suffix if present to get base run ID
    const baseRunId = runId.includes('-') ? runId.split('-').slice(0, 2).join('-') : runId;
    
    // Using the new service layer
    return await airtableService.updateJobTrackingRecord({
      runId: baseRunId,
      updates: metrics
    });
  } catch (error) {
    logger.error(`Error updating aggregate metrics: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'airtableServiceAdapter.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Complete a job run
 * Bridge function for compatibility with existing code
 * 
 * @param {string} runId - Run ID for the job
 * @param {boolean} success - Whether the job completed successfully
 * @param {string} [notes] - Completion notes
 * @returns {Promise<Object>} Updated job tracking record
 */
async function completeJobRun(runId, success, notes = '') {
  try {
    // Strip client suffix if present to get base run ID
    const baseRunId = runId.includes('-') ? runId.split('-').slice(0, 2).join('-') : runId;
    
    // Prepare status update
    const status = success ? 'completed' : 'completed_with_errors';
    
    // Using the new service layer
    return await airtableService.completeJobTrackingRecord({
      runId: baseRunId,
      status,
      notes
    });
  } catch (error) {
    logger.error(`Error completing job run: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'airtableServiceAdapter.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Update client run record
 * Bridge function for compatibility with existing code
 * 
 * @param {string} runId - Run ID for the client
 * @param {string} clientId - Client ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} Updated client run record
 */
async function updateClientRun(runId, clientId, updates) {
  try {
    // Using the new service layer
    return await airtableService.updateRunRecord({
      runId,
      clientId,
      updates,
      createIfMissing: true
    });
  } catch (error) {
    logger.error(`Error updating client run: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'airtableServiceAdapter.js' }).catch(() => {});
    throw error;
  }
}

module.exports = {
  initialize,
  createJobTrackingRecord,
  updateAggregateMetrics,
  completeJobRun,
  updateClientRun
};