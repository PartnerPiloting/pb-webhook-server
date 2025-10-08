// utils/errorLogger.js
/**
 * Production error logging service
 * Logs errors to Airtable Production Issues table for debugging
 * 
 * NOTE: This is a SIMPLE direct logger for explicit error logging from code.
 * The main error detection system uses pattern-based log scanning via:
 * - config/errorPatterns.js (regex patterns for CRITICAL/ERROR/WARNING)
 * - services/logFilterService.js (scans logs and extracts errors)
 * - API endpoints: /api/analyze-logs/recent and /api/analyze-logs/text
 */

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
 * Simple severity determination (no complex filtering)
 * @param {Error} error - The error object
 * @param {Object} context - Additional context
 * @returns {string} - Severity level
 */
function determineSeverity(error, context = {}) {
  // Allow explicit override
  if (context.severity) {
    return context.severity;
  }
  
  // Simple classification based on error type
  const errorMessage = error.message || error.toString();
  
  // CRITICAL: System crashes, connection failures
  if (errorMessage.includes('FATAL') ||
      errorMessage.includes('out of memory') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('Cannot connect')) {
    return 'CRITICAL';
  }
  
  // WARNING: Deprecations, slow operations
  if (errorMessage.includes('deprecated') ||
      errorMessage.includes('slow') ||
      errorMessage.includes('timeout')) {
    return 'WARNING';
  }
  
  // Default to ERROR
  return 'ERROR';
}

/**
 * Simple error type determination
 * @param {Error} error - The error object
 * @param {Object} context - Additional context
 * @returns {string} - Error type
 */
function determineErrorType(error, context = {}) {
  const errorMessage = error.message || error.toString();
  
  // Module import errors
  if (errorMessage.includes('Cannot find module') ||
      errorMessage.includes('MODULE_NOT_FOUND')) {
    return 'Module Import';
  }
  
  // Airtable errors
  if (errorMessage.includes('Unknown field name') ||
      errorMessage.includes('INVALID_REQUEST') ||
      errorMessage.includes('Record not found')) {
    return 'Airtable API';
  }
  
  // AI service errors
  if (errorMessage.includes('Gemini') ||
      errorMessage.includes('OpenAI') ||
      errorMessage.includes('AI') ||
      context.operation?.includes('scoring')) {
    return 'AI Service';
  }
  
  // Job tracking errors
  if (errorMessage.includes('run record') ||
      errorMessage.includes('Job Tracking') ||
      errorMessage.includes('run ID')) {
    return 'Job Tracking';
  }
  
  // Network errors
  if (errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('timeout') ||
      error.code?.startsWith('E')) {
    return 'Network';
  }
  
  // Authentication errors
  if (error.statusCode === 401 || error.statusCode === 403 ||
      errorMessage.includes('Unauthorized') ||
      errorMessage.includes('Authentication')) {
    return 'Authentication';
  }
  
  return 'Unknown';
}

/**
 * Extract location information from error stack
 * @param {Error} error - The error object
 * @returns {Object} - Location information
 */
function extractLocation(error) {
  try {
    if (!error.stack) {
      return { filePath: null, functionName: null, lineNumber: null };
    }
    
    // Parse first line of stack trace (after error message)
    const lines = error.stack.split('\n');
    if (lines.length < 2) {
      return { filePath: null, functionName: null, lineNumber: null };
    }
    
    // Look for pattern: "at functionName (file.js:123:45)"
    const stackLine = lines[1];
    const match = stackLine.match(/at\s+(\S+)\s+\((.+):(\d+):(\d+)\)/);
    
    if (match) {
      return {
        functionName: match[1],
        filePath: match[2],
        lineNumber: parseInt(match[3], 10)
      };
    }
    
    // Alternative pattern: "at file.js:123:45"
    const simpleMatch = stackLine.match(/at\s+(.+):(\d+):(\d+)/);
    if (simpleMatch) {
      return {
        functionName: null,
        filePath: simpleMatch[1],
        lineNumber: parseInt(simpleMatch[2], 10)
      };
    }
    
    return { filePath: null, functionName: null, lineNumber: null };
  } catch (err) {
    return { filePath: null, functionName: null, lineNumber: null };
  }
}

/**
 * Log an error to Airtable Production Issues table
 * @param {Error} error - The error object
 * @param {Object} context - Additional context about the error
 * @returns {Promise<Object|null>} - The created Airtable record or null if skipped
 */
