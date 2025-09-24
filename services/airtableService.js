// services/airtableService.js
// Service for tracking run metrics in Airtable
// Handles recording data to Job Tracking and Client Run Results tables

require('dotenv').config();
const Airtable = require('airtable');

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

// Import runIdUtils for handling client-suffixed run IDs
const runIdUtils = require('../utils/runIdUtils');

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
  
  // Check if we already have a record ID in the cache
  const cachedRecordId = recordCache.getClientRunRecordId(runId, clientId);
  
  if (cachedRecordId) {
    console.log(`Airtable Service: Using cached record ID ${cachedRecordId} for ${clientId} in run ${runId}`);
    try {
      // Verify the record exists
      const record = await base(CLIENT_RUN_RESULTS_TABLE).find(cachedRecordId);
      console.log(`Airtable Service: Found existing record with ID ${cachedRecordId} for ${clientId} in run ${runId}`);
      return record;
    } catch (err) {
      console.log(`Airtable Service: Cached record ID ${cachedRecordId} no longer valid, will create new record`);
      // Fall through to create a new record
    }
  }
  
  // Check if a record already exists for this client and run
  try {
    console.log(`Airtable Service: Checking for existing client run record for ${clientId} in run ${runId}`);
    const existingRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `AND({Run ID} = '${runId}', {Client ID} = '${clientId}')`
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      console.log(`Airtable Service: Found existing client run record ID: ${existingRecords[0].id} for ${clientId} in run ${runId}`);
      
      // Cache the record ID for future use
      recordCache.storeClientRunRecordId(runId, clientId, existingRecords[0].id);
      
      return existingRecords[0];
    }
    
    // If we get here, no existing record was found
    console.log(`Airtable Service: Creating new client run record for ${clientId} in run ${runId}`);
    
    const records = await base(CLIENT_RUN_RESULTS_TABLE).create([
      {
        fields: {
          'Run ID': runId,
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

    // Cache the new record ID
    recordCache.storeClientRunRecordId(runId, clientId, records[0].id);
    
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
  
  // Strip client suffix from runId to get the base run ID used for tracking
  const baseRunId = runIdUtils.stripClientSuffix(runId);
  
  console.log(`Airtable Service: Updating job tracking for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    // Find all records with the base run ID (without client suffix)
    const records = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{Run ID} = '${baseRunId}'`
    }).firstPage();
    
    if (!records || records.length === 0) {
      throw new Error(`Job tracking record not found for run ID: ${runId} (base: ${baseRunId})`);
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
  
  console.log(`Airtable Service: Updating client run for ${clientId} in run ${runId}`);
  
  try {
    // First get or create the client run record
    const record = await createClientRunRecord(runId, clientId, clientId); // Using clientId as name fallback
    
    // Now update it
    const updated = await base(CLIENT_RUN_RESULTS_TABLE).update(record.id, updates);
    console.log(`Airtable Service: Updated client run record ${record.id}`);
    
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
  
  // Log the cache key we're using
  console.log(`Airtable Service: Completing client run for ${clientId} in run ${runId}`);
  console.log(`Airtable Service: Cached record ID: ${recordCache.getClientRunRecordId(runId, clientId) || 'none'}`);
  
  return await updateClientRun(runId, clientId, updates);
}

/**
 * Update aggregate metrics for a run by combining client results
 * @param {string} runId - The run ID to update (may contain client suffix)
 * @returns {Promise<Object>} The updated record
 */
async function updateAggregateMetrics(runId) {
  const base = initialize();
  
  // Get the base run ID (without client suffix) for lookup in client records
  // Since client record run IDs may include their own client suffixes
  const baseRunId = runIdUtils.stripClientSuffix(runId);
  
  console.log(`Airtable Service: Updating aggregate metrics for ${runId} (base run ID: ${baseRunId})`);
  
  try {
    // Get all client run records for this run ID using base run ID pattern match
    // This handles cases where client records have varied client suffixes
    const clientRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `FIND('${baseRunId}', {Run ID}) = 1`
    }).all();
    
    if (!clientRecords || clientRecords.length === 0) {
      console.warn(`Airtable Service WARNING: No client records found for run ID: ${runId}`);
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
    
    console.log(`Found ${clientRecords.length} client records for base run ID ${baseRunId}`);
    
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
    
    // Update the job tracking record using the base run ID
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