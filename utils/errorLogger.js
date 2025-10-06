// utils/errorLogger.js
/**
 * Production error logging service
 * Logs critical errors to Airtable for debugging without needing Render logs
 */

const { isCriticalError, classifySeverity, classifyErrorType, extractLocationFromStack, shouldSkipError } = require('./errorClassifier');
const { ERROR_LOG_FIELDS, MASTER_TABLES, ERROR_STATUS_VALUES } = require('../constants/airtableUnifiedConstants');

let masterClientsBase = null;
let errorLogCache = new Map(); // For deduplication

// Rate limiting
const MAX_ERRORS_PER_HOUR = 100;
let errorCount = 0;
let lastHourReset = Date.now();

/**
 * Initialize error logger with Master Clients base connection
 */
function initialize() {
  try {
    const { getMasterClientsBase } = require('../config/airtableClient');
    masterClientsBase = getMasterClientsBase();
    console.log('[ErrorLogger] Initialized successfully');
  } catch (err) {
    console.error('[ErrorLogger] Failed to initialize:', err.message);
    // Don't throw - error logging should never crash the app
  }
}

/**
 * Log a critical error to Airtable
 * @param {Error} error - The error object
 * @param {Object} context - Additional context about the error
 * @returns {Promise<Object|null>} - The created Airtable record or null if skipped
 */
async function logCriticalError(error, context = {}) {
  try {
    // Skip if error logging is disabled in env
    if (process.env.DISABLE_ERROR_LOGGING === 'true') {
      console.log('[ErrorLogger] Error logging disabled, skipping');
      return null;
    }

    // Skip expected business logic errors
    if (shouldSkipError(error, context)) {
      console.log('[ErrorLogger] Skipping expected error:', error.message);
      return null;
    }

    // Check if error is critical enough to log
    if (!isCriticalError(error, context)) {
      console.log('[ErrorLogger] Error not critical, skipping Airtable log:', error.message);
      return null;
    }

    // Rate limiting
    const now = Date.now();
    if (now - lastHourReset > 3600000) {
      // Reset counter every hour
      errorCount = 0;
      lastHourReset = now;
    }

    if (errorCount >= MAX_ERRORS_PER_HOUR) {
      console.error('[ErrorLogger] Rate limit exceeded, skipping error log');
      return null;
    }

    // Deduplication - check if same error logged in last 5 minutes
    const errorKey = `${error.message}:${context.operation || 'unknown'}`;
    const lastLogged = errorLogCache.get(errorKey);
    if (lastLogged && (now - lastLogged) < 300000) {
      console.log('[ErrorLogger] Duplicate error within 5 minutes, skipping');
      return null;
    }

    // Initialize if not already done
    if (!masterClientsBase) {
      initialize();
    }

    if (!masterClientsBase) {
      console.error('[ErrorLogger] Master base not initialized, cannot log error');
      return null;
    }

    // Extract error details
    const severity = classifySeverity(error, context);
    const errorType = classifyErrorType(error, context);
    const location = extractLocationFromStack(error);

    // Build context JSON
    const contextData = {
      runId: context.runId || null,
      clientId: context.clientId || null,
      clientName: context.clientName || null,
      operation: context.operation || 'Unknown',
      endpoint: context.endpoint || null,
      method: context.method || null,
      inputData: context.inputData ? sanitizeInputData(context.inputData) : null,
      systemState: captureSystemState(),
      requestHeaders: context.requestHeaders ? sanitizeHeaders(context.requestHeaders) : null,
      additionalContext: context.additionalContext || null
    };

    // Create Airtable record using constants
    const record = {
      [ERROR_LOG_FIELDS.SEVERITY]: severity,
      [ERROR_LOG_FIELDS.ERROR_TYPE]: errorType,
      [ERROR_LOG_FIELDS.ERROR_MESSAGE]: truncate(error.message || error.toString(), 10000),
      [ERROR_LOG_FIELDS.STACK_TRACE]: truncate(error.stack || 'No stack trace available', 100000),
      [ERROR_LOG_FIELDS.FILE_PATH]: location.filePath || 'Unknown',
      [ERROR_LOG_FIELDS.FUNCTION_NAME]: location.functionName || 'Unknown',
      [ERROR_LOG_FIELDS.LINE_NUMBER]: location.lineNumber || 0,
      [ERROR_LOG_FIELDS.CONTEXT_JSON]: JSON.stringify(contextData, null, 2),
      [ERROR_LOG_FIELDS.STATUS]: ERROR_STATUS_VALUES.NEW
    };

    // Add client link if available
    if (context.clientId) {
      record[ERROR_LOG_FIELDS.CLIENT_ID] = [context.clientId];
    }

    // Add run ID if available
    if (context.runId) {
      record[ERROR_LOG_FIELDS.RUN_ID] = context.runId;
    }

    console.log('[ErrorLogger] Logging error to Airtable:', {
      severity,
      errorType,
      message: error.message,
      operation: context.operation
    });

    const createdRecord = await masterClientsBase(MASTER_TABLES.ERROR_LOG).create(record);

    // Update cache and counter
    errorLogCache.set(errorKey, now);
    errorCount++;

    console.log('[ErrorLogger] Error logged successfully:', createdRecord.id);
    return createdRecord;

  } catch (logError) {
    // NEVER let error logging crash the app
    console.error('[ErrorLogger] Failed to log error to Airtable:', logError.message);
    console.error('[ErrorLogger] Original error was:', error.message);
    return null;
  }
}

