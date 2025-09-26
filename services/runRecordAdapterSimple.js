// services/runRecordAdapterSimple.js
// Simplified adapter to the airtableServiceSimple implementation
// Using the "Create once, update many, error if missing" principle
// 
// ARCHITECTURAL NOTE:
// This module implements the standardized object parameter pattern.
// All functions accept a single object with named parameters instead of
// positional arguments. See docs/STANDARDIZED-PARAMETER-PATTERN.md for details.
// 
// For backward compatibility, all functions still accept old-style positional parameters
// but new code should use the object parameter style exclusively.

const airtableServiceSimple = require('./airtableServiceSimple');
const runIdUtils = require('../utils/runIdUtils');
const { StructuredLogger } = require('../utils/structuredLogger');

/**
 * @typedef {Object} RunRecordParams
 * @property {string} runId - The run identifier
 * @property {string} clientId - The client identifier
 * @property {string} [clientName] - Optional client name (will be looked up if not provided)
 * @property {Object} [options] - Additional options
 * @property {Object} [options.logger] - Logger instance
 * @property {string} [options.source] - Source of the operation
 * @property {boolean} [options.requireExisting=true] - Whether to require existing record
 */

/**
 * @typedef {Object} RunRecordMetrics
 * @property {number} [totalPosts] - Total posts harvested
 * @property {number} [apiCosts] - API costs
 * @property {string} [apifyRunId] - Apify run identifier
 * @property {number} [profilesSubmitted] - Profiles submitted count
 */

/**
 * Create a run record - ONLY called at workflow start
 * @param {RunRecordParams} params - Parameters for run record creation
 * @returns {Promise<Object>} - The created record
 */
async function createRunRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: createRunRecord(runId, clientId, clientName, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const clientName = arguments[2];
    const options = arguments[3] || {};
    
    // Convert to new format
    return createRunRecord({ runId, clientId, clientName, options });
  }
  
  const { runId, clientId, clientName: providedClientName, options = {} } = params;
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
 * @param {Object} params - Parameters for run record update
 * @param {string} params.runId - Run ID for the job
 * @param {string} params.clientId - Client ID
 * @param {Object} params.updates - Updates to apply
 * @param {Object} [params.options] - Options including logger and source
 * @returns {Promise<Object>} - The updated record
 */
async function updateRunRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: updateRunRecord(runId, clientId, updates, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const updates = arguments[2];
    const options = arguments[3] || {};
    
    // Convert to new format
    return updateRunRecord({ runId, clientId, updates, options });
  }
  
  const { runId, clientId, updates, options = {} } = params;
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
 * @param {Object} params - Parameters for run record completion
 * @param {string} params.runId - Run ID for the job
 * @param {string} params.clientId - Client ID
 * @param {string|boolean} params.status - Status or success boolean
 * @param {string} [params.notes=''] - Notes to append
 * @param {Object} [params.options] - Options including logger and source
 * @returns {Promise<Object>} - The updated record
 */
async function completeRunRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: completeRunRecord(runId, clientId, status, notes, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const status = arguments[2];
    const notes = arguments[3] || '';
    const options = arguments[4] || {};
    
    // Convert to new format
    return completeRunRecord({ runId, clientId, status, notes, options });
  }
  
  const { runId, clientId, status, notes = '', options = {} } = params;
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

/**
 * Function to create a job tracking record (without client ID)
 * @param {Object} params - Parameters for job record creation
 * @param {string} params.runId - Run ID for the job
 * @param {number} [params.stream=1] - Stream number
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} - The created record
 */
async function createJobRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: createJobRecord(runId, stream)
    const runId = arguments[0];
    const stream = arguments[1] || 1;
    
    // Convert to new format
    return createJobRecord({ runId, stream });
  }
  
  const { runId, stream = 1, options = {} } = params;
  const logger = options.logger || new StructuredLogger('SYSTEM', runId, 'job_tracking');
  
  try {
    // Clean/standardize the run ID (strip any client suffix)
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    logger.debug(`[RunRecordAdapterSimple] Creating job tracking record with ID: ${baseRunId}`);
    
    // Direct call to the simple service
    return await airtableServiceSimple.createJobTrackingRecord(baseRunId, stream);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error creating job record: ${error.message}`);
    throw error;
  }
}

/**
 * Function to complete a job (without client ID)
 * @param {Object} params - Parameters for job completion
 * @param {string} params.runId - Run ID for the job
 * @param {boolean} [params.success=true] - Whether the job completed successfully
 * @param {string} [params.notes=''] - Completion notes
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} - The updated record
 */
async function completeJobRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: completeJobRecord(runId, success, notes)
    const runId = arguments[0];
    const success = arguments[1] !== undefined ? arguments[1] : true;
    const notes = arguments[2] || '';
    
    // Convert to new format
    return completeJobRecord({ runId, success, notes });
  }
  
  const { runId, success = true, notes = '', options = {} } = params;
  const logger = options.logger || new StructuredLogger('SYSTEM', runId, 'job_tracking');
  
  try {
    // Clean/standardize the run ID (strip any client suffix)
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    logger.debug(`[RunRecordAdapterSimple] Completing job tracking record with ID: ${baseRunId}`);
    
    // Direct call to the simple service
    return await airtableServiceSimple.completeJobRun(baseRunId, success, notes);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error completing job record: ${error.message}`);
    throw error;
  }
}

/**
 * Update aggregate metrics for a job run
 * @param {Object} params - Parameters for updating job aggregates
 * @param {string} params.runId - Run ID for the job
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} - The updated record
 */
async function updateJobAggregates(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: updateJobAggregates(runId)
    const runId = arguments[0];
    
    // Convert to new format
    return updateJobAggregates({ runId });
  }
  
  const { runId, options = {} } = params;
  const logger = options.logger || new StructuredLogger('SYSTEM', runId, 'job_tracking');
  
  try {
    // Clean/standardize the run ID (strip any client suffix)
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    logger.debug(`[RunRecordAdapterSimple] Updating aggregate metrics for job: ${baseRunId}`);
    
    // Direct call to the simple service
    return await airtableServiceSimple.updateAggregateMetrics(baseRunId);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error updating job aggregates: ${error.message}`);
    throw error;
  }
}

/**
 * Update client metrics for a run record (posts harvesting, scoring, etc.)
 * @param {Object} params - Parameters for updating metrics
 * @param {string} params.runId - Run ID
 * @param {string} params.clientId - Client ID
 * @param {Object} params.metrics - Metrics to update
 * @param {Object} [params.options] - Options including logger and source
 * @returns {Promise<Object>} - The updated record
 */
async function updateClientMetrics(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: updateClientMetrics(runId, clientId, metrics, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const metrics = arguments[2];
    const options = arguments[3] || {};
    
    // Convert to new format
    return updateClientMetrics({ runId, clientId, metrics, options });
  }
  
  const { runId, clientId, metrics, options = {} } = params;
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

/**
 * Export all functions using the standardized object parameter approach
 * All functions now accept an object with named parameters for improved clarity
 * and flexibility, while maintaining backward compatibility with legacy calls.
 */
module.exports = {
  createRunRecord,
  updateRunRecord,
  completeRunRecord,
  createJobRecord,
  completeJobRecord,
  updateJobAggregates,
  updateClientMetrics,
  
  // For backward compatibility, alias createRunRecord to createClientRunRecord
  // This makes the transition seamless for existing code
  createClientRunRecord: createRunRecord
};