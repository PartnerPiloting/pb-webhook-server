/**
 * utils/paramValidator.js
 * 
 * A comprehensive parameter validation utility for ensuring consistent 
 * parameter validation across all service boundaries.
 * 
 * This utility provides methods to validate common parameters like clientId, runId,
 * and other data types with consistent error handling.
 */

// FIXED: Using unified logger factory instead of direct StructuredLogger instantiation
const { createSystemLogger } = require('./unifiedLoggerFactory');
const runIdSystem = require('../services/runIdSystem');

// Base logger for the validation system - using factory pattern
const logger = createSystemLogger(null, 'param_validator');

/**
 * ValidationError class for parameter validation errors
 * Provides consistent error type and formatting
 */
class ValidationError extends Error {
  constructor(message, params = {}) {
    super(message);
    this.name = 'ValidationError';
    this.params = params;
    this.isValidationError = true;
  }
}

/**
 * Validate that a value exists (not undefined or null)
 * @param {any} value - Value to check
 * @param {string} paramName - Name of parameter for error message
 * @param {Object} options - Additional options
 * @returns {any} The original value if valid
 * @throws {ValidationError} If validation fails
 */
function validateRequired(value, paramName, options = {}) {
  const { source = 'unknown', throwError = true } = options;
  
  if (value === undefined || value === null) {
    const errorMessage = `Required parameter '${paramName}' is missing`;
    
    if (throwError) {
      throw new ValidationError(errorMessage, { paramName, source });
    } else {
      logger.error(`[${source}] ${errorMessage}`);
      return false;
    }
  }
  
  return value;
}

/**
 * Validate that a value is a non-empty string
 * @param {any} value - Value to check
 * @param {string} paramName - Name of parameter for error message
 * @param {Object} options - Additional options
 * @returns {string} The validated string
 * @throws {ValidationError} If validation fails
 */
function validateString(value, paramName, options = {}) {
  const { 
    source = 'unknown', 
    throwError = true,
    allowEmpty = false,
    trim = true,
    defaultValue = undefined
  } = options;
  
  // Handle undefined or null with defaultValue if provided
  if ((value === undefined || value === null) && defaultValue !== undefined) {
    return defaultValue;
  }
  
  // First check existence
  validateRequired(value, paramName, { source, throwError });
  
  // Then validate type
  if (typeof value !== 'string') {
    const errorMessage = `Parameter '${paramName}' must be a string, got ${typeof value}: ${JSON.stringify(value)}`;
    
    if (throwError) {
      throw new ValidationError(errorMessage, { paramName, source, actualType: typeof value, value });
    } else {
      logger.error(`[${source}] ${errorMessage}`);
      return false;
    }
  }
  
  // Trim if requested
  const processedValue = trim ? value.trim() : value;
  
  // Check for empty if not allowed
  if (!allowEmpty && processedValue === '') {
    const errorMessage = `Parameter '${paramName}' cannot be empty`;
    
    if (throwError) {
      throw new ValidationError(errorMessage, { paramName, source });
    } else {
      logger.error(`[${source}] ${errorMessage}`);
      return false;
    }
  }
  
  return processedValue;
}

/**
 * Validate that a value is a valid client ID
 * @param {any} clientId - Client ID to validate
 * @param {Object} options - Additional options
 * @returns {string} The validated client ID
 * @throws {ValidationError} If validation fails
 */
function validateClientId(clientId, options = {}) {
  const { 
    source = 'unknown', 
    throwError = true,
    defaultValue = 'SYSTEM',
    allowSystem = true
  } = options;

  try {
    // Handle undefined with default
    if ((clientId === undefined || clientId === null) && defaultValue) {
      return defaultValue;
    }
    
    // Special case: if clientId is an object with clientId property
    if (clientId && typeof clientId === 'object' && clientId.clientId) {
      logger.warn(`[${source}] Object passed as clientId, extracted clientId property: ${clientId.clientId}`);
      clientId = clientId.clientId;
    }
    
    // Basic string validation
    const validatedId = validateString(clientId, 'clientId', {
      source,
      throwError,
      allowEmpty: false,
      defaultValue: defaultValue
    });
    
    // If it's not a valid string, exit early
    if (!validatedId) return defaultValue;
    
    // Check for SYSTEM if not allowed
    if (!allowSystem && validatedId === 'SYSTEM') {
      const errorMessage = `'SYSTEM' is not allowed as a clientId in this context`;
      
      if (throwError) {
        throw new ValidationError(errorMessage, { paramName: 'clientId', source });
      } else {
        logger.error(`[${source}] ${errorMessage}`);
        return defaultValue;
      }
    }
    
    return validatedId;
  } catch (error) {
    if (error.isValidationError && !throwError) {
      logger.error(`[${source}] ${error.message}`);
      return defaultValue;
    }
    throw error;
  }
}

/**
 * Validate that a value is a valid run ID
 * @param {any} runId - Run ID to validate
 * @param {Object} options - Additional options
 * @returns {string} The validated and normalized run ID
 * @throws {ValidationError} If validation fails
 */
