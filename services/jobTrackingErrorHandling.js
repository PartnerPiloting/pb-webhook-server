/**
 * services/jobTrackingErrorHandling.js
 * 
 * Standardized error handling and recovery strategies for job tracking records.
 * This module provides consistent approaches for handling common error scenarios
 * in the job tracking system.
 */

const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
const runIdSystem = require('./runIdSystem');

// Default logger - using safe creation
const logger = createSafeLogger('SYSTEM', null, 'job_tracking_errors');

/**
 * Error types that can occur in job tracking
 */
const ERROR_TYPES = {
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
  INVALID_RUN_ID: 'INVALID_RUN_ID',
  AIRTABLE_ERROR: 'AIRTABLE_ERROR',
  INCONSISTENT_DATA: 'INCONSISTENT_DATA',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Recovery strategies for different error scenarios
 */
const RECOVERY_STRATEGIES = {
  CREATE_NEW: 'CREATE_NEW',
  RETRY: 'RETRY',
  ABORT: 'ABORT',
  LOG_AND_CONTINUE: 'LOG_AND_CONTINUE'
};

/**
 * Configuration for how to handle different error types
 */
const ERROR_HANDLING_CONFIG = {
  [ERROR_TYPES.RECORD_NOT_FOUND]: {
    job: RECOVERY_STRATEGIES.CREATE_NEW,
    client: RECOVERY_STRATEGIES.CREATE_NEW,
    severity: 'WARN'
  },
  [ERROR_TYPES.INVALID_RUN_ID]: {
    job: RECOVERY_STRATEGIES.ABORT,
    client: RECOVERY_STRATEGIES.ABORT,
    severity: 'ERROR'
  },
  [ERROR_TYPES.AIRTABLE_ERROR]: {
    job: RECOVERY_STRATEGIES.RETRY,
    client: RECOVERY_STRATEGIES.RETRY,
    severity: 'ERROR'
  },
  [ERROR_TYPES.INCONSISTENT_DATA]: {
    job: RECOVERY_STRATEGIES.LOG_AND_CONTINUE,
    client: RECOVERY_STRATEGIES.LOG_AND_CONTINUE,
    severity: 'WARN'
  },
  [ERROR_TYPES.UNKNOWN]: {
    job: RECOVERY_STRATEGIES.ABORT,
    client: RECOVERY_STRATEGIES.ABORT,
    severity: 'ERROR'
  }
};

/**
 * Create a standardized error object for job tracking errors
 * @param {string} type - Error type from ERROR_TYPES
 * @param {string} message - Descriptive error message
 * @param {Object} context - Additional context about the error
 * @returns {Object} Standardized error object
 */
function createErrorObject(type, message, context) {
  const errorType = ERROR_TYPES[type] || ERROR_TYPES.UNKNOWN;
  const config = ERROR_HANDLING_CONFIG[errorType];
  
  return {
    type: errorType,
    message,
    context,
    timestamp: new Date().toISOString(),
    jobRecoveryStrategy: config.job,
    clientRecoveryStrategy: config.client,
    severity: config.severity
  };
}

/**
 * Handle record not found errors with consistent recovery
 * @param {string} runId - The run ID that wasn't found
 * @param {string} [clientId] - Optional client ID if this was a client record
 * @param {Object} [options] - Additional options
 * @returns {Object} Error handling result with recovery strategy
 */
function handleRecordNotFound(runId, clientId = null, options = {}) {
  const log = options.logger || logger;
  const recordType = clientId ? 'Client run' : 'Job tracking';
  
  // Standardize the runId for consistent logging
  const standardizedRunId = runIdSystem.validateAndStandardizeRunId(runId) || runId;
  
  // Create error object
  const error = createErrorObject(
    ERROR_TYPES.RECORD_NOT_FOUND,
    `${recordType} record not found for run ID: ${standardizedRunId}${clientId ? ` and client: ${clientId}` : ''}`,
    { runId, standardizedRunId, clientId, originalRunId: runId }
  );
  
  // Log based on severity
  if (error.severity === 'ERROR') {
    log.error(error.message);
  } else {
    log.warn(error.message);
  }
  
  // Determine the appropriate recovery strategy
  const recoveryStrategy = clientId 
    ? error.clientRecoveryStrategy 
    : error.jobRecoveryStrategy;
  
  return {
    error,
    recoveryStrategy,
    shouldCreate: recoveryStrategy === RECOVERY_STRATEGIES.CREATE_NEW,
    shouldRetry: recoveryStrategy === RECOVERY_STRATEGIES.RETRY,
    shouldAbort: recoveryStrategy === RECOVERY_STRATEGIES.ABORT,
    shouldContinue: recoveryStrategy === RECOVERY_STRATEGIES.LOG_AND_CONTINUE
  };
}

/**
 * Handle invalid run ID format errors
 * @param {string} runId - The invalid run ID
 * @param {Object} [options] - Additional options
 * @returns {Object} Error handling result with recovery strategy
 */
function handleInvalidRunId(runId, options = {}) {
  const log = options.logger || logger;
  
  // Create error object
  const error = createErrorObject(
    ERROR_TYPES.INVALID_RUN_ID,
    `Invalid run ID format: ${runId}`,
    { runId }
  );
  
  // Log based on severity
  if (error.severity === 'ERROR') {
    log.error(error.message);
  } else {
    log.warn(error.message);
  }
  
  // For invalid run IDs, we typically abort
  return {
    error,
    recoveryStrategy: error.jobRecoveryStrategy,
    shouldCreate: false,
    shouldRetry: false,
    shouldAbort: true,
    shouldContinue: false
  };
}

/**
 * Handle Airtable API errors
 * @param {Error} apiError - The Airtable API error
 * @param {string} runId - The run ID being processed
 * @param {string} [clientId] - Optional client ID if this was a client record
 * @param {Object} [options] - Additional options
 * @returns {Object} Error handling result with recovery strategy
 */
function handleAirtableError(apiError, runId, clientId = null, options = {}) {
  const log = options.logger || logger;
  const recordType = clientId ? 'Client run' : 'Job tracking';
  
  // Standardize the runId for consistent logging
  const standardizedRunId = runIdSystem.validateAndStandardizeRunId(runId) || runId;
  
  // Create error object
  const error = createErrorObject(
    ERROR_TYPES.AIRTABLE_ERROR,
    `Airtable API error for ${recordType} record (${standardizedRunId}): ${apiError.message}`,
    { 
      runId, 
      standardizedRunId,
      clientId, 
      originalRunId: runId,
      apiErrorMessage: apiError.message,
      apiErrorCode: apiError.statusCode || apiError.status,
      apiErrorName: apiError.name
    }
  );
  
  // Log based on severity
  log.error(error.message);
  
  // Determine the appropriate recovery strategy based on specific API errors
  let recoveryStrategy;
  
  // Rate limiting errors should retry
  if (apiError.statusCode === 429 || (apiError.message && apiError.message.includes('rate'))) {
    recoveryStrategy = RECOVERY_STRATEGIES.RETRY;
  } 
  // Record not found errors might need to create a new record
  else if (apiError.statusCode === 404 || apiError.message.includes('not found')) {
    recoveryStrategy = clientId 
      ? ERROR_HANDLING_CONFIG[ERROR_TYPES.RECORD_NOT_FOUND].client
      : ERROR_HANDLING_CONFIG[ERROR_TYPES.RECORD_NOT_FOUND].job;
  }
  // Other errors use the default strategy
  else {
    recoveryStrategy = clientId 
      ? error.clientRecoveryStrategy 
      : error.jobRecoveryStrategy;
  }
  
  return {
    error,
    recoveryStrategy,
    shouldCreate: recoveryStrategy === RECOVERY_STRATEGIES.CREATE_NEW,
    shouldRetry: recoveryStrategy === RECOVERY_STRATEGIES.RETRY,
    shouldAbort: recoveryStrategy === RECOVERY_STRATEGIES.ABORT,
    shouldContinue: recoveryStrategy === RECOVERY_STRATEGIES.LOG_AND_CONTINUE
  };
}

/**
 * Handle inconsistent data errors
 * @param {string} message - Description of the inconsistency
 * @param {string} runId - The run ID with inconsistent data
 * @param {Object} context - Additional context about the inconsistency
 * @param {Object} [options] - Additional options
 * @returns {Object} Error handling result with recovery strategy
 */
function handleInconsistentData(message, runId, context = {}, options = {}) {
  const log = options.logger || logger;
  
  // Standardize the runId for consistent logging
  const standardizedRunId = runIdSystem.validateAndStandardizeRunId(runId) || runId;
  
  // Create error object
  const error = createErrorObject(
    ERROR_TYPES.INCONSISTENT_DATA,
    `Data inconsistency for run ID ${standardizedRunId}: ${message}`,
    { 
      runId, 
      standardizedRunId,
      originalRunId: runId,
      ...context
    }
  );
  
  // Log based on severity
  if (error.severity === 'ERROR') {
    log.error(error.message);
  } else {
    log.warn(error.message);
  }
  
  // For inconsistent data, we typically log and continue
  return {
    error,
    recoveryStrategy: RECOVERY_STRATEGIES.LOG_AND_CONTINUE,
    shouldCreate: false,
    shouldRetry: false,
    shouldAbort: false,
    shouldContinue: true
  };
}

/**
 * Create a recovery record for error tracking
 * @param {Object} error - The error object
 * @param {string} runId - Run ID 
 * @param {string} [clientId] - Optional client ID
 * @param {Object} [baseRecord] - The base record to build recovery data upon
 * @returns {Object} Recovery record data
 */
function createRecoveryRecord(error, runId, clientId = null, baseRecord = {}) {
  const standardizedRunId = runIdSystem.validateAndStandardizeRunId(runId) || runId;
  const timestamp = new Date().toISOString();
  
  const recoveryData = {
    'Run ID': standardizedRunId,
    'Status': 'Recovery',
    'Start Time': timestamp,
    'Error': error.message,
    'System Notes': `Recovery record created at ${timestamp} due to ${error.type} error`,
    'Recovery Source': error.type,
    'Original Run ID': runId
  };
  
  if (clientId) {
    recoveryData['Client ID'] = clientId;
  }
  
  return {
    ...baseRecord,
    ...recoveryData
  };
}

// Export error handling utilities and constants
module.exports = {
  ERROR_TYPES,
  RECOVERY_STRATEGIES,
  createErrorObject,
  handleRecordNotFound,
  handleInvalidRunId,
  handleAirtableError,
  handleInconsistentData,
  createRecoveryRecord
};