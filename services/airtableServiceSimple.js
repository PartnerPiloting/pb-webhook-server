// services/airtableServiceSimple.js
// Simplified service for tracking run metrics in Airtable
// Follows the "Create once, update many, error if missing" principle

require('dotenv').config();
const Airtable = require('airtable');
const { 
  MASTER_TABLES, 
  CLIENT_RUN_FIELDS,
  JOB_TRACKING_FIELDS,
  FORMULA_FIELDS,
  CLIENT_RUN_STATUS_VALUES
} = require('../constants/airtableUnifiedConstants');

// Import validation utilities
const { validateFieldNames, createValidatedObject } = require('../utils/airtableFieldValidator');

// Constants for table names - Use centralized constants
const JOB_TRACKING_TABLE = MASTER_TABLES.JOB_TRACKING;
const CLIENT_RUN_RESULTS_TABLE = MASTER_TABLES.CLIENT_RUN_RESULTS;

// Initialize client base connection
let clientsBase = null;

/**
 * Utility function to filter out formula fields from updates
 * @param {Object} updates - The updates to apply
 * @returns {Object} - Sanitized updates with formula fields removed
 */
function validateUpdates(updates) {
  if (!updates || typeof updates !== 'object') {
    return updates;
  }
  
  const validatedUpdates = {...updates};
  
  // Check for and remove any formula fields
  for (const key of Object.keys(validatedUpdates)) {
    if (FORMULA_FIELDS.includes(key)) {
      console.warn(`⚠️ Attempted to update formula field "${key}" which cannot be directly updated. Removing from updates.`);
      delete validatedUpdates[key];
    }
  }
  
  return validatedUpdates;
}

/**
 * Initialize connection to the Clients base
 * @returns {Object} The initialized Airtable base object
 */
function initialize() {
  if (clientsBase) {
    console.log("Airtable Simple Service: Using existing base connection");
    return clientsBase;
  }

  try {
    if (!process.env.MASTER_CLIENTS_BASE_ID) {
      throw new Error("MASTER_CLIENTS_BASE_ID environment variable is not set");
    }
    if (!process.env.AIRTABLE_API_KEY) {
      throw new Error("AIRTABLE_API_KEY environment variable is not set");
    }

    // Configure Airtable
    Airtable.configure({
      apiKey: process.env.AIRTABLE_API_KEY
    });

    clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    console.log("Airtable Simple Service: Successfully initialized Airtable base connection");
    
    return clientsBase;
  } catch (error) {
    console.error("CRITICAL ERROR initializing Airtable connection:", error.message);
    throw error;
  }
}

/**
 * Create a job tracking record - ONLY called at the start of a job
 * @param {string} runId - The job run ID (timestamp format preferred)
 * @param {number} stream - The stream number
 * @returns {Promise<Object>} The created record
 */
