// services/airtableServiceSimple.js
// Simplified service for tracking run metrics in Airtable
// Follows the "Create once, update many, error if missing" principle

require('dotenv').config();
const Airtable = require('airtable');

// Constants for table names
const JOB_TRACKING_TABLE = 'Job Tracking';
const CLIENT_RUN_RESULTS_TABLE = 'Client Run Results';

// Initialize client base connection
let clientsBase = null;

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

    const records = await base(JOB_TRACKING_TABLE).create([
      {
        fields: {
          'Run ID': runId,
          'Start Time': startTimestamp,
          'Status': 'Running',
          'Stream': streamNumber, // Ensure stream is a number for Airtable's number field
          'Clients Processed': 0,
          'Clients With Errors': 0,
          'Total Profiles Examined': 0,
          'Successful Profiles': 0,
          'Total Posts Harvested': 0,
          'Posts Examined for Scoring': 0, 
          'Posts Successfully Scored': 0,
          'Profile Scoring Tokens': 0,
          'Post Scoring Tokens': 0,
          'System Notes': `Run initiated at ${startTimestamp}`
        }
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
      filterByFormula: `AND({Run ID} = '${runId}', {Client ID} = '${clientId}')`, // Fixed from 'Client' to 'Client ID' to match Airtable schema
      maxRecords: 1
    }).firstPage();
    
    if (existingRecords && existingRecords.length > 0) {
      console.error(`Client run record already exists for ${runId}, ${clientId}`);
      return existingRecords[0];
    }
    
    const startTimestamp = new Date().toISOString();
    
    const records = await base(CLIENT_RUN_RESULTS_TABLE).create([
      {
        fields: {
          'Run ID': runId,
          'Client ID': clientId,  // Fixed from 'Client' to 'Client ID' to match Airtable schema
          'Client Name': clientName,
          'Start Time': startTimestamp,
          'Status': 'Running',
          'Profiles Examined for Scoring': 0,
          'Profiles Successfully Scored': 0,
          'Total Posts Harvested': 0,
          'Profile Scoring Tokens': 0,
          'Post Scoring Tokens': 0,
          'System Notes': `Processing started at ${startTimestamp}`
        }
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
  
  try {
    const records = await base(JOB_TRACKING_TABLE).select({
      filterByFormula: `{Run ID} = '${runId}'`,
      maxRecords: 1
    }).firstPage();
    
    if (!records || records.length === 0) {
      const error = `❌ Job tracking record not found for ${runId}. Record was not created at job start!`;
      console.error(error);
      return { error: true, message: error };
    }
    
    const updated = await base(JOB_TRACKING_TABLE).update(records[0].id, updates);
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
    
    const updated = await base(CLIENT_RUN_RESULTS_TABLE).update(records[0].id, updates);
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
    'End Time': new Date().toISOString(),
    'Status': success ? 'Completed' : 'Failed'
  };
  
  if (notes) {
    updates['System Notes'] = `${notes}\nRun ${success ? 'completed' : 'failed'} at ${new Date().toISOString()}`;
  }
  
  return await updateJobTracking(runId, updates);
}

/**
 * Complete a client run - MUST exist
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {boolean} success - Whether the client run succeeded
 * @param {string} notes - Notes to append
 * @returns {Promise<Object>} The updated record or error object
 */
async function completeClientRun(runId, clientId, success = true, notes = '') {
  const updates = {
    'End Time': new Date().toISOString(),
    'Status': success ? 'Completed' : 'Failed'
  };
  
  if (notes) {
    updates['System Notes'] = `${notes}\nRun ${success ? 'completed' : 'failed'} at ${new Date().toISOString()}`;
  }
  
  return await updateClientRun(runId, clientId, updates);
}

/**
 * Update aggregate metrics for a run by combining client results - MUST exist
 * @param {string} runId - The run ID
 * @returns {Promise<Object>} The updated record or error object
 */
async function updateAggregateMetrics(runId) {
  console.log(`Updating aggregate metrics for: ${runId}`);
  
  const base = initialize();
  
  try {
    // Get client run records for this job
    const clientRecords = await base(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `FIND('${runId}', {Run ID}) > 0`
    }).all();
    
    if (!clientRecords || clientRecords.length === 0) {
      console.warn(`No client records found for run ID: ${runId}`);
      return { warning: `No client records found for run ID: ${runId}` };
    }
    
    // Calculate aggregates
    const aggregates = {
      'Clients Processed': clientRecords.length,
      'Clients With Errors': clientRecords.filter(r => r.fields['Status'] === 'Failed').length,
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
      aggregates['Total Profiles Examined'] += Number(record.fields['Profiles Examined for Scoring'] || 0);
      aggregates['Successful Profiles'] += Number(record.fields['Profiles Successfully Scored'] || 0);
      aggregates['Total Posts Harvested'] += Number(record.fields['Total Posts Harvested'] || 0);
      aggregates['Posts Examined for Scoring'] += Number(record.fields['Posts Examined for Scoring'] || 0);
      aggregates['Posts Successfully Scored'] += Number(record.fields['Posts Successfully Scored'] || 0);
      aggregates['Profile Scoring Tokens'] += Number(record.fields['Profile Scoring Tokens'] || 0);
      aggregates['Post Scoring Tokens'] += Number(record.fields['Post Scoring Tokens'] || 0);
    });
    
    // Update the job tracking record
    return await updateJobTracking(runId, aggregates);
  } catch (error) {
    console.error(`❌ [ERROR] Failed to update aggregate metrics: ${error.message}`);
    return { error: true, message: error.message };
  }
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
  updateAggregateMetrics,
  getBase,
  JOB_TRACKING_TABLE,
  CLIENT_RUN_RESULTS_TABLE
};