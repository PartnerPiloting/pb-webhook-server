// No-op replacement for removed error logger
const logCriticalError = async () => {};
// services/runRecordServiceV2.js
// Centralized service for run record management
// Implements the STRICT Single Creation Point pattern
// 
// ARCHITECTURAL NOTE:
// This module implements the standardized object parameter pattern.
// All functions accept a single object with named parameters instead of
// positional arguments. See docs/STANDARDIZED-PARAMETER-PATTERN.md for details.
// 
// For backward compatibility, all functions still accept old-style positional parameters
// but new code should use the object parameter style exclusively.

require('dotenv').config();

// Import dependencies
const Airtable = require('airtable');
const { createLogger } = require('../utils/contextLogger');

// Create module-level logger for run record service v2
const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'run-record-service-v2' 
});
const clientService = require('./clientService');
// Updated to use the new runIdSystem service
const runIdSystem = require('./runIdSystem');
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger, getLoggerFromOptions } = require('../utils/loggerHelper');
// Import status utility functions for safe status handling
const { getStatusString } = require('../utils/statusUtils');
// Import Airtable constants
const { MASTER_TABLES, CLIENT_RUN_FIELDS, JOB_TRACKING_FIELDS, CLIENT_RUN_STATUS_VALUES } = require('../constants/airtableUnifiedConstants');

// Constants for table names
const JOB_TRACKING_TABLE = MASTER_TABLES.JOB_TRACKING;
const CLIENT_RUN_RESULTS_TABLE = MASTER_TABLES.CLIENT_RUN_RESULTS;

// Legacy field names - these fields have been removed from central constants
// as they are calculated on-the-fly, but we still need to use them in this file
const LEGACY_JOB_FIELDS = {
  CLIENTS_PROCESSED: 'Clients Processed',
  CLIENTS_WITH_ERRORS: 'Clients With Errors',
  // TOTAL_PROFILES_EXAMINED: 'Total Profiles Examined', - Removed 2025-10-02 (field deleted from Job Tracking table)
  SUCCESSFUL_PROFILES: 'Successful Profiles',
  TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
  POSTS_EXAMINED: 'Posts Examined for Scoring',
  POSTS_SUCCESSFULLY_SCORED: 'Posts Successfully Scored',
  PROFILE_SCORING_TOKENS: 'Profile Scoring Tokens',
  POST_SCORING_TOKENS: 'Post Scoring Tokens'
};

// Initialize clients base reference - will be set via initialize()
let clientsBase = null;

// Registry to track run records during runtime
const runRecordRegistry = new Map();

// Activity log for debugging
const activityLog = [];
const MAX_LOG_SIZE = 100;

/**
 * Internal function to track activity in the service
 * @param {string} action - The action performed
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} source - The source of the activity
 * @param {string} result - The result of the activity
 */
function trackActivity(action, runId, clientId, source, result) {
  // Add to activity log with timestamp
  activityLog.unshift({
    timestamp: new Date().toISOString(),
    action,
    runId,
    clientId,
    source,
    result
  });
  
  // Trim log if it gets too long
  if (activityLog.length > MAX_LOG_SIZE) {
    activityLog.pop();
  }
}

/**
 * Initialize connection to the Clients base
 * @returns {Object} The Airtable base object
 */
