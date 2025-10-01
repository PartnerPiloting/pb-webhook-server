// services/runRecordServiceV2.js
// Centralized service for run record management
// Implements the STRICT Single Creation Point pattern
// 
// ARCHITECTURAL NOTE:
// This module implements the standardized object parameter pattern.
// All functions accept a single object with named parameters instead of
// positional arguments. See docs/STANDARDIZED-PARAMETER-PATTERN.md for details.
// 
// For backward compatibility, all functions still accept old-style positional parameters
// but new code should use the object parameter style exclusively.

require('dotenv').config();

// Import dependencies
const Airtable = require('airtable');
const clientService = require('./clientService');
// Updated to use unified run ID service
const runIdService = require('./unifiedRunIdService');
const { StructuredLogger } = require('../utils/structuredLogger');

// Constants for table names
const JOB_TRACKING_TABLE = 'Job Tracking';
const CLIENT_RUN_RESULTS_TABLE = 'Client Run Results';

// Initialize clients base reference - will be set via initialize()
let clientsBase = null;

// Registry to track run records during runtime
const runRecordRegistry = new Map();

// Activity log for debugging
const activityLog = [];
const MAX_LOG_SIZE = 100;

/**
 * Internal function to track activity in the service
 * @param {string} action - The action performed
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} source - The source of the activity
 * @param {string} result - The result of the activity
 */
function trackActivity(action, runId, clientId, source, result) {
  // Add to activity log with timestamp
  activityLog.unshift({
    timestamp: new Date().toISOString(),
    action,
    runId,
    clientId,
    source,
    result
  });
  
  // Trim log if it gets too long
  if (activityLog.length > MAX_LOG_SIZE) {
    activityLog.pop();
  }
}

/**
 * Initialize connection to the Clients base
 * @returns {Object} The Airtable base object
 */
function initialize() {
  if (clientsBase) {
    return clientsBase;
  }

  try {
    // Check if clientService is properly loaded
    if (!clientService || typeof clientService.initializeClientsBase !== 'function') {
      console.error("ERROR: clientService is not properly loaded or initializeClientsBase is not a function");
      
      // Fallback: Initialize directly if clientService is not working
      if (!process.env.MASTER_CLIENTS_BASE_ID) {
        throw new Error("MASTER_CLIENTS_BASE_ID environment variable is not set");
      }
      if (!process.env.AIRTABLE_API_KEY) {
        throw new Error("AIRTABLE_API_KEY environment variable is not set");
      }

      // Configure Airtable directly
      Airtable.configure({
        apiKey: process.env.AIRTABLE_API_KEY
      });

      console.log("FALLBACK: Directly initializing Airtable base connection");
      clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    } else {
      // Use clientService's initialization (preferred method)
      clientsBase = clientService.initializeClientsBase();
      console.log("Run Record Service: Successfully got base connection from clientService");
    }

    if (!clientsBase) {
      throw new Error("Failed to initialize clients base in runRecordService");
    }

    console.log("Run Record Service: Connection to run tracking table initialized");
    return clientsBase;
  } catch (error) {
    console.error("CRITICAL ERROR initializing Airtable connection:", error.message);
    throw error;
  }
}

/**
 * Create a new job tracking record - ONLY called at the start of a process
 * @param {Object} params - Parameters for job record creation
 * @param {string} params.runId - The base run ID (without client suffix)
 * @param {number} [params.stream=1] - The stream number
 * @param {Object} [params.options] - Additional options
 * @param {Object} [params.options.logger] - Optional logger to use
 * @param {string} [params.options.source] - Source of the creation request
 * @returns {Promise<Object>} The created record
 */
