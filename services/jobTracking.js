/**
 * services/jobTracking.js
 * 
 * Unified job tracking service that serves as a single source of truth
 * for all job tracking operations across the system.
 * 
 * This class uses a standardized approach to job IDs, tracking records,
 * and client-specific run records to ensure consistency and prevent
 * duplicate entries.
 * 
 * REFACTORING NOTE: This file has been updated to use the runIdSystem service.
 */

const { createLogger } = require('../utils/contextLogger');
// Old error logger removed - now using Render log analysis
const logCriticalError = async () => {}; // No-op
const { validateString, validateRequiredParams } = require('../utils/simpleValidator');
// Import field validator for consistent field naming
const { FIELD_NAMES, createValidatedObject } = require('../utils/airtableFieldValidator');

// Database access
const airtableClient = require('../config/airtableClient');
const runIdSystem = require('./runIdSystem');

// Import constants - using standardized names only
const { 
  MASTER_TABLES,
  JOB_TRACKING_FIELDS,  // Primary constant for job fields
  CLIENT_RUN_FIELDS,    // Primary constant for client run fields
  CLIENT_RUN_STATUS_VALUES, // Get CLIENT_RUN_STATUS_VALUES from here only
  STATUS_VALUES,        // Deprecated alias - for backward compatibility
  FORMULA_FIELDS
} = require('../constants/airtableUnifiedConstants');

// Table constants - Using simplified constants from unified file
const JOB_TRACKING_TABLE = MASTER_TABLES.JOB_TRACKING;
const CLIENT_RUN_RESULTS_TABLE = MASTER_TABLES.CLIENT_RUN_RESULTS;

// Default logger - using unified factory for consistent creation
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'job_tracking' });

// Using centralized status utility functions for consistent behavior
// This import replaces the local getStatusString function
const { getStatusString, getRawStatusValue } = require('../utils/statusUtils');

// This function has been moved to a static method in the JobTracking class

/**
 * Validate field names against the appropriate constants
 * @param {string} tableName - Table name (e.g., JOB_TRACKING_TABLE, CLIENT_RUN_RESULTS_TABLE)
 * @param {Object} fieldData - Object with field names as keys
 * @returns {boolean} True if all fields are valid, false otherwise
 */
function validateJobTrackingFields(tableName, fieldData) {
  const fieldNames = Object.keys(fieldData);
  
  // Skip validation if no fields
  if (!fieldNames.length) return true;
  
  let validFields;
  let tableDisplayName;
  
  // Determine which field constants to use based on table name
  switch (tableName) {
    case MASTER_TABLES.JOB_TRACKING:
      validFields = Object.values(JOB_TRACKING_FIELDS);
      tableDisplayName = 'Job Tracking';
      break;
    case MASTER_TABLES.CLIENT_RUN_RESULTS:
      validFields = Object.values(CLIENT_RUN_FIELDS);
      tableDisplayName = 'Client Run Results';
      break;
    default:
      logger.warn(`No validation defined for table ${tableName}`);
      return true; // Skip validation for unknown tables
  }
  
  // Add formula fields to valid fields
  const allValidFields = [...validFields, ...FORMULA_FIELDS];
  
  // Check each field name
  const invalidFields = fieldNames.filter(field => !allValidFields.includes(field));
  
  if (invalidFields.length) {
    logger.warn(`Invalid field names for ${tableDisplayName}: ${invalidFields.join(', ')}`);
    return false;
  }
  
  return true;
}

/**
 * JobTracking class - single source of truth for job tracking operations
 */
class JobTracking {
  /**
   * Generate a standardized run ID in YYMMDD-HHMMSS format
   * Delegates to runIdSystem for consistent ID generation
   * @returns {string} A timestamp-based run ID
   */
  static generateRunId() {
    return runIdSystem.generateRunId();
  }

  /**
   * Add client suffix to a base run ID
   * Delegates to runIdSystem for consistent ID formatting
   * @param {string} baseRunId - Base run ID (YYMMDD-HHMMSS)
   * @param {string} clientId - Client ID to add as suffix
   * @returns {string} Run ID with client suffix
   */
  static addClientSuffix(baseRunId, clientId) {
    return runIdSystem.createClientRunId(baseRunId, clientId);
  }
  
  /**
   * Standard method for run ID handling
   * This function ensures all run IDs are consistently formatted when they enter the system
   * Format: YYMMDD-HHMMSS (standard timestamp format)
   * @param {string|Object} runIdInput - Run ID string or object containing a runId property
   * @param {Object} [options={}] - Additional options
   * @param {boolean} [options.enforceStandard=true] - Whether to enforce the standard format
   * @param {boolean} [options.logErrors=true] - Whether to log errors
   * @returns {string|null} Standardized run ID or null if invalid
   */
  static standardizeRunId(runIdInput, options = {}) {
    const { enforceStandard = true, logErrors = true } = options;
    const log = logErrors ? logger : { error: () => {}, warn: () => {}, debug: () => {} };

    try {
      // Handle null/undefined
      if (!runIdInput) {
        log.error('Null or undefined run ID received');
        return null;
      }
      
      // Extract run ID from object if needed
      let runId = runIdInput;
      if (typeof runIdInput === 'object') {
        // Extract from object properties
        if (runIdInput.runId) {
          runId = runIdInput.runId;
        } else if (runIdInput.id) {
          runId = runIdInput.id;
        } else {
          log.error(`Could not extract run ID from object: ${JSON.stringify(runIdInput)}`);
          return null;
        }
      }
      
      // Ensure string format
      if (typeof runId !== 'string') {
        runId = String(runId);
      }
      
      // CRITICAL FIX: Check if run ID contains a client-specific component (format: baseId-clientId)
      // If it does, we should preserve it exactly as is to maintain the client-specific connection
      if (typeof runId === 'string' && runId.match(/^[\w\d]+-[\w\d]+$/)) {
        log.debug(`Run ID contains client-specific component, preserving as-is: ${runId}`);
        return runId;
      }
      
      // For other cases, use the base run ID from the new system
      // This ensures we always work with the standard format
      const baseRunId = runIdSystem.getBaseRunId(runId) || runId;
      
      // Enforce standard if required
      if (enforceStandard && baseRunId !== runId) {
        log.debug(`Run ID standardized: ${runId} → ${baseRunId}`);
      }
      
      return baseRunId;
    } catch (error) {
      log.error(`Error standardizing run ID: ${error.message}`);
      logCriticalError(error, { context: 'Service error (swallowed)', service: 'jobTracking.js' }).catch(() => {});
      return null;
    }
  }

