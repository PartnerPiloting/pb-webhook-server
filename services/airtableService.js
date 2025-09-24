// services/airtableService.js
// Service for tracking run metrics in Airtable
// Handles recording data to Job Tracking and Client Run Results tables

require('dotenv').config();
const Airtable = require('airtable');
const runIdUtils = require('../utils/runIdUtils');

// Import the client service with explicit destructuring to ensure we get what we need
// This helps identify missing exports immediately rather than at runtime
let clientService;
try {
    clientService = require('./clientService');
    // Verify the critical functions exist
    if (!clientService.initializeClientsBase) {
        console.error("ERROR: clientService.initializeClientsBase function is missing");
    }
} catch (e) {
    console.error("CRITICAL ERROR: Failed to load clientService module:", e.message);
}

// Import run ID service for centralized run ID management
const runIdService = require('./runIdService');

// Import record caching service
const recordCache = require('./recordCache');

// Constants for table names
const JOB_TRACKING_TABLE = 'Job Tracking';
const CLIENT_RUN_RESULTS_TABLE = 'Client Run Results';

// Initialize clients base reference
let clientsBase = null;

/**
 * Initialize connection to the Clients base
 * @returns {Object} The Airtable base object
 */
function initialize() {
  if (clientsBase) {
    console.log("Airtable Service: Using existing base connection");
    return clientsBase;
  }

  try {
    // Check if clientService is properly loaded
    if (!clientService || typeof clientService.initializeClientsBase !== 'function') {
      console.error("ERROR: clientService is not properly loaded or initializeClientsBase is not a function");
      console.error("clientService type:", typeof clientService);
      console.error("clientService functions available:", 
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

      console.log("FALLBACK: Directly initializing Airtable base connection");
      clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
      console.log("FALLBACK: Successfully initialized Airtable base directly");
    } else {
      // Use clientService's initialization (preferred method)
      try {
        console.log("Attempting to use clientService.initializeClientsBase()...");
        clientsBase = clientService.initializeClientsBase();
        console.log("Airtable Service: Successfully got base connection from clientService");
      } catch (initError) {
        console.error("ERROR using clientService.initializeClientsBase():", initError.message);
        console.log("Falling back to direct initialization...");
        
        // Configure Airtable directly as fallback
        Airtable.configure({
          apiKey: process.env.AIRTABLE_API_KEY
        });
        
        clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
        console.log("FALLBACK: Successfully initialized Airtable base directly after clientService failed");
      }
    }

    if (!clientsBase) {
      throw new Error("Failed to initialize clients base in airtableService");
    }

    console.log("Airtable Service: Run tracking tables connection initialized");
    return clientsBase;
  } catch (error) {
    console.error("CRITICAL ERROR initializing Airtable connection:", error.message);
    // Create a last-resort fallback attempt
    try {
      console.log("CRITICAL FALLBACK: Attempting emergency direct Airtable connection...");
      Airtable.configure({
        apiKey: process.env.AIRTABLE_API_KEY
      });
      clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
      console.log("CRITICAL FALLBACK: Emergency Airtable connection successful");
      return clientsBase;
    } catch (fallbackError) {
      console.error("FATAL ERROR: Emergency fallback also failed:", fallbackError.message);
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
  
  // Strip client suffix from runId to get the base run ID for tracking
  const baseRunId = runIdUtils.stripClientSuffix(runId);
  
  console.log(`Airtable Service: Creating job tracking record for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    const records = await base(JOB_TRACKING_TABLE).create([
      {
        fields: {
          'Run ID': baseRunId, // Use the base run ID without client suffix
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
          'System Notes': `Run initiated at ${new Date().toISOString()}`
        }
      }
    ]);

    console.log(`Airtable Service: Created job tracking record ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    console.error(`Airtable Service ERROR: Failed to create job tracking record: ${error.message}`);
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
  
  // CONSISTENCY FIX: Try to reuse the existing run ID's timestamp if possible
  // This helps prevent duplication by maintaining the same timestamp
  const standardRunId = runIdService.normalizeRunId(runId, clientId, false);
  
  console.log(`Airtable Service: Creating run record for client ${clientId}`);
  console.log(`Airtable Service: Using standardized ID: ${standardRunId}`);
  
  // STEP 1: First check for any existing RUNNING record for this client
  // This is the most reliable way to prevent duplicates
  try {
    console.log(`Airtable Service: Checking for any RUNNING records for client ${clientId}`);
    const runningRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `AND({Client ID} = '${clientId}', {Status} = 'Running')`,
      maxRecords: 1,
      sort: [{ field: "Start Time", direction: "desc" }]
    }).firstPage();
    
    if (runningRecords && runningRecords.length > 0) {
      const existingRecord = runningRecords[0];
      const existingRunId = existingRecord.fields['Run ID'];
      console.log(`Airtable Service: Found existing RUNNING record ${existingRecord.id} with run ID ${existingRunId}`);
      
      // Register with our normalized ID for future lookups
      runIdService.registerRunRecord(standardRunId, clientId, existingRecord.id);
      
      // Update the record to use our standardized format
      if (existingRunId !== standardRunId) {
        console.log(`Airtable Service: Updating record to use standardized run ID: ${standardRunId}`);
        await base(CLIENT_RUN_RESULTS_TABLE).update(existingRecord.id, {
          'Run ID': standardRunId
        });
      }
      
      return existingRecord;
    }
    
    console.log(`Airtable Service: No running records found for client ${clientId}`);
  } catch (error) {
    console.error(`Airtable Service ERROR during running records check: ${error.message}`);
    // Continue even if this check fails
  }
  
  // STEP 2: Check cache for existing record ID
  const cachedRecordId = runIdService.getRunRecordId(standardRunId, clientId);
  
  if (cachedRecordId) {
    console.log(`Airtable Service: Using cached record ID ${cachedRecordId}`);
    try {
      // Verify the record exists
      const record = await base(CLIENT_RUN_RESULTS_TABLE).find(cachedRecordId);
      console.log(`Airtable Service: Found existing record with ID ${cachedRecordId}`);
      return record;
    } catch (err) {
      console.log(`Airtable Service: Cached record ID ${cachedRecordId} no longer valid, will create new record`);
      // Fall through to create a new record
    }
  }
  
  // STEP 3: Check if a record already exists with this run ID
  try {
    console.log(`Airtable Service: Checking for existing record with run ID ${standardRunId}`);
    
    const existingRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `AND({Run ID} = '${standardRunId}', {Client ID} = '${clientId}')`,
      maxRecords: 1
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      console.log(`Airtable Service: Found existing record ID: ${existingRecords[0].id}`);
      
      // Register the record ID for future lookups
      runIdService.registerRunRecord(standardRunId, clientId, existingRecords[0].id);
      
      return existingRecords[0];
    }
    
    // CLEAN SLATE: Create a new record with our standardized ID
    console.log(`Airtable Service: Creating new client run record for ${clientId} with standardized ID ${standardRunId}`);
    
    const records = await base(CLIENT_RUN_RESULTS_TABLE).create([
      {
        fields: {
          'Run ID': standardRunId, // Always use our standardized timestamp format
          'Client ID': clientId,
          'Client Name': clientName,
          'Start Time': new Date().toISOString(),
          'Status': 'Running',
          'Profiles Examined for Scoring': 0,
          'Profiles Successfully Scored': 0,
          'Total Posts Harvested': 0,
          'Profile Scoring Tokens': 0,
          'Post Scoring Tokens': 0,
          'System Notes': `Processing started at ${new Date().toISOString()}`
        }
      }
    ]);

    // Register the new record ID with runIdService
    runIdService.registerRunRecord(standardRunId, clientId, records[0].id);
    
    console.log(`Airtable Service: Created client run record ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    console.error(`Airtable Service ERROR: Failed to create client run record: ${error.message}`);
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
  
  // CLEAN SLATE APPROACH: Use timestamp format for consistency
  // If the runId is in old format, generate a timestamp-based ID from the current time
  let baseRunId;
  
  // Check if this is an old-format ID (SR prefix)
  if (runId.startsWith('SR-')) {
    // Generate a new timestamp-based ID without client suffix
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
    console.log(`Airtable Service: Converted old format ID ${runId} to timestamp format ${baseRunId} for job tracking`);
  } else {
    // For timestamp-based IDs, just strip the client suffix
    baseRunId = runIdUtils.stripClientSuffix(runId);
  }
  
  console.log(`Airtable Service: Updating job tracking for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    // Find all records with the base run ID (without client suffix)
    const records = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{Run ID} = '${baseRunId}'`
    }).firstPage();
    
    if (!records || records.length === 0) {
      // FALLBACK: Create a new job tracking record if one doesn't exist
      console.log(`Airtable Service: Job tracking record not found for ${runId}, creating a new one`);
      const newRecord = await createJobTrackingRecord(baseRunId, 1);
      if (newRecord) {
        console.log(`Airtable Service: Created fallback job tracking record ID: ${newRecord.id}`);
        // Continue with update now that we have a record
        const updated = await base(JOB_TRACKING_TABLE).update(newRecord.id, updates);
        return updated;
      } else {
        throw new Error(`Failed to create fallback job tracking record for: ${runId} (base: ${baseRunId})`);
      }
    }
    
    // Handle case where there are multiple records with the same run ID
    if (records.length > 1) {
      console.warn(`WARNING: Found ${records.length} records with the same Run ID: ${baseRunId}. Updating the most recent one.`);
      
      // Sort by creation time and update the most recent one
      records.sort((a, b) => {
        const aTime = a.get('Start Time') ? new Date(a.get('Start Time')) : new Date(0);
        const bTime = b.get('Start Time') ? new Date(b.get('Start Time')) : new Date(0);
        return bTime - aTime; // Descending order (most recent first)
      });
    }
    
    const recordId = records[0].id;
    
    // Update the record
    const updated = await base(JOB_TRACKING_TABLE).update(recordId, updates);
    console.log(`Airtable Service: Updated job tracking record ${recordId}`);
    
    return updated;
  } catch (error) {
    console.error(`Airtable Service ERROR: Failed to update job tracking: ${error.message}`);
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
  
  // CONSISTENCY FIX: Try to reuse the existing run ID's timestamp if possible
  // This helps prevent duplication by maintaining the same timestamp
  const standardRunId = runIdService.normalizeRunId(runId, clientId, false);
  
  console.log(`Airtable Service: Updating client run for ${clientId}`);
  console.log(`Airtable Service: Using standardized ID: ${standardRunId}`);
  
  try {
    // CLEAN SLATE APPROACH: Only two steps:
    // 1. Check for any RUNNING record for this client
    // 2. If not found, create a new one
    
    // Step 1: Check for a running record
    let recordId = null;
    
    console.log(`Airtable Service: Checking for any RUNNING records for client ${clientId}`);
    const runningRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `AND({Client ID} = '${clientId}', {Status} = 'Running')`,
      maxRecords: 1,
      sort: [{ field: "Start Time", direction: "desc" }]
    }).firstPage();
    
    if (runningRecords && runningRecords.length > 0) {
      recordId = runningRecords[0].id;
      const existingRunId = runningRecords[0].fields['Run ID'];
      
      console.log(`Airtable Service: Found RUNNING record ${recordId} with run ID ${existingRunId}`);
      
      // Register with our standardized ID for future lookups
      runIdService.registerRunRecord(standardRunId, clientId, recordId);
      
      // Always update to our standardized ID for consistency
      updates['Run ID'] = standardRunId;
    } else {
      // No running record found - create a new one
      console.log(`Airtable Service: No RUNNING record found, creating new record for client ${clientId}`);
      const record = await createClientRunRecord(standardRunId, clientId, clientId);
      recordId = record.id;
    }
    
    // Now update it
    const updated = await base(CLIENT_RUN_RESULTS_TABLE).update(recordId, updates);
    console.log(`Airtable Service: Updated client run record ${recordId}`);
    
    return updated;
  } catch (error) {
    console.error(`Airtable Service ERROR: Failed to update client run: ${error.message}`);
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
  const updates = {
    'End Time': new Date().toISOString(),
    'Status': success ? 'Completed' : 'Failed'
  };
  
  if (notes) {
    updates['System Notes'] = `${notes}\nRun ${success ? 'completed' : 'failed'} at ${new Date().toISOString()}`;
  }
  
  return await updateJobTracking(runId, updates);
}

/**
 * Complete a client run by updating end time and status
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {boolean} success - Whether the client processing was successful
 * @param {string} notes - Additional notes to append
 * @returns {Promise<Object>} The updated record
 */
async function completeClientRun(runId, clientId, success = true, notes = '') {
  const updates = {
    'End Time': new Date().toISOString(),
    'Status': success ? 'Completed' : 'Failed'
  };
  
  if (notes) {
    updates['System Notes'] = `${notes}\nRun ${success ? 'completed' : 'failed'} at ${new Date().toISOString()}`;
  }
  
  // Generate a standardized run ID - reuse timestamp if possible
  const normalizedRunId = runIdService.normalizeRunId(runId, clientId, false);
  
  // Log what we're doing
  console.log(`Airtable Service: Completing client run for ${clientId}`);
  console.log(`Airtable Service: Using standardized run ID: ${normalizedRunId}`);
  
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
  
  // CLEAN SLATE APPROACH: Handle old and new formats consistently
  let baseRunId;
  
  // Check if this is an old-format ID (SR prefix)
  if (runId.startsWith('SR-')) {
    // Generate a new timestamp-based ID without client suffix
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
    console.log(`Airtable Service: Converted old format ID ${runId} to timestamp format ${baseRunId} for aggregate metrics`);
  } else {
    // Extract the timestamp base ID (without client suffix)
    // Our format is YYMMDD-HHMMSS-ClientID, so we take just YYMMDD-HHMMSS
    baseRunId = runIdUtils.getBaseRunId(runId);
  }
  
  console.log(`Airtable Service: Updating aggregate metrics for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    // Use modified formula to find all client records with the right date part
    // This should be more flexible and find all related records regardless of exact timestamp
    const datePartOnly = baseRunId.split('-')[0]; // Just get the YYMMDD part
    const clientRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `FIND('${datePartOnly}', {Run ID}) = 1`
    }).all();
    
    // Log the records and their run IDs for debugging
    console.log(`Found ${clientRecords.length} client records matching base run ID ${baseRunId} (date part ${datePartOnly}):`);
    clientRecords.forEach(record => {
      console.log(`- Record ${record.id}: Run ID = ${record.get('Run ID')}, Client ID = ${record.get('Client ID')}`);
    });
    
    if (!clientRecords || clientRecords.length === 0) {
      console.warn(`Airtable Service WARNING: No client records found for run ID: ${runId}`);
      // Create a dummy record to avoid null errors downstream
      const jobTrackingRecord = await createJobTrackingRecord(baseRunId, 1);
      if (jobTrackingRecord) {
        console.log(`Airtable Service: Created fallback job tracking record with no client data: ${jobTrackingRecord.id}`);
        return jobTrackingRecord;
      }
      return null;
    }
    
    // Calculate aggregates
    const aggregates = {
      'Clients Processed': clientRecords.length,
      'Clients With Errors': clientRecords.filter(r => r.get('Status') === 'Failed').length,
      'Total Profiles Examined': 0,
      'Successful Profiles': 0,
      'Total Posts Harvested': 0,
      'Posts Examined for Scoring': 0,
      'Posts Successfully Scored': 0,
      'Profile Scoring Tokens': 0,
      'Post Scoring Tokens': 0
    };
    
    // Sum up metrics from all client records
    clientRecords.forEach(record => {
      aggregates['Total Profiles Examined'] += Number(record.get('Profiles Examined for Scoring') || 0);
      aggregates['Successful Profiles'] += Number(record.get('Profiles Successfully Scored') || 0);
      aggregates['Total Posts Harvested'] += Number(record.get('Total Posts Harvested') || 0);
      aggregates['Posts Examined for Scoring'] += Number(record.get('Posts Examined for Scoring') || 0);
      aggregates['Posts Successfully Scored'] += Number(record.get('Posts Successfully Scored') || 0);
      aggregates['Profile Scoring Tokens'] += Number(record.get('Profile Scoring Tokens') || 0);
      aggregates['Post Scoring Tokens'] += Number(record.get('Post Scoring Tokens') || 0);
    });
    
    // Update the job tracking record using the base run ID (without client suffix)
    return await updateJobTracking(baseRunId, aggregates);
  } catch (error) {
    console.error(`Airtable Service ERROR: Failed to update aggregate metrics: ${error.message}`);
    throw error;
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
  updateAggregateMetrics
};