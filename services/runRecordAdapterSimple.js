// No-op replacement for removed error logger
const logCriticalError = async () => {};
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
// CRITICAL - ROOT CAUSE FIX: Added extensive validation to prevent [object Object] and
// undefined property errors. This catches errors at the source instead of allowing
// them to propagate through the system.

// Create a Map to track creation attempts and prevent duplicates
const creationAttempts = new Map();
// Set a TTL for creation attempt records to prevent memory leaks
const CREATION_ATTEMPT_TTL_MS = 5 * 60 * 1000; // 5 minutes

const airtableService = require('./airtableService');
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
// CIRCULAR DEPENDENCY FIX: Import airtableClient once at module level
const airtableClient = require('../config/airtableClient');
// Import the new run ID system for all run ID operations
const runIdSystem = require('./runIdSystem');
// Import field validator for consistent field naming
// Removed duplicate STATUS_VALUES import, using the unified constants directly 
const { FIELD_NAMES, createValidatedObject, validateFieldNames } = require('../utils/airtableFieldValidator');
const { CLIENT_RUN_STATUS_VALUES, CLIENT_RUN_FIELDS, JOB_TRACKING_FIELDS, MASTER_TABLES } = require('../constants/airtableUnifiedConstants');
// Import status utility functions for safe status handling
const { getStatusString } = require('../utils/statusUtils');

/**
 * Helper function to get a logger from options or create a new one
 * @param {Object} options - Options object that may contain a logger
 * @param {string} clientId - Client ID for logger creation
 * @param {string} runId - Run ID for logger creation  
 * @param {string} context - Context for logger creation
 * @returns {Object} - Logger instance
 */
function getLoggerFromOptions(options, clientId, runId, context = 'general') {
  // If logger is provided in options, use it
  if (options && options.logger && typeof options.logger.info === 'function') {
    return options.logger;
  }
  
  // Otherwise create a safe logger
  return createSafeLogger(clientId || 'SYSTEM', runId || 'unknown', context);
}

// CRITICAL: Verify constants are properly imported
if (!JOB_TRACKING_FIELDS || !CLIENT_RUN_FIELDS || !MASTER_TABLES) {
  logger.error('CRITICAL: Constants not properly imported from airtableUnifiedConstants.js');
  throw new Error('Missing required constants');
}

// CRITICAL: Verify status values are properly imported
if (!CLIENT_RUN_STATUS_VALUES || typeof CLIENT_RUN_STATUS_VALUES !== 'object') {
  logger.error('CRITICAL: CLIENT_RUN_STATUS_VALUES not properly imported from airtableUnifiedConstants.js');
  throw new Error('Missing required status constants');
}

