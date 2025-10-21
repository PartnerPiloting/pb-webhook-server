// utils/errorHandler.js
/**
 * Central error handling utility for multi-tenant operations
 * Provides standardized error handling patterns across the system
 */

const { StructuredLogger } = require('./structuredLogger');
const { createLogger } = require('./contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'util' });
const { createSafeLogger, getLoggerFromOptions } = require('./loggerHelper');

/**
 * Get the field types for a table
 * @param {Object} base - The Airtable base object
 * @param {string} tableName - The table name to check
 * @param {Object} options - Additional options
 * @param {Object} [options.logger] - Optional logger instance
 * @returns {Promise<Object>} Object with field types mapping
 */
async function getFieldTypes(base, tableName, options = {}) {
  const logger = options.logger || console;
  const fieldTypes = {};
  
  try {
    // Get table metadata (fields and their types)
    const table = base(tableName);
    const records = await table.select({ maxRecords: 1 }).firstPage();
    
    // If we have at least one record, we can examine its fields
    if (records && records.length > 0) {
      const record = records[0];
      const recordFields = record._rawJson.fields;
      
      // Analyze each field value to determine its type
      for (const [fieldName, value] of Object.entries(recordFields)) {
        if (value === null || value === undefined) continue;
        
        // Determine type based on the value
        if (Array.isArray(value)) {
          fieldTypes[fieldName] = 'array';
        } else if (typeof value === 'boolean') {
          fieldTypes[fieldName] = 'boolean';
        } else if (typeof value === 'number') {
          fieldTypes[fieldName] = 'number';
        } else if (typeof value === 'string') {
          // Check if it's a date string
          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
            fieldTypes[fieldName] = 'date';
          } else {
            fieldTypes[fieldName] = 'text';
          }
        } else {
          fieldTypes[fieldName] = 'object';
        }
      }
    }
    
    return fieldTypes;
  } catch (error) {
    logger.error(`Error getting field types for ${tableName}: ${error.message}`);
    return {};
  }
}

/**
 * Convert a value to the appropriate type for a field
 * @param {*} value - The value to convert
 * @param {string} fieldName - The field name for context
 * @param {string} targetType - The target data type
 * @param {Object} options - Additional options
 * @param {Object} [options.logger] - Optional logger instance
 * @returns {*} The converted value
 */
function convertValueToType(value, fieldName, targetType, options = {}) {
  const logger = options.logger || console;
  
  try {
    // Handle null/undefined
    if (value === null || value === undefined) return value;
    
    switch (targetType) {
      case 'text':
        // Convert anything to string
        return String(value);
      
      case 'number':
        // Convert to number if possible
        const num = Number(value);
        if (isNaN(num)) {
          logger.warn(`Could not convert value "${value}" to number for field ${fieldName}`);
          return value; // Return original if conversion fails
        }
        return num;
      
      case 'date':
        // Handle date conversion
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
          return value; // Already a date string
        } else if (value instanceof Date) {
          return value.toISOString(); // Convert Date to ISO string
        } else if (typeof value === 'number') {
          return new Date(value).toISOString(); // Convert timestamp to ISO string
        } else if (typeof value === 'string') {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return date.toISOString(); // Convert valid date string
          }
        }
        logger.warn(`Could not convert value "${value}" to date for field ${fieldName}`);
        return value;
      
      case 'boolean':
        // Convert to boolean
        if (typeof value === 'string') {
          if (value.toLowerCase() === 'true') return true;
          if (value.toLowerCase() === 'false') return false;
        }
        return Boolean(value);
      
      default:
        return value; // Return as is for unknown types
    }
  } catch (error) {
    logger.error(`Error converting value for ${fieldName}: ${error.message}`);
    return value; // Return original if conversion fails
  }
}

/**
 * Handle errors in client-specific operations with proper isolation
 * @param {string} clientId - The client ID where error occurred
 * @param {string} operation - The operation being performed (e.g., 'lead_scoring', 'post_harvesting')
 * @param {Error} error - The error that occurred
 * @param {Object} options - Additional options
 * @param {Object} [options.logger] - Optional logger instance
 * @param {boolean} [options.rethrow=false] - Whether to rethrow the error after handling
 * @param {Function} [options.onError] - Callback function to execute on error
 * @returns {Object} Error information object
 */
