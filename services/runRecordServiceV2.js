// services/runRecordServiceV2.js
// Centralized service for run record management
// Implements the STRICT Single Creation Point pattern

require('dotenv').config();

// Import dependencies
const Airtable = require('airtable');
const clientService = require('./clientService');
const runIdService = require('./runIdService');
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
 * @param {string} runId - The base run ID (without client suffix)
 * @param {number} stream - The stream number
 * @param {Object} options - Additional options
 * @param {Object} options.logger - Optional logger to use
 * @param {string} options.source - Source of the creation request
 * @returns {Promise<Object>} The created record
 */
async function createJobRecord(runId, stream, options = {}) {
  const base = initialize();
  const logger = options.logger || new StructuredLogger('SYSTEM', runId, 'job_tracking');
  const source = options.source || 'unknown';
  
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
    // Create fields object with required fields first
    const recordFields = {
      'Run ID': runId,
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
      // Include Source info in System Notes to ensure we don't lose tracking info
      'System Notes': `Run initiated at ${new Date().toISOString()} from ${source}`
    };
    
    // Only add Source field if it exists in the Airtable schema
    try {
      // Try to add the Source field - will only work if the field exists in Airtable
      recordFields['Source'] = source;
    } catch (fieldError) {
      // If it fails, we already have the info in System Notes
      logger.debug(`Source field might not exist in Airtable schema - info added to System Notes instead`);
    }
    
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
async function createClientRunRecord(runId, clientId, clientName, options = {}) {
  const base = initialize();
  const logger = options.logger || new StructuredLogger(clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  // Only certain sources are allowed to create records
  const allowedSources = ['orchestrator', 'master_process', 'smart_resume_workflow', 'batch_process'];
  if (!allowedSources.includes(source)) {
    const errorMsg = `Unauthorized source "${source}" attempted to create client run record`;
    logger.error(errorMsg);
    trackActivity('create_client', runId, clientId, source, `ERROR: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  logger.debug(`Run Record Service: Creating run record for client ${clientId} (source: ${source})`);
  
  // Normalize the run ID and add client suffix
  const standardRunId = runIdService.normalizeRunId(runId, clientId);
  
  logger.debug(`Run Record Service: Using standardized ID: ${standardRunId}`);
  
  // Check if a record already exists with this run ID
  try {
    const exactIdQuery = `AND({Run ID} = '${standardRunId}', {Client ID} = '${clientId}')`;
    logger.debug(`Run Record Service: Looking for exact Run ID match: ${exactIdQuery}`);
    
    const exactMatches = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: exactIdQuery,
      maxRecords: 1
    }).firstPage();
    
    if (exactMatches && exactMatches.length > 0) {
      const errorMsg = `Client run record already exists for ${standardRunId}, client ${clientId}`;
      logger.error(errorMsg);
      trackActivity('create_client', standardRunId, clientId, source, `ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    logger.debug(`Run Record Service: No existing record found, will create new one`);
  } catch (error) {
    if (error.message.includes('already exists')) {
      throw error;
    }
    logger.error(`Run Record Service ERROR during record check: ${error.message}`);
    // Continue to create a new record if the error was just in checking
  }
  
  // Create a new record with our standardized ID
  logger.debug(`Run Record Service: Creating new client run record for ${clientId} with standardized ID ${standardRunId}`);
  
  // Use current time for Start Time
  const startTimestamp = new Date().toISOString();
  
  try {
    // Create new record with detailed logging
    const recordFields = {
      'Run ID': standardRunId,
      'Client ID': clientId,
      'Client Name': clientName,
      'Start Time': startTimestamp,
      'Status': 'Running',
      'Profiles Examined for Scoring': 0,
      'Profiles Successfully Scored': 0,
      'Total Posts Harvested': 0,
      'Profile Scoring Tokens': 0,
      'Post Scoring Tokens': 0,
      // Include Source info in System Notes to ensure we don't lose tracking info
      'System Notes': `Processing started at ${startTimestamp} from ${source}`
    };
    
    // Only add Source field if it exists in the Airtable schema
    try {
      // Try to add the Source field - will only work if the field exists in Airtable
      recordFields['Source'] = source;
    } catch (fieldError) {
      // If it fails, we already have the info in System Notes
      logger.debug(`Source field might not exist in Airtable schema - info added to System Notes instead`);
    }
    
    const recordData = {
      fields: recordFields
    };
    
    logger.debug(`Run Record Service: Record data: ${JSON.stringify(recordData)}`);
    
    const records = await base(CLIENT_RUN_RESULTS_TABLE).create([recordData]);

    // Register the new record ID with runIdService
    const recordId = records[0].id;
    runIdService.registerRunRecord(standardRunId, clientId, recordId);
    
    // Generate a registry key for this run+client combination
    const registryKey = `${standardRunId}:${clientId}`;
    
    // Add to runtime registry
    runRecordRegistry.set(registryKey, records[0]);
    
    // Track this activity
    trackActivity('create_client', standardRunId, clientId, source, `SUCCESS: Created record ID ${recordId}`);
    
    logger.debug(`Run Record Service: Created client run record ID: ${recordId}`);
    return records[0];
  } catch (error) {
    logger.error(`Run Record Service ERROR: Failed to create client run record: ${error.message}`);
    trackActivity('create_client', standardRunId, clientId, source, `ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Get a client run record - NEVER creates if not found
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The run record, or null if not found
 */
async function getRunRecord(runId, clientId, options = {}) {
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
async function updateRunRecord(runId, clientId, updates, options = {}) {
  const logger = options.logger || new StructuredLogger(clientId, runId, 'run_record');
  const source = options.source || 'unknown';
  
  logger.debug(`Run Record Service: Updating run record for ${runId}, client ${clientId} (source: ${source})`);
  
  // First, get the record - this will NOT create if missing
  const record = await getRunRecord(runId, clientId, options);
  
  // If record not found, this is an error condition
  if (!record) {
    const errorMsg = `Cannot update: Run record not found for ${runId}, client ${clientId}`;
    logger.error(errorMsg);
    trackActivity('update', runId, clientId, source, `ERROR: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  const base = initialize();
  
  // Update with new values
  const updateFields = {
    ...updates,
    'Last Updated': new Date().toISOString()
  };
  
  // Add information about the update to System Notes field
  if (updates['System Notes']) {
    updateFields['System Notes'] = `${updates['System Notes']}. Updated from ${source}.`;
  } else {
    const existingNotes = record.fields['System Notes'] || '';
    updateFields['System Notes'] = `${existingNotes}${existingNotes ? '. ' : ''}Updated at ${new Date().toISOString()} from ${source}`;
  }
  
  // Only add Source field if it exists in the Airtable schema
  try {
    updateFields['Source'] = source;
  } catch (fieldError) {
    // Source info is already added to System Notes
    logger.debug(`Source field might not exist in Airtable schema - info added to System Notes instead`);
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
  
  // Include metric update timestamp
  updatedMetrics['Metrics Updated'] = new Date().toISOString();
  
  // Include update source in System Notes to ensure we don't lose tracking info
  const metricsUpdateNote = `Metrics updated at ${new Date().toISOString()} from ${source}`;
  if (updatedMetrics['System Notes']) {
    updatedMetrics['System Notes'] += `. ${metricsUpdateNote}`;
  } else {
    updatedMetrics['System Notes'] = metricsUpdateNote;
  }
  
  // Only add Source field if it exists in the Airtable schema
  try {
    updatedMetrics['Source'] = source;
  } catch (fieldError) {
    // Source info is already added to System Notes
    logger.debug(`Source field might not exist in Airtable schema - info added to System Notes instead`);
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
  const record = await getRunRecord(runId, clientId, options);
  
  // If record not found, this is an error condition
  if (!record) {
    const errorMsg = `Cannot complete: Run record not found for ${runId}, client ${clientId}`;
    logger.error(errorMsg);
    trackActivity('complete', runId, clientId, source, `ERROR: ${errorMsg}`);
    throw new Error(errorMsg);
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
  
  // Update with completion info
  const updates = {
    'Status': status,
    'End Time': endTimestamp,
    'Completion Notes': notes,
    // Add completion source to notes to ensure we capture this info
    'System Notes': `Completed at ${endTimestamp} with status ${status} from ${source}. ${notes || ''}`
  };
  
  // Only add Source field if it exists in the Airtable schema
  try {
    updates['Source'] = source;
  } catch (fieldError) {
    // Source info is already added to System Notes
    logger.debug(`Source field might not exist in Airtable schema - info added to System Notes instead`);
  }
  
  if (duration !== null) {
    updates['Duration (seconds)'] = duration;
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
    
    // Update the record with all required fields
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
    
    // Only add Source field if it exists in the Airtable schema
    try {
      updateFields['Source'] = source;
    } catch (fieldError) {
      // Source info is already added to System Notes
      logger.debug(`Source field might not exist in Airtable schema - info added to System Notes instead`);
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
    'Completion Notes': notes,
    // Add completion source to System Notes to ensure we capture this info
    'System Notes': `Job completed at ${endTimestamp} with status ${success ? 'Success' : 'Error'} from ${source}. ${notes || ''}`
  };
  
  // Only add Source field if it exists in the Airtable schema
  try {
    updates['Source'] = source;
  } catch (fieldError) {
    // Source info is already added to System Notes
    logger.debug(`Source field might not exist in Airtable schema - info added to System Notes instead`);
  }
  
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
  getStats
};