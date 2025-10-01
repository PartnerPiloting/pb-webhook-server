/**
 * utils/airtableErrors.js
 * 
 * Standardized error classes for Airtable operations.
 * This ensures consistent error handling and reporting across the application.
 */

/**
 * Base class for Airtable errors
 */
class AirtableError extends Error {
  constructor(message, metadata = {}) {
    super(message);
    this.name = this.constructor.name;
    this.metadata = metadata;
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
  
  /**
   * Get a formatted message with metadata
   * @returns {string} Formatted error message
   */
  getFormattedMessage() {
    const metadataStr = Object.entries(this.metadata)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(', ');
    
    return `${this.message}${metadataStr ? ` (${metadataStr})` : ''}`;
  }
}

/**
 * Error for field name validation failures
 */
class FieldNameError extends AirtableError {
  constructor(message, fieldName, correctFieldName = null, metadata = {}) {
    super(message, {
      ...metadata,
      fieldName,
      correctFieldName
    });
    
    this.fieldName = fieldName;
    this.correctFieldName = correctFieldName;
  }
}

/**
 * Error for record not found in Airtable
 */
class RecordNotFoundError extends AirtableError {
  constructor(message, tableId, recordId, metadata = {}) {
    super(message, {
      ...metadata,
      tableId,
      recordId
    });
    
    this.tableId = tableId;
    this.recordId = recordId;
  }
}

/**
 * Error for Airtable API limit errors
 */
class AirtableLimitError extends AirtableError {
  constructor(message, retryAfter = null, metadata = {}) {
    super(message, {
      ...metadata,
      retryAfter
    });
    
    this.retryAfter = retryAfter;
  }
}

/**
 * Format an error for logging
 * @param {Error} error - The error to format
 * @returns {Object} Formatted error object
 */
function formatErrorForLogging(error) {
  if (error instanceof AirtableError) {
    return {
      message: error.message,
      type: error.name,
      metadata: error.metadata,
      stack: error.stack
    };
  }
  
  return {
    message: error.message,
    type: error.name || 'Error',
    stack: error.stack
  };
}

/**
 * Handle common Airtable errors with appropriate responses
 * @param {Error} error - The error to handle
 * @param {Object} logger - Logger instance
 * @returns {Object} Response object with error details
 */
function handleAirtableError(error, logger = console) {
  if (error.statusCode === 404) {
    const notFoundError = new RecordNotFoundError(
      'Record not found in Airtable',
      error.tableName || 'unknown',
      error.recordId || 'unknown',
      { originalError: error.message }
    );
    
    logger.warn(`Airtable 404 error: ${notFoundError.getFormattedMessage()}`);
    
    return {
      success: false,
      error: 'record_not_found',
      message: notFoundError.message,
      details: notFoundError.metadata
    };
  }
  
  if (error.statusCode === 429) {
    const limitError = new AirtableLimitError(
      'Airtable rate limit exceeded',
      error.retryAfter || 30,
      { originalError: error.message }
    );
    
    logger.warn(`Airtable rate limit error: ${limitError.getFormattedMessage()}`);
    
    return {
      success: false,
      error: 'rate_limit',
      message: limitError.message,
      retryAfter: limitError.retryAfter,
      details: limitError.metadata
    };
  }
  
  // Generic error handling
  logger.error(`Airtable error: ${error.message}`, {
    stack: error.stack,
    statusCode: error.statusCode,
    type: error.name
  });
  
  return {
    success: false,
    error: 'airtable_error',
    message: error.message,
    statusCode: error.statusCode
  };
}

module.exports = {
  AirtableError,
  FieldNameError,
  RecordNotFoundError,
  AirtableLimitError,
  formatErrorForLogging,
  handleAirtableError
};