function handleClientError(clientId, operation, error, options = {}) {
  const logger = options.logger || createSafeLogger(clientId || 'SYSTEM', null, operation);
  
  // Create a structured error object with context
  const errorInfo = {
    clientId,
    operation,
    message: error.message,
    time: new Date().toISOString(),
    stack: options.includeStack ? error.stack : undefined
  };
  
  // Log the error with proper context
  logger.error(`[${operation}] Error for client ${clientId}: ${error.message}`);
  
  // Execute error callback if provided
  if (typeof options.onError === 'function') {
    try {
      options.onError(errorInfo);
    } catch (callbackError) {
      logger.warn(`Error in onError callback: ${callbackError.message}`);
    }
  }
  
  // Rethrow if needed
  if (options.rethrow) {
    throw error;
  }
  
  return errorInfo;
}

/**
 * Validate that required fields exist in an Airtable table
 * @param {Object} base - The Airtable base object
 * @param {string} tableName - The table name to check
 * @param {string[]} requiredFields - Array of field names to validate
 * @param {Object} options - Additional options
 * @param {Object} [options.logger] - Optional logger instance
 * @returns {Promise<Object>} Object with validation results
 */
async function validateFields(base, tableName, requiredFields, options = {}) {
  const logger = options.logger || createSafeLogger('SYSTEM', null, 'field_validation');
  const results = {
    valid: true,
    missingFields: [],
    fieldMappings: {},
    caseSensitiveFields: {}
  };
  
  try {
    // Get a sample record to extract field names
    const records = await base(tableName).select({ maxRecords: 1 }).firstPage();
    
    if (!records || records.length === 0) {
      logger.warn(`No records found in table ${tableName} to validate fields`);
      results.valid = false;
      results.missingFields = requiredFields;
      return results;
    }
    
    const sampleRecord = records[0];
    const actualFields = Object.keys(sampleRecord.fields || {});
    
    // Check each required field and handle case sensitivity
    for (const field of requiredFields) {
      // Try exact match first
      if (actualFields.includes(field)) {
        results.fieldMappings[field] = field;
        results.caseSensitiveFields[field] = field;
        continue;
      }
      
      // Try case-insensitive match
      const lowerField = field.toLowerCase();
      const match = actualFields.find(f => f.toLowerCase() === lowerField);
      
      if (match) {
        // Found a match with different case
        results.fieldMappings[field] = match;
        results.caseSensitiveFields[field] = match;
      } else {
        // No match found
        results.valid = false;
        results.missingFields.push(field);
      }
    }
    
    if (results.missingFields.length > 0) {
      logger.warn(`Missing fields in table ${tableName}: ${results.missingFields.join(', ')}`);
    }
    
  } catch (error) {
    logger.error(`Error validating fields in ${tableName}: ${error.message}`);
    results.valid = false;
    results.error = error.message;
  }
  
  return results;
}

/**
 * Execute an operation with proper error boundaries and client isolation
 * @param {string} clientId - The client ID for the operation
 * @param {Function} operationFn - The async function to execute
 * @param {Function} [fallbackFn] - Optional fallback function if operation fails
 * @param {Object} options - Additional options
 * @param {string} [options.operation='unknown'] - Operation name for logging
 * @param {Object} [options.logger] - Optional logger instance
 * @param {boolean} [options.rethrow=false] - Whether to rethrow errors
 * @returns {Promise<any>} The result of the operation or fallback
 */
async function safeOperation(clientId, operationFn, fallbackFn = null, options = {}) {
  const operationName = options.operation || 'unknown';
  const logger = options.logger || createSafeLogger(clientId || 'SYSTEM', null, operationName);
  
  try {
    // Log operation start with context
    logger.debug(`[${operationName}] Starting operation for client ${clientId}`);
    
    // Execute the main operation
    const result = await operationFn();
    
    // Log success
    logger.debug(`[${operationName}] Operation completed successfully for client ${clientId}`);
    
    return result;
  } catch (error) {
    // Handle the error with proper context
    handleClientError(clientId, operationName, error, {
      logger,
      includeStack: true,
      rethrow: false
    });
    
    // Try fallback if provided
    if (typeof fallbackFn === 'function') {
      try {
        logger.info(`[${operationName}] Attempting fallback for client ${clientId}`);
        const fallbackResult = await fallbackFn(error);
        logger.info(`[${operationName}] Fallback succeeded for client ${clientId}`);
        return fallbackResult;
      } catch (fallbackError) {
        handleClientError(clientId, `${operationName}_fallback`, fallbackError, {
          logger,
          rethrow: options.rethrow
        });
      }
    }
    
    // Rethrow if requested
    if (options.rethrow) {
      throw error;
    }
    
    // Return null if we get here (operation failed, no fallback or fallback failed)
    return null;
  }
}

