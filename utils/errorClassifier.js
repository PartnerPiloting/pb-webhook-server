// utils/errorClassifier.js
/**
 * Error classification utility for determining error severity and type
 * Used to decide which errors should be logged to Airtable vs console only
 */

/**
 * Severity levels for error classification
 */
const ERROR_SEVERITY = {
  CRITICAL: 'CRITICAL',  // System crashes, data loss, service unavailable
  ERROR: 'ERROR',        // Feature broken but system runs
  WARNING: 'WARNING'     // Degraded performance, approaching limits
};

/**
 * Error type categories for classification
 */
const ERROR_TYPES = {
  MODULE_IMPORT: 'Module Import',
  AI_SERVICE: 'AI Service',
  AIRTABLE_API: 'Airtable API',
  DATA_VALIDATION: 'Data Validation',
  AUTHENTICATION: 'Authentication',
  MEMORY_RESOURCES: 'Memory/Resources',
  BUSINESS_LOGIC: 'Business Logic',
  JOB_TRACKING: 'Job Tracking',
  NETWORK: 'Network',
  UNKNOWN: 'Unknown'
};

/**
 * Determine if an error is critical enough to log to Airtable
 * @param {Error} error - The error object
 * @param {Object} context - Additional context about the error
 * @returns {boolean} - True if error should be logged to Airtable
 */
function isCriticalError(error, context = {}) {
  // Always log if explicitly marked as critical
  if (context.forceCritical) {
    return true;
  }

  // Check error message patterns for critical issues
  const errorMessage = error.message || error.toString();
  
  // Module import errors are CRITICAL (breaks functionality)
  if (errorMessage.includes('Cannot find module') || 
      errorMessage.includes('MODULE_NOT_FOUND')) {
    return true;
  }

  // Airtable API errors are CRITICAL (can't read/write data)
  if (errorMessage.includes('AIRTABLE') ||
      errorMessage.includes('INVALID_REQUEST_BODY') ||
      errorMessage.includes('INVALID_VALUE_FOR_COLUMN') ||
      errorMessage.includes('Unknown field name')) {
    return true;
  }

  // AI service complete failures are CRITICAL
  if (errorMessage.includes('All AI providers failed') ||
      errorMessage.includes('Gemini and OpenAI both unavailable')) {
    return true;
  }

  // Memory/resource exhaustion is CRITICAL
  if (errorMessage.includes('out of memory') ||
      errorMessage.includes('heap') ||
      error.code === 'ERR_OUT_OF_MEMORY') {
    return true;
  }

  // Authentication failures are CRITICAL
  if (error.statusCode === 401 || error.statusCode === 403 ||
      errorMessage.includes('Unauthorized') ||
      errorMessage.includes('Authentication failed')) {
    return true;
  }

  // Job tracking failures that prevent job completion
  if (errorMessage.includes('Failed to create job tracking record') ||
      errorMessage.includes('Failed to update job status') ||
      errorMessage.includes('Duplicate run ID')) {
    return true;
  }

  // Uncaught exceptions are ERROR level (should be logged)
  if (error.name === 'TypeError' || 
      error.name === 'ReferenceError' ||
      error.name === 'SyntaxError') {
    return true;
  }

  // Data corruption/integrity issues
  if (errorMessage.includes('data integrity') ||
      errorMessage.includes('validation failed') ||
      errorMessage.includes('required field missing')) {
    return true;
  }

  // Network failures that block processing
  if (error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND') {
    return true;
  }

  // Check context for critical operations
  if (context.operation === 'batch-processing' && context.failed === 'all') {
    return true; // Entire batch failed
  }

  if (context.operation === 'client-run-creation' && !context.recovered) {
    return true; // Failed to create client run record
  }

  // Default: Don't log to Airtable (console log only)
  return false;
}

/**
 * Classify error severity
 * @param {Error} error - The error object
 * @param {Object} context - Additional context
 * @returns {string} - Severity level (CRITICAL, ERROR, WARNING)
 */
function classifySeverity(error, context = {}) {
  const errorMessage = error.message || error.toString();

  // CRITICAL: System failures, data loss, service unavailable
  if (errorMessage.includes('Cannot find module') ||
      errorMessage.includes('out of memory') ||
      errorMessage.includes('FATAL') ||
      errorMessage.includes('data loss') ||
      error.code === 'ERR_OUT_OF_MEMORY' ||
      error.statusCode === 500) {
    return ERROR_SEVERITY.CRITICAL;
  }

  // CRITICAL: Authentication/security failures
  if (error.statusCode === 401 || error.statusCode === 403) {
    return ERROR_SEVERITY.CRITICAL;
  }

  // ERROR: Feature broken but system continues
  if (error.name === 'TypeError' ||
      error.name === 'ReferenceError' ||
      errorMessage.includes('AIRTABLE') ||
      errorMessage.includes('AI provider') ||
      error.statusCode === 404) {
    return ERROR_SEVERITY.ERROR;
  }

  // WARNING: Degraded but functional
  return ERROR_SEVERITY.WARNING;
}