function initialize() {
  if (clientsBase) {
    return clientsBase;
  }

  try {
    // Check if clientService is properly loaded
    if (!clientService || typeof clientService.initializeClientsBase !== 'function') {
      logger.error("ERROR: clientService is not properly loaded or initializeClientsBase is not a function");
      
      // Fallback: Initialize directly if clientService is not working
      if (!process.env.MASTER_CLIENTS_BASE_ID) {
        throw new Error("MASTER_CLIENTS_BASE_ID environment variable is not set");
      }
      if (!process.env.AIRTABLE_API_KEY) {
        throw new Error("AIRTABLE_API_KEY environment variable is not set");
      }

      // Configure Airtable directly
      Airtable.configure({
        apiKey: process.env.AIRTABLE_API_KEY
      });

      logger.info("FALLBACK: Directly initializing Airtable base connection");
      clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    } else {
      // Use clientService's initialization (preferred method)
      clientsBase = clientService.initializeClientsBase();
      logger.info("Run Record Service: Successfully got base connection from clientService");
    }

    if (!clientsBase) {
      throw new Error("Failed to initialize clients base in runRecordService");
    }

    logger.info("Run Record Service: Connection to run tracking table initialized");
    return clientsBase;
  } catch (error) {
    logger.error("CRITICAL ERROR initializing Airtable connection:", error.message);
    logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordServiceV2.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Create a new job tracking record - ONLY called at the start of a process
 * @param {Object} params - Parameters for job record creation
 * @param {string} params.runId - The base run ID (without client suffix)
 * @param {number} [params.stream=1] - The stream number
 * @param {Object} [params.options] - Additional options
 * @param {Object} [params.options.logger] - Optional logger to use
 * @param {string} [params.options.source] - Source of the creation request
 * @returns {Promise<Object>} The created record
 */
async function createJobRecord(params) {
  const base = initialize();
  
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: createJobRecord(runId, stream, options)
    const runId = arguments[0];
    const stream = arguments[1] || 1;
    const options = arguments[2] || {};
    
    // Convert to new format
    return createJobRecord({ runId, stream, options });
  }
  
  const { runId, stream = 1, options = {} } = params;
  const logger = getLoggerFromOptions(options, 'SYSTEM', runId, 'job_tracking');
  const source = (isLegacyCall ? legacyOptions.source : params.source) || 'unknown';
  
  logger.debug(`Run Record Service: Creating job tracking record for ${runId}`);
  
  // Check if a job record already exists with this ID
  try {
    const existingRecords = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{${JOB_TRACKING_FIELDS.RUN_ID}} = '${runId}'`,
      maxRecords: 1
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      const errorMsg = `Job tracking record already exists for ${runId}`;
      logger.error(errorMsg);
      trackActivity('create_job', runId, 'SYSTEM', source, `ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  } catch (error) {
    if (error.message.includes('already exists')) {
      throw error;
    }
    logger.debug(`Error checking for existing job record: ${error.message}`);
    await logCriticalError(error, { context: 'Job record existence check failed (continuing)', service: 'runRecordServiceV2.js' }).catch(() => {});
    // Continue to create a new record if the error was just in checking
  }
  
  try {
    // Ensure the run ID is properly formatted (should be just the base run ID without client suffix)
    const baseRunId = runIdSystem.getBaseRunId(runId);
    
    if (!baseRunId) {
      logger.error(`Run Record Service: Invalid run ID format: ${runId}`);
      trackActivity('create_job', runId, 'SYSTEM', source, `ERROR: Invalid run ID format`);
      throw new Error(`Invalid run ID format: ${runId}`);
    }
    
    // Create fields object without the problematic Source field
    const recordFields = {
      [JOB_TRACKING_FIELDS.RUN_ID]: baseRunId, // Ensure we're using the properly formatted run ID
      [JOB_TRACKING_FIELDS.START_TIME]: new Date().toISOString(),
      [JOB_TRACKING_FIELDS.STATUS]: CLIENT_RUN_STATUS_VALUES.RUNNING,
      [JOB_TRACKING_FIELDS.STREAM]: stream,
      [LEGACY_JOB_FIELDS.CLIENTS_PROCESSED]: 0,  // Note: This field has been removed from constants as it's now calculated on-the-fly
      [LEGACY_JOB_FIELDS.CLIENTS_WITH_ERRORS]: 0, // Note: This field has been removed from constants as it's now calculated on-the-fly
      [LEGACY_JOB_FIELDS.TOTAL_PROFILES_EXAMINED]: 0, // Note: This field has been removed from constants as it's now calculated on-the-fly
      [LEGACY_JOB_FIELDS.SUCCESSFUL_PROFILES]: 0, // Note: This field has been removed from constants as it's now calculated on-the-fly
      [LEGACY_JOB_FIELDS.TOTAL_POSTS_HARVESTED]: 0, // Note: This field has been removed from constants as it's now calculated on-the-fly
      [LEGACY_JOB_FIELDS.POSTS_EXAMINED]: 0, // Note: This field has been removed from constants as it's now calculated on-the-fly
      [LEGACY_JOB_FIELDS.POSTS_SUCCESSFULLY_SCORED]: 0, // Note: This field has been removed from constants as it's now calculated on-the-fly
      [LEGACY_JOB_FIELDS.PROFILE_SCORING_TOKENS]: 0, // Note: This field has been removed from constants as it's now calculated on-the-fly
      [LEGACY_JOB_FIELDS.POST_SCORING_TOKENS]: 0, // Note: This field has been removed from constants as it's now calculated on-the-fly
      [JOB_TRACKING_FIELDS.SYSTEM_NOTES]: `Run initiated at ${new Date().toISOString()} from ${source}`
    };
    
    logger.debug(`Run Record Service: Creating job tracking record with ID: ${baseRunId}`);
    
    const records = await base(JOB_TRACKING_TABLE).create([
      {
        fields: recordFields
      }
    ]);

    // Track this activity
    trackActivity('create_job', runId, 'SYSTEM', source, `SUCCESS: Created job record ID ${records[0].id}`);
    
    logger.debug(`Run Record Service: Created job tracking record ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    logger.error(`Run Record Service ERROR: Failed to create job tracking record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordServiceV2.js' }).catch(() => {});
    trackActivity('create_job', runId, 'SYSTEM', source, `ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Create a client run result record - ONLY called at start of client processing
 * @param {string} runId - The structured run ID (without client suffix)
 * @param {string} clientId - The client ID
 * @param {string} clientName - The client name
 * @param {Object} options - Additional options
 * @param {Object} options.logger - Optional logger to use
 * @param {string} options.source - Source of the creation request
 * @returns {Promise<Object>} The created record
 */
/**
 * Create a client run record
 * @param {Object} params - Parameters for client run record creation
 * @param {string} params.runId - The run ID
 * @param {string} params.clientId - The client ID
 * @param {string} params.clientName - The client name
 * @param {Object} [params.options] - Additional options
 * @param {Object} [params.options.logger] - Optional logger to use
 * @param {string} [params.options.source] - Source of the creation request
 * @returns {Promise<Object>} The created record
 */
async function createClientRunRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: createClientRunRecord(runId, clientId, clientName, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const clientName = arguments[2];
    const options = arguments[3] || {};
    
    // Convert to new format
    return createClientRunRecord({ runId, clientId, clientName, options });
  }
  
  const { runId, clientId, clientName, options = {} } = params;
  const logger = getLoggerFromOptions(options, clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`Run Record Service: DELEGATING client run record creation to JobTracking service for ${clientId}`);
  
  try {
    // CRITICAL FIX: Always delegate to the unified JobTracking service
    // This ensures only ONE service actually creates client run records
    const JobTracking = require('./jobTracking');
    
    return await JobTracking.createClientRun({
      runId,
      clientId,
      initialData: {
        [CLIENT_RUN_FIELDS.SYSTEM_NOTES]: `Processing started from source: ${source}`
      },
      options: {
        logger,
        source
      }
    });
  } catch (error) {
    logger.error(`Run Record Service ERROR: Failed to create client run record via JobTracking: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordServiceV2.js' }).catch(() => {});
    throw error;
  }
  
  /* REMOVED: All direct database access code was removed during refactoring.
   * This service now delegates to JobTracking which is the single point of record creation.
   * 
   * The JobTracking.createClientRun function properly:
   * 1. Normalizes the run ID
   * 2. Checks for existing records
   * 3. Prevents duplicates
   * 4. Creates the record with proper fields
   * 
   * By delegating to JobTracking, we ensure:
   * - Only ONE place in the code creates client run records
   * - Consistent run ID normalization
   * - No duplicates due to slight run ID variations
   */
}

/**
 * Get a client run record - NEVER creates if not found
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The run record, or null if not found
 */
/**
 * Get a run record by ID and client
 * @param {Object} params - Parameters for getting run record
 * @param {string} params.runId - The run ID
 * @param {string} params.clientId - The client ID
 * @param {Object} [params.options] - Additional options
 * @param {Object} [params.options.logger] - Optional logger to use
 * @param {string} [params.options.source] - Source of the request
 * @returns {Promise<Object|null>} The record if found, null otherwise
 */
async function getRunRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: getRunRecord(runId, clientId, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const options = arguments[2] || {};
    
    // Convert to new format
    return getRunRecord({ runId, clientId, options });
  }
  
  const { runId, clientId, options = {} } = params;
  const base = initialize();
  const logger = getLoggerFromOptions(options, clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  // Normalize the run ID
  const standardRunId = runIdSystem.validateAndStandardizeRunId(runId);
  
  logger.debug(`Run Record Service: Getting run record for ${standardRunId}, client ${clientId}`);
  
  // Check registry first
  const registryKey = `${standardRunId}:${clientId}`;
  if (runRecordRegistry.has(registryKey)) {
    logger.debug(`Run Record Service: Found record in registry`);
    trackActivity('get', standardRunId, clientId, source, `SUCCESS: Found in registry`);
    return runRecordRegistry.get(registryKey);
  }
  
  // Then check runIdSystem cache
  const cachedRecordId = runIdSystem.getRunRecordId(standardRunId, clientId);
  if (cachedRecordId) {
    try {
      logger.debug(`Run Record Service: Trying cached record ID ${cachedRecordId}`);
      const record = await base(CLIENT_RUN_RESULTS_TABLE).find(cachedRecordId);
      runRecordRegistry.set(registryKey, record);
      trackActivity('get', standardRunId, clientId, source, `SUCCESS: Found by cached ID ${cachedRecordId}`);
      return record;
    } catch (err) {
      logger.debug(`Run Record Service: Cached record ID ${cachedRecordId} no longer valid`);
      await logCriticalError(err, { context: 'Cached record lookup failed (will query)', service: 'runRecordServiceV2.js' }).catch(() => {});
    }
  }
  
  // Query for the record
  try {
    // First, validate that the table exists for this client
    try {
      // Check specifically if the Client Run Results table exists
      // Note: We don't need to check all tables, just try to access the one we need
      await base(CLIENT_RUN_RESULTS_TABLE).select({ maxRecords: 1 }).firstPage();
    } catch (tableError) {
      // Convert "not authorized" errors to a more helpful message about missing tables/fields
      await logCriticalError(tableError, { context: 'Table validation check failed', service: 'runRecordServiceV2.js' }).catch(() => {});
      if (tableError.message.includes('not authorized')) {
        const betterError = new Error(`Table '${CLIENT_RUN_RESULTS_TABLE}' may not exist in client ${clientId}'s base or you don't have access. Original error: ${tableError.message}`);
        logger.warn(`Run Record Service: ${betterError.message}`);
        trackActivity('get', standardRunId, clientId, source, `TABLE ERROR: ${betterError.message}`);
        return null; // Return null instead of throwing - allows the calling code to continue
      }
      // For other errors, just pass through
      throw tableError;
    }
    
    const exactIdQuery = `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${standardRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientId}')`;
    logger.debug(`Run Record Service: Querying for record: ${exactIdQuery}`);
    
    const exactMatches = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: exactIdQuery,
      maxRecords: 1
    }).firstPage();
    
    if (exactMatches && exactMatches.length > 0) {
      // Register the record ID
      logger.debug(`Run Record Service: Found record by query`);
      runIdSystem.registerRunRecord(standardRunId, clientId, exactMatches[0].id);
      runRecordRegistry.set(registryKey, exactMatches[0]);
      trackActivity('get', standardRunId, clientId, source, `SUCCESS: Found by query`);
      return exactMatches[0];
    }
    
    logger.warn(`Run Record Service: No record found for ${standardRunId}, client ${clientId}`);
    trackActivity('get', standardRunId, clientId, source, `WARNING: Record not found`);
    return null;
  } catch (error) {
    logger.error(`Run Record Service ERROR during get: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordServiceV2.js' }).catch(() => {});
    trackActivity('get', standardRunId, clientId, source, `ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Update a client run record - NEVER creates if not found
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} updates - The fields to update
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
/**
 * Update an existing run record - enforces that record must exist
 * @param {Object} params - Parameters for run record update
 * @param {string} params.runId - The run ID
 * @param {string} params.clientId - The client ID
 * @param {Object} params.updates - The updates to apply
 * @param {Object} [params.options] - Additional options
 * @param {Object} [params.options.logger] - Optional logger to use
 * @param {string} [params.options.source] - Source of the update request
 * @returns {Promise<Object>} The updated record
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
  const logger = getLoggerFromOptions(options, clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`Run Record Service: Updating run record for ${runId}, client ${clientId} (source: ${source})`);
  
  // First, get the record - this will NOT create if missing
  let record = await getRunRecord({ runId, clientId, options });
  
  // STRICT ENFORCEMENT: Do NOT create new records, only update existing ones
  if (!record) {
    // Generate a detailed error message
    const errorMsg = `[STRICT ENFORCEMENT] No existing record found for ${runId} (client ${clientId}). UPDATE REJECTED.`;
    logger.error(errorMsg);
    logger.error(`[STRICT ENFORCEMENT] This indicates a process kickoff issue - run record should already exist`);
    logger.error(`[STRICT ENFORCEMENT] Update operation skipped - updates would have been:`, JSON.stringify(updates));
    
    // Track the failure for metrics and debugging
    trackActivity('update', runId, clientId, source, `ERROR: ${errorMsg}`);
    
    // Throw error as explicitly requested
    throw new Error(`Cannot update non-existent run record for ${clientId} (${runId}). Record must exist before updates.`);
  }
  
  const base = initialize();
  
  // Update with new values
  const updateFields = {
    ...updates
    // 'Last Updated' field removed as it doesn't exist in Airtable schema
  };
  
  // Add information about the update to System Notes field
  if (updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES]) {
    updateFields[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = `${updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES]}. Updated from ${source}.`;
  } else {
    const existingNotes = record.fields[CLIENT_RUN_FIELDS.SYSTEM_NOTES] || '';
    updateFields[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = `${existingNotes}${existingNotes ? '. ' : ''}Updated at ${new Date().toISOString()} from ${source}`;
  }
  
  // ROOT CAUSE FIX: Use field validator to normalize field names BEFORE Airtable update
  // This prevents field name mismatches in Client Run Results updates
  const { createValidatedObject } = require('../utils/airtableFieldValidator');
  const normalizedUpdateFields = createValidatedObject(updateFields, { log: false });
  
  const updateData = {
    id: record.id,
    fields: normalizedUpdateFields
  };
  
  logger.debug(`Run Record Service: Updating record ${record.id} with data: ${JSON.stringify(updateData.fields)}`);
  
  try {
    const updatedRecord = await base(CLIENT_RUN_RESULTS_TABLE).update([updateData]);
    
    if (!updatedRecord || updatedRecord.length === 0) {
      throw new Error('Failed to update run record - no record returned');
    }
    
    // Update registry
    const registryKey = `${runIdSystem.validateAndStandardizeRunId(runId)}:${clientId}`;
    runRecordRegistry.set(registryKey, updatedRecord[0]);
    
    // Track this activity
    trackActivity('update', runId, clientId, source, `SUCCESS: Updated record ID ${record.id}`);
    
    logger.debug(`Run Record Service: Successfully updated run record ${record.id}`);
    
    return updatedRecord[0];
  } catch (error) {
    logger.error(`Run Record Service ERROR during update: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordServiceV2.js' }).catch(() => {});
    trackActivity('update', runId, clientId, source, `ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Update client run metrics - specialized update method for tracking metrics
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} metrics - The metrics to update
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
async function updateClientMetrics(runId, clientId, metrics, options = {}) {
  const logger = getLoggerFromOptions(options, clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`Run Record Service: Updating client metrics for ${runId}, client ${clientId} (source: ${source})`);
  
  // First, get the record - this will NOT create if missing
  const record = await getRunRecord(runId, clientId, options);
  
  // If record not found, this is an error condition
  if (!record) {
    const errorMsg = `Cannot update metrics: Run record not found for ${runId}, client ${clientId}`;
    logger.error(errorMsg);
    trackActivity('update_metrics', runId, clientId, source, `ERROR: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  // Get current values to ensure we don't overwrite with lower values
  const currentValues = record.fields;
  
  // For numeric fields, use the higher value
  const numericFields = [
    CLIENT_RUN_FIELDS.PROFILES_EXAMINED,
    CLIENT_RUN_FIELDS.PROFILES_SCORED,
    CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED,
    CLIENT_RUN_FIELDS.POSTS_EXAMINED,
    CLIENT_RUN_FIELDS.POSTS_SCORED,
    CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS,
    CLIENT_RUN_FIELDS.POST_SCORING_TOKENS,
    CLIENT_RUN_FIELDS.APIFY_API_COSTS
  ];
  
  const updatedMetrics = { ...metrics };
  
  numericFields.forEach(field => {
    if (updatedMetrics[field] !== undefined && currentValues[field] !== undefined) {
      const currentVal = Number(currentValues[field] || 0);
      const newVal = Number(updatedMetrics[field] || 0);
      
      // Always use the higher value
      if (currentVal > newVal) {
        updatedMetrics[field] = currentVal;
      }
    }
  });
  
  // Note: 'Metrics Updated' field removed - not present in Airtable schema
  
  // Include update source in System Notes to ensure we don't lose tracking info
  const metricsUpdateNote = `Metrics updated at ${new Date().toISOString()} from ${source}`;
  if (updatedMetrics[CLIENT_RUN_FIELDS.SYSTEM_NOTES]) {
    updatedMetrics[CLIENT_RUN_FIELDS.SYSTEM_NOTES] += `. ${metricsUpdateNote}`;
  } else {
    updatedMetrics[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = metricsUpdateNote;
  }
  
  return await updateRunRecord(runId, clientId, updatedMetrics, { 
    logger,
    source: `metrics_update_from_${source}` 
  });
}

/**
 * Complete a client run with final status
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} status - Final status (Success, Error, Skipped)
 * @param {string} notes - Additional notes
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
async function completeRunRecord(runId, clientId, status, notes = '', options = {}) {
  const logger = getLoggerFromOptions(options, clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`Run Record Service: Completing run record for ${runId}, client ${clientId} with status ${status} (source: ${source})`);
  
  // First, get the record - this will NOT create if missing
  let record = await getRunRecord(runId, clientId, options);
  
  // STRICT ENFORCEMENT: Do NOT create new records, only update existing ones
  if (!record) {
    // Generate a detailed error message
    const errorMsg = `[STRICT ENFORCEMENT] No existing record found for ${runId} (client ${clientId}). COMPLETION REJECTED.`;
    logger.error(errorMsg);
    logger.error(`[STRICT ENFORCEMENT] This indicates a process kickoff issue - run record should already exist`);
    logger.error(`[STRICT ENFORCEMENT] Completion operation skipped - status would have been: ${status}`);
    
    // Track the failure for metrics and debugging
    trackActivity('complete', runId, clientId, source, `ERROR: ${errorMsg}`);
    
    // Throw error as explicitly requested
    throw new Error(`Cannot complete non-existent run record for ${clientId} (${runId}). Record must exist before completion.`);
  }
  
  const endTimestamp = new Date().toISOString();
  
  // Calculate duration if start time exists
  let duration = null;
  const startTime = record.fields[CLIENT_RUN_FIELDS.START_TIME];
  
  if (startTime) {
    const start = new Date(startTime);
    const end = new Date(endTimestamp);
    duration = (end - start) / 1000; // Duration in seconds
  }
  
  // Update with completion info, removing problematic fields
  const updates = {
    [CLIENT_RUN_FIELDS.END_TIME]: endTimestamp,
    // Notes added directly to System Notes instead of using Completion Notes field
    [CLIENT_RUN_FIELDS.SYSTEM_NOTES]: `Completed at ${endTimestamp} from ${source}. ${notes || ''}`
  };
  
  // Source info is already added to System Notes - don't try to use the Source field at all
  // Duration info added to System Notes instead of using Duration field
  if (duration !== null && updates && updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES]) {
    updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES] += ` Duration: ${duration} seconds.`;
  }
  
  // Track this activity
  trackActivity('complete', runId, clientId, source, `Status: ${status}, Notes: ${notes}`);
  
  return await updateRunRecord(runId, clientId, updates, {
    logger,
    source: `completion_from_${source}`
  });
}

/**
 * Update a job tracking record
 * @param {string} runId - The run ID
 * @param {Object} updates - Updates to apply
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
async function updateJobRecord(runId, updates, options = {}) {
  const base = initialize();
  const logger = getLoggerFromOptions(options, 'SYSTEM', runId, 'job_tracking');
  const source = options.source || 'unknown';
  
  // Strip client suffix if present
  const baseRunId = runIdSystem.getBaseRunId(runId);
  
  logger.debug(`Run Record Service: Updating job tracking for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    // Find the job tracking record
    const records = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{${JOB_TRACKING_FIELDS.RUN_ID}} = '${baseRunId}'`
    }).firstPage();
    
    if (!records || records.length === 0) {
      const errorMsg = `Job tracking record not found for ${runId} (base: ${baseRunId})`;
      logger.error(errorMsg);
      trackActivity('update_job', baseRunId, 'SYSTEM', source, `ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    const record = records[0];
    
    // Update the record with all required fields, completely removing Source field
    const updateFields = {
      ...updates,
      [JOB_TRACKING_FIELDS.LAST_UPDATED]: new Date().toISOString()
    };
    
    // Add update source information to System Notes
    const updateNote = `Job updated at ${new Date().toISOString()} from ${source}`;
    if (updates[JOB_TRACKING_FIELDS.SYSTEM_NOTES]) {
      updateFields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = `${updates[JOB_TRACKING_FIELDS.SYSTEM_NOTES]}. ${updateNote}`;
    } else {
      const existingNotes = record.fields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] || '';
      updateFields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = `${existingNotes}${existingNotes ? '. ' : ''}${updateNote}`;
    }
    
    const updateData = {
      id: record.id,
      fields: updateFields
    };
    
    logger.debug(`Run Record Service: Updating job record ${record.id} with data: ${JSON.stringify(updateData.fields)}`);
    
    const updatedRecords = await base(JOB_TRACKING_TABLE).update([updateData]);
    
    if (!updatedRecords || updatedRecords.length === 0) {
      throw new Error('Failed to update job record - no record returned');
    }
    
    // Track this activity
    trackActivity('update_job', baseRunId, 'SYSTEM', source, `SUCCESS: Updated job record ${record.id}`);
    
    logger.debug(`Run Record Service: Successfully updated job record ${record.id}`);
    
    return updatedRecords[0];
  } catch (error) {
    logger.error(`Run Record Service ERROR during job update: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordServiceV2.js' }).catch(() => {});
    trackActivity('update_job', baseRunId, 'SYSTEM', source, `ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a job run with final status
 * @param {string} runId - The run ID
 * @param {boolean} success - Whether the job was successful
 * @param {string} notes - Additional notes
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
async function completeJobRecord(runId, success, notes = '', options = {}) {
  const logger = getLoggerFromOptions(options, 'SYSTEM', runId, 'job_tracking');
  const source = options.source || 'unknown';
  
  // Strip client suffix if present
  const baseRunId = runIdSystem.getBaseRunId(runId);
  
  logger.debug(`Run Record Service: Completing job record for ${runId} (base: ${baseRunId})`);
  
  const endTimestamp = new Date().toISOString();
  
  const updates = {
    [JOB_TRACKING_FIELDS.STATUS]: success ? CLIENT_RUN_STATUS_VALUES.COMPLETED : CLIENT_RUN_STATUS_VALUES.FAILED,
    [JOB_TRACKING_FIELDS.END_TIME]: endTimestamp,
    // Notes added directly to System Notes instead of using Completion Notes field
    [JOB_TRACKING_FIELDS.SYSTEM_NOTES]: `Job completed at ${endTimestamp} with status ${success ? CLIENT_RUN_STATUS_VALUES.COMPLETED : CLIENT_RUN_STATUS_VALUES.FAILED} from ${source}. ${notes || ''}`
  };
  
  // Track this activity
  trackActivity('complete_job', baseRunId, 'SYSTEM', source, `Success: ${success}, Notes: ${notes}`);
  
  return await updateJobRecord(baseRunId, updates, {
    logger,
    source: `job_completion_from_${source}`
  });
}

/**
 * Get the activity log for debugging
 * @param {number} limit - Maximum number of entries to return
 * @returns {Array} The activity log
 */
function getActivityLog(limit = 50) {
  return activityLog.slice(0, limit);
}

/**
 * Get statistics about run records
 * @returns {Object} Statistics
 */
function getStats() {
  return {
    registrySize: runRecordRegistry.size,
    activityLogSize: activityLog.length,
    recordTypes: countRecordTypes()
  };
}

/**
 * Count types of records in registry
 * @returns {Object} Counts by type
 */
function countRecordTypes() {
  const counts = { running: 0, completed: 0, error: 0, other: 0 };
  
  for (const [_, record] of runRecordRegistry.entries()) {
    // Status field deprecated - check Progress Log for completion status instead
    const progressLog = record.fields?.[CLIENT_RUN_FIELDS.PROGRESS_LOG] || '';
    const hasCompletion = progressLog.includes('✅') || progressLog.includes('Completed');
    const hasError = progressLog.includes('❌') || progressLog.includes('Error');
    
    // Derive status from Progress Log
    const status = hasError ? 'failed' : (hasCompletion ? 'completed' : 'running');
    
    // Safety: Use fallback strings if constants are undefined
    const runningStr = 'running';
    const completedStr = 'completed';
    const failedStr = 'failed';
    
    if (status === runningStr) {
      counts.running++;
    } else if (status === completedStr) {
      counts.completed++;
    } else if (status === failedStr) {
      counts.error++;
    } else {
      counts.other++;
    }
  }
  
  return counts;
}

/**
 * Check if a run record exists without attempting to create it
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID (optional, can be extracted from runId if it contains client suffix)
 * @returns {Promise<boolean>} True if record exists, false otherwise
 */
async function checkRunRecordExists(runId, clientId = null) {
  try {
    
    // Extract client ID from runId if not provided and runId contains client suffix
    if (!clientId && runId && runId.includes('-C')) {
      const parts = runId.split('-C');
      if (parts.length > 1) {
        clientId = parts[1];
      }
    }
    
    if (!clientId) {
      return false;
    }
    
    // Use getRunRecord which never creates if not found
    const record = await getRunRecord(runId, clientId, { source: 'checkRunRecordExists' });
    
    if (record) {
    } else {
      // Try to find any similar records
      try {
        const base = initialize();
        const records = await base(CLIENT_RUN_RESULTS_TABLE).select({
          filterByFormula: `{${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientId}'`, // Using constant for field name
          maxRecords: 5,
          sort: [{ field: CLIENT_RUN_FIELDS.START_TIME, direction: 'desc' }]
        }).firstPage();
        
        if (records && records.length > 0) {
          records.forEach(rec => {
          });
        } else {
        }
      } catch (searchError) {
        await logCriticalError(searchError, { context: 'Client records search failed (debug info)', service: 'runRecordServiceV2.js' }).catch(() => {});
      }
    }
    
    return record !== null;
  } catch (error) {
    await logCriticalError(error, { context: 'Service error (swallowed)', service: 'runRecordServiceV2.js' }).catch(() => {});
    await logCriticalError(error, { context: 'Service error (swallowed)', service: 'runRecordServiceV2.js' }).catch(() => {});
    return false;
  }
}

// Export all functions
module.exports = {
  initialize,
  createJobRecord,
  createClientRunRecord,
  getRunRecord,
  updateRunRecord,
  updateClientMetrics,
  completeRunRecord,
  updateJobRecord,
  completeJobRecord,
  getActivityLog,
  getStats,
  checkRunRecordExists
};