async function createJobTrackingRecord(runId, stream) {
  console.log(`Creating job tracking record: ${runId}`);
  
  const base = initialize();
  
  try {
    // Check if record already exists to prevent duplicates
    const existingRecords = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{Run ID} = '${runId}'`,
      maxRecords: 1
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      console.error(`Job tracking record already exists for ${runId}`);
      return existingRecords[0];
    }
    
    const startTimestamp = new Date().toISOString();
    
    // Convert stream to a number if it's a string
    const streamNumber = typeof stream === 'string' ? parseInt(stream, 10) : stream;

    // Create complete record data
    const recordData = {
      'Run ID': runId,
      'Start Time': startTimestamp,
      'Status': 'Running',
      'Stream': streamNumber,
      // NOTE: 'Clients Processed', 'Clients With Errors', and 'Total Profiles Examined' removed from Job Tracking (calculated on-the-fly)
      // 'Total Profiles Examined': 0, - Removed 2025-10-02 (field deleted from Job Tracking table)
      'Successful Profiles': 0,
      'Total Posts Harvested': 0,
      'Posts Examined for Scoring': 0, 
      'Posts Successfully Scored': 0,
      'Profile Scoring Tokens': 0,
      'Post Scoring Tokens': 0,
      'System Notes': `Run initiated at ${startTimestamp}`
    };
    
    // Validate to remove any formula fields
    const safeData = validateUpdates(recordData);
    
    const records = await base(JOB_TRACKING_TABLE).create([
      {
        fields: safeData
      }
    ]);

    console.log(`✅ Created job tracking record: ${records[0].id}`);
    return records[0];
  } catch (error) {
    console.error(`❌ FATAL: Failed to create job tracking record: ${error.message}`);
    throw error; // Let it fail loudly
  }
}

/**
 * Create a client run record - ONLY called at the start of client processing
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} clientName - The client name
 * @returns {Promise<Object>} The created record
 */
async function createClientRunRecord(runId, clientId, clientName) {
  console.log(`Creating client run record: ${runId} for ${clientId}`);
  
  const base = initialize();
  
  try {
    // Check if record already exists to prevent duplicates
    const existingRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${runId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientId}')`,
      maxRecords: 1
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      console.error(`Client run record already exists for ${runId}, ${clientId}`);
      return existingRecords[0];
    }
    
    const startTimestamp = new Date().toISOString();
    
    // Create record data using field constants
    const recordData = {
      [CLIENT_RUN_FIELDS.RUN_ID]: runId,
      [CLIENT_RUN_FIELDS.CLIENT_ID]: clientId,
      [CLIENT_RUN_FIELDS.CLIENT_NAME]: clientName,
      [CLIENT_RUN_FIELDS.START_TIME]: startTimestamp,
      [CLIENT_RUN_FIELDS.STATUS]: 'Running',
      [CLIENT_RUN_FIELDS.PROFILES_EXAMINED]: 0,
      [CLIENT_RUN_FIELDS.PROFILES_SUCCESSFULLY_SCORED]: 0,
      [CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: 0,
      [CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS]: 0,
      [CLIENT_RUN_FIELDS.POST_SCORING_TOKENS]: 0,
      'System Notes': `Processing started at ${startTimestamp}`
    };
    
    // Validate to remove any formula fields
    const safeData = validateUpdates(recordData);
    
    const records = await base(CLIENT_RUN_RESULTS_TABLE).create([
      {
        fields: safeData
      }
    ]);
    
    console.log(`✅ Created client run record: ${records[0].id}`);
    return records[0];
  } catch (error) {
    console.error(`❌ FATAL: Failed to create client run record: ${error.message}`);
    throw error; // Let it fail loudly
  }
}

/**
 * Update a job tracking record - MUST exist
 * @param {string} runId - The run ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} The updated record or error object
 */
