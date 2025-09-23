// services/airtableService.js
// Service for tracking run metrics in Airtable
// Handles recording data to Job Tracking and Client Run Results tables

require('dotenv').config();
const Airtable = require('airtable');
const clientService = require('./clientService');

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
  if (clientsBase) return clientsBase;

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
      clientsBase = clientService.initializeClientsBase();
      console.log("Airtable Service: Got base connection from clientService");
    }

    if (!clientsBase) {
      throw new Error("Failed to initialize clients base in airtableService");
    }

    console.log("Airtable Service: Run tracking tables connection initialized");
    return clientsBase;
  } catch (error) {
    console.error("CRITICAL ERROR initializing Airtable connection:", error.message);
    throw error;
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
  
  console.log(`Airtable Service: Creating job tracking record for ${runId}`);
  
  try {
    const records = await base(JOB_TRACKING_TABLE).create([
      {
        fields: {
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
  
  console.log(`Airtable Service: Creating client run record for ${clientId} in run ${runId}`);
  
  try {
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

    console.log(`Airtable Service: Created client run record ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    console.error(`Airtable Service ERROR: Failed to create client run record: ${error.message}`);
    throw error;
  }
}

/**
 * Update an existing job tracking record
 * @param {string} runId - The run ID to update
 * @param {Object} updates - Field updates to apply
 * @returns {Promise<Object>} The updated record
 */
async function updateJobTracking(runId, updates) {
  const base = initialize();
  
  console.log(`Airtable Service: Updating job tracking for ${runId}`);
  
  try {
    // Find the record first
    const records = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{Run ID} = '${runId}'`
    }).firstPage();
    
    if (!records || records.length === 0) {
      throw new Error(`Job tracking record not found for run ID: ${runId}`);
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
    // Find the record first
    const records = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `AND({Run ID} = '${runId}', {Client ID} = '${clientId}')`
    }).firstPage();
    
    if (!records || records.length === 0) {
      throw new Error(`Client run record not found for run ID: ${runId} and client ID: ${clientId}`);
    }
    
    const recordId = records[0].id;
    
    // Update the record
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
    updates['System Notes'] = `${notes}\nProcessing ${success ? 'completed' : 'failed'} at ${new Date().toISOString()}`;
  }
  
  return await updateClientRun(runId, clientId, updates);
}

/**
 * Calculate and update aggregated metrics for the job tracking record
 * @param {string} runId - The run ID to update
 * @returns {Promise<Object>} The updated record
 */
async function updateAggregateMetrics(runId) {
  const base = initialize();
  
  console.log(`Airtable Service: Updating aggregate metrics for ${runId}`);
  
  try {
    // Get all client run records for this run ID
    const clientRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `{Run ID} = '${runId}'`
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
    
    // Update the job tracking record
    return await updateJobTracking(runId, aggregates);
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