/**
 * Capture current system state
 * @returns {Object} - System state information
 */
function captureSystemState() {
  try {
    const memUsage = process.memoryUsage();
    return {
      memoryUsage: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024)
      },
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      env: process.env.NODE_ENV || 'unknown'
    };
  } catch (err) {
    return { error: 'Failed to capture system state' };
  }
}

/**
 * Sanitize input data to remove sensitive information
 * @param {*} data - Input data to sanitize
 * @returns {Object} - Sanitized data
 */
function sanitizeInputData(data) {
  try {
    // Convert to JSON string and back to create a copy
    let sanitized = JSON.parse(JSON.stringify(data));

    // Remove sensitive fields
    const sensitiveFields = [
      'password', 'token', 'apiKey', 'secret', 'creditCard',
      'ssn', 'Authorization', 'cookie', 'session'
    ];

    function redactSensitive(obj) {
      if (typeof obj !== 'object' || obj === null) return obj;

      for (const key in obj) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          redactSensitive(obj[key]);
        }
      }
      return obj;
    }

    return redactSensitive(sanitized);
  } catch (err) {
    return { error: 'Failed to sanitize input data', raw: String(data).substring(0, 100) };
  }
}

/**
 * Sanitize request headers to remove sensitive information
 * @param {Object} headers - Request headers
 * @returns {Object} - Sanitized headers
 */
function sanitizeHeaders(headers) {
  try {
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }

    return sanitized;
  } catch (err) {
    return { error: 'Failed to sanitize headers' };
  }
}

/**
 * Truncate string to max length
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated string
 */
function truncate(str, maxLength) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '... [truncated]';
}

/**
 * Clear error cache (for testing)
 */
function clearCache() {
  errorLogCache.clear();
  errorCount = 0;
  console.log('[ErrorLogger] Cache cleared');
}

/**
 * Log error and also console log it
 * Convenience function for common use case
 * @param {Error} error - The error object
 * @param {Object} context - Additional context
 */
async function logAndConsole(error, context = {}) {
  // Always log to console first
  console.error('[ERROR]', error.message);
  if (error.stack) {
    console.error(error.stack);
  }

  // Then try to log to Airtable if critical
  return await logCriticalError(error, context);
}

module.exports = {
  logCriticalError,
  logAndConsole,
  initialize,
  clearCache,
  captureSystemState,
  sanitizeInputData
};