function validateRunId(runId, options = {}) {
  const { 
    source = 'unknown', 
    throwError = true,
    normalize = true,
    defaultValue = undefined,
    allowEmpty = false
  } = options;

  try {
    // Handle undefined with default
    if ((runId === undefined || runId === null) && defaultValue !== undefined) {
      return defaultValue;
    }
    
    // Special case: if runId is an object with runId property
    if (runId && typeof runId === 'object') {
      if (runId.runId) {
        logger.warn(`[${source}] Object passed as runId, extracted runId property: ${runId.runId}`);
        runId = runId.runId;
      } else if (runId.id) {
        logger.warn(`[${source}] Object passed as runId, extracted id property: ${runId.id}`);
        runId = runId.id;
      }
    }
    
    // Basic string validation
    const validatedId = validateString(runId, 'runId', {
      source,
      throwError,
      allowEmpty,
      defaultValue
    });
    
    // If it's not a valid string, exit early
    if (!validatedId && validatedId !== '') return defaultValue;
    
    // Normalize run ID if requested
    if (normalize && validatedId) {
      try {
        return runIdSystem.validateAndStandardizeRunId(validatedId);
      } catch (error) {
        if (throwError) {
          throw new ValidationError(`Invalid run ID format: ${error.message}`, { 
            paramName: 'runId', 
            source, 
            originalValue: validatedId 
          });
        } else {
          logger.error(`[${source}] Invalid run ID format: ${error.message}`);
          return validatedId; // Return original even if normalization fails
        }
      }
    }
    
    return validatedId;
  } catch (error) {
    if (error.isValidationError && !throwError) {
      logger.error(`[${source}] ${error.message}`);
      return defaultValue;
    }
    throw error;
  }
}

/**
 * Validate that a value is an object
 * @param {any} value - Value to check
 * @param {string} paramName - Name of parameter for error message
 * @param {Object} options - Additional options
 * @returns {Object} The validated object
 * @throws {ValidationError} If validation fails
 */
function validateObject(value, paramName, options = {}) {
  const { 
    source = 'unknown', 
    throwError = true,
    allowNull = false,
    defaultValue = {},
    requiredKeys = []
  } = options;
  
  // Handle undefined or null with defaultValue
  if (value === undefined || (value === null && !allowNull)) {
    if (defaultValue !== undefined) {
      return defaultValue;
    } else {
      const errorMessage = `Required parameter '${paramName}' is missing`;
      
      if (throwError) {
        throw new ValidationError(errorMessage, { paramName, source });
      } else {
        logger.error(`[${source}] ${errorMessage}`);
        return defaultValue;
      }
    }
  }
  
  // Allow null if specified
  if (value === null && allowNull) {
    return null;
  }
  
  // Check type
  if (typeof value !== 'object' || Array.isArray(value)) {
    const errorMessage = `Parameter '${paramName}' must be an object, got ${typeof value}: ${JSON.stringify(value)}`;
    
    if (throwError) {
      throw new ValidationError(errorMessage, { paramName, source, actualType: typeof value, value });
    } else {
      logger.error(`[${source}] ${errorMessage}`);
      return defaultValue;
    }
  }
  
  // Check required keys if any
  if (requiredKeys.length > 0) {
    const missingKeys = requiredKeys.filter(key => !(key in value));
    
    if (missingKeys.length > 0) {
      const errorMessage = `Parameter '${paramName}' is missing required keys: ${missingKeys.join(', ')}`;
      
      if (throwError) {
        throw new ValidationError(errorMessage, { 
          paramName, 
          source, 
          missingKeys 
        });
      } else {
        logger.error(`[${source}] ${errorMessage}`);
        return defaultValue;
      }
    }
  }
  
  return value;
}

/**
 * Validate parameters for logger creation
 * @param {Object} params - Parameters to validate
 * @param {string} params.clientId - Client ID
 * @param {string} params.sessionId - Session ID
 * @param {string} params.processType - Process type
 * @param {Object} options - Additional options
 * @returns {Object} The validated parameters
 */
function validateLoggerParams(params = {}, options = {}) {
  const { source = 'logger_params' } = options;
  const { clientId, sessionId, processType } = params;
  
  const validatedClientId = validateClientId(clientId, {
    source,
    throwError: false,
    defaultValue: 'SYSTEM'
  });
  
  const validatedSessionId = validateRunId(sessionId, {
    source,
    throwError: false,
    normalize: false,
    allowEmpty: true,
    defaultValue: null
  });
  
  const validatedProcessType = validateString(processType, 'processType', {
    source,
    throwError: false,
    allowEmpty: true,
    defaultValue: null
  });
  
  return {
    clientId: validatedClientId,
    sessionId: validatedSessionId,
    processType: validatedProcessType
  };
}

module.exports = {
  ValidationError,
  validateRequired,
  validateString,
  validateClientId,
  validateRunId,
  validateObject,
  validateLoggerParams
};