// Import run ID validator for input validation
const RunIdValidator = require('../utils/runIdValidator');
// Import safe access utilities for defensive programming
const { safeGet, safeSet } = require('../utils/safeAccess');

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
  
  // CRITICAL FIX: Validate params is an object before destructuring
  if (!params || typeof params !== 'object') {
    const errMsg = `Invalid params: ${JSON.stringify(params)}`;
    logger.error(`[RunRecordAdapterSimple] ${errMsg}`);
    throw new Error(errMsg);
  }
  
  const { runId, clientId, clientName: providedClientName, options = {} } = params;
  
  // ROOT CAUSE FIX: Validate runId and clientId before proceeding
  const validatedRunId = RunIdValidator.validateAndNormalize(runId, 'createRunRecord');
  const validatedClientId = RunIdValidator.validateClientId(clientId, 'createRunRecord');
  
  if (!validatedRunId || !validatedClientId) {
    const errorMsg = `Invalid parameters: runId=${JSON.stringify(runId)}, clientId=${JSON.stringify(clientId)}`;
    const sysLogger = createSafeLogger('SYSTEM', validatedRunId || runId, 'run_record');
    sysLogger.error(`[RunRecordAdapterSimple] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  // CRITICAL FIX: Create unique key and check if we already attempted creation
  const recordKey = `${validatedRunId}-${validatedClientId}`;
  
  // Check if we're already creating this record (prevents race conditions)
  if (creationAttempts.has(recordKey)) {
    const attemptInfo = creationAttempts.get(recordKey);
    const logger = getLoggerFromOptions(options, validatedClientId, validatedRunId, 'run_record');
    logger.warn(`[DUPLICATE_PREVENTION] Already attempted to create record ${recordKey} at ${attemptInfo.timestamp} from ${attemptInfo.source}`);
    return { 
      skipped: true, 
      reason: 'duplicate_creation_attempt',
      originalSource: attemptInfo.source 
    };
  }
  
  // Mark that we're attempting to create this record
  creationAttempts.set(recordKey, {
    timestamp: new Date().toISOString(),
    source: options.source || 'unknown'
  });
  
  // Clean up old entries after TTL to prevent memory leak
  setTimeout(() => {
    creationAttempts.delete(recordKey);
  }, CREATION_ATTEMPT_TTL_MS);
  
  const logger = getLoggerFromOptions(options, validatedClientId, validatedRunId, 'run_record');
  const source = options.source || 'unknown';
  
  // STANDALONE CHECK: Don't create records in standalone mode
  if (options.isStandalone === true) {
    logger.info(`[RunRecordAdapterSimple] Skipping client run record creation for standalone run: ${validatedRunId}, ${validatedClientId}`);
    return { skipped: true, reason: 'standalone_run' };
  }
  
  logger.debug(`[RunRecordAdapterSimple] Creating run record for client ${validatedClientId} from source ${source}`);
  
  try {
    // Get the base run ID without any client suffix
    const baseRunId = runIdSystem.getBaseRunId(validatedRunId);
    
    // Create a client-specific run ID using the base ID
    const standardRunId = runIdSystem.createClientRunId(baseRunId, validatedClientId);
    
    logger.debug(`[RunRecordAdapterSimple] Using standardized run ID: ${standardRunId}`);
    
    // CRITICAL: Check if client run record already exists first to prevent duplicates
    // This uses the MASTER base directly, not client-specific bases
    const masterBase = airtableClient.getMasterBase();
    
    if (!masterBase) {
      throw new Error("Failed to get master base connection. This is required for client run records.");
    }
    
    logger.debug(`[RunRecordAdapterSimple] Checking for existing client run record in MASTER base: ${standardRunId}, ${validatedClientId}`);
    
    // ROOT CAUSE FIX: Use field name constants to prevent errors
    const existingRecords = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).select({
      filterByFormula: `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${standardRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${validatedClientId}')`,
      maxRecords: 1
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      logger.info(`[RunRecordAdapterSimple] Client run record already exists for ${standardRunId}, ${validatedClientId}, using existing record`);
      return existingRecords[0];
    }
    
    logger.debug(`[RunRecordAdapterSimple] No existing client run record found, creating new: ${standardRunId}, ${validatedClientId}`);
    
    // Direct call to the simple service - only creates if doesn't exist
    return await airtableService.createClientRunRecord(standardRunId, validatedClientId, providedClientName);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error creating run record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
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
  
  // ROOT CAUSE FIX: Validate params is an object
  if (!params || typeof params !== 'object') {
    const errMsg = `Invalid params: ${JSON.stringify(params)}`;
    logger.error(`[RunRecordAdapterSimple] ${errMsg}`);
    throw new Error(errMsg);
  }
  
  const { runId, clientId, updates, options = {} } = params;
  
  // ROOT CAUSE FIX: Validate runId and clientId
  const validatedRunId = RunIdValidator.validateAndNormalize(runId, 'updateRunRecord');
  const validatedClientId = RunIdValidator.validateClientId(clientId, 'updateRunRecord');
  
  if (!validatedRunId || !validatedClientId) {
    const errorMsg = `Invalid parameters: runId=${JSON.stringify(runId)}, clientId=${JSON.stringify(clientId)}`;
    const sysLogger = createSafeLogger('SYSTEM', validatedRunId || runId, 'run_record');
    sysLogger.error(`[RunRecordAdapterSimple] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  const logger = getLoggerFromOptions(options, validatedClientId, validatedRunId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`[RunRecordAdapterSimple] Updating run record for client ${validatedClientId} from source ${source}`);
  
  try {
    // STANDALONE CHECK: Don't update records in standalone mode
    if (options.isStandalone === true) {
      logger.info(`[RunRecordAdapterSimple] Skipping record update for standalone run: ${validatedRunId}, ${validatedClientId}`);
      return { skipped: true, reason: 'standalone_run' };
    }
    
    // Get the base run ID without any client suffix
    const baseRunId = runIdSystem.getBaseRunId(validatedRunId);
    
    // Create a client-specific run ID using the base ID
    const standardRunId = runIdSystem.createClientRunId(baseRunId, validatedClientId);
    
    logger.debug(`[RunRecordAdapterSimple] Using standardized run ID: ${standardRunId}`);
    
    // CRITICAL: First check if the record exists
    const recordExists = await checkRunRecordExists({ 
      runId: standardRunId, 
      clientId: validatedClientId,
      options: { source, logger }
    });
    
    if (!recordExists) {
      const errorMsg = `[RunRecordAdapterSimple] CRITICAL: Cannot update non-existent record for ${standardRunId}, ${validatedClientId}`;
      logger.error(errorMsg);
      throw new Error(`Cannot update non-existent record for ${validatedClientId} (${standardRunId}). Record must exist before updates.`);
    }
    
    // ROOT CAUSE FIX: Validate updates is an object
    if (!updates || typeof updates !== 'object') {
      const errorMsg = `Invalid updates object: ${JSON.stringify(updates)}`;
      logger.error(`[RunRecordAdapterSimple] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Direct call to the simple service - will only be called if record exists
    return await airtableService.updateClientRun(standardRunId, validatedClientId, updates);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error updating run record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Complete a run record - requires record to exist
 * @param {Object} params - Parameters for run record completion
 * @param {string} params.runId - Run ID for the job
 * @param {string} params.clientId - Client ID
 * @param {string|boolean} params[FIELD_NAMES.STATUS] - Status value using standardized field name
 * @param {string} [params[FIELD_NAMES.SYSTEM_NOTES]] - Notes to append using standardized field name
 * @param {Object} [params.options] - Options including logger and source
 * @returns {Promise<Object>} - The updated record
 */
async function completeRunRecord(params) {
  const source = 'RunRecordAdapterSimple.completeRunRecord';
  
  // ROOT CAUSE FIX: Validate params is an object
  if (!params || typeof params !== 'object') {
    const errMsg = `Invalid params: ${JSON.stringify(params)}`;
    logger.error(`[${source}] ${errMsg}`);
    throw new Error(errMsg);
  }
  
  // DEBUG: Log params structure to diagnose undefined issues
  logger.info(`[${source}] Received params with keys: ${Object.keys(params).map(k => k === undefined ? 'UNDEFINED' : `"${k}"`).join(', ')}`);
  
  // Extract values using standardized field names
  const runId = params.runId;
  const clientId = params.clientId;
  // CRITICAL FIX: Safely extract status - try multiple possible keys to handle different calling patterns
  const statusKey = FIELD_NAMES?.STATUS || 'Status';
  const status = params[statusKey] || params.status || params.Status;
  
  // DEBUG: Log what status value we extracted
  logger.info(`[${source}] Extracted status: ${status} (type: ${typeof status}), statusKey used: ${statusKey}`);
  const notesKey = FIELD_NAMES?.SYSTEM_NOTES || 'System Notes';
  const notes = params[notesKey] || params.systemNotes || params.notes || '';
  const options = params.options || {};
  
  // ROOT CAUSE FIX: Validate runId and clientId
  const validatedRunId = RunIdValidator.validateAndNormalize(runId, source);
  const validatedClientId = RunIdValidator.validateClientId(clientId, source);
  
  if (!validatedRunId || !validatedClientId) {
    const errorMsg = `Invalid parameters: runId=${JSON.stringify(runId)}, clientId=${JSON.stringify(clientId)}`;
    const sysLogger = createSafeLogger('SYSTEM', validatedRunId || String(runId) || 'invalid', 'run_record');
    sysLogger.error(`[${source}] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  // Initialize logger AFTER we have validated runId and clientId
  const logger = getLoggerFromOptions(options, validatedClientId, validatedRunId, 'run_record');
  // Use our own source value if options.source is not provided
  const sourceContext = options.source || source;
  
  logger.debug(`[${source}] Completing run record for client ${validatedClientId} from source ${sourceContext}`);
  
  try {
    // STANDALONE CHECK: Don't update records in standalone mode
    if (options.isStandalone === true) {
      logger.info(`[${source}] Skipping record completion for standalone run: ${validatedRunId}, ${validatedClientId}`);
      return { skipped: true, reason: 'standalone_run' };
    }
    
    // ROOT CAUSE FIX: Handle null or undefined status
    if (status === null || status === undefined) {
      logger.error(`[${source}] Invalid status: ${status}`);
      throw new Error(`Cannot complete run record with invalid status: ${status}`);
    }
    
    // Handle status as string or boolean - safely
    let success = false;
    if (typeof status === 'boolean') {
      success = status;
    } else if (typeof status === 'string' && status) {
      // IMPROVEMENT: Use centralized statusUtils to safely handle toLowerCase conversion
      // This maintains the defensive programming approach while using standardized utilities
      try {
        // CRITICAL FIX: Add extra safety checks to prevent toLowerCase errors
        // First ensure CLIENT_RUN_STATUS_VALUES is properly defined
        const isValidStatusEnum = CLIENT_RUN_STATUS_VALUES && typeof CLIENT_RUN_STATUS_VALUES === 'object';
        // Then check if status is in the enum (only if the enum is valid)
        const isStatusKey = isValidStatusEnum && status && status.toUpperCase() === status && status in CLIENT_RUN_STATUS_VALUES;
        
        // Now use the appropriate method based on our safety checks
        const statusStr = isStatusKey
          ? getStatusString(status)
          : (status ? String(status).toLowerCase() : 'unknown');
          
        // Match against lowercase constants for case-insensitive comparison
        // Triple-check CLIENT_RUN_STATUS_VALUES.COMPLETED exists and is a string
        const completedValue = CLIENT_RUN_STATUS_VALUES?.COMPLETED;
        const completedStr = (isValidStatusEnum && completedValue && typeof completedValue === 'string') 
          ? completedValue.toLowerCase() 
          : 'completed'; // Hardcoded fallback
        success = statusStr === completedStr || statusStr === 'success';
      } catch (error) {
        logger.warn(`[${source}] Error converting status to lowercase: ${error.message}`);
        await logCriticalError(error, { context: 'Status conversion error (defaulting to false)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
        // Default to false on error
        success = false;
      }
    } else {
      // Default to false for other types
      logger.warn(`[${source}] Unexpected status type: ${typeof status}, defaulting to false`);
      success = false;
    }
    
    // Get the base run ID with proper error handling
    let normalizedRunId;
    try {
      normalizedRunId = runIdSystem.getBaseRunId(validatedRunId);
      
      // CRITICAL FIX: Handle the case where getBaseRunId returns null or undefined
      if (!normalizedRunId) {
        logger.warn(`[${source}] Failed to get base run ID from: ${validatedRunId}, using validated ID as fallback`);
        normalizedRunId = validatedRunId; // Use validated ID as fallback to prevent undefined errors
      }
    } catch (error) {
      // Error occurred during processing - use validated ID as fallback
      logger.warn(`[${source}] Error getting base run ID: ${error.message}, using validated ID as fallback`);
      await logCriticalError(error, { context: 'Run ID normalization failed (using fallback)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
      normalizedRunId = validatedRunId; // Use validated ID as fallback to prevent undefined errors
    }
    
    // Get base run ID with error handling
    let baseRunId;
    try {
  baseRunId = runIdSystem.getBaseRunId(normalizedRunId);
      if (!baseRunId) {
        logger.warn(`[${source}] Failed to strip client suffix, using normalized ID as fallback`);
        baseRunId = normalizedRunId;
      }
    } catch (error) {
      logger.warn(`[${source}] Error stripping client suffix: ${error.message}, using normalized ID as fallback`);
      await logCriticalError(error, { context: 'Client suffix stripping failed (using fallback)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
      baseRunId = normalizedRunId;
    }
    
    // Add client suffix with proper error handling
    let standardRunId;
    try {
  standardRunId = runIdSystem.createClientRunId(baseRunId, validatedClientId);
      if (!standardRunId) {
        logger.error(`[${source}] Failed to add client suffix: ${baseRunId}, ${validatedClientId}`);
        throw new Error(`Failed to add client suffix: ${baseRunId}, ${validatedClientId}`);
      }
    } catch (error) {
      logger.error(`[${source}] Error adding client suffix: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
      throw new Error(`Error adding client suffix: ${error.message}`);
    }
    
    logger.debug(`[${source}] Using standardized run ID: ${standardRunId}`);
    
    // CRITICAL: First check if the record exists
    const recordExists = await checkRunRecordExists({ 
      runId: standardRunId, 
      clientId: validatedClientId,
      options: { source: sourceContext, logger }
    });
    
    if (!recordExists) {
      const errorMsg = `[${source}] CRITICAL: Cannot complete non-existent record for ${standardRunId}, ${validatedClientId}`;
      logger.error(errorMsg);
      throw new Error(`Cannot complete non-existent run record for ${validatedClientId} (${standardRunId}). Record must exist before completion.`);
    }
    
    // Create a properly structured object with standardized field names for update
    const updateData = {
      [FIELD_NAMES.RUN_ID]: standardRunId,
      [FIELD_NAMES.CLIENT_ID]: validatedClientId,
      [FIELD_NAMES.STATUS]: success ? CLIENT_RUN_STATUS_VALUES.COMPLETED : CLIENT_RUN_STATUS_VALUES.FAILED,
      [FIELD_NAMES.SYSTEM_NOTES]: notes
    };
    
    // Direct call to the simple service using standardized field names
    return await airtableService.completeClientRun(standardRunId, validatedClientId, updateData);
  } catch (error) {
    logger.error(`[${source}] Error completing run record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
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
  
  // ROOT CAUSE FIX: Validate params is an object
  if (!params || typeof params !== 'object') {
    const errMsg = `Invalid params: ${JSON.stringify(params)}`;
    logger.error(`[RunRecordAdapterSimple] ${errMsg}`);
    throw new Error(errMsg);
  }
  
  const { runId, stream = 1, options = {} } = params;
  
  // ROOT CAUSE FIX: Validate runId
  const validatedRunId = RunIdValidator.validateAndNormalize(runId, 'createJobRecord');
  
  if (!validatedRunId) {
    const errorMsg = `Invalid runId parameter: ${JSON.stringify(runId)}`;
    const sysLogger = createSafeLogger('SYSTEM', validatedRunId || runId, 'job_tracking');
    sysLogger.error(`[RunRecordAdapterSimple] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  // CRITICAL FIX: Create unique key and check if we already attempted job creation
  const jobRecordKey = `job-${validatedRunId}`;
  
  // Check if we're already creating this job record (prevents race conditions)
  if (creationAttempts.has(jobRecordKey)) {
    const attemptInfo = creationAttempts.get(jobRecordKey);
    const logger = getLoggerFromOptions(options, 'SYSTEM', validatedRunId, 'job_tracking');
    logger.warn(`[DUPLICATE_PREVENTION] Already attempted to create job record ${jobRecordKey} at ${attemptInfo.timestamp} from ${attemptInfo.source}`);
    return { 
      skipped: true, 
      reason: 'duplicate_job_creation_attempt',
      originalSource: attemptInfo.source,
      success: true // Indicate creation was likely successful in previous attempt
    };
  }
  
  // Mark that we're attempting to create this record
  creationAttempts.set(jobRecordKey, {
    timestamp: new Date().toISOString(),
    source: options.source || 'job_tracking'
  });
  
  // Clean up old entries after TTL to prevent memory leak
  setTimeout(() => {
    creationAttempts.delete(jobRecordKey);
  }, CREATION_ATTEMPT_TTL_MS);
  
  const logger = getLoggerFromOptions(options, 'SYSTEM', validatedRunId, 'job_tracking');
  const source = options.source || 'job_tracking';
  
  // STANDALONE CHECK: Don't create records in standalone mode
  if (options.isStandalone === true) {
    logger.info(`[RunRecordAdapterSimple] Skipping job record creation for standalone run: ${validatedRunId}`);
    return { skipped: true, reason: 'standalone_run', success: true };
  }
  
  try {
    // Get the base run ID (remove any client suffix)
    const baseRunId = runIdSystem.getBaseRunId(validatedRunId);
    
    logger.debug(`[RunRecordAdapterSimple] Checking for existing job tracking record with ID: ${baseRunId}`);
    
    // CRITICAL: Check if job record already exists first
    // This prevents duplicate job tracking records
    const masterBase = airtableClient.getMasterBase();
    
    // ROOT CAUSE FIX: Use field name constants
    const existingRecords = await masterBase(MASTER_TABLES.JOB_TRACKING).select({
      filterByFormula: `{${JOB_TRACKING_FIELDS.RUN_ID}} = '${baseRunId}'`,
      maxRecords: 1
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      logger.info(`[RunRecordAdapterSimple] Job tracking record already exists for ${baseRunId}, using existing record`);
      return {
        ...existingRecords[0],
        success: true,
        created: false,
        existed: true
      };
    }
    
    logger.debug(`[RunRecordAdapterSimple] No existing job record found, creating new with ID: ${baseRunId}`);
    
    // Direct call to the simple service - only creates if doesn't exist
    const newRecord = await airtableService.createJobTrackingRecord(baseRunId, stream);
    
    // CRITICAL FIX: Validate successful creation
    if (!newRecord || !newRecord.id) {
      logger.error(`[RunRecordAdapterSimple] Failed to create job tracking record for ${baseRunId}`);
      return {
        success: false,
        reason: 'creation_failed',
        runId: baseRunId
      };
    }
    
    logger.info(`[RunRecordAdapterSimple] Successfully created job tracking record: ${baseRunId}`);
    return {
      ...newRecord,
      success: true,
      created: true,
      existed: false
    };
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error creating job record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    // Return error information instead of throwing
    return {
      success: false,
      error: error.message,
      runId: validatedRunId,
      reason: 'exception'
    };
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
  
  // ROOT CAUSE FIX: Validate params is an object
  if (!params || typeof params !== 'object') {
    const errMsg = `Invalid params: ${JSON.stringify(params)}`;
    logger.error(`[RunRecordAdapterSimple] ${errMsg}`);
    throw new Error(errMsg);
  }
  
  const { runId, success = true, notes = '', options = {} } = params;
  
  // ROOT CAUSE FIX: Validate runId
  const validatedRunId = RunIdValidator.validateAndNormalize(runId, 'completeJobRecord');
  
  if (!validatedRunId) {
    const errorMsg = `Invalid runId parameter: ${JSON.stringify(runId)}`;
    const sysLogger = createSafeLogger('SYSTEM', runId, 'job_tracking');
    sysLogger.error(`[RunRecordAdapterSimple] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  const logger = getLoggerFromOptions(options, 'SYSTEM', validatedRunId, 'job_tracking');
  const source = options.source || 'job_tracking';
  
  // STANDALONE CHECK: Don't update records in standalone mode
  if (options.isStandalone === true) {
    logger.info(`[RunRecordAdapterSimple] Skipping job record completion for standalone run: ${validatedRunId}`);
    return { skipped: true, reason: 'standalone_run' };
  }
  
  try {
    // Get the base run ID (remove any client suffix)
    const baseRunId = runIdSystem.getBaseRunId(validatedRunId);
    
    logger.debug(`[RunRecordAdapterSimple] Checking for job record before completing: ${baseRunId}`);
    
    // CRITICAL: Check if job record exists first
    const masterBase = airtableClient.getMasterBase();
    const existingRecords = await masterBase(MASTER_TABLES.JOB_TRACKING).select({
      filterByFormula: `{Run ID} = '${baseRunId}'`,
      maxRecords: 1
    }).firstPage();
    
    if (!existingRecords || existingRecords.length === 0) {
      const errorMsg = `[RunRecordAdapterSimple] CRITICAL: Cannot complete non-existent job record for ${baseRunId}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    logger.debug(`[RunRecordAdapterSimple] Found job record, completing with ID: ${baseRunId}`);
    
    // Direct call to the simple service - only updates if exists
    return await airtableService.completeJobRun(baseRunId, success, notes);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error completing job record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Calculate and update aggregate metrics for a job based on its client runs
 * @param {Object} params - Parameters for job aggregation
 * @param {string} params.runId - Run ID for the job 
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} - The updated record with aggregated metrics
 */
async function updateJobAggregates(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: updateJobAggregates(runId)
    const runId = arguments[0];
    
    // Convert to new format
    return updateJobAggregates({ runId });
  }
  
  // ROOT CAUSE FIX: Validate params is an object
  if (!params || typeof params !== 'object') {
    const errMsg = `Invalid params: ${JSON.stringify(params)}`;
    logger.error(`[RunRecordAdapterSimple] ${errMsg}`);
    throw new Error(errMsg);
  }
  
  const { runId, options = {} } = params;
  
  // ROOT CAUSE FIX: Validate runId
  const validatedRunId = RunIdValidator.validateAndNormalize(runId, 'updateJobAggregates');
  
  if (!validatedRunId) {
    const errorMsg = `Invalid runId parameter: ${JSON.stringify(runId)}`;
    const sysLogger = createSafeLogger('SYSTEM', runId, 'job_tracking');
    sysLogger.error(`[RunRecordAdapterSimple] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  const logger = getLoggerFromOptions(options, 'SYSTEM', validatedRunId, 'job_tracking');
  
  try {
    // Clean/standardize the run ID (strip any client suffix)
  const baseRunId = runIdSystem.getBaseRunId(runId);
    
    logger.debug(`[RunRecordAdapterSimple] Updating aggregate metrics for job: ${baseRunId}`);
    
    // Direct call to the simple service
    return await airtableService.updateAggregateMetrics(baseRunId);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error updating job aggregates: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
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
  const logger = getLoggerFromOptions(options, clientId || 'SYSTEM', runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`[RunRecordAdapterSimple] Updating client metrics for ${runId} and client ${clientId}`);
  
  try {
    // Clean/standardize the run ID (strip any client suffix)
  const baseRunId = runIdSystem.getBaseRunId(runId);
    
    // Add client suffix for client-specific run ID
  const standardRunId = runIdSystem.createClientRunId(baseRunId, clientId);
    
    // DO NOT include End Time or Status in regular metric updates
    // These should only be set when the client processing is complete
    const filteredMetrics = { ...metrics };
    delete filteredMetrics['End Time'];
    delete filteredMetrics['Status'];
    
    // Merge metrics with necessary fields for update
    // Note: 'Metrics Updated' field removed - not present in Airtable schema
    const updates = {
      ...filteredMetrics
    };
    
    // Add note about update source
    const metricsUpdateNote = `Metrics updated at ${new Date().toISOString()} from ${source}`;
    if (updates['System Notes']) {
      updates['System Notes'] += `. ${metricsUpdateNote}`;
    } else {
      updates['System Notes'] = metricsUpdateNote;
    }
    
    // Use airtableServiceSimple to update the record
    return await airtableService.updateClientRun(standardRunId, clientId, updates);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Failed to update metrics: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Complete all processing for a client (after lead scoring, post harvesting, and post scoring)
 * @param {Object} params - Parameters for completing client processing
 * @param {string} params.runId - Run ID
 * @param {string} params.clientId - Client ID
 * @param {Object} params.finalMetrics - Final metrics from all processes
 * @param {Object} [params.options] - Options including logger
 * @returns {Promise<Object>} - The updated record
 */
async function completeClientProcessing(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: completeClientProcessing(runId, clientId, finalMetrics, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const finalMetrics = arguments[2];
    const options = arguments[3] || {};
    
    // Convert to new format
    return completeClientProcessing({ runId, clientId, finalMetrics, options });
  }
  
  const { runId, clientId, finalMetrics = {}, options = {} } = params;
  const logger = getLoggerFromOptions(options, clientId || 'SYSTEM', runId, 'run_record');
  
  logger.debug(`[RunRecordAdapterSimple] Completing all processing for client ${clientId}`);
  
  try {
    // FIXED: Validate runId and clientId parameters
    if (!runId) {
      logger.error(`[STRICT ENFORCEMENT] Missing runId parameter - cannot complete client processing`);
      throw new Error(`Missing required runId parameter for completing client processing`);
    }
    
    if (typeof runId === 'object') {
      logger.error(`[STRICT ENFORCEMENT] Object passed as runId: ${JSON.stringify(runId)}`);
      // Try to extract a usable runId
      if (runId.runId) runId = runId.runId;
      else if (runId.id) runId = runId.id;
      else {
        logger.error(`[STRICT ENFORCEMENT] Cannot extract valid runId from object`);
        throw new Error(`Invalid runId object: ${JSON.stringify(runId)}`);
      }
    }
    
    if (!clientId) {
      logger.error(`[STRICT ENFORCEMENT] Missing clientId parameter - cannot complete client processing`);
      throw new Error(`Missing required clientId parameter for completing client processing`);
    }
    
    // Get the base run ID and create a client-specific ID
    const baseRunId = runIdSystem.getBaseRunId(runId);
    const standardRunId = runIdSystem.createClientRunId(baseRunId, clientId);
    
    // First, check if all required processes have completed based on client's service level
    try {
      // Get the current record to check what processes have completed
      const masterBase = airtableClient.getMasterBase();
      const records = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).select({
        filterByFormula: `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${standardRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientId}')`,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        logger.error(`No run record found for ${standardRunId}, ${clientId} - cannot complete`);
        throw new Error(`Cannot complete non-existent run record for ${clientId} (${standardRunId})`);
      }
      
      const currentRecord = records[0].fields;
      
      // Check if the required processes have completed - use actual Airtable field names
      // and check for null values as well as undefined
      const hasLeadScoring = currentRecord['Profiles Successfully Scored'] !== undefined && 
                             currentRecord['Profiles Successfully Scored'] !== null;
      const hasPostHarvesting = currentRecord['Total Posts Harvested'] !== undefined && 
                               currentRecord['Total Posts Harvested'] !== null;
      const hasPostScoring = currentRecord['Posts Successfully Scored'] !== undefined && 
                            currentRecord['Posts Successfully Scored'] !== null;
      
      // Get client service level to determine what processes should run
      const clientInfo = await require('../services/clientService').getClientById(clientId);
      const serviceLevel = clientInfo?.fields?.['Service Level'] || 1;
      
      // Determine if all expected processes are complete
      let allProcessesComplete = hasLeadScoring; // Lead scoring is always required
      
      if (serviceLevel >= 2) {
        // Service level 2+ should have post harvesting and post scoring
        allProcessesComplete = allProcessesComplete && hasPostHarvesting;
        
        // Only check post scoring if posts were harvested
        if (hasPostHarvesting && currentRecord[CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED] > 0) {
          allProcessesComplete = allProcessesComplete && hasPostScoring;
        }
      }
      
      if (!allProcessesComplete) {
        logger.info(`Not all processes complete for ${clientId}. Lead: ${hasLeadScoring}, Harvest: ${hasPostHarvesting}, PostScore: ${hasPostScoring}, Service Level: ${serviceLevel}`);
        logger.info(`Skipping End Time/Status update until all processes complete.`);
        
        // Only update metrics, not End Time or Status
        const filteredUpdates = { ...finalMetrics };
        delete filteredUpdates['End Time'];
        delete filteredUpdates['Status'];
        
        // Add detailed note about which specific processes are pending
        const processStatus = [];
        if (!hasLeadScoring) processStatus.push('Lead Scoring pending');
        if (serviceLevel >= 2 && !hasPostHarvesting) processStatus.push('Post Harvesting pending');
        if (serviceLevel >= 2 && hasPostHarvesting && currentRecord['Total Posts Harvested'] > 0 && !hasPostScoring) {
          processStatus.push('Post Scoring pending');
        }
        
        const statusNote = processStatus.length > 0 ? 
                        `Waiting for: ${processStatus.join(', ')}` : 
                        `Waiting for processes to complete`;
                        
        if (filteredUpdates['System Notes']) {
          filteredUpdates['System Notes'] += `. ${statusNote}`;
        } else {
          filteredUpdates['System Notes'] = statusNote;
        }
        
        // Update with filtered updates
        return await airtableService.updateClientRun(standardRunId, clientId, filteredUpdates);
      }
    } catch (checkError) {
      logger.warn(`Error checking process completion: ${checkError.message}. Proceeding with completion.`);
      await logCriticalError(checkError, { context: 'Process completion check failed (continuing)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
      // Continue with completion as normal in case of error checking processes
    }
    
    // All processes are complete or check failed - proceed with completion
    // Determine final status based on metrics
    let status = CLIENT_RUN_STATUS_VALUES.COMPLETED;
    const hasErrors = finalMetrics.errors && finalMetrics.errors > 0;
    const noLeadsProcessed = (!finalMetrics['Profiles Examined for Scoring'] || finalMetrics['Profiles Examined for Scoring'] === 0) &&
                             (!finalMetrics['Posts Examined for Scoring'] || finalMetrics['Posts Examined for Scoring'] === 0);
    
    if (noLeadsProcessed) {
      status = CLIENT_RUN_STATUS_VALUES.NO_LEADS;
    } else if (finalMetrics.failed) {
      status = CLIENT_RUN_STATUS_VALUES.FAILED;
    } else if (hasErrors) {
      // If there are errors but process completed, still mark as Completed
      // but note the errors in System Notes
      status = CLIENT_RUN_STATUS_VALUES.COMPLETED;
    }
    
    const updates = {
      ...finalMetrics,
      [CLIENT_RUN_FIELDS.END_TIME]: new Date().toISOString(),
      [CLIENT_RUN_FIELDS.STATUS]: status
      // Note: 'Metrics Updated' field removed - not present in Airtable schema
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
    
    // Use airtableServiceSimple to update the record
    return await airtableService.updateClientRun(standardRunId, clientId, updates);
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Failed to complete client processing: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Check if a run record exists (useful before attempting to update/complete)
 * This function is designed to be very robust and handle variations in run ID format
 * @param {Object} params - Parameters for checking existence
 * @param {string} params.runId - Run ID to check
 * @param {string} params.clientId - Client ID
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<boolean>} - Whether the record exists
 */
async function checkRunRecordExists(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: checkRunRecordExists(runId, clientId, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const options = arguments[2] || {};
    
    // Convert to new format
    return checkRunRecordExists({ runId, clientId, options });
  }
  
  // ROOT CAUSE FIX: Validate params is an object
  if (!params || typeof params !== 'object') {
    const errMsg = `Invalid params: ${JSON.stringify(params)}`;
    logger.error(`[RunRecordAdapterSimple] ${errMsg}`);
    return false; // Fail safe - return false on validation errors
  }
  
  const { runId, clientId: providedClientId, options: optionsParam = {} } = params;
  
  // Create logger FIRST before any usage
  const safeRunId = runId ? String(runId) : 'UNKNOWN';
  const logger = optionsParam.logger || createSafeLogger(providedClientId || 'SYSTEM', safeRunId, 'run_record');
  const source = optionsParam.source || 'unknown';
  
  // ROOT CAUSE FIX: Validate runId
  if (!runId) {
    const errorMsg = `Missing runId parameter in checkRunRecordExists`;
    logger.error(`[RunRecordAdapterSimple] ${errorMsg}`);
    return false; // Fail safe - return false on missing runId
  }
  
  logger.debug(`[RunRecordAdapterSimple] Checking if run record exists: ${safeRunId}, client: ${providedClientId || 'any'}`);
  
  try {
    // Extract client ID from run ID if not provided
    let clientIdToUse = providedClientId;
    
    if (!clientIdToUse) {
      // Try to extract from run ID if it has a client suffix
  const extractedClientId = runIdSystem.getClientId(runId);
      if (extractedClientId) {
        clientIdToUse = extractedClientId;
        logger.debug(`[RunRecordAdapterSimple] Extracted clientId=${clientIdToUse} from runId`);
      }
    }
    
    if (!clientIdToUse) {
      logger.error(`[RunRecordAdapterSimple] Cannot check if record exists without clientId`);
      return false;
    }
    
    // CIRCULAR DEPENDENCY FIX: Remove redundant import - already imported at top level
    // The airtableClient is already imported at the module level
    
    // Try with the exact run ID first using MASTER base - not the client's specific base
    try {
      // ARCHITECTURE FIX: Use Master Clients Base instead of client-specific base
      // The "Client Run Results" table exists in the Master Clients Base, not in client bases
      const masterBase = airtableService.initialize(); // Get the Master base
      
      // Query the master table - MUST search by BOTH Run ID AND Client ID
      logger.debug(`[RunRecordAdapterSimple] Checking for run ID: ${runId}, client: ${clientIdToUse} in master base`);
      
      const records = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).select({
        filterByFormula: `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${runId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientIdToUse}')`,
        maxRecords: 1
      }).firstPage();
      
      if (records && records.length > 0) {
        logger.debug(`[RunRecordAdapterSimple] Found record with exact ID match`);
        return true;
      }
    } catch (exactMatchError) {
      logger.debug(`[RunRecordAdapterSimple] Exact match search failed: ${exactMatchError.message}`);
      await logCriticalError(exactMatchError, { context: 'Exact run ID match search failed (trying standard match)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    }
    
    // Clean/standardize the run ID (strip any client suffix)
  const baseRunId = runIdSystem.getBaseRunId(runId);
    
    // Try with standardized ID format
    try {
  const standardRunId = runIdSystem.createClientRunId(baseRunId, clientIdToUse);
      
      // Skip if it's the same as what we just tried
      if (standardRunId !== runId) {
        // ARCHITECTURE FIX: Use Master Clients Base instead of client-specific base
        // The "Client Run Results" table exists in the Master Clients Base, not in client bases
        const masterBase = airtableService.initialize(); // Get the Master base
        
        const records = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).select({
          filterByFormula: `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${standardRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientIdToUse}')`,
          maxRecords: 1
        }).firstPage();
        
        if (records && records.length > 0) {
          logger.debug(`[RunRecordAdapterSimple] Found record with standardized ID match: ${standardRunId}`);
          return true;
        }
      }
    } catch (standardMatchError) {
      logger.debug(`[RunRecordAdapterSimple] Standard match search failed: ${standardMatchError.message}`);
      await logCriticalError(standardMatchError, { context: 'Standard run ID match search failed (trying date part)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    }
    
    // Finally, try with just the date part of the run ID to find similar records
    try {
      // Extract date part (first segment before dash)
      const parts = baseRunId.split('-');
      if (parts.length > 0) {
        const datePart = parts[0];
        if (datePart && datePart.length === 6) { // YYMMDD format
          // ARCHITECTURE FIX: Use Master Clients Base instead of client-specific base
          // The "Client Run Results" table exists in the Master Clients Base, not in client bases
          const masterBase = airtableService.initialize(); // Get the Master base
          const records = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).select({
            filterByFormula: `AND(FIND('${datePart}', {${CLIENT_RUN_FIELDS.RUN_ID}}) > 0, {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientIdToUse}')`,
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
      await logCriticalError(datePartMatchError, { context: 'Date part match search failed (no record found)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    }
    
    logger.debug(`[RunRecordAdapterSimple] No matching records found for runId=${runId}, clientId=${clientIdToUse}`);
    return false;
  } catch (error) {
    logger.error(`[RunRecordAdapterSimple] Error checking if run record exists: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (swallowed)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    return false; // Fail safe - return false on any error
  }
}

/**
 * Safe method to update metrics for a client run record
 * - Creates the record if it doesn't exist (if createIfMissing=true)
 * - Updates existing record if it exists
 * - Uses standardized run ID format
 * - Handles standalone mode
 * - Validates all inputs thoroughly
 * 
 * This is the preferred method to use for updating metrics to avoid
 * errors when records don't exist.
 * 
 * @param {Object} params - Parameters object
 * @param {string} params.runId - The job run ID
 * @param {string} params.clientId - The client ID
 * @param {string} [params.processType] - Type of process (lead_scoring, post_harvesting, post_scoring)
 * @param {Object} params.metrics - Metrics to update
 * @param {boolean} [params.createIfMissing=false] - Create record if missing
 * @param {Object} [params.options] - Options object
 * @param {boolean} [params.options.isStandalone] - Whether this is a standalone run
 * @param {Object} [params.options.logger] - Logger instance
 * @param {string} [params.options.source] - Source of the operation
 * @returns {Promise<Object>} Result object with success status and details
 * 
 * @see {docs/METRICS-UPDATE-SYSTEM.md} For detailed documentation on this metrics system
 */
async function safeUpdateMetrics(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: safeUpdateMetrics(runId, clientId, processType, metrics, createIfMissing, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const processType = arguments[2];
    const metrics = arguments[3] || {};
    const createIfMissing = arguments[4] !== undefined ? arguments[4] : false;
    const options = arguments[5] || {};
    
    // Convert to new format
    return safeUpdateMetrics({
      runId,
      clientId,
      processType,
      metrics,
      createIfMissing,
      options
    });
  }
  
  // ROOT CAUSE FIX: Validate params is an object
  if (!params || typeof params !== 'object') {
    const errMsg = `Invalid params: ${JSON.stringify(params)}`;
    logger.error(`[RunRecordAdapterSimple] ${errMsg}`);
    throw new Error(errMsg);
  }
  
  const {
    runId,
    clientId,
    processType,
    metrics = {},
    createIfMissing = false,
    options = {}
  } = params;
  
  // ROOT CAUSE FIX: Validate critical parameters
  const validatedRunId = RunIdValidator.validateAndNormalize(runId, 'safeUpdateMetrics');
  const validatedClientId = RunIdValidator.validateClientId(clientId, 'safeUpdateMetrics');
  
  if (!validatedRunId || !validatedClientId) {
    const errorMsg = `Invalid parameters: runId=${JSON.stringify(runId)}, clientId=${JSON.stringify(clientId)}`;
    const sysLogger = createSafeLogger('SYSTEM', runId, 'metrics');
    sysLogger.error(`[RunRecordAdapterSimple] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  // ROOT CAUSE FIX: Validate metrics is an object
  if (metrics && typeof metrics !== 'object') {
    const errorMsg = `Invalid metrics parameter: ${JSON.stringify(metrics)}`;
    const sysLogger = createSafeLogger(validatedClientId, validatedRunId, processType || 'metrics');
    sysLogger.error(`[RunRecordAdapterSimple] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  const { isStandalone = false } = options;
  const logger = getLoggerFromOptions(options, validatedClientId, validatedRunId, processType || 'metrics');
  const source = options.source || processType || 'metrics';
  
  // CRITICAL CHECK: Early exit for standalone runs
  // No records should be created or updated in standalone mode
  if (isStandalone === true) {
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
    
    // CRITICAL: First check if the run record exists using our robust function
    // This prevents any attempt to create records during an update operation
    const recordExists = await checkRunRecordExists({ 
      runId, 
      clientId,
      options: { 
        source: `${source}_metrics`, 
        logger 
      }
    });
    
    if (!recordExists) {
      // Record doesn't exist - log error and do NOT attempt to create it
      // This is critical to prevent duplicate records
      logger.error(`[${processType}] CRITICAL: Run record not found for ${runId} (${clientId}). Metrics update SKIPPED. Check that record creation happened at workflow start.`);
      return {
        success: false,
        skipped: true,
        reason: 'record_not_found',
        message: `Run record not found for ${runId} (${clientId}). Metrics update skipped.`
      };
    }
    
    // Record exists, proceed with update
    logger.debug(`[${processType}] Updating metrics for run ${runId} (${clientId})`);
    
    // DEBUG: Log metrics object to diagnose undefined key issue
    logger.debug(`[${processType}] Metrics object keys: ${Object.keys(metrics).map(k => k === undefined ? 'UNDEFINED_KEY' : `"${k}"`).join(', ')}`);
    logger.debug(`[${processType}] Metrics object: ${JSON.stringify(metrics, null, 2)}`);
    
    // Validate and correct field names before sending to Airtable
    const validatedMetrics = createValidatedObject(metrics);
    
    // Check if any field names were invalid
    const validationResult = validateFieldNames(metrics, true);
    if (!validationResult.success) {
      logger.warn(`[${processType}] Field name validation warnings: ${validationResult.errors.join(', ')}`);
    }
    
    // Use the standard updateRunRecord function to apply the updates
    const updateResult = await updateRunRecord({
      runId,
      clientId,
      updates: validatedMetrics,
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
    await logCriticalError(error, { context: 'Metrics update failed (swallowed)', service: 'runRecordAdapterSimple.js' }).catch(() => {});
    
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
  completeClientProcessing,
  checkRunRecordExists,
  safeUpdateMetrics,
  getLoggerFromOptions,
  
  // For backward compatibility, alias createRunRecord to createClientRunRecord
  // This makes the transition seamless for existing code
  createClientRunRecord: createRunRecord
};