/**
 * Classify error type
 * @param {Error} error - The error object
 * @param {Object} context - Additional context
 * @returns {string} - Error type category
 */
function classifyErrorType(error, context = {}) {
  const errorMessage = error.message || error.toString();

  if (errorMessage.includes('Cannot find module') || error.code === 'MODULE_NOT_FOUND') {
    return ERROR_TYPES.MODULE_IMPORT;
  }

  if (errorMessage.includes('Gemini') || errorMessage.includes('OpenAI') || 
      errorMessage.includes('AI provider') || errorMessage.includes('quota')) {
    return ERROR_TYPES.AI_SERVICE;
  }

  if (errorMessage.includes('AIRTABLE') || errorMessage.includes('INVALID_VALUE_FOR_COLUMN') ||
      errorMessage.includes('Unknown field name') || errorMessage.includes('base')) {
    return ERROR_TYPES.AIRTABLE_API;
  }

  if (errorMessage.includes('validation') || errorMessage.includes('required field') ||
      errorMessage.includes('invalid data') || errorMessage.includes('type mismatch')) {
    return ERROR_TYPES.DATA_VALIDATION;
  }

  if (error.statusCode === 401 || error.statusCode === 403 ||
      errorMessage.includes('Unauthorized') || errorMessage.includes('Authentication')) {
    return ERROR_TYPES.AUTHENTICATION;
  }

  if (errorMessage.includes('memory') || errorMessage.includes('heap') ||
      errorMessage.includes('resource') || error.code === 'ERR_OUT_OF_MEMORY') {
    return ERROR_TYPES.MEMORY_RESOURCES;
  }

  if (errorMessage.includes('run ID') || errorMessage.includes('job tracking') ||
      errorMessage.includes('client run') || context.operation?.includes('job')) {
    return ERROR_TYPES.JOB_TRACKING;
  }

  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND' || errorMessage.includes('network')) {
    return ERROR_TYPES.NETWORK;
  }

  if (error.name === 'TypeError' || error.name === 'ReferenceError' ||
      error.name === 'SyntaxError' || errorMessage.includes('undefined')) {
    return ERROR_TYPES.BUSINESS_LOGIC;
  }

  return ERROR_TYPES.UNKNOWN;
}

/**
 * Extract file path and line number from stack trace
 * @param {Error} error - The error object
 * @returns {Object} - {filePath, lineNumber, functionName}
 */
function extractLocationFromStack(error) {
  if (!error.stack) {
    return { filePath: null, lineNumber: null, functionName: null };
  }

  // Parse first relevant line of stack trace
  const stackLines = error.stack.split('\n');
  
  // Find first line with file path (skip error message line)
  for (let i = 1; i < stackLines.length; i++) {
    const line = stackLines[i];
    
    // Match patterns like "at functionName (/path/to/file.js:123:45)"
    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):\d+\)?/);
    
    if (match) {
      return {
        functionName: match[1] || 'anonymous',
        filePath: match[2],
        lineNumber: parseInt(match[3], 10)
      };
    }
  }

  return { filePath: null, lineNumber: null, functionName: null };
}

/**
 * Check if error should be skipped (expected business logic)
 * @param {Error} error - The error object
 * @param {Object} context - Additional context
 * @returns {boolean} - True if error should be skipped (not logged)
 */
function shouldSkipError(error, context = {}) {
  const errorMessage = error.message || error.toString();

  // Skip validation warnings that were auto-corrected
  if (context.recovered || context.autoFixed) {
    return true;
  }

  // Skip expected business logic (no LinkedIn URL, lead already scored, etc.)
  if (errorMessage.includes('no LinkedIn URL') ||
      errorMessage.includes('already scored') ||
      errorMessage.includes('no leads to process')) {
    return true;
  }

  // Skip handled retries that succeeded
  if (context.retried && context.succeeded) {
    return true;
  }

  // Skip cache misses (normal operation)
  if (errorMessage.includes('cache miss')) {
    return true;
  }

  return false;
}

module.exports = {
  isCriticalError,
  classifySeverity,
  classifyErrorType,
  extractLocationFromStack,
  shouldSkipError,
  ERROR_SEVERITY,
  ERROR_TYPES
};