async function logCriticalError(error, context = {}) {
  try {
    // Skip if error logging is disabled in env
    if (process.env.DISABLE_ERROR_LOGGING === 'true') {
      console.log('[ErrorLogger] Error logging disabled via DISABLE_ERROR_LOGGING env var');
      return null;
    }

    // Rate limiting - prevent overwhelming Airtable if something goes very wrong
    const now = Date.now();
    if (now - lastHourReset > 3600000) {
      // Reset counter every hour
      errorCount = 0;
      lastHourReset = now;
    }

    if (errorCount >= MAX_ERRORS_PER_HOUR) {
      console.error('[ErrorLogger] Rate limit exceeded (100 errors/hour), skipping error log');
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

    // Simple error classification (no complex filtering - log everything!)
    const severity = determineSeverity(error, context);
    const errorType = determineErrorType(error, context);
    const location = extractLocation(error);

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

    // Add client ID as text if available (human-readable identifier like "Guy-Wilson")
    if (context.clientId) {
      record[ERROR_LOG_FIELDS.CLIENT_ID] = context.clientId;
    }

    // Add run ID if available
    if (context.runId) {
      record[ERROR_LOG_FIELDS.RUN_ID] = context.runId;
    }

    console.log('[ErrorLogger] Logging error to Airtable:', {
      severity,
      errorType,
      message: error.message,
      operation: context.operation,
      tableName: MASTER_TABLES.ERROR_LOG,
      tableNameType: typeof MASTER_TABLES.ERROR_LOG
    });

    // DEFENSIVE: Verify table name is not undefined before calling Airtable
    if (!MASTER_TABLES.ERROR_LOG) {
      console.error('[ErrorLogger] CRITICAL: ERROR_LOG table name is undefined!');
      return null;
    }

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

/**
 * Get all NEW errors from Airtable Error Log
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Array of error records
 */
async function getNewErrors(options = {}) {
  try {
    if (!masterClientsBase) {
      initialize();
    }

    if (!masterClientsBase) {
      console.error('[ErrorLogger] Master base not initialized');
      return [];
    }

    // DEFENSIVE: Verify table name is defined
    if (!MASTER_TABLES.ERROR_LOG) {
      console.error('[ErrorLogger] CRITICAL: ERROR_LOG table name is undefined!');
      return [];
    }

    const { maxRecords = 100, filterByClient = null } = options;

    let filterFormula = `{${ERROR_LOG_FIELDS.STATUS}} = '${ERROR_STATUS_VALUES.NEW}'`;
    
    if (filterByClient) {
      filterFormula = `AND(${filterFormula}, {Client ID} = '${filterByClient}')`;
    }

    const records = await masterClientsBase(MASTER_TABLES.ERROR_LOG)
      .select({
        filterByFormula,
        maxRecords,
        sort: [{ field: ERROR_LOG_FIELDS.TIMESTAMP, direction: 'desc' }]
      })
      .all();

    return records.map(record => ({
      id: record.id,
      errorId: record.get(ERROR_LOG_FIELDS.ERROR_ID),
      timestamp: record.get(ERROR_LOG_FIELDS.TIMESTAMP),
      severity: record.get(ERROR_LOG_FIELDS.SEVERITY),
      errorType: record.get(ERROR_LOG_FIELDS.ERROR_TYPE),
      message: record.get(ERROR_LOG_FIELDS.ERROR_MESSAGE),
      filePath: record.get(ERROR_LOG_FIELDS.FILE_PATH),
      lineNumber: record.get(ERROR_LOG_FIELDS.LINE_NUMBER),
      functionName: record.get(ERROR_LOG_FIELDS.FUNCTION_NAME),
      runId: record.get(ERROR_LOG_FIELDS.RUN_ID),
      stackTrace: record.get(ERROR_LOG_FIELDS.STACK_TRACE),
      contextJSON: record.get(ERROR_LOG_FIELDS.CONTEXT_JSON)
    }));

  } catch (error) {
    console.error('[ErrorLogger] Failed to get errors:', error.message);
    return [];
  }
}

/**
 * Mark error as fixed with commit information
 * @param {string} recordId - Airtable record ID (e.g., 'recABC123')
 * @param {string} commitHash - Git commit hash
 * @param {string} fixedBy - Who fixed it (default: 'AI Assistant')
 * @param {string} resolutionNotes - Optional notes about the fix
 * @returns {Promise<Object|null>} - Updated record or null if failed
 */
async function markErrorAsFixed(recordId, commitHash, fixedBy = 'AI Assistant', resolutionNotes = '') {
  try {
    if (!masterClientsBase) {
      initialize();
    }

    if (!masterClientsBase) {
      console.error('[ErrorLogger] Master base not initialized');
      return null;
    }

    // DEFENSIVE: Verify table name is defined
    if (!MASTER_TABLES.ERROR_LOG) {
      console.error('[ErrorLogger] CRITICAL: ERROR_LOG table name is undefined!');
      return null;
    }

    const updateData = {
      [ERROR_LOG_FIELDS.STATUS]: ERROR_STATUS_VALUES.FIXED,
      [ERROR_LOG_FIELDS.FIXED_IN_COMMIT]: commitHash,
      [ERROR_LOG_FIELDS.FIXED_BY]: fixedBy,
      [ERROR_LOG_FIELDS.FIXED_DATE]: new Date().toISOString().split('T')[0] // YYYY-MM-DD
    };

    if (resolutionNotes) {
      updateData[ERROR_LOG_FIELDS.RESOLUTION_NOTES] = resolutionNotes;
    }

    console.log(`[ErrorLogger] Marking error ${recordId} as FIXED (commit: ${commitHash})`);

    const updatedRecord = await masterClientsBase(MASTER_TABLES.ERROR_LOG).update(recordId, updateData);

    console.log(`[ErrorLogger] Error ${recordId} marked as FIXED successfully`);
    return updatedRecord;

  } catch (error) {
    console.error('[ErrorLogger] Failed to mark error as fixed:', error.message);
    return null;
  }
}

/**
 * Update resolution notes for an error
 * @param {string} recordId - Airtable record ID
 * @param {string} notes - Resolution notes
 * @returns {Promise<Object|null>} - Updated record or null if failed
 */
async function updateResolutionNotes(recordId, notes) {
  try {
    if (!masterClientsBase) {
      initialize();
    }

    if (!masterClientsBase) {
      console.error('[ErrorLogger] Master base not initialized');
      return null;
    }

    // DEFENSIVE: Verify table name is defined
    if (!MASTER_TABLES.ERROR_LOG) {
      console.error('[ErrorLogger] CRITICAL: ERROR_LOG table name is undefined!');
      return null;
    }

    const updatedRecord = await masterClientsBase(MASTER_TABLES.ERROR_LOG).update(recordId, {
      [ERROR_LOG_FIELDS.RESOLUTION_NOTES]: notes
    });

    console.log(`[ErrorLogger] Updated resolution notes for ${recordId}`);
    return updatedRecord;

  } catch (error) {
    console.error('[ErrorLogger] Failed to update resolution notes:', error.message);
    return null;
  }
}

/**
 * Get error details by record ID
 * @param {string} recordId - Airtable record ID
 * @returns {Promise<Object|null>} - Error details or null if not found
 */
async function getErrorById(recordId) {
  try {
    if (!masterClientsBase) {
      initialize();
    }

    if (!masterClientsBase) {
      console.error('[ErrorLogger] Master base not initialized');
      return null;
    }

    const record = await masterClientsBase(MASTER_TABLES.ERROR_LOG).find(recordId);

    return {
      id: record.id,
      errorId: record.get(ERROR_LOG_FIELDS.ERROR_ID),
      timestamp: record.get(ERROR_LOG_FIELDS.TIMESTAMP),
      severity: record.get(ERROR_LOG_FIELDS.SEVERITY),
      errorType: record.get(ERROR_LOG_FIELDS.ERROR_TYPE),
      message: record.get(ERROR_LOG_FIELDS.ERROR_MESSAGE),
      stackTrace: record.get(ERROR_LOG_FIELDS.STACK_TRACE),
      filePath: record.get(ERROR_LOG_FIELDS.FILE_PATH),
      lineNumber: record.get(ERROR_LOG_FIELDS.LINE_NUMBER),
      functionName: record.get(ERROR_LOG_FIELDS.FUNCTION_NAME),
      contextJSON: record.get(ERROR_LOG_FIELDS.CONTEXT_JSON),
      runId: record.get(ERROR_LOG_FIELDS.RUN_ID),
      status: record.get(ERROR_LOG_FIELDS.STATUS),
      resolutionNotes: record.get(ERROR_LOG_FIELDS.RESOLUTION_NOTES),
      fixedInCommit: record.get(ERROR_LOG_FIELDS.FIXED_IN_COMMIT),
      fixedBy: record.get(ERROR_LOG_FIELDS.FIXED_BY),
      fixedDate: record.get(ERROR_LOG_FIELDS.FIXED_DATE)
    };

  } catch (error) {
    console.error('[ErrorLogger] Failed to get error by ID:', error.message);
    return null;
  }
}

module.exports = {
  logCriticalError,
  logAndConsole,
  initialize,
  clearCache,
  captureSystemState,
  sanitizeInputData,
  // New query and update functions
  getNewErrors,
  getErrorById,
  markErrorAsFixed,
  updateResolutionNotes
};
