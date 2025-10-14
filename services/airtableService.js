// services/airtableService.js
// Removed old error logger - now using production issue tracking
const logCriticalError = async () => {};
// Service for tracking run metrics in Airtable
// Handles recording data to Job Tracking and Client Run Results tables

require('dotenv').config();
const Airtable = require('airtable');
const { createLogger } = require('../utils/contextLogger');

// Create module-level logger for airtable service
const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'airtable-service' 
});
const runIdUtils = require('../utils/runIdUtils');

// Import the client service with explicit destructuring to ensure we get what we need
// This helps identify missing exports immediately rather than at runtime
let clientService;
try {
    clientService = require('./clientService');
    // Verify the critical functions exist
    if (!clientService.initializeClientsBase) {
        logger.error("ERROR: clientService.initializeClientsBase function is missing");
    }
} catch (e) {
    logger.error("CRITICAL ERROR: Failed to load clientService module:", e.message);
    logCriticalError(e, { context: 'Module initialization error', service: 'airtableService.js' }).catch(() => {});
}

// Import new run ID system for centralized run ID management
const runIdSystem = require('./runIdSystem');

// Import record caching service
const recordCache = require('./recordCache');

// Import Airtable constants
const { MASTER_TABLES, CLIENT_RUN_FIELDS, JOB_TRACKING_FIELDS, CLIENT_RUN_STATUS_VALUES } = require('../constants/airtableUnifiedConstants');

// Constants for table names
const JOB_TRACKING_TABLE = MASTER_TABLES.JOB_TRACKING;
const CLIENT_RUN_RESULTS_TABLE = MASTER_TABLES.CLIENT_RUN_RESULTS;

// Initialize clients base reference
let clientsBase = null;

/**
 * Initialize connection to the Clients base
 * @returns {Object} The Airtable base object
 */
function initialize() {
  if (clientsBase) {
    logger.info("Airtable Service: Using existing base connection");
    return clientsBase;
  }

  try {
    // Check if clientService is properly loaded
    if (!clientService || typeof clientService.initializeClientsBase !== 'function') {
      logger.error("ERROR: clientService is not properly loaded or initializeClientsBase is not a function");
      logger.error("clientService type:", typeof clientService);
      logger.error("clientService functions available:", 
                   clientService ? Object.keys(clientService).join(", ") : "NONE");
      
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

      logger.info("FALLBACK: Directly initializing Airtable base connection");
      clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
      logger.info("FALLBACK: Successfully initialized Airtable base directly");
    } else {
      // Use clientService's initialization (preferred method)
      try {
        logger.info("Attempting to use clientService.initializeClientsBase()...");
        clientsBase = clientService.initializeClientsBase();
        logger.info("Airtable Service: Successfully got base connection from clientService");
      } catch (initError) {
        logger.error("ERROR using clientService.initializeClientsBase():", initError.message);
        logCriticalError(initError, { context: 'Fallback to direct Airtable init', service: 'airtableService.js' }).catch(() => {});
        logger.info("Falling back to direct initialization...");
        
        // Configure Airtable directly as fallback
        Airtable.configure({
          apiKey: process.env.AIRTABLE_API_KEY
        });
        
        clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
        logger.info("FALLBACK: Successfully initialized Airtable base directly after clientService failed");
      }
    }

    if (!clientsBase) {
      throw new Error("Failed to initialize clients base in airtableService");
    }

    logger.info("Airtable Service: Run tracking tables connection initialized");
    return clientsBase;
  } catch (error) {
    logger.error("CRITICAL ERROR initializing Airtable connection:", error.message);
    logCriticalError(error, { context: 'Emergency fallback initialization', service: 'airtableService.js' }).catch(() => {});
    // Create a last-resort fallback attempt
    try {
      logger.info("CRITICAL FALLBACK: Attempting emergency direct Airtable connection...");
      Airtable.configure({
        apiKey: process.env.AIRTABLE_API_KEY
      });
      clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
      logger.info("CRITICAL FALLBACK: Emergency Airtable connection successful");
      return clientsBase;
    } catch (fallbackError) {
      logger.error("FATAL ERROR: Emergency fallback also failed:", fallbackError.message);
      logCriticalError(fallbackError, { context: 'Service error (before throw)', service: 'airtableService.js' }).catch(() => {});
      throw error; // Throw the original error
    }
  }
}