async function createJobRecord(params) {
  const base = initialize();
  
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: createJobRecord(runId, stream, options)
    const runId = arguments[0];
    const stream = arguments[1] || 1;
    const options = arguments[2] || {};
    
    // Convert to new format
    return createJobRecord({ runId, stream, options });
  }
  
  const { runId, stream = 1, options = {} } = params;
  const logger = options.logger || new StructuredLogger('SYSTEM', runId, 'job_tracking');
  const source = (isLegacyCall ? legacyOptions.source : params.source) || 'unknown';
  
  logger.debug(`Run Record Service: Creating job tracking record for ${runId}`);
  
  // Check if a job record already exists with this ID
  try {
    const existingRecords = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{Run ID} = '${runId}'`,
      maxRecords: 1
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      const errorMsg = `Job tracking record already exists for ${runId}`;
      logger.error(errorMsg);
      trackActivity('create_job', runId, 'SYSTEM', source, `ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  } catch (error) {
    if (error.message.includes('already exists')) {
      throw error;
    }
    logger.debug(`Error checking for existing job record: ${error.message}`);
    // Continue to create a new record if the error was just in checking
  }
  
  try {
    // Ensure the run ID is properly formatted (should be just the base run ID without client suffix)
    const baseRunId = runIdService.stripClientSuffix(runId);
    
    if (!baseRunId) {
      logger.error(`Run Record Service: Invalid run ID format: ${runId}`);
      trackActivity('create_job', runId, 'SYSTEM', source, `ERROR: Invalid run ID format`);
      throw new Error(`Invalid run ID format: ${runId}`);
    }
    
    // Create fields object without the problematic Source field
    const recordFields = {
      'Run ID': baseRunId, // Ensure we're using the properly formatted run ID
      'Start Time': new Date().toISOString(),
      'Status': 'Running',
      'Stream': stream,
      'Clients Processed': 0,
      'Clients With Errors': 0,
      'Total Profiles Examined': 0,
      'Successful Profiles': 0,
      'Total Posts Harvested': 0,
      'Posts Examined for Scoring': 0, 
      'Posts Successfully Scored': 0,
      'Profile Scoring Tokens': 0,
      'Post Scoring Tokens': 0,
      'System Notes': `Run initiated at ${new Date().toISOString()} from ${source}`
    };
    
    logger.debug(`Run Record Service: Creating job tracking record with ID: ${baseRunId}`);
    
    const records = await base(JOB_TRACKING_TABLE).create([
      {
        fields: recordFields
      }
    ]);

    // Track this activity
    trackActivity('create_job', runId, 'SYSTEM', source, `SUCCESS: Created job record ID ${records[0].id}`);
    
    logger.debug(`Run Record Service: Created job tracking record ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    logger.error(`Run Record Service ERROR: Failed to create job tracking record: ${error.message}`);
    trackActivity('create_job', runId, 'SYSTEM', source, `ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Create a client run result record - ONLY called at start of client processing
 * @param {string} runId - The structured run ID (without client suffix)
 * @param {string} clientId - The client ID
 * @param {string} clientName - The client name
 * @param {Object} options - Additional options
 * @param {Object} options.logger - Optional logger to use
 * @param {string} options.source - Source of the creation request
 * @returns {Promise<Object>} The created record
 */
/**
 * Create a client run record
 * @param {Object} params - Parameters for client run record creation
 * @param {string} params.runId - The run ID
 * @param {string} params.clientId - The client ID
 * @param {string} params.clientName - The client name
 * @param {Object} [params.options] - Additional options
 * @param {Object} [params.options.logger] - Optional logger to use
 * @param {string} [params.options.source] - Source of the creation request
 * @returns {Promise<Object>} The created record
 */
async function createClientRunRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: createClientRunRecord(runId, clientId, clientName, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const clientName = arguments[2];
    const options = arguments[3] || {};
    
    // Convert to new format
    return createClientRunRecord({ runId, clientId, clientName, options });
  }
  
  const { runId, clientId, clientName, options = {} } = params;
  const logger = options.logger || new StructuredLogger(clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`Run Record Service: DELEGATING client run record creation to JobTracking service for ${clientId}`);
  
  try {
    // CRITICAL FIX: Always delegate to the unified JobTracking service
    // This ensures only ONE service actually creates client run records
    const JobTracking = require('./jobTracking');
    
    return await JobTracking.createClientRun({
      runId,
      clientId,
      initialData: {
        'System Notes': `Processing started from source: ${source}`
      },
      options: {
        logger,
        source
      }
    });
  } catch (error) {
    logger.error(`Run Record Service ERROR: Failed to create client run record via JobTracking: ${error.message}`);
    throw error;
  }
  
  /* REMOVED: All direct database access code was removed during refactoring.
   * This service now delegates to JobTracking which is the single point of record creation.
   * 
   * The JobTracking.createClientRun function properly:
   * 1. Normalizes the run ID
   * 2. Checks for existing records
   * 3. Prevents duplicates
   * 4. Creates the record with proper fields
   * 
   * By delegating to JobTracking, we ensure:
   * - Only ONE place in the code creates client run records
   * - Consistent run ID normalization
   * - No duplicates due to slight run ID variations
   */
}

/**
 * Get a client run record - NEVER creates if not found
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The run record, or null if not found
 */
/**
 * Get a run record by ID and client
 * @param {Object} params - Parameters for getting run record
 * @param {string} params.runId - The run ID
 * @param {string} params.clientId - The client ID
 * @param {Object} [params.options] - Additional options
 * @param {Object} [params.options.logger] - Optional logger to use
 * @param {string} [params.options.source] - Source of the request
 * @returns {Promise<Object|null>} The record if found, null otherwise
 */
async function getRunRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: getRunRecord(runId, clientId, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const options = arguments[2] || {};
    
    // Convert to new format
    return getRunRecord({ runId, clientId, options });
  }
  
  const { runId, clientId, options = {} } = params;
  const base = initialize();
  const logger = options.logger || new StructuredLogger(clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  // Normalize the run ID
  const standardRunId = runIdService.normalizeRunId(runId, clientId);
  
  logger.debug(`Run Record Service: Getting run record for ${standardRunId}, client ${clientId}`);
  
  // Check registry first
  const registryKey = `${standardRunId}:${clientId}`;
  if (runRecordRegistry.has(registryKey)) {
    logger.debug(`Run Record Service: Found record in registry`);
    trackActivity('get', standardRunId, clientId, source, `SUCCESS: Found in registry`);
    return runRecordRegistry.get(registryKey);
  }
  
  // Then check runIdService cache
  const cachedRecordId = runIdService.getRunRecordId(standardRunId, clientId);
  if (cachedRecordId) {
    try {
      logger.debug(`Run Record Service: Trying cached record ID ${cachedRecordId}`);
      const record = await base(CLIENT_RUN_RESULTS_TABLE).find(cachedRecordId);
      runRecordRegistry.set(registryKey, record);
      trackActivity('get', standardRunId, clientId, source, `SUCCESS: Found by cached ID ${cachedRecordId}`);
      return record;
    } catch (err) {
      logger.debug(`Run Record Service: Cached record ID ${cachedRecordId} no longer valid`);
    }
  }
  
  // Query for the record
  try {
    // First, validate that the table exists for this client
    try {
      // Check specifically if the Client Run Results table exists
      // Note: We don't need to check all tables, just try to access the one we need
      await base(CLIENT_RUN_RESULTS_TABLE).select({ maxRecords: 1 }).firstPage();
    } catch (tableError) {
      // Convert "not authorized" errors to a more helpful message about missing tables/fields
      if (tableError.message.includes('not authorized')) {
        const betterError = new Error(`Table '${CLIENT_RUN_RESULTS_TABLE}' may not exist in client ${clientId}'s base or you don't have access. Original error: ${tableError.message}`);
        logger.warn(`Run Record Service: ${betterError.message}`);
        trackActivity('get', standardRunId, clientId, source, `TABLE ERROR: ${betterError.message}`);
        return null; // Return null instead of throwing - allows the calling code to continue
      }
      // For other errors, just pass through
      throw tableError;
    }
    
    const exactIdQuery = `AND({Run ID} = '${standardRunId}', {Client ID} = '${clientId}')`;
    logger.debug(`Run Record Service: Querying for record: ${exactIdQuery}`);
    
    const exactMatches = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: exactIdQuery,
      maxRecords: 1
    }).firstPage();
    
    if (exactMatches && exactMatches.length > 0) {
      // Register the record ID
      logger.debug(`Run Record Service: Found record by query`);
      runIdService.registerRunRecord(standardRunId, clientId, exactMatches[0].id);
      runRecordRegistry.set(registryKey, exactMatches[0]);
      trackActivity('get', standardRunId, clientId, source, `SUCCESS: Found by query`);
      return exactMatches[0];
    }
    
    logger.warn(`Run Record Service: No record found for ${standardRunId}, client ${clientId}`);
    trackActivity('get', standardRunId, clientId, source, `WARNING: Record not found`);
    return null;
  } catch (error) {
    logger.error(`Run Record Service ERROR during get: ${error.message}`);
    trackActivity('get', standardRunId, clientId, source, `ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Update a client run record - NEVER creates if not found
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} updates - The fields to update
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
/**
 * Update an existing run record - enforces that record must exist
 * @param {Object} params - Parameters for run record update
 * @param {string} params.runId - The run ID
 * @param {string} params.clientId - The client ID
 * @param {Object} params.updates - The updates to apply
 * @param {Object} [params.options] - Additional options
 * @param {Object} [params.options.logger] - Optional logger to use
 * @param {string} [params.options.source] - Source of the update request
 * @returns {Promise<Object>} The updated record
 */
async function updateRunRecord(params) {
  // For backward compatibility, handle old-style function calls
  if (typeof params === 'string') {
    // Legacy call format: updateRunRecord(runId, clientId, updates, options)
    const runId = arguments[0];
    const clientId = arguments[1];
    const updates = arguments[2];
    const options = arguments[3] || {};
    
    // Convert to new format
    return updateRunRecord({ runId, clientId, updates, options });
  }
  
  const { runId, clientId, updates, options = {} } = params;
  const logger = options.logger || new StructuredLogger(clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`Run Record Service: Updating run record for ${runId}, client ${clientId} (source: ${source})`);
  
  // First, get the record - this will NOT create if missing
  let record = await getRunRecord({ runId, clientId, options });
  
  // STRICT ENFORCEMENT: Do NOT create new records, only update existing ones
  if (!record) {
    // Generate a detailed error message
    const errorMsg = `[STRICT ENFORCEMENT] No existing record found for ${runId} (client ${clientId}). UPDATE REJECTED.`;
    logger.error(errorMsg);
    logger.error(`[STRICT ENFORCEMENT] This indicates a process kickoff issue - run record should already exist`);
    logger.error(`[STRICT ENFORCEMENT] Update operation skipped - updates would have been:`, JSON.stringify(updates));
    
    // Track the failure for metrics and debugging
    trackActivity('update', runId, clientId, source, `ERROR: ${errorMsg}`);
    
    // Throw error as explicitly requested
    throw new Error(`Cannot update non-existent run record for ${clientId} (${runId}). Record must exist before updates.`);
  }
  
  const base = initialize();
  
  // Update with new values
  const updateFields = {
    ...updates
    // 'Last Updated' field removed as it doesn't exist in Airtable schema
  };
  
  // Add information about the update to System Notes field
  if (updates['System Notes']) {
    updateFields['System Notes'] = `${updates['System Notes']}. Updated from ${source}.`;
  } else {
    const existingNotes = record.fields['System Notes'] || '';
    updateFields['System Notes'] = `${existingNotes}${existingNotes ? '. ' : ''}Updated at ${new Date().toISOString()} from ${source}`;
  }
  
  const updateData = {
    id: record.id,
    fields: updateFields
  };
  
  logger.debug(`Run Record Service: Updating record ${record.id} with data: ${JSON.stringify(updateData.fields)}`);
  
  try {
    const updatedRecord = await base(CLIENT_RUN_RESULTS_TABLE).update([updateData]);
    
    if (!updatedRecord || updatedRecord.length === 0) {
      throw new Error('Failed to update run record - no record returned');
    }
    
    // Update registry
    const registryKey = `${runIdService.normalizeRunId(runId, clientId, false)}:${clientId}`;
    runRecordRegistry.set(registryKey, updatedRecord[0]);
    
    // Track this activity
    trackActivity('update', runId, clientId, source, `SUCCESS: Updated record ID ${record.id}`);
    
    logger.debug(`Run Record Service: Successfully updated run record ${record.id}`);
    
    return updatedRecord[0];
  } catch (error) {
    logger.error(`Run Record Service ERROR during update: ${error.message}`);
    trackActivity('update', runId, clientId, source, `ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Update client run metrics - specialized update method for tracking metrics
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} metrics - The metrics to update
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
async function updateClientMetrics(runId, clientId, metrics, options = {}) {
  const logger = options.logger || new StructuredLogger(clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`Run Record Service: Updating client metrics for ${runId}, client ${clientId} (source: ${source})`);
  
  // First, get the record - this will NOT create if missing
  const record = await getRunRecord(runId, clientId, options);
  
  // If record not found, this is an error condition
  if (!record) {
    const errorMsg = `Cannot update metrics: Run record not found for ${runId}, client ${clientId}`;
    logger.error(errorMsg);
    trackActivity('update_metrics', runId, clientId, source, `ERROR: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  // Get current values to ensure we don't overwrite with lower values
  const currentValues = record.fields;
  
  // For numeric fields, use the higher value
  const numericFields = [
    'Profiles Examined for Scoring',
    'Profiles Successfully Scored',
    'Total Posts Harvested',
    'Posts Examined for Scoring',
    'Posts Successfully Scored',
    'Profile Scoring Tokens',
    'Post Scoring Tokens',
    'Apify API Costs'
  ];
  
  const updatedMetrics = { ...metrics };
  
  numericFields.forEach(field => {
    if (updatedMetrics[field] !== undefined && currentValues[field] !== undefined) {
      const currentVal = Number(currentValues[field] || 0);
      const newVal = Number(updatedMetrics[field] || 0);
      
      // Always use the higher value
      if (currentVal > newVal) {
        updatedMetrics[field] = currentVal;
      }
    }
  });
  
  // Note: 'Metrics Updated' field removed - not present in Airtable schema
  
  // Include update source in System Notes to ensure we don't lose tracking info
  const metricsUpdateNote = `Metrics updated at ${new Date().toISOString()} from ${source}`;
  if (updatedMetrics['System Notes']) {
    updatedMetrics['System Notes'] += `. ${metricsUpdateNote}`;
  } else {
    updatedMetrics['System Notes'] = metricsUpdateNote;
  }
  
  return await updateRunRecord(runId, clientId, updatedMetrics, { 
    logger,
    source: `metrics_update_from_${source}` 
  });
}

/**
 * Complete a client run with final status
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} status - Final status (Success, Error, Skipped)
 * @param {string} notes - Additional notes
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
async function completeRunRecord(runId, clientId, status, notes = '', options = {}) {
  const logger = options.logger || new StructuredLogger(clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`Run Record Service: Completing run record for ${runId}, client ${clientId} with status ${status} (source: ${source})`);
  
  // First, get the record - this will NOT create if missing
  let record = await getRunRecord(runId, clientId, options);
  
  // STRICT ENFORCEMENT: Do NOT create new records, only update existing ones
  if (!record) {
    // Generate a detailed error message
    const errorMsg = `[STRICT ENFORCEMENT] No existing record found for ${runId} (client ${clientId}). COMPLETION REJECTED.`;
    logger.error(errorMsg);
    logger.error(`[STRICT ENFORCEMENT] This indicates a process kickoff issue - run record should already exist`);
    logger.error(`[STRICT ENFORCEMENT] Completion operation skipped - status would have been: ${status}`);
    
    // Track the failure for metrics and debugging
    trackActivity('complete', runId, clientId, source, `ERROR: ${errorMsg}`);
    
    // Throw error as explicitly requested
    throw new Error(`Cannot complete non-existent run record for ${clientId} (${runId}). Record must exist before completion.`);
  }
  
  const endTimestamp = new Date().toISOString();
  
  // Calculate duration if start time exists
  let duration = null;
  const startTime = record.fields['Start Time'];
  
  if (startTime) {
    const start = new Date(startTime);
    const end = new Date(endTimestamp);
    duration = (end - start) / 1000; // Duration in seconds
  }
  
  // Update with completion info, removing problematic fields
  const updates = {
    'Status': status,
    'End Time': endTimestamp,
    // Notes added directly to System Notes instead of using Completion Notes field
    'System Notes': `Completed at ${endTimestamp} with status ${status} from ${source}. ${notes || ''}`
  };
  
  // Source info is already added to System Notes - don't try to use the Source field at all
  // Duration info added to System Notes instead of using Duration field
  if (duration !== null && updates && updates['System Notes']) {
    updates['System Notes'] += ` Duration: ${duration} seconds.`;
  }
  
  // Track this activity
  trackActivity('complete', runId, clientId, source, `Status: ${status}, Notes: ${notes}`);
  
  return await updateRunRecord(runId, clientId, updates, {
    logger,
    source: `completion_from_${source}`
  });
}

/**
 * Update a job tracking record
 * @param {string} runId - The run ID
 * @param {Object} updates - Updates to apply
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
async function updateJobRecord(runId, updates, options = {}) {
  const base = initialize();
  const logger = options.logger || new StructuredLogger('SYSTEM', runId, 'job_tracking');
  const source = options.source || 'unknown';
  
  // Strip client suffix if present
  const baseRunId = runIdService.stripClientSuffix(runId);
  
  logger.debug(`Run Record Service: Updating job tracking for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    // Find the job tracking record
    const records = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{Run ID} = '${baseRunId}'`
    }).firstPage();
    
    if (!records || records.length === 0) {
      const errorMsg = `Job tracking record not found for ${runId} (base: ${baseRunId})`;
      logger.error(errorMsg);
      trackActivity('update_job', baseRunId, 'SYSTEM', source, `ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    const record = records[0];
    
    // Update the record with all required fields, completely removing Source field
    const updateFields = {
      ...updates,
      'Last Updated': new Date().toISOString()
    };
    
    // Add update source information to System Notes
    const updateNote = `Job updated at ${new Date().toISOString()} from ${source}`;
    if (updates['System Notes']) {
      updateFields['System Notes'] = `${updates['System Notes']}. ${updateNote}`;
    } else {
      const existingNotes = record.fields['System Notes'] || '';
      updateFields['System Notes'] = `${existingNotes}${existingNotes ? '. ' : ''}${updateNote}`;
    }
    
    const updateData = {
      id: record.id,
      fields: updateFields
    };
    
    logger.debug(`Run Record Service: Updating job record ${record.id} with data: ${JSON.stringify(updateData.fields)}`);
    
    const updatedRecords = await base(JOB_TRACKING_TABLE).update([updateData]);
    
    if (!updatedRecords || updatedRecords.length === 0) {
      throw new Error('Failed to update job record - no record returned');
    }
    
    // Track this activity
    trackActivity('update_job', baseRunId, 'SYSTEM', source, `SUCCESS: Updated job record ${record.id}`);
    
    logger.debug(`Run Record Service: Successfully updated job record ${record.id}`);
    
    return updatedRecords[0];
  } catch (error) {
    logger.error(`Run Record Service ERROR during job update: ${error.message}`);
    trackActivity('update_job', baseRunId, 'SYSTEM', source, `ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a job run with final status
 * @param {string} runId - The run ID
 * @param {boolean} success - Whether the job was successful
 * @param {string} notes - Additional notes
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The updated record
 */
async function completeJobRecord(runId, success, notes = '', options = {}) {
  const logger = options.logger || new StructuredLogger('SYSTEM', runId, 'job_tracking');
  const source = options.source || 'unknown';
  
  // Strip client suffix if present
  const baseRunId = runIdService.stripClientSuffix(runId);
  
  logger.debug(`Run Record Service: Completing job record for ${runId} (base: ${baseRunId})`);
  
  const endTimestamp = new Date().toISOString();
  
  const updates = {
    'Status': success ? 'Success' : 'Error',
    'End Time': endTimestamp,
    // Notes added directly to System Notes instead of using Completion Notes field
    'System Notes': `Job completed at ${endTimestamp} with status ${success ? 'Success' : 'Error'} from ${source}. ${notes || ''}`
  };
  
  // Track this activity
  trackActivity('complete_job', baseRunId, 'SYSTEM', source, `Success: ${success}, Notes: ${notes}`);
  
  return await updateJobRecord(baseRunId, updates, {
    logger,
    source: `job_completion_from_${source}`
  });
}

/**
 * Get the activity log for debugging
 * @param {number} limit - Maximum number of entries to return
 * @returns {Array} The activity log
 */
function getActivityLog(limit = 50) {
  return activityLog.slice(0, limit);
}

/**
 * Get statistics about run records
 * @returns {Object} Statistics
 */
function getStats() {
  return {
    registrySize: runRecordRegistry.size,
    activityLogSize: activityLog.length,
    recordTypes: countRecordTypes()
  };
}

/**
 * Count types of records in registry
 * @returns {Object} Counts by type
 */
function countRecordTypes() {
  const counts = { running: 0, completed: 0, error: 0, other: 0 };
  
  for (const [_, record] of runRecordRegistry.entries()) {
    const status = record.fields?.Status?.toLowerCase() || '';
    if (status === 'running') {
      counts.running++;
    } else if (status === 'success' || status === 'completed') {
      counts.completed++;
    } else if (status === 'error' || status === 'failed') {
      counts.error++;
    } else {
      counts.other++;
    }
  }
  
  return counts;
}

/**
 * Check if a run record exists without attempting to create it
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID (optional, can be extracted from runId if it contains client suffix)
 * @returns {Promise<boolean>} True if record exists, false otherwise
 */
async function checkRunRecordExists(runId, clientId = null) {
  try {
    console.log(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] checkRunRecordExists called with runId=${runId}, clientId=${clientId}`);
    
    // Extract client ID from runId if not provided and runId contains client suffix
    if (!clientId && runId && runId.includes('-C')) {
      const parts = runId.split('-C');
      if (parts.length > 1) {
        clientId = parts[1];
        console.log(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] Extracted clientId=${clientId} from runId`);
      }
    }
    
    if (!clientId) {
      console.error(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] ❌ Cannot check existence without clientId for runId ${runId}`);
      return false;
    }
    
    // Use getRunRecord which never creates if not found
    console.log(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] Calling getRunRecord with runId=${runId}, clientId=${clientId}`);
    const record = await getRunRecord(runId, clientId, { source: 'checkRunRecordExists' });
    console.log(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] getRunRecord result: ${record ? "Found record" : "No record found"}`);
    
    if (record) {
      console.log(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] Record details: ID=${record.id}, Run ID=${record.fields['Run ID']}`);
    } else {
      // Try to find any similar records
      try {
        console.log(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] Searching for any records for client ${clientId}`);
        const base = initialize();
        const records = await base(CLIENT_RUN_RESULTS_TABLE).select({
          filterByFormula: `{Client ID} = '${clientId}'`, // Fixed back to Client ID which is the correct field name in Airtable schema
          maxRecords: 5,
          sort: [{ field: 'Start Time', direction: 'desc' }]
        }).firstPage();
        
        if (records && records.length > 0) {
          console.log(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] Found ${records.length} recent records for client ${clientId}:`);
          records.forEach(rec => {
            console.log(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] - Run ID: ${rec.fields['Run ID']}, Start Time: ${rec.fields['Start Time']}`);
          });
        } else {
          console.log(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] No records found for client ${clientId}`);
        }
      } catch (searchError) {
        console.error(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] Error searching for client records: ${searchError.message}`);
      }
    }
    
    return record !== null;
  } catch (error) {
    console.error(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] ❌ Error checking run record existence: ${error.message}`);
    console.error(`[DEBUG-RUN-ID-FLOW][RUN-RECORD-SERVICE] Stack trace: ${error.stack}`);
    return false;
  }
}

// Export all functions
module.exports = {
  initialize,
  createJobRecord,
  createClientRunRecord,
  getRunRecord,
  updateRunRecord,
  updateClientMetrics,
  completeRunRecord,
  updateJobRecord,
  completeJobRecord,
  getActivityLog,
  getStats,
  checkRunRecordExists
};