/**
 * utils/airtableFieldValidator.js
 * 
 * Centralized utility for Airtable field validation.
 * This module provides field name constants and validation functions
 * to ensure data sent to Airtable meets schema requirements.
 * 
 * BENEFITS:
 * - Prevents typos in field names
 * - Validates case sensitivity (crucial for Airtable)
 * - Provides consistent error messages
 * - Enables defensive programming patterns
 */

// Import the logger helper
const { createSafeLogger } = require('./loggerHelper');

// Import specialized error classes
const { FieldNameError } = require('./airtableErrors');

// Base logger for this module
const logger = createSafeLogger('SYSTEM', 'field-validator', 'airtable');

/**
 * Consolidated constants for Airtable field names
 * These are the EXACT field names as they appear in Airtable
 * Case sensitivity matters - Airtable will reject incorrect case
 */
const FIELD_NAMES = {
  // Common status fields
  STATUS: 'Status',
  SYSTEM_NOTES: 'System Notes',
  
  // Time tracking fields
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  DURATION: 'Duration',
  
  // Run identification fields
  RUN_ID: 'Run ID',
  CLIENT_ID: 'Client ID',
  CLIENT_NAME: 'Client Name',
  
  // Lead scoring metrics
  PROFILES_EXAMINED: 'Profiles Examined for Scoring',
  PROFILES_SCORED: 'Profiles Successfully Scored',
  PROFILE_SCORING_TOKENS: 'Profile Scoring Tokens',
  
  // Post scoring metrics
  POSTS_EXAMINED: 'Posts Examined for Scoring',
  POSTS_SCORED: 'Posts Successfully Scored',
  POST_SCORING_TOKENS: 'Post Scoring Tokens',
  
  // Error tracking
  ERRORS: 'Errors',
  ERROR_COUNT: 'Error Count',
  ERROR_DETAILS: 'Error Details',
  ERROR_SUMMARY: 'Error Summary',
  
  // Processing flags
  PROCESSING_COMPLETED: 'Processing Completed',
  
  // Formula fields (read-only)
  SUCCESS_RATE: 'Success Rate'
};

/**
 * Status value constants to ensure consistency
 */
const STATUS_VALUES = {
  RUNNING: 'Running',
  COMPLETED: 'Completed successfully',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
  ERROR: 'Error',
  NO_LEADS: 'No leads to process'
};

/**
 * Validates if an object has valid Airtable field names
 * @param {Object} data - The data object to validate
 * @param {boolean} [allowUnknown=false] - Whether to allow unknown fields
 * @param {boolean} [throwOnError=false] - Whether to throw on validation errors
 * @returns {Object} - Validation result with success flag and errors
 * @throws {FieldNameError} If throwOnError is true and validation fails
 */
function validateFieldNames(data, allowUnknown = false, throwOnError = false) {
  if (!data || typeof data !== 'object') {
    const error = new FieldNameError('Invalid data object provided for validation', null, null, { data });
    
    if (throwOnError) {
      throw error;
    }
    
    return { 
      success: false, 
      errors: [error.message],
      fieldErrors: [{ field: null, error }]
    };
  }
  
  const errors = [];
  const fieldErrors = [];
  const knownFieldNames = Object.values(FIELD_NAMES);
  
  // Check each field in the data object
  for (const [key, value] of Object.entries(data)) {
    // Skip fields that start with underscore (internal use)
    if (key.startsWith('_')) continue;
    
    // Check if field name is recognized
    if (!knownFieldNames.includes(key)) {
      if (!allowUnknown) {
        const errorMessage = `Unknown field name: ${key}`;
        const error = new FieldNameError(errorMessage, key, null, { value });
        errors.push(errorMessage);
        fieldErrors.push({ field: key, error });
      }
    }
    
    // Check if there's a case-sensitive match but different case (common error)
    const lowerCaseKey = key.toLowerCase();
    const matchingFieldName = knownFieldNames.find(field => field.toLowerCase() === lowerCaseKey && field !== key);
    
    if (matchingFieldName) {
      const errorMessage = `Incorrect case for field name: ${key}. Should be: ${matchingFieldName}`;
      const error = new FieldNameError(errorMessage, key, matchingFieldName, { value });
      errors.push(errorMessage);
      fieldErrors.push({ field: key, error, correctField: matchingFieldName });
    }
  }
  
  const result = {
    success: errors.length === 0,
    errors,
    fieldErrors,
    validatedData: data
  };
  
  // If requested, throw on any validation errors
  if (throwOnError && !result.success) {
    const firstError = fieldErrors[0]?.error || 
                      new FieldNameError('Field validation failed', null, null, { errors });
    throw firstError;
  }
  
  return result;
}

/**
 * Creates a validated object with corrected field names
 * @param {Object} data - The data object to validate and correct
 * @param {Object} options - Options for validation
 * @param {boolean} [options.strict=false] - Whether to throw on unknown fields
 * @param {boolean} [options.log=true] - Whether to log corrections
 * @returns {Object} - Object with corrected field names
 * @throws {FieldNameError} If strict mode is on and unknown fields are found
 */
function createValidatedObject(data, options = {}) {
  const { strict = false, log = true } = options;
  
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const validatedData = {};
  const lowerCaseMappings = {};
  const corrections = [];
  const unknownFields = [];
  
  // Create lowercase mappings for all field names
  for (const [key, value] of Object.entries(FIELD_NAMES)) {
    lowerCaseMappings[value.toLowerCase()] = value;
  }
  
  // Process each field in the data object
  for (const [key, value] of Object.entries(data)) {
    // Skip fields that start with underscore (internal use)
    if (key.startsWith('_')) {
      validatedData[key] = value;
      continue;
    }
    
    // Check if we need to correct the case
    const correctFieldName = lowerCaseMappings[key.toLowerCase()];
    
    if (correctFieldName) {
      // Use the correctly cased field name
      validatedData[correctFieldName] = value;
      
      // Track if we had to correct the case
      if (correctFieldName !== key) {
        corrections.push({
          original: key,
          corrected: correctFieldName,
          value
        });
      }
    } else {
      // Track unknown fields
      unknownFields.push(key);
      
      if (!strict) {
        // In non-strict mode, keep unknown fields
        validatedData[key] = value;
      }
    }
  }
  
  // Log corrections if requested
  if (log && corrections.length > 0) {
    corrections.forEach(({ original, corrected }) => {
      logger.warn(`Corrected field name case: ${original} → ${corrected}`);
    });
  }
  
  // In strict mode, throw if there are unknown fields
  if (strict && unknownFields.length > 0) {
    throw new FieldNameError(
      `Unknown field names found: ${unknownFields.join(', ')}`,
      unknownFields[0],
      null,
      { unknownFields }
    );
  }
  
  return validatedData;
}

/**
 * Safe wrapper for field name access
 * @param {string} fieldName - The field name to get
 * @returns {string} - The correctly cased field name
 */
function getFieldName(fieldName) {
  const field = FIELD_NAMES[fieldName];
  if (!field) {
    logger.warn(`Requested unknown field name constant: ${fieldName}`);
    return fieldName; // Return original if not found
  }
  return field;
}

module.exports = {
  FIELD_NAMES,
  STATUS_VALUES,
  validateFieldNames,
  createValidatedObject,
  getFieldName
};