/**
 * Safe field update that handles missing fields gracefully
 * @param {Object} base - The Airtable base object
 * @param {string} tableName - The table name to update
 * @param {string} recordId - The record ID to update
 * @param {Object} updates - The fields to update
 * @param {Object} options - Additional options
 * @param {Object} [options.logger] - Optional logger instance
 * @param {string} [options.clientId='SYSTEM'] - Client ID for logging
 * @param {boolean} [options.skipMissing=true] - Whether to skip missing fields
 * @returns {Promise<Object>} The update result
 */
/**
 * Safely update fields in a record with validation and type conversion
 * @param {Object} base - The Airtable base object
 * @param {string} tableName - The table name
 * @param {string} recordId - The record ID to update
 * @param {Object} updates - The fields to update
 * @param {Object} options - Additional options
 * @param {string} [options.clientId] - Client ID for logging context
 * @param {Object} [options.logger] - Optional logger instance
 * @param {boolean} [options.skipMissing=true] - Skip fields that don't exist in table
 * @param {boolean} [options.convertTypes=true] - Convert values to match field types
 * @param {string} [options.source] - Source of the update
 * @returns {Promise<Object>} The update result
 */
async function safeFieldUpdate(base, tableName, recordId, updates, options = {}) {
  const clientId = options.clientId || 'SYSTEM';
  const logger = options.logger || createSafeLogger(clientId, null, 'field_update');
  const skipMissing = options.skipMissing !== false; // Default to true
  const convertTypes = options.convertTypes !== false; // Default to true
  
  // First validate that the fields exist
  const fieldNames = Object.keys(updates);
  const validation = await validateFields(base, tableName, fieldNames, { logger });
  
  // Get field types if converting
  let fieldTypes = {};
  if (convertTypes) {
    fieldTypes = await getFieldTypes(base, tableName, { logger });
    logger.debug(`Found types for ${Object.keys(fieldTypes).length} fields in ${tableName}`);
  }
  
  // Create a new updates object with only valid fields and converted values
  const safeUpdates = {};
  let skippedFields = [];
  let convertedFields = [];
  
  for (const field of fieldNames) {
    const correctField = validation.caseSensitiveFields[field];
    
    if (correctField) {
      // Use the correct case for the field
      let value = updates[field];
      
      // Convert value if needed
      if (convertTypes && fieldTypes[correctField]) {
        const originalValue = value;
        value = convertValueToType(value, correctField, fieldTypes[correctField], { logger });
        
        // Track if we converted the value
        if (value !== originalValue) {
          convertedFields.push(`${correctField} (${typeof originalValue} → ${fieldTypes[correctField]})`);
        }
      }
      
      safeUpdates[correctField] = value;
    } else if (!skipMissing) {
      // If not skipping missing fields, keep the original
      safeUpdates[field] = updates[field];
    } else {
      // Track skipped fields
      skippedFields.push(field);
    }
  }
  
  // Log conversions and skips
  if (convertedFields.length > 0) {
    logger.info(`Converted fields in ${tableName}: ${convertedFields.join(', ')}`);
  }
  if (skippedFields.length > 0) {
    logger.warn(`Skipping missing fields in ${tableName}: ${skippedFields.join(', ')}`);
  }
  
  // If no valid fields to update, return early
  if (Object.keys(safeUpdates).length === 0) {
    logger.warn(`No valid fields to update in ${tableName} for record ${recordId}`);
    return { updated: false, reason: 'no_valid_fields' };
  }
  
  // Perform the update with only valid fields
  try {
    const result = await base(tableName).update(recordId, safeUpdates);
    logger.debug(`Successfully updated record ${recordId} in ${tableName}`);
    return { 
      updated: true, 
      result,
      skippedFields,
      convertedFields
    };
  } catch (error) {
    logger.error(`Error updating record ${recordId} in ${tableName}: ${error.message}`);
    return {
      updated: false,
      error: error.message,
      skippedFields,
      convertedFields
    };
  }
}