/**
 * Create a new run record in the Job Tracking table
 * @param {string} runId - The structured run ID
 * @param {number} stream - The stream number
 * @returns {Promise<Object>} The created record
 */
async function createJobTrackingRecord(runId, stream) {
  const base = initialize();
  
  // Handle null or invalid run ID
  if (!runId) {
    logger.error(`Airtable Service ERROR: Attempting to create job tracking with invalid runId: ${runId}`);
    // Generate a valid runId if none provided
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(2, 14);
    runId = `${timestamp.substring(0, 6)}-${timestamp.substring(6, 12)}`;
    logger.info(`Airtable Service: Generated new runId: ${runId}`);
  }
  
  // Strip client suffix from runId to get the base run ID for tracking
  let baseRunId = runIdUtils.stripClientSuffix(runId);
  
  // Format check - ensure baseRunId matches expected pattern
  const runIdPattern = /^(\d{6}-\d{6})$/;
  if (!runIdPattern.test(baseRunId)) {
    logger.error(`Airtable Service WARNING: baseRunId doesn't match expected format: ${baseRunId}`);
    // Try to repair the format if possible
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(2, 14);
    baseRunId = `${timestamp.substring(0, 6)}-${timestamp.substring(6, 12)}`;
    logger.info(`Airtable Service: Repaired baseRunId to: ${baseRunId}`);
  }
  
  logger.info(`Airtable Service: Creating job tracking record for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    const records = await base(JOB_TRACKING_TABLE).create([
      {
        fields: {
          [JOB_TRACKING_FIELDS.RUN_ID]: baseRunId, // Use the base run ID without client suffix
          // CRR REDESIGN: Removed START_TIME and STATUS fields (replaced by Progress Log)
          [JOB_TRACKING_FIELDS.STREAM]: Number(stream), // Ensure stream is a number for Airtable's number field
          // NOTE: Job Tracking table stores minimal data. Most metrics are in Client Run Results table.
          // Removed fields (2025-10-02): Total Profiles Examined, Successful Profiles, Total Posts Harvested,
          // Posts Examined for Scoring, Posts Successfully Scored, Profile Scoring Tokens, Post Scoring Tokens
          // (all calculated on-the-fly from Client Run Results)
          [JOB_TRACKING_FIELDS.SYSTEM_NOTES]: `Run initiated at ${new Date().toISOString()}`
        }
      }
    ]);

    logger.info(`Airtable Service: Created job tracking record ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    logger.error(`Airtable Service ERROR: Failed to create job tracking record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'airtableService.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Create a client run result record
 * @param {string} runId - The structured run ID
 * @param {string} clientId - The client ID
 * @param {string} clientName - The client name
 * @returns {Promise<Object>} The created record
 */
async function createClientRunRecord(runId, clientId, clientName) {
  const base = initialize();
  
  // SIMPLIFIED: Just normalize the run ID once to ensure consistency
  const standardRunId = runIdSystem.validateAndStandardizeRunId(runId);
  
  logger.info(`Airtable Service: Creating run record for client ${clientId}`);
  logger.info(`Airtable Service: Using standardized ID: ${standardRunId}`);
  
  // First check if we have a cached record ID
  const cachedRecordId = runIdSystem.getRunRecordId(standardRunId, clientId);
  
  if (cachedRecordId) {
    logger.info(`Airtable Service: Using cached record ID ${cachedRecordId}`);
    try {
      // Verify the record exists
      const record = await base(CLIENT_RUN_RESULTS_TABLE).find(cachedRecordId);
      logger.info(`Airtable Service: Found existing record with ID ${cachedRecordId}`);
      return record;
    } catch (err) {
      logger.info(`Airtable Service: Cached record ID ${cachedRecordId} no longer valid`);
      await logCriticalError(err, { context: 'Cached record verification failed (fallback)', service: 'airtableService.js' }).catch(() => {});
      // Fall through to check by query
    }
  }
  
  // Check if a record already exists with this run ID
  try {
    const exactIdQuery = `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${standardRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientId}')`;
    logger.info(`Airtable Service: Looking for exact Run ID match: ${exactIdQuery}`);
    
    const exactMatches = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: exactIdQuery,
      maxRecords: 1
    }).firstPage();
    
    if (exactMatches && exactMatches.length > 0) {
      logger.info(`Airtable Service: Found existing record ID: ${exactMatches[0].id}`);
      
      // Register the record ID for future lookups
      runIdSystem.registerRunRecord(standardRunId, clientId, exactMatches[0].id);
      
      return exactMatches[0];
    }
    
    logger.info(`Airtable Service: No existing record found, will create new one`);
  } catch (error) {
    logger.error(`Airtable Service ERROR during record check: ${error.message}`);
    await logCriticalError(error, { context: 'Record lookup failed (will create new)', service: 'airtableService.js' }).catch(() => {});
    // Continue to create a new record
  }
  
  // Create a new record with our standardized ID
  logger.info(`Airtable Service: Creating new client run record for ${clientId} with standardized ID ${standardRunId}`);
  
  // SIMPLIFIED: Just use current time for Start Time
  const startTimestamp = new Date().toISOString();
  logger.info(`Airtable Service: Using Start Time: ${startTimestamp}`);
  
  try {
    // Create new record with detailed debug
    logger.info(`Airtable Service: CREATE DEBUG - Full record creation request:`);
    const recordData = {
      fields: {
        [CLIENT_RUN_FIELDS.RUN_ID]: standardRunId, // Always use our standardized timestamp format
        [CLIENT_RUN_FIELDS.CLIENT_ID]: clientId,
        [CLIENT_RUN_FIELDS.CLIENT_NAME]: clientName,
        // CRR REDESIGN: Removed START_TIME and STATUS fields (replaced by Progress Log)
        [CLIENT_RUN_FIELDS.PROFILES_EXAMINED]: 0,
        [CLIENT_RUN_FIELDS.PROFILES_SCORED]: 0,
        [CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: 0,
        [CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS]: 0,
        [CLIENT_RUN_FIELDS.POST_SCORING_TOKENS]: 0,
        [CLIENT_RUN_FIELDS.SYSTEM_NOTES]: `Processing started at ${startTimestamp}`
      }
    };
    logger.info(`Airtable Service: CREATE DEBUG - Record data:`, JSON.stringify(recordData));
    
    const records = await base(CLIENT_RUN_RESULTS_TABLE).create([recordData]);

    // Register the new record ID with runIdSystem
    runIdSystem.registerRunRecord(standardRunId, clientId, records[0].id);
    
    logger.info(`Airtable Service: Created client run record ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    logger.error(`Airtable Service ERROR: Failed to create client run record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'airtableService.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Update an existing job tracking record
 * @param {string} runId - The run ID to update (may contain client suffix)
 * @param {Object} updates - Field updates to apply
 * @returns {Promise<Object>} The updated record
 */
async function updateJobTracking(runId, updates) {
  const base = initialize();
  
  // Import the new run ID system
  const runIdSystem = require('./runIdSystem');
  
  // Use the new system to standardize the run ID
  const standardizedRunId = runIdSystem.validateAndStandardizeRunId(runId);
  
  // Extract the base run ID using the new system
  let baseRunId = runIdSystem.getBaseRunId(standardizedRunId);
  
  // Ensure we have a valid run ID - if not, generate one as fallback
  if (!baseRunId) {
    const now = new Date();
    const datePart = [
      now.getFullYear().toString().slice(2),
      (now.getMonth() + 1).toString().padStart(2, '0'),
      now.getDate().toString().padStart(2, '0')
    ].join('');
    
    const timePart = [
      now.getHours().toString().padStart(2, '0'),
      now.getMinutes().toString().padStart(2, '0'),
      now.getSeconds().toString().padStart(2, '0')
    ].join('');
    
    baseRunId = `${datePart}-${timePart}`;
    logger.info(`Airtable Service: Generated fallback timestamp ID ${baseRunId} for job tracking of unrecognized format ${runId}`);
  }
  
  logger.info(`Airtable Service: Updating job tracking for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    // Find all records with the base run ID (without client suffix)
    const records = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{${JOB_TRACKING_FIELDS.RUN_ID}} = '${baseRunId}'`
    }).firstPage();
    
    if (!records || records.length === 0) {
      // CRITICAL CHANGE: Don't create a new record, log an error instead
      const errorMsg = `Job tracking record not found for ${runId} (base: ${baseRunId}). Updates will not be applied.`;
      logger.error(`Airtable Service ERROR: ${errorMsg}`);
      return { error: errorMsg, runId, baseRunId, notFound: true };
    }
    
    // Handle case where there are multiple records with the same run ID
    if (records.length > 1) {
      logger.warn(`WARNING: Found ${records.length} records with the same Run ID: ${baseRunId}. Updating the most recent one.`);
      
      // CRR REDESIGN: Sort by creation time (Airtable's createdTime) instead of Start Time
      records.sort((a, b) => {
        const aTime = a._rawJson?.createdTime ? new Date(a._rawJson.createdTime) : new Date(0);
        const bTime = b._rawJson?.createdTime ? new Date(b._rawJson.createdTime) : new Date(0);
        return bTime - aTime; // Descending order (most recent first)
      });
    }
    
    const recordId = records[0].id;
    
    // ROOT CAUSE FIX: Normalize field names before updating
    // This is the 4th code path that needed this fix (jobTracking.js, unifiedJobTrackingRepository.js, simpleJobTracking.js, now airtableService.js)
    const { createValidatedObject } = require('../utils/airtableFieldValidator');
    const normalizedUpdates = createValidatedObject(updates, { log: false });
    
    // Update the record with normalized field names
    const updated = await base(JOB_TRACKING_TABLE).update(recordId, normalizedUpdates);
    logger.info(`Airtable Service: Updated job tracking record ${recordId}`);
    
    return updated;
  } catch (error) {
    logger.error(`Airtable Service ERROR: Failed to update job tracking: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'airtableService.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Update an existing client run record
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} updates - Field updates to apply
 * @returns {Promise<Object>} The updated record
 */
async function updateClientRun(runId, clientId, updates) {
  const base = initialize();
  
  // Use the standardized run ID format
  const standardRunId = runIdSystem.validateAndStandardizeRunId(runId);
  
  logger.info(`[METDEBUG] AirtableService updateClientRun called:`);
  logger.info(`[METDEBUG] - Client: ${clientId}`);
  logger.info(`[METDEBUG] - Original Run ID: ${runId}`);
  logger.info(`[METDEBUG] - Standardized Run ID: ${standardRunId}`);
  logger.info(`[METDEBUG] - Updates:`, JSON.stringify(updates));
  
  try {
    // Look for exact Run ID match using our standard format
    let recordId = null;
    
    // First check if we have a cached record ID for this run
    recordId = runIdSystem.getRunRecordId(standardRunId, clientId);
    
    if (recordId) {
      logger.info(`[METDEBUG] Using cached record ID ${recordId} for run ${standardRunId}`);
      
      try {
        // Verify the record exists
        await base(CLIENT_RUN_RESULTS_TABLE).find(recordId);
        logger.info(`[METDEBUG] Verified cached record exists`);
      } catch (err) {
        logger.info(`[METDEBUG] Cached record not found, will search again`);
        await logCriticalError(err, { context: 'Cached record validation failed (will search)', service: 'airtableService.js' }).catch(() => {});
        recordId = null;
      }
    }
    
    // If not found in cache, search by exact Run ID match
    if (!recordId) {
      logger.info(`[METDEBUG] Looking for exact Run ID match`);
      const exactIdQuery = `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${standardRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientId}')`;
      
      const exactMatches = await base(CLIENT_RUN_RESULTS_TABLE).select({
        filterByFormula: exactIdQuery,
        maxRecords: 1
      }).firstPage();
      
      if (exactMatches && exactMatches.length > 0) {
        recordId = exactMatches[0].id;
        logger.info(`[METDEBUG] Found exact Run ID match ${recordId}`);
        
        // Register for future lookups
        runIdSystem.registerRunRecord(standardRunId, clientId, recordId);
      } else {
        logger.info(`[METDEBUG] No exact Run ID match found for ${standardRunId}`);
      }
    }
      
    // STRICT ENFORCEMENT: Do NOT create new records, only update existing ones
    if (!recordId) {
      // Generate a detailed error message
      const errorMsg = `[STRICT ENFORCEMENT] No existing record found for ${standardRunId} (client ${clientId}). UPDATES REJECTED.`;
      logger.error(errorMsg);
      logger.error(`[STRICT ENFORCEMENT] This indicates a process kickoff issue - run record should already exist`);
      logger.error(`[STRICT ENFORCEMENT] Update operation skipped - updates would have been:`, JSON.stringify(updates));
      
      // Throw error as explicitly requested
      throw new Error(`Cannot update non-existent run record for ${clientId} (${standardRunId}). Record must exist before updates.`);
    }
    
    // Now update it
    logger.info(`[METDEBUG] Updating record ${recordId} with:`, JSON.stringify(updates));
    
    // Define the fields we want to preserve when not explicitly updated
    const fieldsToPreserve = [
      'Apify Run ID',
      'Total Posts Harvested',
      'Profiles Submitted for Post Harvesting',
      'Apify API Costs',
      'Posts Examined for Scoring',
      'Posts Successfully Scored'
    ];
    
    // Check if we need to preserve any existing values
    const fieldsMissingInUpdate = fieldsToPreserve.filter(field => 
      updates[field] === undefined || updates[field] === '');
    
    if (fieldsMissingInUpdate.length > 0) {
      try {
        // Get the existing record to check for values
        const existingRecord = await base(CLIENT_RUN_RESULTS_TABLE).find(recordId);
        let preservedAny = false;
        
        // Check each field that's missing in the update
        for (const field of fieldsMissingInUpdate) {
          const existingValue = existingRecord.get(field);
          // If the field has a value, preserve it
          if (existingValue !== undefined && existingValue !== null && existingValue !== '') {
            logger.info(`[METDEBUG] Preserving existing value for ${field}: ${existingValue}`);
            updates[field] = existingValue;
            preservedAny = true;
          }
        }
        
        if (preservedAny) {
          logger.info(`[METDEBUG] Final update with preserved values:`, JSON.stringify(updates));
        }
      } catch (findError) {
        logger.warn(`[METDEBUG] Could not check for existing field values: ${findError.message}`);
        await logCriticalError(findError, { context: 'Field preservation check failed (continuing)', service: 'airtableService.js' }).catch(() => {});
      }
    }
    
    // ROOT CAUSE FIX: Use field validator to normalize field names BEFORE Airtable update
    // This prevents field name mismatches in Client Run Results updates
    const { createValidatedObject } = require('../utils/airtableFieldValidator');
    const normalizedUpdates = createValidatedObject(updates, { log: false });
    
    const updated = await base(CLIENT_RUN_RESULTS_TABLE).update(recordId, normalizedUpdates);
    logger.info(`[METDEBUG] Successfully updated client run record ${recordId}`);
    logger.info(`[METDEBUG] Updated fields:`, JSON.stringify(Object.keys(updates)));
    
    return updated;
  } catch (error) {
    logger.error(`Airtable Service ERROR: Failed to update client run: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'airtableService.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Complete a job run by updating end time and status
 * @param {string} runId - The run ID to complete
 * @param {boolean} success - Whether the run was successful
 * @param {string} notes - Additional notes to append
 * @returns {Promise<Object>} The updated record
 */
async function completeJobRun(runId, success = true, notes = '') {
  // CRR REDESIGN: Removed END_TIME and STATUS updates (replaced by Progress Log)
  const updates = {};
  
  if (notes) {
    updates[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = `${notes}\nRun ${success ? 'completed' : 'failed'} at ${new Date().toISOString()}`;
  }
  
  // If no updates, just return success without calling Airtable
  if (Object.keys(updates).length === 0) {
    return { success: true, message: 'No updates needed (Status/Time fields deprecated)' };
  }
  
  return await updateJobTracking(runId, updates);
}

// Removed findClientRunByTimestampPrefix function - we now use only exact run ID matching

/**
 * Complete a client run by updating end time and status
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {boolean} success - Whether the client processing was successful
 * @param {string} notes - Additional notes to append
 * @returns {Promise<Object>} The updated record
 */
async function completeClientRun(runId, clientId, success = true, notes = '') {
  // CRR REDESIGN: Removed END_TIME and STATUS updates (replaced by Progress Log)
  const updates = {};
  
  if (notes) {
    updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = `${notes}\nRun ${success ? 'completed' : 'failed'} at ${new Date().toISOString()}`;
  }
  
  // If no updates, just return success without calling Airtable
  if (Object.keys(updates).length === 0) {
    return { success: true, message: 'No updates needed (Status/Time fields deprecated)' };
  }
  
  // Generate a standardized run ID - reuse timestamp if possible
  const normalizedRunId = runIdSystem.validateAndStandardizeRunId(runId);
  
  // Log what we're doing
  logger.info(`Airtable Service: Completing client run for ${clientId}`);
  logger.info(`Airtable Service: Using standardized run ID: ${normalizedRunId}`);
  
  // updateClientRun will find the record - using RUNNING status first if possible
  return await updateClientRun(normalizedRunId, clientId, updates);
}

/**
 * Update aggregate metrics for a run by combining client results
 * @param {string} runId - The run ID to update (may contain client suffix)
 * @returns {Promise<Object>} The updated record
 */
async function updateAggregateMetrics(runId) {
  const base = initialize();
  
  // CLEAN SLATE APPROACH: Use only timestamp format
  // Strip client suffix to get the base run ID
  let baseRunId = runIdUtils.stripClientSuffix(runId);
  
  // Ensure we have a valid run ID - if not, generate one as fallback
  if (!baseRunId || baseRunId === runId) {
    // If stripping didn't change anything and it's not a timestamp format, create a fallback
    const timestampMatch = runId.match(/^\d{6}-\d{6}/);
    if (!timestampMatch) {
      const now = new Date();
      const datePart = [
        now.getFullYear().toString().slice(2),
        (now.getMonth() + 1).toString().padStart(2, '0'),
        now.getDate().toString().padStart(2, '0')
      ].join('');
      
      const timePart = [
        now.getHours().toString().padStart(2, '0'),
        now.getMinutes().toString().padStart(2, '0'),
        now.getSeconds().toString().padStart(2, '0')
      ].join('');
      
      baseRunId = `${datePart}-${timePart}`;
      logger.info(`Airtable Service: Generated fallback timestamp ID ${baseRunId} for aggregate metrics of unrecognized format ${runId}`);
    }
  }
  
  logger.info(`Airtable Service: Updating aggregate metrics for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    // Use modified formula to find all client records with the right date part
    // This should be more flexible and find all related records regardless of exact timestamp
    const datePartOnly = baseRunId.split('-')[0]; // Just get the YYMMDD part
    const clientRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `FIND('${datePartOnly}', {${CLIENT_RUN_FIELDS.RUN_ID}}) = 1`
    }).all();
    
    // Log the records and their run IDs for debugging
    logger.info(`Found ${clientRecords.length} client records matching base run ID ${baseRunId} (date part ${datePartOnly}):`);
    clientRecords.forEach(record => {
      logger.info(`- Record ${record.id}: Run ID = ${record.get('Run ID')}, Client ID = ${record.get('Client ID')}`);
    });
    
    if (!clientRecords || clientRecords.length === 0) {
      logger.warn(`Airtable Service WARNING: No client records found for run ID: ${runId}`);
      // Create a dummy record to avoid null errors downstream
      const jobTrackingRecord = await createJobTrackingRecord(baseRunId, 1);
      if (jobTrackingRecord) {
        logger.info(`Airtable Service: Created fallback job tracking record with no client data: ${jobTrackingRecord.id}`);
        return jobTrackingRecord;
      }
      return null;
    }
    
    // Calculate aggregates
    // NOTE: 'Clients Processed', 'Clients With Errors', 'Total Profiles Examined', 'Successful Profiles',
    // and 'Total Posts Harvested' removed from Job Tracking (calculated on-the-fly)
    // Calculate aggregates from Client Run Results
    // NOTE: Job Tracking table doesn't store these fields - they're calculated on-the-fly
    // Removed 2025-10-02: Total Profiles Examined, Successful Profiles, Total Posts Harvested,
    // Posts Examined for Scoring, Posts Successfully Scored, Profile Scoring Tokens, Post Scoring Tokens
    // (not in Job Tracking schema - only in Client Run Results)
    
    // CRR REDESIGN: Job Tracking only stores: Stream, System Notes
    // Status/Time fields removed (replaced by Progress Log)
    // All metrics are calculated on-the-fly from Client Run Results when needed
    
    // No aggregates to update anymore - just return success silently
    return { success: true, message: 'Aggregate metrics update skipped (Status/Time fields deprecated)' };
  } catch (error) {
    logger.error(`Airtable Service ERROR: Failed to update aggregate metrics: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'airtableService.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Check if a client run record exists in Airtable
 * @param {string} runId - The run ID to check
 * @param {string} clientId - The client ID
 * @returns {Promise<boolean>} True if record exists, false otherwise
 */
async function checkRunRecordExists(runId, clientId) {
  const base = initialize();
  
  // Use the standardized run ID format
  const standardRunId = runIdSystem.validateAndStandardizeRunId(runId);
  
  logger.info(`[RUNDEBUG] Checking if run record exists for ${standardRunId} (client ${clientId})`);
  
  try {
    // First check if we have a cached record ID for this run
    let recordId = runIdSystem.getRunRecordId(standardRunId, clientId);
    
    if (recordId) {
      logger.info(`[RUNDEBUG] Found cached record ID ${recordId} for run ${standardRunId}`);
      try {
        // Verify the record exists
        await base(CLIENT_RUN_RESULTS_TABLE).find(recordId);
        logger.info(`[RUNDEBUG] Verified cached record exists`);
        return true;
      } catch (err) {
        logger.info(`[RUNDEBUG] Cached record not found, will search again`);
        await logCriticalError(err, { context: 'Cached record check failed (will search)', service: 'airtableService.js' }).catch(() => {});
        recordId = null;
      }
    }
    
    // If not found in cache, search by exact Run ID match
    const exactIdQuery = `AND({${CLIENT_RUN_FIELDS.RUN_ID}} = '${standardRunId}', {${CLIENT_RUN_FIELDS.CLIENT_ID}} = '${clientId}')`;
    
    const exactMatches = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: exactIdQuery,
      maxRecords: 1
    }).firstPage();
    
    if (exactMatches && exactMatches.length > 0) {
      recordId = exactMatches[0].id;
      logger.info(`[RUNDEBUG] Found exact Run ID match ${recordId}`);
      
      // Register for future lookups
      runIdSystem.registerRunRecord(standardRunId, clientId, recordId);
      return true;
    } else {
      logger.info(`[RUNDEBUG] No run record found for ${standardRunId} (client ${clientId})`);
      return false;
    }
  } catch (error) {
    logger.error(`[RUNDEBUG] Error checking run record: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (swallowed)', service: 'airtableService.js' }).catch(() => {});
    return false;
  }
}

module.exports = {
  initialize,
  createJobTrackingRecord,
  createClientRunRecord,
  updateJobTracking,
  updateClientRun,
  completeJobRun,
  completeClientRun,
  updateAggregateMetrics,
  checkRunRecordExists
};