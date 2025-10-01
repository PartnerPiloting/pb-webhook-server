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
// FIXED: Import our new validator utility for more robust ID validation
const { validateAndNormalizeRunId, validateAndNormalizeClientId } = require('../utils/runIdValidator');
// Import field validator for consistent field naming
const { FIELD_NAMES, STATUS_VALUES, createValidatedObject, validateFieldNames } = require('../utils/airtableFieldValidator');

// Database access
const baseManager = require('./airtable/baseManager');
const unifiedRunIdService = require('./unifiedRunIdService');

// Import constants with both new and legacy names
const { 
  TABLES,
  MASTER_TABLES,
  JOB_FIELDS,
  JOB_TRACKING_FIELDS, // Legacy name 
  CLIENT_RUN_FIELDS,
  CLIENT_RUN_RESULTS_FIELDS // Legacy name
  // Removed duplicate STATUS_VALUES import that was causing conflicts
} = require('../constants/airtableSimpleConstants');

// Table constants - Using simplified constants from unified file
const JOB_TRACKING_TABLE = TABLES.JOB_TRACKING;
const CLIENT_RUN_RESULTS_TABLE = TABLES.CLIENT_RUN_RESULTS;

// Default logger - using safe creation to ensure valid parameters
const logger = createSafeLogger('SYSTEM', null, 'job_tracking');

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
    
    if (!runId) {
      log.error("Run ID is required to create job tracking record");
      throw new Error("Run ID is required to create job tracking record");
    }
    
    try {
      // First, normalize the run ID to prevent duplicates - use imported service
      const normalizedRunId = unifiedRunIdService.normalizeRunId(runId);
      log.debug(`Creating job with normalized runId: ${normalizedRunId} (original: ${runId})`);
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Enhanced deduplication: Check for existing records with any variant of this run ID
      // This prevents duplicates even if different formats of the same logical ID are used
      const formula = `OR({${JOB_TRACKING_FIELDS.RUN_ID}} = '${runId}', {${JOB_TRACKING_FIELDS.RUN_ID}} = '${normalizedRunId}')`;
      
      const existingRecords = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      if (existingRecords && existingRecords.length > 0) {
        log.warn(`Job tracking record already exists for run ID ${runId}. Not creating duplicate.`);
        return {
          id: existingRecords[0].id,
          runId: normalizedRunId, // Return the normalized ID for consistency
          alreadyExists: true
        };
      }
      
      // Default values
      const startTime = new Date().toISOString();
      
      // Prepare record data using constants - improves maintainability
      const recordData = {
        [JOB_TRACKING_FIELDS.RUN_ID]: normalizedRunId, // Always use normalized ID
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
    
    if (!runId) {
      log.error("Run ID is required to update job tracking record");
      throw new Error("Run ID is required to update job tracking record");
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
      
      // Prepare update fields - only use fields that exist
      const updateFields = {};
      
      // Map common update fields using constants
      if (updates.status) updateFields[JOB_TRACKING_FIELDS.STATUS] = updates.status;
      if (updates.endTime) updateFields[JOB_TRACKING_FIELDS.END_TIME] = updates.endTime;
      if (updates.error) updateFields['Error'] = updates.error;
      if (updates.progress) updateFields[JOB_TRACKING_FIELDS.PROGRESS] = updates.progress;
      if (updates.lastClient) updateFields[JOB_TRACKING_FIELDS.LAST_CLIENT] = updates.lastClient;
      
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
    
    if (!runId || !clientId) {
      log.error("Run ID and Client ID are required to create client run record");
      throw new Error("Run ID and Client ID are required to create client run record");
    }
    
    try {
      // First, normalize the run ID to prevent duplicates
      const normalizedRunId = unifiedRunIdService.normalizeRunId(runId);
      log.debug(`Creating client run with normalized runId: ${normalizedRunId} (original: ${runId})`);
      
      // Create client-specific run ID from the normalized run ID for consistency
      const clientRunId = JobTracking.addClientSuffix(normalizedRunId, clientId);
      // No need to create a separate normalized version since clientRunId is already normalized
      const normalizedClientRunId = clientRunId;
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Check if record already exists using BOTH the original and normalized run IDs
      // CRITICAL FIX: Use field name constants instead of hardcoded strings
      const formula = `OR({${CLIENT_RUN_FIELDS.RUN_ID}} = '${clientRunId}', {${CLIENT_RUN_FIELDS.RUN_ID}} = '${normalizedClientRunId}')`;
      
      const existingRecords = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: formula,
        maxRecords: 1
      }).firstPage();
      
      if (existingRecords && existingRecords.length > 0) {
        log.warn(`Client run record already exists for ${clientRunId}. Not creating duplicate.`);
        return {
          id: existingRecords[0].id,
          runId: clientRunId,
          baseRunId: runId,
          clientId,
          alreadyExists: true
        };
      }
      
      // Default values
      const startTime = new Date().toISOString();
      
      // Prepare record data - only use fields that actually exist
      const recordData = {
        'Run ID': clientRunId,
        'Client ID': clientId,
        'Status': 'Running',
        'Start Time': startTime,
        'System Notes': initialData['System Notes'] || ''
      };
      
      // Add other verified fields that exist
      if (initialData['Apify Run ID']) recordData['Apify Run ID'] = initialData['Apify Run ID'];
      
      // Create the record
      const record = await masterBase(CLIENT_RUN_RESULTS_TABLE).create(recordData);
      
      log.debug(`Created client run record for ${clientRunId}`);
      
      return {
        id: record.id,
        runId: clientRunId,
        baseRunId: runId,
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
    
    // Validate required parameters
    try {
      validateRequiredParams(params, ['runId', 'clientId'], 'updateClientRun');
    } catch (error) {
      logger.error(`Parameter validation failed: ${error.message}`);
      throw error;
    }
    
    // Simple string validation for critical parameters
    const safeRunId = validateString(runId, 'runId', 'updateClientRun');
    const safeClientId = validateString(clientId, 'clientId', 'updateClientRun');
    
    // Use existing logger or create a safe one
    const log = options.logger || createSafeLogger(safeClientId, safeRunId, 'job_tracking');
    
    try {
      // Get standardized run ID with client suffix
      const clientRunId = JobTracking.addClientSuffix(safeRunId, safeClientId);
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Find the record
      // CRITICAL FIX: Use field name constants instead of hardcoded strings
      const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: `{${CLIENT_RUN_RESULTS_FIELDS.RUN_ID}} = '${clientRunId}'`,
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
      
      // Prepare update fields - only use fields that actually exist
      const updateFields = {};
      
      // Use the globally defined list of formula fields
      
      // Map common update fields to Airtable field names (only those that exist)
      if (updates.status) updateFields['Status'] = updates.status;
      if (updates.endTime) updateFields['End Time'] = updates.endTime;
      if (updates.leadsProcessed) updateFields['Leads Processed'] = updates.leadsProcessed;
      if (updates.postsProcessed) updateFields['Posts Processed'] = updates.postsProcessed;
      if (updates.errors) updateFields['Errors'] = updates.errors;
      
      // Handle System Notes properly
      if (updates['System Notes']) {
        updateFields['System Notes'] = updates['System Notes'];
      } else if (updates.notes) {
        updateFields['System Notes'] = updates.notes;
      }
      
      // Add token usage fields if they exist
      if (updates.tokenUsage) updateFields['Token Usage'] = updates.tokenUsage;
      if (updates.promptTokens) updateFields['Prompt Tokens'] = updates.promptTokens;
      if (updates.completionTokens) updateFields['Completion Tokens'] = updates.completionTokens;
      if (updates.totalTokens) updateFields['Total Tokens'] = updates.totalTokens;
      
      // Add API costs if they exist
      if (updates['Apify API Costs']) updateFields['Apify API Costs'] = updates['Apify API Costs'];
      
      // Process all other direct field mappings, filtering out formula fields
      
      // Add all remaining fields that aren't already processed and aren't formula fields
      Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined &&
            !updateFields.hasOwnProperty(key) &&
            !FORMULA_FIELDS.includes(key)) {
          updateFields[key] = updates[key];
        }
      });
      
      // Update the record
      await masterBase(CLIENT_RUN_RESULTS_TABLE).update(record.id, updateFields);
      
      log.debug(`Updated client run record for ${clientRunId}`);
      
      return {
        id: record.id,
        runId: clientRunId,
        baseRunId: runId,
        clientId,
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
   * @param {string} runId - Run ID to find
   * @returns {Promise<Object|null>} Job tracking record or null if not found
   */
  static async getJobById(runId) {
    try {
      const masterBase = baseManager.getMasterClientsBase();
      
      const records = await masterBase(JOB_TRACKING_TABLE).select({
        filterByFormula: `{Run ID} = '${runId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        return null;
      }
      
      return records[0];
    } catch (error) {
      logger.error(`Error getting job by ID: ${error.message}`);
      return null;
    }
  }

  /**
   * Get client run record by client run ID
   * @param {string} runId - Base run ID
   * @param {string} clientId - Client ID
   * @returns {Promise<Object|null>} Client run record or null if not found
   */
  static async getClientRun(runId, clientId) {
    try {
      const clientRunId = JobTracking.addClientSuffix(runId, clientId);
      const masterBase = baseManager.getMasterClientsBase();
      
      // CRITICAL FIX: Use field name constants instead of hardcoded strings
      const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: `{${CLIENT_RUN_RESULTS_FIELDS.RUN_ID}} = '${clientRunId}'`,
        maxRecords: 1
      }).firstPage();
      
      if (!records || records.length === 0) {
        return null;
      }
      
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
    
    // Validate required parameters
    try {
      validateRequiredParams(params, ['runId', 'clientId'], 'updateClientMetrics');
    } catch (error) {
      logger.error(`Parameter validation failed: ${error.message}`);
      throw error;
    }
    
    // Simple string validation for critical parameters
    const safeRunId = validateString(runId, 'runId', 'updateClientMetrics');
    const safeClientId = validateString(clientId, 'clientId', 'updateClientMetrics');
    
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
      log.error(`[RECORD_NOT_FOUND] Client run record does not exist for ${runId}/${clientId}. Cannot update metrics.`);
      return {
        success: false,
        error: 'record_not_found',
        message: `No run record found for ${clientId} with run ID ${runId}`,
        source,
        runId,
        clientId
      };
    }
    
    try {
      // Make a copy of metrics to ensure we don't modify End Time, Status, or formula fields
      const filteredMetrics = { ...metrics };
      delete filteredMetrics['End Time'];
      delete filteredMetrics['Status'];
      
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
    
    // Validate required parameters
    if (!runId || !clientId) {
      logger.error("Run ID and Client ID are required to check if client run record exists");
      return false;
    }
    
    // Simple string validation
    const safeRunId = String(runId).trim();
    const safeClientId = String(clientId).trim();
    
    // Use existing logger or default
    const log = options.logger || logger;
    
    try {
      // Create client-specific run ID
      const clientRunId = JobTracking.addClientSuffix(safeRunId, safeClientId);
      
      // Get the master base
      const masterBase = baseManager.getMasterClientsBase();
      
      // Find the record using constants
      const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: `{${CLIENT_RUN_RESULTS_FIELDS.RUN_ID}} = '${clientRunId}'`,
        maxRecords: 1
      }).firstPage();
      
      return !!(records && records.length > 0);
    } catch (error) {
      log.error(`Error checking client run record existence: ${error.message}`);
      return false;
    }
  }

  static async completeClientProcessing(params) {
    // Simple parameter handling - no complex validation
    if (!params || typeof params !== 'object') {
      throw new Error("completeClientProcessing: Missing parameters object");
    }
    
    const { runId, clientId, finalMetrics = {}, options = {} } = params;
    
    // FIXED: More robust validation that can handle objects being passed as IDs
    try {
      // This will throw if parameters are missing
      validateRequiredParams(params, ['runId', 'clientId'], 'completeClientProcessing');
      
      // Use our new validators that can extract IDs from objects
      const safeRunId = validateAndNormalizeRunId(runId) || 
                        validateString(runId, 'runId', 'completeClientProcessing');
      const safeClientId = validateAndNormalizeClientId(clientId) || 
                          validateString(clientId, 'clientId', 'completeClientProcessing');
      
      // Override the original parameters with safe versions
      params.runId = safeRunId;
      params.clientId = safeClientId;
    } catch (error) {
      logger.error(`Parameter validation failed: ${error.message}`);
      throw error;
    }
    
    // Use the validated parameters
    const safeRunId = params.runId;
    const safeClientId = params.clientId;
    
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
      log.error(`[RECORD_NOT_FOUND] Client run record does not exist for ${runId}/${clientId}. Cannot complete client processing.`);
      return {
        success: false,
        error: 'record_not_found',
        message: `No run record found for ${clientId} with run ID ${runId}`,
        source,
        runId,
        clientId
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
      // Determine final status based on metrics
      let status = 'Completed';
      const hasErrors = finalMetrics.errors && finalMetrics.errors > 0;
      const noLeadsProcessed = (!finalMetrics['Profiles Examined for Scoring'] || finalMetrics['Profiles Examined for Scoring'] === 0) &&
                              (!finalMetrics['Posts Examined for Scoring'] || finalMetrics['Posts Examined for Scoring'] === 0);
      
      if (noLeadsProcessed) {
        status = 'No Leads To Score';
      } else if (finalMetrics.failed) {
        status = 'Failed';
      }
      
      // Create updates object with End Time and Status using field name constants
      const rawUpdates = {
        ...finalMetrics,
        [FIELD_NAMES.END_TIME]: new Date().toISOString(),
        [FIELD_NAMES.STATUS]: status,
        [FIELD_NAMES.PROCESSING_COMPLETED]: true
      };
      
      // Validate field names before sending to Airtable
      const updates = createValidatedObject(rawUpdates);
      
      // Check if any field names were invalid (just for logging/debugging)
      const validationResult = validateFieldNames(rawUpdates, true);
      if (!validationResult.success) {
        log.warn(`Field name validation warnings: ${validationResult.errors.join(', ')}`);
      }
      
      // Build comprehensive system notes
      const notes = [];
      if (hasErrors) {
        notes.push(`Completed with ${finalMetrics.errors} errors`);
      }
      if (finalMetrics['Profiles Successfully Scored']) {
        notes.push(`Scored ${finalMetrics['Profiles Successfully Scored']} profiles`);
      }
      if (finalMetrics['Posts Successfully Scored']) {
        notes.push(`Scored ${finalMetrics['Posts Successfully Scored']} posts`);
      }
      if (finalMetrics['Total Posts Harvested']) {
        notes.push(`Harvested ${finalMetrics['Total Posts Harvested']} posts`);
      }
      
      if (notes.length > 0) {
        const notesStr = `Final: ${notes.join(', ')}`;
        if (updates[FIELD_NAMES.SYSTEM_NOTES]) {
          updates[FIELD_NAMES.SYSTEM_NOTES] += ` | ${notesStr}`;
        } else {
          updates[FIELD_NAMES.SYSTEM_NOTES] = notesStr;
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

module.exports = JobTracking;