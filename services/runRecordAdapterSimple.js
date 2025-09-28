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
//
// CRITICAL - DEBUG MODE ENABLED: Extensive logging added to troubleshoot Airtable auth issues

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
    return await airtableServiceSimple.createClientRunRecord(standardRunId, clientId, providedClientName);
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
 * Check if a run record exists without attempting to create it
 * This function is designed to be very robust and handle variations in run ID format
 * @param {string|Object} runIdOrParams - Run ID or parameter object
 * @param {string} [clientId] - Optional client ID when using positional parameters
 * @param {Object} [options] - Optional options when using positional parameters
 * @returns {Promise<boolean>} True if record exists, false otherwise
 */
async function checkRunRecordExists(runIdOrParams, clientId, options = {}) {
  console.log(`[DEBUG-EXTREME] checkRunRecordExists CALLED with:`, 
              typeof runIdOrParams === 'string' ? `runId=${runIdOrParams}` : 'parameter object');
  
  // For backward compatibility, handle old-style function calls
  if (typeof runIdOrParams === 'string') {
    // Convert to new format
    console.log(`[DEBUG-EXTREME] Converting string parameters to object format`);
    return checkRunRecordExists({ runId: runIdOrParams, clientId, options });
  }

  const { runId, clientId: providedClientId, options: optionsParam = {} } = runIdOrParams;
  const logger = optionsParam.logger || new StructuredLogger(providedClientId || 'SYSTEM', runId, 'run_record');
  const source = optionsParam.source || 'unknown';
  
  console.log(`[DEBUG-EXTREME] ====== START checkRunRecordExists DETAILS ======`);
  console.log(`[DEBUG-EXTREME] runId: ${runId}`);
  console.log(`[DEBUG-EXTREME] providedClientId: ${providedClientId}`);
  console.log(`[DEBUG-EXTREME] source: ${source}`);
  console.log(`[DEBUG-EXTREME] ============================================`);
  
  if (!runId) {
    console.error(`[DEBUG-EXTREME] ERROR: Missing runId in checkRunRecordExists call`);
    logger.error(`[RunRecordAdapterSimple] Missing runId in checkRunRecordExists call`);
    return false;
  }
  
  logger.debug(`[RunRecordAdapterSimple] Checking if run record exists: ${runId}, client: ${providedClientId || 'any'}`);
  
  try {
    // Extract client ID from run ID if not provided
    let clientIdToUse = providedClientId;
    
    if (!clientIdToUse) {
      // Try to extract from run ID if it has a client suffix
      const extractedClientId = runIdUtils.extractClientId(runId);
      if (extractedClientId) {
        clientIdToUse = extractedClientId;
        logger.debug(`[RunRecordAdapterSimple] Extracted clientId=${clientIdToUse} from runId`);
      }
    }
    
    if (!clientIdToUse) {
      logger.error(`[RunRecordAdapterSimple] Cannot check if record exists without clientId`);
      return false;
    }
    
    // Try with the exact run ID first using client's specific base - NOT the master base
    try {
      // CRITICAL FIX: Use client's specific base instead of master base
      // Import here to avoid circular dependencies
      console.log(`[DEBUG-EXTREME] Getting client base for clientId=${clientIdToUse}`);
      const { getClientBase } = require('../config/airtableClient');
      console.log(`[DEBUG-EXTREME] Calling getClientBase(${clientIdToUse})`);
      const base = await getClientBase(clientIdToUse);
      console.log(`[DEBUG-EXTREME] Got base connection: ${base ? 'SUCCESS' : 'NULL'}`);
      
      // Query the client-specific table
      console.log(`[DEBUG-EXTREME] Querying ${airtableServiceSimple.CLIENT_RUN_RESULTS_TABLE} for runId=${runId}`);
      logger.debug(`[RunRecordAdapterSimple] Checking for run ID: ${runId} in client base`);
      
      console.log(`[DEBUG-EXTREME] Running query with formula: {Run ID} = '${runId}'`);
      console.log(`[DEBUG-EXTREME] Table name being queried: ${airtableServiceSimple.CLIENT_RUN_RESULTS_TABLE}`);
      const records = await base(airtableServiceSimple.CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: `{Run ID} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      console.log(`[DEBUG-EXTREME] Query result: ${records ? records.length : 'NULL'} records`);
      if (records && records.length > 0) {
        // Debug: Log actual field names and values to verify structure
        console.log(`[DEBUG-EXTREME] SUCCESS: Found record with exact ID match, recordId=${records[0].id}`);
        console.log(`[DEBUG-EXTREME] Record fields available: ${Object.keys(records[0].fields).join(', ')}`);
        console.log(`[DEBUG-EXTREME] Actual 'Run ID' field value: ${records[0].fields['Run ID']}`);
        logger.debug(`[RunRecordAdapterSimple] Found record with exact ID match`);
        return true;
      }
    } catch (exactMatchError) {
      console.log(`[DEBUG-EXTREME] ERROR in exact match: ${exactMatchError.message}`);
      console.log(`[DEBUG-EXTREME] ERROR stack: ${exactMatchError.stack}`);
      logger.debug(`[RunRecordAdapterSimple] Exact match search failed: ${exactMatchError.message}`);
    }
    
    // Clean/standardize the run ID (strip any client suffix)
    const baseRunId = runIdUtils.stripClientSuffix(runId);
    
    // Try with standardized ID format
    try {
      const standardRunId = runIdUtils.addClientSuffix(baseRunId, clientIdToUse);
      
      // Skip if it's the same as what we just tried
      if (standardRunId !== runId) {
        // CRITICAL FIX: Use client's specific base instead of master base
        const { getClientBase } = require('../config/airtableClient');
        const base = await getClientBase(clientIdToUse);
        const records = await base(airtableServiceSimple.CLIENT_RUN_RESULTS_TABLE).select({
          filterByFormula: `{Run ID} = '${standardRunId}'`,
          maxRecords: 1
        }).firstPage();
        
        if (records && records.length > 0) {
          logger.debug(`[RunRecordAdapterSimple] Found record with standardized ID match: ${standardRunId}`);
          return true;
        }
      }
    } catch (standardMatchError) {
      logger.debug(`[RunRecordAdapterSimple] Standard match search failed: ${standardMatchError.message}`);
    }
    
    // Finally, try with just the date part of the run ID to find similar records
    try {
      // Extract date part (first segment before dash)
      const parts = baseRunId.split('-');
      if (parts.length > 0) {
        const datePart = parts[0];
        if (datePart && datePart.length === 6) { // YYMMDD format
          // CRITICAL FIX: Use client's specific base instead of master base
          const { getClientBase } = require('../config/airtableClient');
          const base = await getClientBase(clientIdToUse);
          const records = await base(airtableServiceSimple.CLIENT_RUN_RESULTS_TABLE).select({
            filterByFormula: `FIND('${datePart}', {Run ID}) > 0`,
            maxRecords: 5
          }).firstPage();
          
          if (records && records.length > 0) {
            logger.debug(`[RunRecordAdapterSimple] Found ${records.length} records with date part match: ${datePart}`);
            // Return true if any records found with date part
            return true;
          }
        }
      }
    } catch (datePartMatchError) {
      logger.debug(`[RunRecordAdapterSimple] Date part match search failed: ${datePartMatchError.message}`);
    }
    
    logger.debug(`[RunRecordAdapterSimple] No matching records found for runId=${runId}, clientId=${clientIdToUse}`);
    return false;
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error checking if run record exists: ${error.message}`);
    return false; // Fail safe - return false on any error
  }
}

/**
 * Safely update metrics in a run record - checking if the record exists first
 * and handling various error conditions gracefully
 * 
 * This is a common function that can be called from:
 * - Lead scoring process
 * - Post harvesting process
 * - Post scoring process
 * 
 * It ensures consistency in how we handle metrics updates across all processes.
 * 
 * @param {Object} params - Parameters for metrics update
 * @param {string} params.runId - The run ID to update metrics for
 * @param {string} params.clientId - The client ID
 * @param {string} params.processType - Type of process ('lead_scoring', 'post_harvesting', 'post_scoring')
 * @param {Object} params.metrics - The metrics to update
 * @param {Object} [params.options] - Additional options
 * @param {boolean} [params.options.isStandalone=false] - Whether this is a standalone run (will skip metrics)
 * @param {Object} [params.options.logger] - Logger instance
 * @param {string} [params.options.source] - Source of the operation
 * @returns {Promise<Object>} Result object with success status and details
 * 
 * @see {docs/METRICS-UPDATE-SYSTEM.md} For detailed documentation on this metrics system
 */
async function safeUpdateMetrics(params) {
  const { runId, clientId, processType, metrics = {}, options = {} } = params;
  const { isStandalone = false } = options;
  const logger = options.logger || new StructuredLogger(clientId, null, processType);
  const source = options.source || processType;
  
  // If this is a standalone run, don't update metrics
  if (isStandalone) {
    logger.info(`[${processType}] Skipping metrics update for standalone run ${runId}`);
    return {
      success: true,
      skipped: true,
      reason: 'standalone_run',
      message: 'Metrics update skipped for standalone run'
    };
  }
  
  try {
    logger.debug(`[${processType}] Checking if run record exists for ${runId} (${clientId})`);
    
    // First check if the run record exists using our robust function
    const recordExists = await checkRunRecordExists({ 
      runId, 
      clientId,
      options: { 
        source: `${source}_metrics`, 
        logger 
      }
    });
    
    if (!recordExists) {
      // Record doesn't exist - log warning but don't throw error
      logger.warn(`[${processType}] Run record not found for ${runId} (${clientId}). Metrics update skipped.`);
      return {
        success: false,
        skipped: true,
        reason: 'record_not_found',
        message: `Run record not found for ${runId} (${clientId}). Metrics update skipped.`
      };
    }
    
    // Record exists, proceed with update
    logger.debug(`[${processType}] Updating metrics for run ${runId} (${clientId})`);
    
    // Use the standard updateRunRecord function to apply the updates
    const updateResult = await updateRunRecord({
      runId,
      clientId,
      updates: metrics,
      options: {
        source: `${source}_metrics`,
        logger
      }
    });
    
    logger.info(`[${processType}] Successfully updated metrics for run ${runId} (${clientId})`);
    
    return {
      success: true,
      skipped: false,
      updateResult
    };
    
  } catch (error) {
    // If anything goes wrong, log error but don't fail the process
    logger.error(`[${processType}] Error updating metrics for ${runId} (${clientId}): ${error.message}`);
    
    return {
      success: false,
      error: error.message,
      skipped: true,
      reason: 'update_error'
    };
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
  checkRunRecordExists,
  safeUpdateMetrics,
  
  // For backward compatibility, alias createRunRecord to createClientRunRecord
  // This makes the transition seamless for existing code
  createClientRunRecord: createRunRecord
};