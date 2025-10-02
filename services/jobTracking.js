/**
 * services/jobTracking.js
 * 
 * Unified job tracking service that serves as a single source of truth
 * for all job tracking operations across the system.
 * 
 * This class uses a standardized approach to job IDs, tracking records,
 * and client-specific run records to ensure consistency and prevent
 * duplicate entries.
 */

const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
const { validateString, validateRequiredParams } = require('../utils/simpleValidator');
// Import field validator for consistent field naming
const { FIELD_NAMES, createValidatedObject } = require('../utils/airtableFieldValidator');

// Database access
const baseManager = require('./airtable/baseManager');
const unifiedRunIdService = require('./unifiedRunIdService');

// Import constants - using standardized names only
const { 
  TABLES,
  JOB_TRACKING_FIELDS,  // Primary constant for job fields
  CLIENT_RUN_FIELDS,    // Primary constant for client run fields
  STATUS_VALUES,        // Get STATUS_VALUES from here only
  FORMULA_FIELDS
} = require('../constants/airtableSimpleConstants');

// Table constants - Using simplified constants from unified file
const JOB_TRACKING_TABLE = TABLES.JOB_TRACKING;
const CLIENT_RUN_RESULTS_TABLE = TABLES.CLIENT_RUN_RESULTS;

// Default logger - using safe creation to ensure valid parameters
const logger = createSafeLogger('SYSTEM', null, 'job_tracking');

/**
 * Helper function to ensure consistent status values
 * Prevents "toLowerCase of undefined" errors and ensures consistent status values
 * @param {string|*} statusValue - The status value to sanitize
 * @returns {string} A lowercase consistent status value
 */