async function updateJobTracking(runId, updates) {
  console.log(`Updating job tracking record: ${runId}`);
  
  const base = initialize();
  
  // Import the new run ID system
  const runIdSystem = require('./runIdSystem');
  
  // Use the new system to standardize the run ID
  const standardizedRunId = runIdSystem.validateAndStandardizeRunId(runId);
  
  try {
    const records = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{Run ID} = '${standardizedRunId}'`,
      maxRecords: 1
    }).firstPage();
    
    if (!records || records.length === 0) {
      const error = `❌ Job tracking record not found for ${runId} (standardized: ${standardizedRunId}). Record was not created at job start!`;
      console.error(error);
      return { error: true, message: error };
    }
    
    // Validate updates to prevent formula field errors
    const safeUpdates = validateUpdates(updates);
    const updated = await base(JOB_TRACKING_TABLE).update(records[0].id, safeUpdates);
    console.log(`✅ Updated job tracking record`);
    return updated;
    
  } catch (error) {
    console.error(`❌ [ERROR] Failed to update job tracking record: ${error.message}`);
    return { error: true, message: error.message };
  }
}

/**
 * Update a client run record - MUST exist
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} The updated record or error object
 */
async function updateClientRun(runId, clientId, updates) {
  console.log(`Updating client run record: ${runId} for ${clientId}`);
  
  const base = initialize();
  
  try {
    const records = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `AND({Run ID} = '${runId}', {Client ID} = '${clientId}')`,
      maxRecords: 1
    }).firstPage();
    
    if (!records || records.length === 0) {
      const error = `❌ Client run record not found for ${runId}, ${clientId}. Record was not created at client job start!`;
      console.error(error);
      return { error: true, message: error };
    }
    
    // Validate updates to prevent formula field errors
    const safeUpdates = validateUpdates(updates);
    const updated = await base(CLIENT_RUN_RESULTS_TABLE).update(records[0].id, safeUpdates);
    console.log(`✅ Updated client run record`);
    return updated;
    
  } catch (error) {
    console.error(`❌ [ERROR] Failed to update client run record: ${error.message}`);
    return { error: true, message: error.message };
  }
}

/**
 * Complete a job run - MUST exist
 * @param {string} runId - The run ID
 * @param {boolean} success - Whether the job succeeded
 * @param {string} notes - Notes to append
 * @returns {Promise<Object>} The updated record or error object
 */
async function completeJobRun(runId, success = true, notes = '') {
  const updates = {
    [JOB_TRACKING_FIELDS.END_TIME]: new Date().toISOString(),
    [JOB_TRACKING_FIELDS.STATUS]: success ? CLIENT_RUN_STATUS_VALUES.COMPLETED : CLIENT_RUN_STATUS_VALUES.FAILED
  };
  
  if (notes) {
    updates[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = `${notes}\nRun ${success ? 'completed' : 'failed'} at ${new Date().toISOString()}`;
  }
  
  // Validate field names before sending to Airtable
  const validatedUpdates = createValidatedObject(updates);
  
  return await updateJobTracking(runId, validatedUpdates);
}

/**
 * Complete a client run - MUST exist
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object|boolean} updateData - Either standardized field object or legacy success boolean
 * @param {string} [notes] - Legacy notes parameter (only used if updateData is boolean)
 * @returns {Promise<Object>} The updated record or error object
 */
async function completeClientRun(runId, clientId, updateData, notes = '') {
  // ROOT CAUSE FIX: Validate parameters to prevent [object Object] errors
  const ParameterValidator = require('../utils/parameterValidator');
  
  // Validate runId
  const validatedRunId = ParameterValidator.validateRunId(runId, 'completeClientRun');
  if (!validatedRunId) {
    console.error(`[AirtableServiceSimple] Invalid runId parameter: ${JSON.stringify(runId)}`);
    throw new Error(`Invalid runId parameter: ${JSON.stringify(runId)}`);
  }
  
  // Validate clientId
  const validatedClientId = ParameterValidator.validateClientId(clientId, 'completeClientRun');
  if (!validatedClientId) {
    console.error(`[AirtableServiceSimple] Invalid clientId parameter: ${JSON.stringify(clientId)}`);
    throw new Error(`Invalid clientId parameter: ${JSON.stringify(clientId)}`);
  }
  
  // Initialize updates object with end time
  const updates = {};
  updates[CLIENT_RUN_FIELDS.END_TIME] = new Date().toISOString();
  
  // Handle both standardized field object and legacy parameters
  if (typeof updateData === 'object' && updateData !== null) {
    // Using standardized field object - copy all provided fields to updates
    Object.keys(updateData).forEach(key => {
      updates[key] = updateData[key];
    });
    
    // Make sure status is set
    if (!updates[CLIENT_RUN_FIELDS.STATUS]) {
      console.warn(`[AirtableServiceSimple] Status not provided in updateData, defaulting to COMPLETED`);
      updates[CLIENT_RUN_FIELDS.STATUS] = CLIENT_RUN_STATUS_VALUES.COMPLETED;
    }
    
    // Add timestamp to notes if provided
    if (updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES]) {
      updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = 
        `${updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES]}\nRun completed at ${new Date().toISOString()}`;
    } else {
      updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = `Run completed at ${new Date().toISOString()}`;
    }
  } else {
    // Legacy boolean success parameter
    const successBoolean = (typeof updateData === 'boolean') ? updateData : Boolean(updateData);
    const safeNotes = (typeof notes === 'string') ? notes : String(notes || '');
    
    updates[CLIENT_RUN_FIELDS.STATUS] = successBoolean ? CLIENT_RUN_STATUS_VALUES.COMPLETED : CLIENT_RUN_STATUS_VALUES.FAILED;
    updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = safeNotes 
      ? `${safeNotes}\nRun ${successBoolean ? 'completed' : 'failed'} at ${new Date().toISOString()}`
      : `Run ${successBoolean ? 'completed' : 'failed'} at ${new Date().toISOString()}`;
  }
  
  // Validate field names before sending to Airtable
  const validatedUpdates = createValidatedObject(updates);
  
  return await updateClientRun(validatedRunId, validatedClientId, validatedUpdates);
}

/**
 * Calculate aggregate metrics from Client Run Results records without storing them in Job Tracking
 * Following the Single Source of Truth principle - data is only stored in Client Run Results
 * and aggregated on-the-fly when needed
 * 
 * @param {string} runId - The run ID
 * @returns {Promise<Object>} The calculated metrics
 */
async function getAggregateMetrics(runId) {
  console.log(`Calculating aggregate metrics for run: ${runId}`);
  
  const base = initialize();
  
  try {
    // Get client run records for this job
    const clientRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `FIND('${runId}', {${CLIENT_RUN_FIELDS.RUN_ID}}) > 0`
    }).all();
    
    if (!clientRecords || clientRecords.length === 0) {
      console.warn(`No client records found for run ID: ${runId}`);
      return { 
        warning: `No client records found for run ID: ${runId}`,
        metrics: {}
      };
    }
    
    // Calculate metrics on-the-fly (not stored in Airtable)
    const metrics = {
      // Client metrics
      clientsProcessed: clientRecords.length,
      clientsWithErrors: clientRecords.filter(r => r.fields[CLIENT_RUN_FIELDS.STATUS] === CLIENT_RUN_STATUS_VALUES.FAILED).length,
      
      // Initialize aggregation counters
      totalProfilesExamined: 0,
      successfulProfiles: 0,
      totalPostsHarvested: 0,
      postsExamined: 0,
      postsScored: 0,
      profileScoringTokens: 0,
      postScoringTokens: 0,
      totalTokensUsed: 0
    };
    
    // Sum up metrics from all client records
    clientRecords.forEach(record => {
      metrics.totalProfilesExamined += Number(record.fields[CLIENT_RUN_FIELDS.PROFILES_EXAMINED] || 0);
      metrics.successfulProfiles += Number(record.fields[CLIENT_RUN_FIELDS.PROFILES_SUCCESSFULLY_SCORED] || 0);
      metrics.totalPostsHarvested += Number(record.fields[CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED] || 0);
      metrics.postsExamined += Number(record.fields[CLIENT_RUN_FIELDS.POSTS_EXAMINED] || 0);
      metrics.postsScored += Number(record.fields[CLIENT_RUN_FIELDS.POSTS_SUCCESSFULLY_SCORED] || 0);
      metrics.profileScoringTokens += Number(record.fields[CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS] || 0);
      metrics.postScoringTokens += Number(record.fields[CLIENT_RUN_FIELDS.POST_SCORING_TOKENS] || 0);
    });
    
    // Calculate derived metrics
    metrics.totalTokensUsed = metrics.profileScoringTokens + metrics.postScoringTokens;
    
    // Calculate success rates
    metrics.profileSuccessRate = metrics.totalProfilesExamined > 0 
      ? (metrics.successfulProfiles / metrics.totalProfilesExamined * 100).toFixed(1) + '%'
      : '0%';
      
    metrics.postSuccessRate = metrics.postsExamined > 0
      ? (metrics.postsScored / metrics.postsExamined * 100).toFixed(1) + '%'
      : '0%';
      
    // Add any other calculated metrics here
    
    return { metrics };
  } catch (error) {
    console.error(`❌ [ERROR] Failed to calculate aggregate metrics: ${error.message}`);
    return { 
      error: true, 
      message: error.message,
      metrics: {} 
    };
  }
}

/**
 * Legacy function kept for backwards compatibility
 * Now just returns the calculated metrics without updating anything in Airtable
 * 
 * @param {string} runId - The run ID
 * @returns {Promise<Object>} The calculated metrics
 */
async function updateAggregateMetrics(runId) {
  console.log(`[DEPRECATED] Using on-the-fly calculation for metrics instead of storing in Job Tracking`);
  return await getAggregateMetrics(runId);
}

/**
 * Get the initialized base connection
 * @returns {Object} The Airtable base object
 */
function getBase() {
  return initialize();
}

module.exports = {
  initialize,
  createJobTrackingRecord,
  createClientRunRecord,
  updateJobTracking,
  updateClientRun,
  completeJobRun,
  completeClientRun,
  getAggregateMetrics, // New function for on-the-fly calculation
  updateAggregateMetrics, // Legacy function now using on-the-fly calculation
  getBase,
  JOB_TRACKING_TABLE,
  CLIENT_RUN_RESULTS_TABLE
};