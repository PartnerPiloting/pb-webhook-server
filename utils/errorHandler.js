// utils/errorHandler.js
/**
 * Central error handling utility for multi-tenant operations
 * Provides standardized error handling patterns across the system
 */

const { StructuredLogger } = require('./structuredLogger');

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
  const logger = options.logger || new StructuredLogger(clientId || 'SYSTEM', null, operation);
  
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
  const logger = options.logger || new StructuredLogger('SYSTEM', null, 'field_validation');
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
  const logger = options.logger || new StructuredLogger(clientId || 'SYSTEM', null, operationName);
  
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
async function safeFieldUpdate(base, tableName, recordId, updates, options = {}) {
  const clientId = options.clientId || 'SYSTEM';
  const logger = options.logger || new StructuredLogger(clientId, null, 'field_update');
  const skipMissing = options.skipMissing !== false; // Default to true
  
  // First validate that the fields exist
  const fieldNames = Object.keys(updates);
  const validation = await validateFields(base, tableName, fieldNames, { logger });
  
  // Create a new updates object with only valid fields
  const safeUpdates = {};
  let skippedFields = [];
  
  for (const field of fieldNames) {
    if (validation.caseSensitiveFields[field]) {
      // Use the correct case for the field
      safeUpdates[validation.caseSensitiveFields[field]] = updates[field];
    } else if (!skipMissing) {
      // If not skipping missing fields, keep the original
      safeUpdates[field] = updates[field];
    } else {
      // Track skipped fields
      skippedFields.push(field);
    }
  }
  
  // Log skipped fields if any
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
      skippedFields
    };
  } catch (error) {
    logger.error(`Error updating record ${recordId} in ${tableName}: ${error.message}`);
    return {
      updated: false,
      error: error.message,
      skippedFields
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
    console.error(`Error detecting field case: ${error.message}`);
    return defaultCase || fieldName;
  }
}

module.exports = {
  handleClientError,
  validateFields,
  safeOperation,
  safeFieldUpdate,
  getFieldCase
};