function getStatusString(statusValue = 'completed') {
  // Handle null/undefined
  if (statusValue === null || statusValue === undefined) {
    return 'completed';
  }
  
  // Handle different types
  const statusStr = String(statusValue).trim();
  
  // Normalize to lowercase for consistency
  return statusStr.toLowerCase();
}

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
    case TABLES.JOB_TRACKING:
      validFields = Object.values(JOB_TRACKING_FIELDS);
      tableDisplayName = 'Job Tracking';
      break;
    case TABLES.CLIENT_RUN_RESULTS:
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
   * Delegates to unifiedRunIdService for consistent ID generation
   * @returns {string} A timestamp-based run ID
   */
  static generateRunId() {
    return unifiedRunIdService.generateTimestampRunId();
  }

  /**
   * Add client suffix to a base run ID
   * Delegates to unifiedRunIdService for consistent ID formatting
   * @param {string} baseRunId - Base run ID (YYMMDD-HHMMSS)
   * @param {string} clientId - Client ID to add as suffix
   * @returns {string} Run ID with client suffix
   */
  static addClientSuffix(baseRunId, clientId) {
    return unifiedRunIdService.addClientSuffix(baseRunId, clientId);
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
      
      // Normalize using the unified service
      const normalizedRunId = unifiedRunIdService.normalizeRunId(runId);
      
      // Enforce standard if required
      if (enforceStandard && normalizedRunId && normalizedRunId !== runId) {
        log.debug(`Run ID standardized: ${runId} → ${normalizedRunId}`);
      }
      
      return normalizedRunId;
    } catch (error) {
      log.error(`Error standardizing run ID: ${error.message}`);
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
      log.error("Run ID is required to create job tracking record");
      throw new Error("Run ID is required to create job tracking record");
    }
    
    try {
      // Use standardizeRunId helper to ensure consistent format
      const standardRunId = standardizeRunId(runId, { 
        enforceStandard: true,
        logErrors: true
      });
      
      // Exit early if we couldn't get a valid run ID
      if (!standardRunId) {
        log.error(`Invalid run ID provided: ${runId}`);
        throw new Error(`Invalid run ID provided: ${runId}`);
      }
      
      log.debug(`Creating job with standardized run ID: ${standardRunId}`);
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
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
        [JOB_TRACKING_FIELDS.STATUS]: STATUS_VALUES.RUNNING,
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
      // Use standardizeRunId helper to ensure consistent format
      const standardRunId = standardizeRunId(runId, { 
        enforceStandard: true,
        logErrors: true
      });
      
      // Exit early if we couldn't get a valid run ID
      if (!standardRunId) {
        log.error(`Invalid run ID provided for update: ${runId}`);
        throw new Error(`Invalid run ID provided for update: ${runId}`);
      }
      
      log.debug(`Updating job with standardized run ID: ${standardRunId}`);
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
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
      
      // Prepare update fields - only use fields that exist
      const updateFields = {};
      
      // CRITICAL: Handle status update with special logic - check both legacy and standardized field names
      const statusValue = 'status' in updates ? updates.status : (JOB_TRACKING_FIELDS.STATUS in updates ? updates[JOB_TRACKING_FIELDS.STATUS] : null);
      if (statusValue !== null) {
        updateFields[JOB_TRACKING_FIELDS.STATUS] = statusValue;
        
        // Always validate status values are uppercase and match constants
        const safeStatusValue = getStatusString(statusValue);
        log.debug(`Status update ${statusValue} -> ${safeStatusValue}`);
        
        // If status is transitioning to a completed state, set end time if not provided
        const isCompletedState = ['completed', 'failed', 'completed with errors', 'no leads to score'].includes(safeStatusValue);
        const hasEndTime = 'endTime' in updates || JOB_TRACKING_FIELDS.END_TIME in updates;
        if (isCompletedState && !hasEndTime) {
          const endTime = new Date().toISOString();
          updateFields[JOB_TRACKING_FIELDS.END_TIME] = endTime;
          log.debug(`Auto-setting end time to ${endTime}`);
        }
      }
      if ('error' in updates) updateFields[JOB_TRACKING_FIELDS.ERROR] = updates.error;
      // Progress and LastClient fields removed to simplify codebase
      
      // Handle System Notes field properly
      if (updates[JOB_TRACKING_FIELDS.SYSTEM_NOTES]) {
        updateFields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = updates[JOB_TRACKING_FIELDS.SYSTEM_NOTES];
      } else if (updates.notes) {
        updateFields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = updates.notes;
      }
      
      // Process each update field with formula field validation
      for (const [key, value] of Object.entries(updates)) {
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
      // Use standardizeRunId helper to ensure consistent format
      const standardRunId = standardizeRunId(runId, { 
        enforceStandard: true,
        logErrors: true
      });
      
      // Exit early if we couldn't get a valid run ID
      if (!standardRunId) {
        log.error(`Invalid run ID provided for client run creation: ${runId}`);
        throw new Error(`Invalid run ID provided for client run creation: ${runId}`);
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
      const masterBase = baseManager.getMasterClientsBase();
      
      // Only check for the standardized client run ID
      const formula = `{${CLIENT_RUN_FIELDS.RUN_ID}} = '${clientRunId}'`;
      
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
        [CLIENT_RUN_FIELDS.STATUS]: STATUS_VALUES.RUNNING,
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
    
    // Use existing logger or create a safe one
    const log = options.logger || createSafeLogger(safeClientId, safeRunId, 'job_tracking');
    
    try {
      // Use standardizeRunId helper to ensure consistent format
      const standardRunId = standardizeRunId(safeRunId, { 
        enforceStandard: true,
        logErrors: true
      });
      
      // Exit early if we couldn't get a valid run ID
      if (!standardRunId) {
        log.error(`Invalid run ID provided for client run update: ${safeRunId}`);
        return {
          success: false,
          error: 'invalid_run_id',
          message: `Invalid run ID format: ${safeRunId}`
        };
      }
      
      // Create client-specific run ID with standard format
      const clientRunId = JobTracking.addClientSuffix(standardRunId, safeClientId);
      
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
      const masterBase = baseManager.getMasterClientsBase();
      
      // Only check for the standardized client run ID using constants
      const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: `{${CLIENT_RUN_FIELDS.RUN_ID}} = '${clientRunId}'`,
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
      
      // Prepare update fields using constants
      const updateFields = {};
      
      // Use the globally defined list of formula fields
      
      // CRITICAL: Handle status update with special logic - check both legacy and standardized field names
      const statusValue = 'status' in updates ? updates.status : (CLIENT_RUN_FIELDS.STATUS in updates ? updates[CLIENT_RUN_FIELDS.STATUS] : null);
      if (statusValue !== null) {
        updateFields[CLIENT_RUN_FIELDS.STATUS] = statusValue;
        
        // Always validate status values are uppercase and match constants
        const safeStatusValue = getStatusString(statusValue);
        log.debug(`Status update ${statusValue} -> ${safeStatusValue}`);
        
        // If status is transitioning to a completed state, set end time if not provided
        const isCompletedState = ['completed', 'failed', 'completed with errors', 'no leads to score'].includes(safeStatusValue);
        const hasEndTime = 'endTime' in updates || CLIENT_RUN_FIELDS.END_TIME in updates;
        if (isCompletedState && !hasEndTime) {
          const endTime = new Date().toISOString();
          updateFields[CLIENT_RUN_FIELDS.END_TIME] = endTime;
          log.debug(`Auto-setting end time to ${endTime}`);
        }
      }
      if ('leadsProcessed' in updates) updateFields[CLIENT_RUN_FIELDS.LEADS_PROCESSED] = updates.leadsProcessed;
      if ('postsProcessed' in updates) updateFields[CLIENT_RUN_FIELDS.POSTS_PROCESSED] = updates.postsProcessed;
      if ('errors' in updates) updateFields[CLIENT_RUN_FIELDS.ERRORS] = updates.errors;
      
      // Handle System Notes properly using constants
      if (updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES]) {
        updateFields[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES];
      } else if (updates.notes) {
        updateFields[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = updates.notes;
      }
      
      // Add token usage fields using constants
      if (updates.tokenUsage) updateFields[CLIENT_RUN_FIELDS.TOKEN_USAGE] = updates.tokenUsage;
      if (updates.promptTokens) updateFields[CLIENT_RUN_FIELDS.PROMPT_TOKENS] = updates.promptTokens;
      if (updates.completionTokens) updateFields[CLIENT_RUN_FIELDS.COMPLETION_TOKENS] = updates.completionTokens;
      if (updates.totalTokens) updateFields[CLIENT_RUN_FIELDS.TOTAL_TOKENS] = updates.totalTokens;
      
      // Add API costs using constants
      if (updates[CLIENT_RUN_FIELDS.APIFY_API_COSTS]) {
        updateFields[CLIENT_RUN_FIELDS.APIFY_API_COSTS] = updates[CLIENT_RUN_FIELDS.APIFY_API_COSTS];
      };
      
      // Process all other direct field mappings, filtering out formula fields
      
      // Add all remaining fields that aren't already processed and aren't formula fields
      Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined &&
            !updateFields.hasOwnProperty(key) &&
            !FORMULA_FIELDS.includes(key)) {
          updateFields[key] = updates[key];
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
      endTime: updates.endTime || new Date().toISOString()
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
    
    // Add completion details to updates
    const completeUpdates = {
      ...updates,
      status,
      endTime: updates.endTime || new Date().toISOString()
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
    
    try {
      // Use standardizeRunId helper to ensure consistent format
      const standardRunId = standardizeRunId(runId, { 
        enforceStandard: true,
        logErrors: true
      });
      
      // Exit early if we couldn't get a valid run ID
      if (!standardRunId) {
        log.error(`Invalid run ID provided for lookup: ${runId}`);
        return null;
      }
      
      const masterBase = baseManager.getMasterClientsBase();
      
      // Use only the standardized run ID with constant for field name
      const formula = `{${JOB_TRACKING_FIELDS.RUN_ID}} = '${standardRunId}'`;
      
      log.debug(`Looking up job record with standardized run ID: ${standardRunId}`);
      
      const records = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        log.debug(`Job tracking record not found for standardized run ID: ${standardRunId}`);
        return null;
      }
      
      log.debug(`Found job tracking record for run ID: ${standardRunId}`);
      return records[0];
    } catch (error) {
      log.error(`Error getting job by ID: ${error.message}`);
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
      
      // Use standardizeRunId helper to ensure consistent format
      const standardRunId = standardizeRunId(safeRunId, { 
        enforceStandard: true,
        logErrors: true
      });
      
      // Exit early if we couldn't get a valid run ID
      if (!standardRunId) {
        log.error(`Invalid run ID provided for client run lookup: ${safeRunId}`);
        return null;
      }
      
      // Create client-specific run ID with standard format
      const clientRunId = JobTracking.addClientSuffix(standardRunId, safeClientId);
      
      if (!clientRunId) {
        log.error(`Failed to create client run ID for ${standardRunId} and ${safeClientId}`);
        return null;
      }
      
      const masterBase = baseManager.getMasterClientsBase();
      
      // Only check for the standardized client run ID using constants
      const formula = `{${CLIENT_RUN_FIELDS.RUN_ID}} = '${clientRunId}'`;
      
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
    
    // Use existing logger or create a safe one
    const log = options.logger || createSafeLogger(safeClientId, safeRunId, 'job_tracking');
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
    
    try {
      // Use standardizeRunId helper to ensure consistent format
      const standardRunId = standardizeRunId(safeRunId, { 
        enforceStandard: true,
        logErrors: true
      });
      
      // Exit early if we couldn't get a valid run ID
      if (!standardRunId) {
        log.error(`Invalid run ID provided for client run check: ${safeRunId}`);
        return false;
      }
      
      // Create client-specific run ID with standard format
      const clientRunId = JobTracking.addClientSuffix(standardRunId, safeClientId);
      
      if (!clientRunId) {
        log.error(`Failed to create client run ID for ${standardRunId} and ${safeClientId}`);
        return false;
      }
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Only check for the standardized client run ID
      const formula = `{${CLIENT_RUN_FIELDS.RUN_ID}} = '${clientRunId}'`;
      
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
    
    if (!runId) {
      log.error("Run ID is required to update aggregate metrics");
      throw new Error("Run ID is required to update aggregate metrics");
    }
    
    try {
      // First normalize the run ID to handle different formats consistently
      const normalizedRunId = unifiedRunIdService.normalizeRunId(runId);
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Find the record - check both original and normalized run IDs
      const formula = `OR({${JOB_TRACKING_FIELDS.RUN_ID}} = '${runId}', {${JOB_TRACKING_FIELDS.RUN_ID}} = '${normalizedRunId}')`;
      
      const records = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        log.error(`Job tracking record not found for run ID ${runId} or ${normalizedRunId}`);
        throw new Error(`Job tracking record not found for run ID ${runId} or ${normalizedRunId}`);
      }
      
      const record = records[0];
      const currentFields = record.fields || {};
      
      // Prepare update fields for aggregation
      const updateFields = {};
      
      // Numerical fields to aggregate (add to existing values)
      const numericFields = [
        'Profiles Processed', 'Profiles Successfully Scored', 'Posts Processed', 
        'Posts Successfully Scored', 'Errors', 'Total Tokens', 'Prompt Tokens', 
        'Completion Tokens', 'Total Posts Harvested'
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
        await masterBase(JOB_TRACKING_TABLE).update(record.id, updateFields);
        log.debug(`Updated aggregate metrics for ${runId}`, { updateFields });
      } else {
        log.debug(`No metrics to update for ${runId}`);
      }
      
      return {
        id: record.id,
        runId,
        updated: Object.keys(updateFields)
      };
    } catch (error) {
      log.error(`Error updating aggregate metrics: ${error.message}`);
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
    
    // Use existing logger or create a safe one
    const log = options.logger || createSafeLogger(safeClientId, safeRunId, 'job_tracking');
    
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
      let status = STATUS_VALUES.COMPLETED;
      const hasErrors = finalMetrics[CLIENT_RUN_FIELDS.ERRORS] && finalMetrics[CLIENT_RUN_FIELDS.ERRORS] > 0;
      const noLeadsProcessed = (!finalMetrics[CLIENT_RUN_FIELDS.PROFILES_EXAMINED_FOR_SCORING] || 
                                finalMetrics[CLIENT_RUN_FIELDS.PROFILES_EXAMINED_FOR_SCORING] === 0) &&
                              (!finalMetrics[CLIENT_RUN_FIELDS.POSTS_EXAMINED_FOR_SCORING] || 
                                finalMetrics[CLIENT_RUN_FIELDS.POSTS_EXAMINED_FOR_SCORING] === 0);
      
      // Check both legacy and standardized field names for status
      const explicitStatus = finalMetrics && ('status' in finalMetrics ? finalMetrics.status : 
                          (CLIENT_RUN_FIELDS.STATUS in finalMetrics ? finalMetrics[CLIENT_RUN_FIELDS.STATUS] : null));
      if (explicitStatus !== null) {
        // If status is explicitly provided, use that
        status = explicitStatus;
      } else {
        // Otherwise determine based on metrics
        if (noLeadsProcessed) {
          status = STATUS_VALUES.NO_LEADS_TO_SCORE;
        } else if (finalMetrics.failed) {
          status = STATUS_VALUES.FAILED;
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
      if (finalMetrics[CLIENT_RUN_FIELDS.PROFILES_SUCCESSFULLY_SCORED]) {
        notes.push(`Scored ${finalMetrics[CLIENT_RUN_FIELDS.PROFILES_SUCCESSFULLY_SCORED]} profiles`);
      }
      if (finalMetrics[CLIENT_RUN_FIELDS.POSTS_SUCCESSFULLY_SCORED]) {
        notes.push(`Scored ${finalMetrics[CLIENT_RUN_FIELDS.POSTS_SUCCESSFULLY_SCORED]} posts`);
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
      throw error;
    }
  }
}

// Export directly to support both import styles
// This allows both require('../jobTracking') and const { JobTracking } = require('../jobTracking')
module.exports = JobTracking;
// Also export as a property for destructured imports
module.exports.JobTracking = JobTracking;