/**
 * Detect the case of a field in a specific table
 * @param {Object} base - The Airtable base object
 * @param {string} tableName - The table name to check
 * @param {string} fieldName - The field name to check (case insensitive)
 * @param {string} defaultCase - Default case to return if field not found
 * @returns {Promise<string>} The field name with correct case
 */
async function getFieldCase(base, tableName, fieldName, defaultCase = null) {
  try {
    // Get a sample record to extract field names
    const records = await base(tableName).select({ maxRecords: 1 }).firstPage();
    
    if (!records || records.length === 0) {
      return defaultCase || fieldName;
    }
    
    const sampleRecord = records[0];
    const actualFields = Object.keys(sampleRecord.fields || {});
    
    // Try exact match first
    if (actualFields.includes(fieldName)) {
      return fieldName;
    }
    
    // Try case-insensitive match
    const lowerField = fieldName.toLowerCase();
    const match = actualFields.find(f => f.toLowerCase() === lowerField);
    
    return match || defaultCase || fieldName;
  } catch (error) {
    logger.error(`Error detecting field case: ${error.message}`);
    return defaultCase || fieldName;
  }
}

/**
 * Log an error with stack trace capture to Stack Traces table
 * Logs errors with STACKTRACE: markers for analyzer pickup
 * @param {Error} error - The error object with stack trace
 * @param {Object} options - Error context
 * @param {string} options.runId - Run ID for this operation
 * @param {string} options.clientId - Client ID (optional)
 * @param {string} options.context - Additional context for the error
 * @param {string} options.loggerName - Name for the logger (default: 'ERROR-HANDLER')
 * @param {string} options.operation - Operation name (default: 'logError')
 * @returns {Promise<string|null>} - Timestamp of saved stack trace or null
 */
async function logErrorWithStackTrace(error, options = {}) {
  const {
    runId,
    clientId = null,
    context = '',
    loggerName = 'ERROR-HANDLER',
    operation = 'logError',
  } = options;

  // Create logger
  const errorLogger = createSafeLogger(loggerName, operation);

  // Extract error details
  const errorMessage = error?.message || String(error);
  const stackTrace = error?.stack || new Error().stack;

  try {
    // Load StackTraceService dynamically to avoid circular dependencies
    const StackTraceService = require('../services/stackTraceService');
    
    // Generate unique timestamp for stack trace lookup
    const timestamp = StackTraceService.generateUniqueTimestamp();

    // Save stack trace to Stack Traces table
    const stackTraceService = new StackTraceService();
    await stackTraceService.saveStackTrace({
      timestamp,
      runId,
      clientId,
      errorMessage,
      stackTrace,
    });

    // Log error with STACKTRACE: marker for analyzer to detect
    const contextPrefix = context ? `${context} - ` : '';
    const runIdTag = runId ? `[${runId}] ` : '';
    const clientIdTag = clientId ? `[Client: ${clientId}] ` : '';
    
    // Use direct console.log to ensure marker appears in Render logs (contextLogger may not write to stdout)
    console.log(`[ERROR] ${runIdTag}${clientIdTag}${contextPrefix}${errorMessage} STACKTRACE:${timestamp}`);
    
    // Also log via contextLogger for consistency
    errorLogger.error(
      `${runIdTag}${clientIdTag}${contextPrefix}${errorMessage} STACKTRACE:${timestamp}`
    );

    return timestamp;
  } catch (stackTraceError) {
    // Stack trace saving failed - still log the error without marker
    errorLogger.error(`${errorMessage}`);
    errorLogger.debug(`Failed to save stack trace: ${stackTraceError.message}`);
    return null;
  }
}

/**
 * Async wrapper for logErrorWithStackTrace (fire-and-forget)
 * Use when you don't need to wait for stack trace to be saved
 * @param {Error} error - The error object
 * @param {Object} options - Error context (same as logErrorWithStackTrace)
 */
function logErrorAsync(error, options = {}) {
  // Fire and forget - don't wait for stack trace saving
  logErrorWithStackTrace(error, options).catch(err => {
    // Fallback logging if even the error handler fails
    console.error('[ERROR-HANDLER] Critical failure:', err.message);
  });
}

module.exports = {
  handleClientError,
  validateFields,
  safeOperation,
  safeFieldUpdate,
  getFieldCase,
  getFieldTypes,
  convertValueToType,
  logErrorWithStackTrace,
  logErrorAsync,
};