  /**
   * Simple helper to extract string ID from various input types
   * Fixes the "[object Object]" errors in logs
   * @param {*} value - The value to extract an ID from
   * @param {string} [fieldName='id'] - The field name to check if value is an object
   * @returns {string|null} - The extracted ID as a string, or null if no valid ID found
   */
  static extractId(value, fieldName = 'id') {
    if (!value) return null;
    
    // If already a string, return it
    if (typeof value === 'string') return value.trim();
    
    // If object, try to extract ID fields
    if (typeof value === 'object') {
      if (value.runId) return String(value.runId).trim();
      if (value.clientId) return String(value.clientId).trim();
      if (value.id) return String(value.id).trim();
    }
    
    // Fallback to string conversion
    return String(value).trim();
  }

  /**
   * Create a job tracking record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Run ID for the job
   * @param {string} params.jobType - Type of job (e.g., 'scoring', 'post_harvesting')
   * @param {Object} [params.initialData={}] - Initial data for the record
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Created record info
   */
  static async createJob(params) {
    const { runId, jobType = 'job', initialData = {}, options = {} } = params;
    const log = options.logger || logger;
    const source = 'JobTracking.createJob';
    
    if (!runId) {
      log.error(`[${source}] Run ID is required to create job tracking record`);
      throw new Error(`[${source}] Run ID is required to create job tracking record`);
    }
    
    try {
      // Extract ID safely if an object was passed
      const safeRunId = JobTracking.extractId(runId);
      
      // Use runIdSystem for validation
      try {
        // This will throw if validation fails
        runIdSystem.validateRunId(safeRunId);
      } catch (validationError) {
        log.error(`[${source}] Run ID validation failed: ${validationError.message}`);
        await logCriticalError(validationError, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
        throw validationError;
      }
      
      // Get the base run ID to ensure standard format
      const standardRunId = runIdSystem.getBaseRunId(safeRunId) || safeRunId;
      
      // Validate the standardized run ID
      if (!standardRunId) {
        log.error(`[${source}] Failed to standardize run ID: ${safeRunId}`);
        throw new Error(`[${source}] Failed to standardize run ID: ${safeRunId}`);
      }
      
      log.debug(`[${source}] Creating job with standardized run ID: ${standardRunId}`);
      
      // Get the master base
      const masterBase = airtableClient.getMasterClientsBase();
      
      // DIAGNOSTIC: Log table name before Airtable call
      logger.debug(`JOB_TRACKING_TABLE value: "${JOB_TRACKING_TABLE}"`);
      logger.debug(`typeof JOB_TRACKING_TABLE: ${typeof JOB_TRACKING_TABLE}`);
      logger.debug(`MASTER_TABLES.JOB_TRACKING value: "${MASTER_TABLES.JOB_TRACKING}"`);
      
      if (!JOB_TRACKING_TABLE || JOB_TRACKING_TABLE === 'undefined') {
        const errorMsg = `CRITICAL: JOB_TRACKING_TABLE is ${JOB_TRACKING_TABLE} (should be "Job Tracking")`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      // Only check for the standardized run ID to prevent duplicates
      const formula = `{${JOB_TRACKING_FIELDS.RUN_ID}} = '${standardRunId}'`;
      
      const existingRecords = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      if (existingRecords && existingRecords.length > 0) {
        log.warn(`Job tracking record already exists for standardized run ID ${standardRunId}. Not creating duplicate.`);
        return {
          id: existingRecords[0].id,
          runId: standardRunId, // Return the standardized ID
          alreadyExists: true
        };
      }
      
      // Default values
      const startTime = new Date().toISOString();
      
      // Prepare record data using constants - improves maintainability
      const recordData = {
        [JOB_TRACKING_FIELDS.RUN_ID]: standardRunId, // Always use standardized ID
        [JOB_TRACKING_FIELDS.STATUS]: CLIENT_RUN_STATUS_VALUES.RUNNING,
        [JOB_TRACKING_FIELDS.START_TIME]: startTime,
        // Use proper field name from constants - ensure it exists in Airtable
        [JOB_TRACKING_FIELDS.SYSTEM_NOTES]: initialData[JOB_TRACKING_FIELDS.SYSTEM_NOTES] || ''
      };
      
      // Add any other data from initialData with formula field validation
      for (const [key, value] of Object.entries(initialData)) {
        if (FORMULA_FIELDS.includes(key)) {
          // Skip formula fields to prevent errors
          log.warn(`Skipping formula field "${key}" which cannot be directly updated`);
          continue;
        }
        
        // Only add if not already set and has a value
        if (!recordData[key] && value !== undefined && value !== null) {
          recordData[key] = value;
        }
      }
      
      // Validate field names before sending to Airtable
      validateJobTrackingFields(JOB_TRACKING_TABLE, recordData);
      
      // DIAGNOSTIC: Log right before create call
      logger.debug(`About to create job tracking record`);
      logger.debug(`Table name: "${JOB_TRACKING_TABLE}"`);
      logger.debug(`Record data keys:`, { keys: Object.keys(recordData) });
      
      // Create the record
      const record = await masterBase(JOB_TRACKING_TABLE).create(recordData);
      
      log.debug(`Created job tracking record for ${runId}`);
      
      return {
        id: record.id,
        runId,
        startTime
      };
    } catch (error) {
      log.error(`Error creating job tracking record: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
      throw error;
    }
  }

  /**
   * Update a job tracking record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Run ID to update
   * @param {Object} params.updates - Updates to apply
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Updated record info
   */
  static async updateJob(params) {
    const { runId, updates = {}, options = {} } = params;
    const log = options.logger || logger;
    const source = 'JobTracking.updateJob';
    
    if (!runId) {
      log.error("Run ID is required to update job tracking record");
      throw new Error("Run ID is required to update job tracking record");
    }
    
    try {
      // Extract ID safely if an object was passed
      const safeRunId = JobTracking.extractId(runId);
      
      // CRITICAL FIX: Use the SAME validation/standardization method as in createJob
      // This ensures consistency between job creation and updates
      try {
        // This will throw if validation fails
        runIdSystem.validateRunId(safeRunId);
      } catch (validationError) {
        log.error(`[${source}] Run ID validation failed: ${validationError.message}`);
        await logCriticalError(validationError, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
        throw validationError;
      }
      
      // Use validateAndStandardizeRunId for consistent run ID format
      const standardRunId = runIdSystem.validateAndStandardizeRunId(safeRunId);
      
      // This should never happen in strict mode (would throw instead), but as extra protection:
      if (!standardRunId) {
        log.error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
        throw new Error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
      }
      
      log.debug(`Updating job with standardized run ID: ${standardRunId}`);
      
      // Get the master base
      const masterBase = airtableClient.getMasterClientsBase();
      
      // Only check for the standardized run ID
      const formula = `{${JOB_TRACKING_FIELDS.RUN_ID}} = '${standardRunId}'`;
      
      const records = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        log.error(`Job tracking record not found for standardized run ID: ${standardRunId}`);
        throw new Error(`Job tracking record not found for standardized run ID: ${standardRunId}`);
      }
      
      const record = records[0];
      
      // ROOT CAUSE FIX: Use field validator to normalize field names BEFORE building updates
      // This prevents lowercase field names (status, endTime) from being passed through
      const { createValidatedObject } = require('../utils/airtableFieldValidator');
      const normalizedUpdates = createValidatedObject(updates, { log: false });
      
      // Prepare update fields - only use fields that exist
      const updateFields = {};
      
      // CRITICAL: Handle status update with special logic - always use constants for field names
      // Now using normalized field names from validator
      const statusValue = JOB_TRACKING_FIELDS.STATUS in normalizedUpdates ? normalizedUpdates[JOB_TRACKING_FIELDS.STATUS] : null;
      if (statusValue !== null) {
        updateFields[JOB_TRACKING_FIELDS.STATUS] = statusValue;
        
        // Always validate status values are uppercase and match constants
        const safeStatusValue = getStatusString(statusValue);
        log.debug(`Status update ${statusValue} -> ${safeStatusValue}`);
        
        // If status is transitioning to a completed state, set end time if not provided
        const isCompletedState = ['completed', 'failed', 'completed with errors', 'no leads to score'].includes(safeStatusValue);
        const hasEndTime = JOB_TRACKING_FIELDS.END_TIME in normalizedUpdates;
        if (isCompletedState && !hasEndTime) {
          const endTime = new Date().toISOString();
          updateFields[JOB_TRACKING_FIELDS.END_TIME] = endTime;
          log.debug(`Auto-setting end time to ${endTime}`);
        }
      }
      if ('error' in normalizedUpdates) updateFields[JOB_TRACKING_FIELDS.ERROR] = normalizedUpdates.error;
      // Progress and LastClient fields removed to simplify codebase
      
      // Handle System Notes field properly
      if (normalizedUpdates[JOB_TRACKING_FIELDS.SYSTEM_NOTES]) {
        updateFields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = normalizedUpdates[JOB_TRACKING_FIELDS.SYSTEM_NOTES];
      } else if (normalizedUpdates.notes) {
        updateFields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = normalizedUpdates.notes;
      }
      
      // Process each update field with formula field validation
      for (const [key, value] of Object.entries(normalizedUpdates)) {
        // Skip fields we've already processed
        if (updateFields[key] !== undefined) continue;
        
        // Skip null/undefined values
        if (value === null || value === undefined) continue;
        
        // Skip formula fields to prevent errors
        if (FORMULA_FIELDS.includes(key)) {
          log.warn(`Skipping formula field "${key}" which cannot be directly updated`);
          continue;
        }
        
        // Add all other fields (will be validated by Airtable)
        updateFields[key] = value;
      }
      
      // Validate field names before sending to Airtable
      validateJobTrackingFields(JOB_TRACKING_TABLE, updateFields);
      
      // Update the record
      await masterBase(JOB_TRACKING_TABLE).update(record.id, updateFields);
      
      log.debug(`Updated job tracking record for ${runId}`);
      
      return {
        id: record.id,
        runId,
        ...updates
      };
    } catch (error) {
      log.error(`Error updating job tracking record: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
      throw error;
    }
  }

  /**
   * Create a client-specific run record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Base run ID
   * @param {string} params.clientId - Client ID
   * @param {Object} [params.initialData={}] - Initial data
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Created record info
   */
  static async createClientRun(params) {
    const { runId, clientId, initialData = {}, options = {} } = params;
    const log = options.logger || logger;
    const source = 'JobTracking.createClientRun';
    
    if (!runId || !clientId) {
      log.error("Run ID and Client ID are required to create client run record");
      throw new Error("Run ID and Client ID are required to create client run record");
    }
    
    try {
      // Extract ID safely if an object was passed
      const safeRunId = JobTracking.extractId(runId);
      
      // CRITICAL FIX: Use the SAME validation/standardization method as in createJob
      // This ensures consistency between job creation and client run creation
      try {
        // This will throw if validation fails
        runIdSystem.validateRunId(safeRunId);
      } catch (validationError) {
        log.error(`[${source}] Run ID validation failed: ${validationError.message}`);
        await logCriticalError(validationError, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
        throw validationError;
      }
      
      // Use validateAndStandardizeRunId for consistent run ID format
      const standardRunId = runIdSystem.validateAndStandardizeRunId(safeRunId);
      
      // This should never happen in strict mode (would throw instead), but as extra protection:
      if (!standardRunId) {
        log.error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
        throw new Error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
      }
      
      log.debug(`Creating client run with standardized run ID: ${standardRunId}`);
      
      // Create client-specific run ID with standard format
      const clientRunId = JobTracking.addClientSuffix(standardRunId, clientId);
      
      if (!clientRunId) {
        log.error(`Failed to create client run ID for ${standardRunId} and ${clientId}`);
        throw new Error(`Failed to create client run ID for ${standardRunId} and ${clientId}`);
      }
      
      log.debug(`Using standardized client run ID: ${clientRunId}`);
      
      // Get the master base
      const masterBase = airtableClient.getMasterClientsBase();
      
      // Search by BOTH Run ID AND Client ID to find the correct record
      const formula = `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${clientRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientId}')`;
      
      const existingRecords = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      if (existingRecords && existingRecords.length > 0) {
        log.warn(`Client run record already exists for standardized client run ID: ${clientRunId}. Not creating duplicate.`);
        return {
          id: existingRecords[0].id,
          runId: clientRunId,
          baseRunId: standardRunId,
          clientId,
          alreadyExists: true
        };
      }
      
      // Default values
      const startTime = new Date().toISOString();
      
      // Prepare record data using constants
      const recordData = {
        [CLIENT_RUN_FIELDS.RUN_ID]: clientRunId,
        [CLIENT_RUN_FIELDS.CLIENT_ID]: clientId,
        [CLIENT_RUN_FIELDS.STATUS]: CLIENT_RUN_STATUS_VALUES.RUNNING,
        [CLIENT_RUN_FIELDS.START_TIME]: startTime,
        [CLIENT_RUN_FIELDS.SYSTEM_NOTES]: initialData[CLIENT_RUN_FIELDS.SYSTEM_NOTES] || ''
      };
      
      // Add other verified fields using constants
      if (initialData[CLIENT_RUN_FIELDS.APIFY_RUN_ID]) {
        recordData[CLIENT_RUN_FIELDS.APIFY_RUN_ID] = initialData[CLIENT_RUN_FIELDS.APIFY_RUN_ID];
      }
      
      // Validate field names before sending to Airtable
      validateJobTrackingFields(CLIENT_RUN_RESULTS_TABLE, recordData);
      
      // Create the record
      const record = await masterBase(CLIENT_RUN_RESULTS_TABLE).create(recordData);
      
      log.debug(`Created client run record for ${clientRunId}`);
      
      return {
        id: record.id,
        runId: clientRunId,
        baseRunId: standardRunId,
        clientId,
        startTime
      };
    } catch (error) {
      log.error(`Error creating client run record: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
      throw error;
    }
  }

  /**
   * Update a client-specific run record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Base run ID
   * @param {string} params.clientId - Client ID
   * @param {Object} params.updates - Updates to apply
   * @param {boolean} [params.createIfMissing=false] - Whether to create the record if it doesn't exist
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Updated record info
   */
  static async updateClientRun(params) {
    // Simple parameter validation
    if (!params || typeof params !== 'object') {
      throw new Error("updateClientRun: Missing parameters object");
    }
    
    const { runId, clientId, updates = {}, options = {} } = params;
    
    // Use the simple extractId helper to handle objects
    const safeRunId = JobTracking.extractId(runId);
    const safeClientId = JobTracking.extractId(clientId);
    
    if (!safeRunId || !safeClientId) {
      throw new Error("Run ID and Client ID are required to update client run record");
    }
    
    // Use existing logger or create a new one with unified factory
    const log = options.logger || createLogger({ runId: safeRunId, clientId: safeClientId, operation: 'job_tracking' });
    const source = options.source || 'JobTracking.updateClientRun';
    
    try {
      // CRITICAL FIX: Use the SAME validation/standardization method as in createJob
      try {
        // This will throw if validation fails
        runIdSystem.validateRunId(safeRunId);
      } catch (validationError) {
        log.error(`[${source}] Run ID validation failed: ${validationError.message}`);
    logCriticalError(validationError, { operation: 'unknown' }).catch(() => {});
        return {
          success: false,
          error: validationError.message
        };
      }
      
      // Use validateAndStandardizeRunId for consistent run ID format
      const standardRunId = runIdSystem.validateAndStandardizeRunId(safeRunId);
      
      // This should never happen in strict mode (would throw instead), but as extra protection:
      if (!standardRunId) {
        log.error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
        return {
          success: false,
          error: 'invalid_run_id',
          message: `Invalid run ID format: ${safeRunId}`
        };
      }
      
      // CRITICAL: In orchestrated runs, the runId passed here is ALREADY the complete 
      // client run ID (e.g., "251007-041822-Guy-Wilson") created by the orchestrator.
      // We use it EXACTLY as-is with NO reconstruction or suffix manipulation.
      const clientRunId = standardRunId;
      
      log.debug(`Using client run ID exactly as passed: ${clientRunId}`);
      
      if (!clientRunId) {
        log.error(`Failed to create client run ID for ${standardRunId} and ${safeClientId}`);
        return {
          success: false,
          error: 'client_run_id_creation_failed',
          message: `Failed to create client run ID for ${standardRunId} and ${safeClientId}`
        };
      }
      
      log.debug(`Updating client run with standardized ID: ${clientRunId}`);
      
      // Get the master base
      const masterBase = airtableClient.getMasterClientsBase();
      
      // Search by BOTH Run ID AND Client ID to find the correct record
      const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${clientRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientId}')`,
        maxRecords: 1
      }).firstPage();
      
      // CRITICAL FIX: Never create records in update paths
      // Removed the createIfMissing option entirely to enforce the pattern
      if (!records || records.length === 0) {
        // Record not found - log error but don't throw to prevent breaking flows
        log.error(`Client run record not found for ${clientRunId} - cannot update non-existent record`);
        return {
          success: false,
          error: 'record_not_found',
          runId: clientRunId,
          clientId,
          message: `Run record not found for ${clientRunId}`
        };
      }
      
      const record = records[0];
      
      // ROOT CAUSE FIX: Use field validator to normalize field names BEFORE building updates
      // This prevents field name mismatches in Client Run Results updates
      const { createValidatedObject } = require('../utils/airtableFieldValidator');
      const normalizedUpdates = createValidatedObject(updates, { log: false });
      
      // Prepare update fields using constants
      const updateFields = {};
      
      // Use the globally defined list of formula fields
      
      // CRITICAL: Handle status update with special logic - always use constants for field names
      // Now using normalized field names from validator
      const statusValue = CLIENT_RUN_FIELDS.STATUS in normalizedUpdates ? normalizedUpdates[CLIENT_RUN_FIELDS.STATUS] : null;
      if (statusValue !== null) {
        updateFields[CLIENT_RUN_FIELDS.STATUS] = statusValue;
        
        // Always validate status values are uppercase and match constants
        const safeStatusValue = getStatusString(statusValue);
        log.debug(`Status update ${statusValue} -> ${safeStatusValue}`);
        
        // If status is transitioning to a completed state, set end time if not provided
        const isCompletedState = ['completed', 'failed', 'completed with errors', 'no leads to score'].includes(safeStatusValue);
        const hasEndTime = CLIENT_RUN_FIELDS.END_TIME in normalizedUpdates;
        if (isCompletedState && !hasEndTime) {
          const endTime = new Date().toISOString();
          updateFields[CLIENT_RUN_FIELDS.END_TIME] = endTime;
          log.debug(`Auto-setting end time to ${endTime}`);
        }
      }
      if ('leadsProcessed' in normalizedUpdates) updateFields[CLIENT_RUN_FIELDS.LEADS_PROCESSED] = normalizedUpdates.leadsProcessed;
      if ('postsProcessed' in normalizedUpdates) updateFields[CLIENT_RUN_FIELDS.POSTS_PROCESSED] = normalizedUpdates.postsProcessed;
      if ('errors' in normalizedUpdates) updateFields[CLIENT_RUN_FIELDS.ERROR_DETAILS] = normalizedUpdates.errors;
      
      // Handle System Notes properly using constants
      if (normalizedUpdates[CLIENT_RUN_FIELDS.SYSTEM_NOTES]) {
        updateFields[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = normalizedUpdates[CLIENT_RUN_FIELDS.SYSTEM_NOTES];
      } else if (normalizedUpdates.notes) {
        updateFields[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = normalizedUpdates.notes;
      }
      
      // Add token usage fields using constants
      if (normalizedUpdates.tokenUsage) updateFields[CLIENT_RUN_FIELDS.TOKEN_USAGE] = normalizedUpdates.tokenUsage;
      if (normalizedUpdates.promptTokens) updateFields[CLIENT_RUN_FIELDS.PROMPT_TOKENS] = normalizedUpdates.promptTokens;
      if (normalizedUpdates.completionTokens) updateFields[CLIENT_RUN_FIELDS.COMPLETION_TOKENS] = normalizedUpdates.completionTokens;
      if (normalizedUpdates.totalTokens) updateFields[CLIENT_RUN_FIELDS.TOTAL_TOKENS] = normalizedUpdates.totalTokens;
      
      // Add API costs using constants
      if (normalizedUpdates[CLIENT_RUN_FIELDS.APIFY_API_COSTS]) {
        updateFields[CLIENT_RUN_FIELDS.APIFY_API_COSTS] = normalizedUpdates[CLIENT_RUN_FIELDS.APIFY_API_COSTS];
      };
      
      // Process all other direct field mappings, filtering out formula fields
      
      // Add all remaining fields that aren't already processed and aren't formula fields
      Object.keys(normalizedUpdates).forEach(key => {
        if (normalizedUpdates[key] !== undefined &&
            !updateFields.hasOwnProperty(key) &&
            !FORMULA_FIELDS.includes(key)) {
          updateFields[key] = normalizedUpdates[key];
        }
      });
      
      // Validate field names before sending to Airtable
      validateJobTrackingFields(CLIENT_RUN_RESULTS_TABLE, updateFields);
      
      // Update the record
      await masterBase(CLIENT_RUN_RESULTS_TABLE).update(record.id, updateFields);
      
      log.debug(`Updated client run record for ${clientRunId}`);
      
      return {
        id: record.id,
        runId: clientRunId,
        baseRunId: safeRunId,
        clientId: safeClientId,
        ...updates
      };
    } catch (error) {
      log.error(`Error updating client run record: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
      throw error;
    }
  }

  /**
   * Complete a job tracking record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Run ID to complete
   * @param {string} [params.status='Completed'] - Final status
   * @param {Object} [params.updates={}] - Additional updates
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Completed record info
   */
  static async completeJob(params) {
    const { runId, status = 'Completed', updates = {}, options = {} } = params;
    
    // Add completion details to updates
    const completeUpdates = {
      ...updates,
      status,
      [JOB_TRACKING_FIELDS.END_TIME]: updates[JOB_TRACKING_FIELDS.END_TIME] || new Date().toISOString()
    };
    
    // Update the record with completion details
    return await JobTracking.updateJob({
      runId,
      updates: completeUpdates,
      options
    });
  }

  /**
   * Complete a client run record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Base run ID
   * @param {string} params.clientId - Client ID
   * @param {string} [params.status='Completed'] - Final status
   * @param {Object} [params.updates={}] - Additional updates
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Completed record info
   */
  static async completeClientRun(params) {
    const { runId, clientId, status = 'Completed', updates = {}, options = {} } = params;
    
    // Add completion details to updates - use proper field constants
    const completeUpdates = {
      ...updates,
      [CLIENT_RUN_FIELDS.STATUS]: status, // Using proper constant for Status field
      [CLIENT_RUN_FIELDS.END_TIME]: updates[CLIENT_RUN_FIELDS.END_TIME] || new Date().toISOString()
    };
    
    // Update the record with completion details
    return await JobTracking.updateClientRun({
      runId,
      clientId,
      updates: completeUpdates,
      options
    });
  }

  /**
   * Get job tracking record by run ID
   * @param {string|Object} runId - Run ID to find or object containing runId property
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object|null>} Job tracking record or null if not found
   */
  static async getJobById(runId, options = {}) {
    const log = options.logger || logger;
    const source = 'JobTracking.getJobById';
    
    try {
      // Extract ID safely if an object was passed
      const safeRunId = JobTracking.extractId(runId);
      
      // Use runIdSystem for validation and standardization
      try {
        // This will throw if validation fails
        runIdSystem.validateRunId(safeRunId);
      } catch (validationError) {
        log.error(`[${source}] Run ID validation failed: ${validationError.message}`);
        await logCriticalError(validationError, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
        throw validationError;
      }
      
      // Use validateAndStandardizeRunId for consistent run ID format
      const standardRunId = runIdSystem.validateAndStandardizeRunId(safeRunId);
      
      // This should never happen in strict mode (would throw instead), but as extra protection:
      if (!standardRunId) {
        log.error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
        throw new Error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
      }
      
      const masterBase = airtableClient.getMasterClientsBase();
      
      // Use only the standardized run ID with constant for field name
      const formula = `{${JOB_TRACKING_FIELDS.RUN_ID}} = '${standardRunId}'`;
      
      log.debug(`[${source}] Looking up job record with standardized run ID: ${standardRunId}`);
      
      const records = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        // Enhanced diagnostic logging for the "record not found" case
        const errorDetails = {
          originalRunId: safeRunId !== standardRunId ? safeRunId : undefined,
          standardizedRunId: standardRunId, 
          wasNormalized: safeRunId !== standardRunId,
          searchFormula: formula,
          table: JOB_TRACKING_TABLE,
          timestamp: new Date().toISOString(),
          source: source,
          stack: new Error().stack
        };
        
        log.error(`[${source}] Job tracking record not found`, errorDetails);
        
        // Throw an error in strict mode instead of silently returning null
        throw new Error(`[${source}] Job tracking record not found for run ID: ${standardRunId}`);
        
        // For debugging purposes - log recent records to help troubleshoot
        try {
          const recentRecords = await masterBase(JOB_TRACKING_TABLE).select({
            maxRecords: 5,
            sort: [{field: JOB_TRACKING_FIELDS.START_TIME, direction: 'desc'}]
          }).firstPage();
          
          if (recentRecords && recentRecords.length > 0) {
            const recentIds = recentRecords.map(r => ({
              id: r.id,
              runId: r.fields[JOB_TRACKING_FIELDS.RUN_ID],
              startTime: r.fields[JOB_TRACKING_FIELDS.START_TIME]
            }));
            log.debug(`Recent job tracking records for comparison:`, {recentIds});
          }
        } catch (lookupError) {
          log.error(`Failed to look up recent records: ${lookupError.message}`);
          await logCriticalError(lookupError, { context: 'Service error (swallowed)', service: 'jobTracking.js' }).catch(() => {});
        }
        
        return null;
      }
      
      log.debug(`Found job tracking record for run ID: ${standardRunId}`);
      return records[0];
    } catch (error) {
      log.error(`Error getting job by ID: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (swallowed)', service: 'jobTracking.js' }).catch(() => {});
      return null;
    }
  }

  /**
   * Get client run record by client run ID
   * @param {string|Object} runId - Base run ID or object containing runId property
   * @param {string|Object} clientId - Client ID or object containing clientId property
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object|null>} Client run record or null if not found
   */
  static async getClientRun(runId, clientId, options = {}) {
    try {
      // Use the simple extractId helper to handle objects
      const safeRunId = JobTracking.extractId(runId);
      const safeClientId = JobTracking.extractId(clientId);
      
      if (!safeRunId || !safeClientId) {
        logger.error("Run ID and Client ID are required to get client run record");
        return null;
      }
      
      // Use existing logger or default
      const log = options.logger || logger;
      const source = 'JobTracking.getClientRun';
      
      // CRITICAL FIX: Use the SAME validation/standardization method as in createJob
      let standardRunId;
      try {
        // This will throw if validation fails
        runIdSystem.validateRunId(safeRunId);
        standardRunId = runIdSystem.validateAndStandardizeRunId(safeRunId);
      } catch (validationError) {
        log.error(`[${source}] Run ID validation failed: ${validationError.message}`);
        await logCriticalError(validationError, { context: 'Service error (swallowed)', service: 'jobTracking.js' }).catch(() => {});
        return null;
      }
      
      // This should never happen in strict mode (would throw instead), but as extra protection:
      if (!standardRunId) {
        log.error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
        return null;
      }
      
      // PURE CONSUMER ARCHITECTURE: In orchestrated runs, the runId passed here is ALREADY 
      // the complete client run ID (e.g., "251007-070457-Guy-Wilson") created by createClientRun().
      // We use it EXACTLY as-is with NO reconstruction or suffix manipulation.
      // This matches the pattern used in updateClientRun() (line 638-645).
      const clientRunId = standardRunId;
      
      log.debug(`Using client run ID exactly as passed: ${clientRunId}`);
      
      const masterBase = airtableClient.getMasterClientsBase();
      
      // Search by BOTH Run ID AND Client ID to find the correct record
      const formula = `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${clientRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${safeClientId}')`;
      
      log.debug(`Looking up client run record with standardized ID: ${clientRunId}`);
      
      const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        log.debug(`Client run record not found for standardized client run ID: ${clientRunId}`);
        return null;
      }
      
      log.debug(`Found client run record for standardized client run ID: ${clientRunId}`);
      return records[0];
    } catch (error) {
      logger.error(`Error getting client run: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (swallowed)', service: 'jobTracking.js' }).catch(() => {});
      return null;
    }
  }
  
  /**
   * Update client metrics for a run record without affecting End Time or Status
   * @param {Object} params - Parameters object
   * @param {string} params.runId - Run ID
   * @param {string} params.clientId - Client ID
   * @param {Object} params.metrics - Metrics to update
   * @param {Object} [params.options] - Additional options
   * @returns {Promise<Object>} Updated record info
   */
  static async updateClientMetrics(params) {
    // Simple parameter validation
    if (!params || typeof params !== 'object') {
      throw new Error("updateClientMetrics: Missing parameters object");
    }
    
    const { runId, clientId, metrics = {}, options = {} } = params;
    
    // Use the simple extractId helper to handle objects
    const safeRunId = JobTracking.extractId(runId);
    const safeClientId = JobTracking.extractId(clientId);
    
    if (!safeRunId || !safeClientId) {
      throw new Error("Run ID and Client ID are required to update client metrics");
    }
    
    // Use existing logger or create a new one with unified factory
    const log = options.logger || createLogger({ runId: safeRunId, clientId: safeClientId, operation: 'job_tracking' });
    const source = options.source || 'unknown';
    
    // Simple existence check with validated parameters
    const recordExists = await JobTracking.checkClientRunExists({
      runId: safeRunId,
      clientId: safeClientId,
      options: {
        logger: log,
        source: `${source}_metrics_existence_check`
      }
    });    if (!recordExists) {
      log.error(`[RECORD_NOT_FOUND] Client run record does not exist for ${safeRunId}/${safeClientId}. Cannot update metrics.`);
      return {
        success: false,
        error: 'record_not_found',
        message: `No run record found for ${safeClientId} with run ID ${safeRunId}`,
        source,
        runId: safeRunId,
        clientId: safeClientId
      };
    }
    
    try {
      // Make a copy of metrics to ensure we don't modify End Time, Status, or formula fields
      const filteredMetrics = { ...metrics };
      delete filteredMetrics[CLIENT_RUN_FIELDS.END_TIME];
      delete filteredMetrics[CLIENT_RUN_FIELDS.STATUS];
      
      // Also filter out any formula fields
      FORMULA_FIELDS.forEach(field => {
        delete filteredMetrics[field];
      });
      
      // Log the metrics update
      log.debug(`Updating metrics for client ${safeClientId} with run ID ${safeRunId}`, { metrics: filteredMetrics });
      
      // Use the standard updateClientRun method but with filtered metrics
      return await JobTracking.updateClientRun({
        runId: safeRunId,
        clientId: safeClientId,
        updates: {
          ...filteredMetrics
        },
        options: {
          ...options,
          logger: log // Pass existing logger to prevent new logger creation
        }
      });
    } catch (error) {
      log.error(`Error updating client metrics: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
      throw error;
    }
  }
  
  /**
   * Complete all processing for a client (after lead scoring, post harvesting, and post scoring)
   * @param {Object} params - Parameters object
   * @param {string} params.runId - Run ID
   * @param {string} params.clientId - Client ID
   * @param {Object} params.finalMetrics - Final metrics from all processes
   * @param {Object} [params.options] - Additional options including isStandalone flag
   * @returns {Promise<Object>} Updated record info
   */
  /**
   * Check if a client run record exists
   * @param {Object} params - Parameters
   * @param {string} params.runId - Run ID
   * @param {string} params.clientId - Client ID
   * @param {Object} [params.options={}] - Options
   * @returns {Promise<boolean>} True if record exists
   */
  static async checkClientRunExists(params) {
    // Simple parameter validation
    if (!params || typeof params !== 'object') {
      logger.error("checkClientRunExists: Missing parameters object");
      return false;
    }
    
    const { runId, clientId, options = {} } = params;
    
    // Use the simple extractId helper to handle objects
    const safeRunId = JobTracking.extractId(runId);
    const safeClientId = JobTracking.extractId(clientId);
    
    if (!safeRunId || !safeClientId) {
      logger.error("Run ID and Client ID are required to check if client run record exists");
      return false;
    }
    
    // Use existing logger or default
    const log = options.logger || logger;
    const source = 'JobTracking.checkClientRunExists';
    
    try {
      // CRITICAL FIX: Use the SAME validation/standardization method as in createJob
      let standardRunId;
      try {
        // This will throw if validation fails
        runIdSystem.validateRunId(safeRunId);
        standardRunId = runIdSystem.validateAndStandardizeRunId(safeRunId);
      } catch (validationError) {
        log.error(`[${source}] Run ID validation failed: ${validationError.message}`);
        await logCriticalError(validationError, { context: 'Service error (swallowed)', service: 'jobTracking.js' }).catch(() => {});
        return false;
      }
      
      // This should never happen in strict mode (would throw instead), but as extra protection:
      if (!standardRunId) {
        log.error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
        return false;
      }
      
      // PURE CONSUMER ARCHITECTURE: In orchestrated runs, the runId passed here is ALREADY 
      // the complete client run ID (e.g., "251007-070457-Guy-Wilson") created by createClientRun().
      // We use it EXACTLY as-is with NO reconstruction or suffix manipulation.
      // This matches the pattern used in updateClientRun() (line 638-645).
      const clientRunId = standardRunId;
      
      log.debug(`Using client run ID exactly as passed: ${clientRunId}`);
      
      // Get the master base
      const masterBase = airtableClient.getMasterClientsBase();
      
      // Search by BOTH Run ID AND Client ID to find the correct record
      const formula = `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${clientRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${safeClientId}')`;
      
      const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      const exists = !!(records && records.length > 0);
      if (!exists) {
        log.debug(`Client run record not found for standardized client run ID ${clientRunId}`);
      } else {
        log.debug(`Found client run record for standardized client run ID ${clientRunId}`);
      }
      
      return exists;
    } catch (error) {
      log.error(`Error checking client run record existence: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (swallowed)', service: 'jobTracking.js' }).catch(() => {});
      return false;
    }
  }

  /**
   * Update aggregate metrics for a job tracking record
   * @param {Object} params - Parameters
   * @param {string} params.runId - Run ID for the job
   * @param {Object} params.metrics - Metrics to update/aggregate
   * @param {Object} [params.options={}] - Additional options
   * @returns {Promise<Object>} Updated record info
   */
  static async updateAggregateMetrics(params) {
    const { runId, metrics = {}, options = {} } = params;
    const log = options.logger || logger;
    const source = 'JobTracking.updateAggregateMetrics';
    
    if (!runId) {
      log.error(`[${source}] Run ID is required to update aggregate metrics`);
      throw new Error(`[${source}] Run ID is required to update aggregate metrics`);
    }
    
    try {
      // Extract ID safely if an object was passed
      const safeRunId = JobTracking.extractId(runId);
      
      // Use runIdSystem for validation and standardization
      try {
        // This will throw if validation fails
        runIdSystem.validateRunId(safeRunId);
      } catch (validationError) {
        log.error(`[${source}] Run ID validation failed: ${validationError.message}`);
        await logCriticalError(validationError, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
        throw validationError;
      }
      
      // Use validateAndStandardizeRunId for consistent run ID format
      const standardRunId = runIdSystem.validateAndStandardizeRunId(safeRunId);
      
      // This should never happen in strict mode (would throw instead), but as extra protection:
      if (!standardRunId) {
        log.error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
        throw new Error(`[${source}] Failed to normalize run ID: ${safeRunId}`);
      }
      
      // Get the job record directly using our already-enhanced getJobById method
      // which has proper error handling and diagnostics
      // Get the job record using our enhanced getJobById method
      const jobRecord = await JobTracking.getJobById(standardRunId, { logger: log });
      
      // Get record fields safely
      const currentFields = jobRecord.fields || {};
      
      // Prepare update fields for aggregation
      const updateFields = {};
      
      // Numerical fields to aggregate (add to existing values)
      const numericFields = [
        // Using constants from JOB_TRACKING_FIELDS to ensure consistency
        JOB_TRACKING_FIELDS.CLIENTS_PROCESSED,
        JOB_TRACKING_FIELDS.CLIENTS_SUCCEEDED,
        JOB_TRACKING_FIELDS.CLIENTS_FAILED,
        JOB_TRACKING_FIELDS.PROFILES_PROCESSED, 
        JOB_TRACKING_FIELDS.PROFILES_SCORED, 
        JOB_TRACKING_FIELDS.POSTS_PROCESSED, 
        JOB_TRACKING_FIELDS.POSTS_SCORED, 
        JOB_TRACKING_FIELDS.ERRORS, 
        JOB_TRACKING_FIELDS.TOTAL_TOKENS, 
        JOB_TRACKING_FIELDS.PROMPT_TOKENS, 
        JOB_TRACKING_FIELDS.COMPLETION_TOKENS, 
        JOB_TRACKING_FIELDS.TOTAL_POSTS_HARVESTED
      ];
      
      // Process each numeric metric for aggregation
      numericFields.forEach(field => {
        if (metrics[field] !== undefined) {
          // Get current value, default to 0 if not present
          const currentValue = currentFields[field] || 0;
          // Add new value (ensure numeric conversion)
          const newValue = currentValue + Number(metrics[field]);
          updateFields[field] = newValue;
        }
      });
      
      // Non-numeric fields to update (replace existing values)
      // Progress and LastClient fields removed to simplify codebase
      
      // Handle System Notes field - append rather than replace
      if (metrics.notes || metrics[JOB_TRACKING_FIELDS.SYSTEM_NOTES]) {
        const newNote = metrics.notes || metrics[JOB_TRACKING_FIELDS.SYSTEM_NOTES];
        const currentNotes = currentFields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] || '';
        
        if (newNote) {
          // Append the new note to existing notes
          updateFields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = currentNotes 
            ? `${currentNotes}\n${newNote}` 
            : newNote;
        }
      }
      
      // Skip formula fields to prevent errors
      Object.keys(metrics).forEach(key => {
        if (metrics[key] !== undefined && 
            !updateFields.hasOwnProperty(key) && 
            !FORMULA_FIELDS.includes(key) &&
            !numericFields.includes(key)) {
          updateFields[key] = metrics[key];
        }
      });
      
      // Only update if we have fields to update
      if (Object.keys(updateFields).length > 0) {
        // Update the record
        await masterBase(JOB_TRACKING_TABLE).update(jobRecord.id, updateFields);
        log.debug(`[${source}] Updated aggregate metrics for ${standardRunId}`, { updateFields });
      } else {
        log.debug(`[${source}] No metrics to update for ${standardRunId}`);
      }
      
      return {
        id: jobRecord.id,
        runId: standardRunId,
        updated: Object.keys(updateFields)
      };
    } catch (error) {
      log.error(`Error updating aggregate metrics: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
      throw error;
    }
  }

  static async completeClientProcessing(params) {
    // Simple parameter handling - no complex validation
    if (!params || typeof params !== 'object') {
      throw new Error("completeClientProcessing: Missing parameters object");
    }
    
    const { runId, clientId, finalMetrics = {}, options = {} } = params;
    
    // FIXED: Use the simple extractId helper that's already defined in the class
    const safeRunId = JobTracking.extractId(runId);
    const safeClientId = JobTracking.extractId(clientId);
    
    if (!safeRunId || !safeClientId) {
      throw new Error("Run ID and Client ID are required to complete client processing");
    }
      
    // Override the original parameters with safe versions
    params.runId = safeRunId;
    params.clientId = safeClientId;
    
    // Use existing logger or create a new one with unified factory
    const log = options.logger || createLogger({ runId: safeRunId, clientId: safeClientId, operation: 'job_tracking' });
    
    const isStandalone = options.isStandalone === true;
    const source = options.source || 'unknown';
    
    // Simple existence check with validated parameters
    const recordExists = await JobTracking.checkClientRunExists({
      runId: safeRunId,
      clientId: safeClientId,
      options: {
        logger: log,
        source: `${source}_existence_check`
      }
    });
    
    if (!recordExists) {
      log.error(`[RECORD_NOT_FOUND] Client run record does not exist for ${safeRunId}/${safeClientId}. Cannot complete client processing.`);
      return {
        success: false,
        error: 'record_not_found',
        message: `No run record found for ${safeClientId} with run ID ${safeRunId}`,
        source,
        runId: safeRunId,
        clientId: safeClientId
      };
    }
    
    // For non-standalone runs, we should only update metrics, not complete the process
    // unless explicitly told to do so with the force flag
    if (!isStandalone && !options.force) {
      log.info(`Not completing client processing for ${clientId} - not a standalone run (source: ${source})`);
      
      // Just update metrics without End Time or Status - pass the validated parameters
      return await JobTracking.updateClientMetrics({
        runId: safeRunId,
        clientId: safeClientId,
        metrics: finalMetrics,
        options: {
          ...options,
          logger: log, // Pass existing logger to prevent new logger creation
          source: `${source}_metrics_only`
        }
      });
    }
    
    try {
      // CRITICAL FIX: Check for existing status in finalMetrics using both legacy and standardized field names
      // Determine final status based on metrics using constants
      let status = CLIENT_RUN_STATUS_VALUES.COMPLETED;
      const hasErrors = finalMetrics[CLIENT_RUN_FIELDS.ERRORS] && finalMetrics[CLIENT_RUN_FIELDS.ERRORS] > 0;
      const noLeadsProcessed = (!finalMetrics[CLIENT_RUN_FIELDS.PROFILES_EXAMINED_FOR_SCORING] || 
                                finalMetrics[CLIENT_RUN_FIELDS.PROFILES_EXAMINED_FOR_SCORING] === 0) &&
                              (!finalMetrics[CLIENT_RUN_FIELDS.POSTS_EXAMINED_FOR_SCORING] || 
                                finalMetrics[CLIENT_RUN_FIELDS.POSTS_EXAMINED_FOR_SCORING] === 0);
      
      // STANDARDIZATION FIX: Only use constant field names, eliminate legacy lowercase checks
      const explicitStatus = finalMetrics && CLIENT_RUN_FIELDS.STATUS in finalMetrics ? 
                          finalMetrics[CLIENT_RUN_FIELDS.STATUS] : null;
      if (explicitStatus !== null) {
        // If status is explicitly provided, use that
        status = explicitStatus;
      } else {
        // Otherwise determine based on metrics
        if (noLeadsProcessed) {
          status = CLIENT_RUN_STATUS_VALUES.NO_LEADS_TO_SCORE;
        } else if (finalMetrics.failed) {
          status = CLIENT_RUN_STATUS_VALUES.FAILED;
        }
      }
      
      // Create updates object using constants
      const updates = {
        ...finalMetrics,
        [CLIENT_RUN_FIELDS.END_TIME]: new Date().toISOString(),
        [CLIENT_RUN_FIELDS.STATUS]: status,
        [CLIENT_RUN_FIELDS.PROCESSING_COMPLETED]: true
      };
      
      // Build comprehensive system notes
      const notes = [];
      if (hasErrors) {
        notes.push(`Completed with ${finalMetrics[CLIENT_RUN_FIELDS.ERRORS]} errors`);
      }
      if (finalMetrics[CLIENT_RUN_FIELDS.PROFILES_SCORED]) {
        notes.push(`Scored ${finalMetrics[CLIENT_RUN_FIELDS.PROFILES_SCORED]} profiles`);
      }
      if (finalMetrics[CLIENT_RUN_FIELDS.POSTS_SCORED]) {
        notes.push(`Scored ${finalMetrics[CLIENT_RUN_FIELDS.POSTS_SCORED]} posts`);
      }
      if (finalMetrics[CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]) {
        notes.push(`Harvested ${finalMetrics[CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]} posts`);
      }
      
      if (notes.length > 0) {
        const notesStr = `Final: ${notes.join(', ')}`;
        if (updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES]) {
          updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES] += ` | ${notesStr}`;
        } else {
          updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = notesStr;
        }
      }
      
      log.info(`Completing all processing for client ${safeClientId} with status: ${status} (standalone=${isStandalone}, source=${source})`);
      
      // Use the standard updateClientRun method with validated parameters
      return await JobTracking.updateClientRun({
        runId: safeRunId,
        clientId: safeClientId,
        updates,
        options: {
          ...options,
          logger: log // Pass existing logger to prevent new logger creation
        }
      });
    } catch (error) {
      log.error(`Error completing client processing: ${error.message}`);
      await logCriticalError(error, { context: 'Service error (before throw)', service: 'jobTracking.js' }).catch(() => {});
      throw error;
    }
  }
}

// Export directly to support both import styles
// This allows both require('../jobTracking') and const { JobTracking } = require('../jobTracking')
module.exports = JobTracking;
// Also export as a property for destructured imports
module.exports.JobTracking = JobTracking;