/**
 * services/unifiedJobTrackingRepository.js
 * 
 * A consolidated repository for job tracking operations.
 * This service unifies all job tracking operations across the application
 * and ensures consistent behavior and error handling.
 */

const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
const baseManager = require('./airtable/baseManager');
const unifiedRunIdService = require('./unifiedRunIdService');

// Table names
const JOB_TRACKING_TABLE = 'Job Tracking';
const CLIENT_RUN_RESULTS_TABLE = 'Client Run Results';

// Default logger - using safe creation
const logger = createSafeLogger('SYSTEM', null, 'unified_job_tracking');

/**
 * Get the job tracking record by run ID with robust format handling
 * @param {Object} params - Query parameters
 * @param {string} params.runId - Run ID to find (in any supported format)
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object|null>} The record or null if not found
 */
async function getJobTrackingRecord(params) {
  const { runId, options = {} } = params;
  const log = options.logger || logger;
  
  if (!runId) {
    log.error("Run ID is required to get job tracking record");
    throw new Error("Run ID is required to get job tracking record");
  }
  
  try {
    // Convert to standard format
    const standardizedRunId = unifiedRunIdService.convertToStandardFormat(runId);
    if (!standardizedRunId) {
      log.error(`Could not convert run ID to standard format: ${runId}`);
      return null;
    }
    
    log.debug(`Looking up job tracking record with standardized Run ID: ${standardizedRunId}`);
    
    // Check for cached record ID first
    const cachedRecordId = unifiedRunIdService.getCachedRecordId(standardizedRunId);
    if (cachedRecordId) {
      log.debug(`Using cached record ID ${cachedRecordId} for run ID ${standardizedRunId}`);
      
      const masterBase = baseManager.getMasterClientsBase();
      try {
        const record = await masterBase(JOB_TRACKING_TABLE).find(cachedRecordId);
        return record;
      } catch (err) {
        // Cache miss, continue with normal lookup
        log.warn(`Cached record not found (${cachedRecordId}), continuing with normal lookup`);
      }
    }
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Find the record by Run ID
    const records = await masterBase(JOB_TRACKING_TABLE).select({
      filterByFormula: `{Run ID} = '${standardizedRunId}'`
    }).firstPage();
    
    if (!records || records.length === 0) {
      log.debug(`Job tracking record not found with Run ID: ${standardizedRunId}`);
      return null;
    }
    
    // Cache the record ID for future lookups
    unifiedRunIdService.cacheRecordId(standardizedRunId, records[0].id);
    
    log.debug(`Found job tracking record with ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    log.error(`Error getting job tracking record: ${error.message}`);
    throw error;
  }
}

/**
 * Create a job tracking record
 * @param {Object} params - Job tracking parameters
 * @param {string} params.runId - Run ID for the job (in any supported format)
 * @param {string} [params.clientId] - Optional client ID for the job
 * @param {number|string} [params.stream=1] - Stream number for the job
 * @param {Object} [params.initialData] - Initial data for the job
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Created job tracking record
 */
async function createJobTrackingRecord(params) {
  const { runId, clientId, stream = 1, initialData = {}, options = {} } = params;
  const log = options.logger || logger;
  
  if (!runId) {
    log.error("Run ID is required to create job tracking record");
    throw new Error("Run ID is required to create job tracking record");
  }
  
  try {
    // Convert to standard format
    const standardizedRunId = unifiedRunIdService.convertToStandardFormat(runId);
    if (!standardizedRunId) {
      log.error(`Could not convert run ID to standard format: ${runId}`);
      throw new Error(`Could not convert run ID to standard format: ${runId}`);
    }
    
    // Start time for the job
    const startTime = new Date().toISOString();
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Check if record already exists
    const existingRecord = await getJobTrackingRecord({ runId: standardizedRunId, options });
    
    if (existingRecord) {
      log.warn(`Job tracking record for ${standardizedRunId} already exists. Not creating duplicate.`);
      return {
        id: existingRecord.id,
        runId: standardizedRunId,
        clientId,
        startTime: existingRecord.get('Start Time'),
        status: existingRecord.get('Status')
      };
    }
    
    // Convert stream to a number if it's a string (Airtable expects a number)
    const streamNumber = typeof stream === 'string' ? parseInt(stream, 10) : stream;
    
    // Create the record
    const record = await masterBase(JOB_TRACKING_TABLE).create({
      'Run ID': standardizedRunId,
      'Start Time': startTime,
      'Status': 'Running',
      'Stream': streamNumber,
      ...initialData
    });
    
    // Cache the record ID
    unifiedRunIdService.cacheRecordId(standardizedRunId, record.id);
    
    log.debug(`Created job tracking record for ${standardizedRunId}`);
    
    return {
      id: record.id,
      runId: standardizedRunId,
      clientId,
      startTime,
      status: 'Running'
    };
  } catch (error) {
    log.error(`Error creating job tracking record: ${error.message}`);
    throw error;
  }
}

/**
 * Update a job tracking record with robust format handling
 * @param {Object} params - Update parameters
 * @param {string} params.runId - Run ID for the job (in any supported format)
 * @param {Object} params.updates - Fields to update
 * @param {boolean} [params.createIfMissing=false] - Whether to create the record if not found
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Updated job tracking record
 */
async function updateJobTrackingRecord(params) {
  const { runId, updates, createIfMissing = false, options = {} } = params;
  const log = options.logger || logger;
  
  if (!runId) {
    log.error("Run ID is required to update job tracking record");
    throw new Error("Run ID is required to update job tracking record");
  }
  
  try {
    // Convert to standard format
    const standardizedRunId = unifiedRunIdService.convertToStandardFormat(runId);
    if (!standardizedRunId) {
      log.error(`Could not convert run ID to standard format: ${runId}`);
      throw new Error(`Could not convert run ID to standard format: ${runId}`);
    }
    
    // Get the record
    let record = await getJobTrackingRecord({ runId: standardizedRunId, options });
    
    // Create if missing and requested
    if (!record && createIfMissing) {
      log.info(`Job tracking record not found for ${standardizedRunId}, creating a new one`);
      record = await createJobTrackingRecord({
        runId: standardizedRunId,
        clientId: updates.clientId,
        options
      });
      
      if (!record) {
        throw new Error(`Failed to create job tracking record for ${standardizedRunId}`);
      }
    } else if (!record) {
      const errorMessage = `Job tracking record not found with Run ID: ${standardizedRunId} (original: ${runId}). Updates will not be applied.`;
      log.error(errorMessage);
      
      // Return a placeholder with error info
      return {
        error: 'Job tracking record not found',
        runId: standardizedRunId,
        originalRunId: runId,
        clientId: updates.clientId,
        status: 'Error',
        errorMessage
      };
    }
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Prepare update fields
    const updateFields = {};
    
    // Map common update fields to Airtable field names
    if (updates.status) updateFields['Status'] = updates.status;
    if (updates.endTime) updateFields['End Time'] = updates.endTime;
    if (updates.error) updateFields['Error'] = updates.error;
    if (updates.progress) updateFields['Progress'] = updates.progress;
    if (updates.itemsProcessed) updateFields['Items Processed'] = updates.itemsProcessed;
    if (updates.notes) updateFields['System Notes'] = updates.notes;
    
    // Add any other custom fields from updates
    Object.keys(updates).forEach(key => {
      if (!['status', 'endTime', 'error', 'progress', 'itemsProcessed', 'notes', 'clientId', 'Success Rate'].includes(key)) {
        updateFields[key] = updates[key];
      }
    });
    
    // Update the record
    await masterBase(JOB_TRACKING_TABLE).update(record.id, updateFields);
    
    log.debug(`Updated job tracking record for ${standardizedRunId}`);
    
    return {
      id: record.id,
      runId: standardizedRunId,
      ...updates
    };
  } catch (error) {
    log.error(`Error updating job tracking record: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a job tracking record
 * @param {Object} params - Completion parameters
 * @param {string} params.runId - Run ID for the job (in any supported format)
 * @param {string} [params.status='Completed'] - Final status for the job
 * @param {Object} [params.metrics] - Completion metrics
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Completed job tracking record
 */
async function completeJobTrackingRecord(params) {
  const { runId, status = 'Completed', metrics = {}, options = {} } = params;
  const log = options.logger || logger;
  
  try {
    const endTime = new Date().toISOString();
    
    // Update with completion status and metrics
    return await updateJobTrackingRecord({
      runId,
      updates: {
        status,
        endTime,
        ...metrics
      },
      options
    });
  } catch (error) {
    log.error(`Error completing job tracking record: ${error.message}`);
    throw error;
  }
}

/**
 * Get a client run record
 * @param {Object} params - Query parameters
 * @param {string} params.runId - Run ID (in any supported format)
 * @param {string} params.clientId - Client ID
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object|null>} The record or null if not found
 */
async function getClientRunRecord(params) {
  const { runId, clientId, options = {} } = params;
  const log = options.logger || logger;
  
  if (!runId || !clientId) {
    log.error("Run ID and Client ID are required to get client run record");
    throw new Error("Run ID and Client ID are required to get client run record");
  }
  
  try {
    // Ensure runId has client suffix
    const standardizedRunId = unifiedRunIdService.addClientSuffix(
      unifiedRunIdService.convertToStandardFormat(runId) || runId,
      clientId
    );
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Find the record by Run ID and Client ID
    const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `AND({Run ID} = '${standardizedRunId}', {Client ID} = '${clientId}')`
    }).firstPage();
    
    if (!records || records.length === 0) {
      log.debug(`Client run record not found for ${clientId} with Run ID: ${standardizedRunId}`);
      return null;
    }
    
    log.debug(`Found client run record with ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    log.error(`Error getting client run record: ${error.message}`);
    throw error;
  }
}

/**
 * Create a client run record
 * @param {Object} params - Run record parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.runId - Run ID (in any supported format)
 * @param {string} [params.clientName] - Client name (will be looked up if not provided)
 * @param {Object} [params.initialData] - Initial data for the record
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Created run record
 */
async function createClientRunRecord(params) {
  const { clientId, runId, clientName, initialData = {}, options = {} } = params;
  const log = options.logger || logger;
  
  if (!clientId || !runId) {
    log.error("Client ID and Run ID are required to create run record");
    throw new Error("Client ID and Run ID are required to create run record");
  }
  
  try {
    // Convert base run ID to standard format
    const baseStandardRunId = unifiedRunIdService.convertToStandardFormat(runId);
    if (!baseStandardRunId) {
      log.error(`Could not convert run ID to standard format: ${runId}`);
      throw new Error(`Could not convert run ID to standard format: ${runId}`);
    }
    
    // Add client suffix to create the client-specific run ID
    const standardizedRunId = unifiedRunIdService.addClientSuffix(baseStandardRunId, clientId);
    
    // Start time for the run
    const startTime = new Date().toISOString();
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Check if record already exists
    const existingRecord = await getClientRunRecord({ 
      runId: standardizedRunId, 
      clientId, 
      options 
    });
    
    if (existingRecord) {
      log.warn(`Client run record for ${clientId} with Run ID ${standardizedRunId} already exists. Not creating duplicate.`);
      return {
        id: existingRecord.id,
        runId: standardizedRunId,
        baseRunId: baseStandardRunId,
        clientId,
        clientName: existingRecord.get('Client Name'),
        startTime: existingRecord.get('Start Time'),
        status: existingRecord.get('Status')
      };
    }
    
    // Prepare fields for the record
    const fields = {
      'Run ID': standardizedRunId,
      'Client ID': clientId,
      'Client Name': clientName || clientId, // Use clientId as fallback
      'Start Time': startTime,
      'Status': 'Running',
      ...initialData
    };
    
    // Create the run record
    const record = await masterBase(CLIENT_RUN_RESULTS_TABLE).create(fields);
    
    log.debug(`Created client run record for ${clientId}: ${standardizedRunId}`);
    
    // Also ensure a job tracking record exists for this run
    try {
      await createJobTrackingRecord({
        runId: baseStandardRunId,
        clientId,
        options: { 
          logger: log 
        }
      });
    } catch (jobError) {
      // Non-fatal, just log the error
      log.warn(`Error creating job tracking record for ${baseStandardRunId}: ${jobError.message}`);
    }
    
    return {
      id: record.id,
      runId: standardizedRunId,
      baseRunId: baseStandardRunId,
      clientId,
      clientName: clientName || clientId,
      startTime,
      status: 'Running'
    };
  } catch (error) {
    log.error(`Error creating client run record: ${error.message}`);
    throw error;
  }
}

/**
 * Update a client run record
 * @param {Object} params - Update parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.runId - Run ID (in any supported format)
 * @param {Object} params.updates - Fields to update
 * @param {boolean} [params.createIfMissing=true] - Whether to create the record if it doesn't exist
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Updated run record
 */
async function updateClientRunRecord(params) {
  const { clientId, runId, updates, createIfMissing = true, options = {} } = params;
  const log = options.logger || logger;
  
  if (!clientId || !runId) {
    log.error("Client ID and Run ID are required to update client run record");
    throw new Error("Client ID and Run ID are required to update client run record");
  }
  
  try {
    // Convert base run ID to standard format
    const baseStandardRunId = unifiedRunIdService.convertToStandardFormat(runId);
    if (!baseStandardRunId) {
      log.error(`Could not convert run ID to standard format: ${runId}`);
      throw new Error(`Could not convert run ID to standard format: ${runId}`);
    }
    
    // Add client suffix to create the client-specific run ID
    const standardizedRunId = unifiedRunIdService.addClientSuffix(baseStandardRunId, clientId);
    
    // Get the client run record
    let record = await getClientRunRecord({ 
      runId: standardizedRunId, 
      clientId, 
      options 
    });
    
    // If record not found and createIfMissing is true, create it
    if (!record && createIfMissing) {
      log.warn(`Client run record not found for ${clientId} with Run ID ${standardizedRunId}, creating it...`);
      
      // Create a new record
      const createdRecord = await createClientRunRecord({
        clientId,
        runId: standardizedRunId,
        initialData: {
          'Recovery Note': 'Created during update attempt - original record missing',
          ...updates
        },
        options
      });
      
      return createdRecord;
    } else if (!record) {
      const errorMessage = `Client run record not found for ${clientId} with Run ID ${standardizedRunId} and createIfMissing is false`;
      log.error(errorMessage);
      throw new Error(errorMessage);
    }
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Prepare update fields
    const updateFields = {};
    
    // Map common update fields to Airtable field names
    if (updates.status) updateFields['Status'] = updates.status;
    if (updates.endTime) updateFields['End Time'] = updates.endTime;
    if (updates.leadsProcessed) updateFields['Leads Processed'] = updates.leadsProcessed;
    if (updates.postsProcessed) updateFields['Posts Processed'] = updates.postsProcessed;
    if (updates.errors) updateFields['Errors'] = updates.errors;
    if (updates.notes) updateFields['System Notes'] = updates.notes;
    if (updates.tokenUsage) updateFields['Token Usage'] = updates.tokenUsage;
    if (updates.promptTokens) updateFields['Prompt Tokens'] = updates.promptTokens;
    if (updates.completionTokens) updateFields['Completion Tokens'] = updates.completionTokens;
    if (updates.totalTokens) updateFields['Total Tokens'] = updates.totalTokens;
    
    // Add any other custom fields from updates
    Object.keys(updates).forEach(key => {
      if (!['status', 'endTime', 'leadsProcessed', 'postsProcessed', 'errors', 'notes', 
          'tokenUsage', 'promptTokens', 'completionTokens', 'totalTokens', 'Success Rate'].includes(key)) {
        updateFields[key] = updates[key];
      }
    });
    
    // Update the run record
    await masterBase(CLIENT_RUN_RESULTS_TABLE).update(record.id, updateFields);
    
    log.debug(`Updated client run record for ${clientId}: ${standardizedRunId}`);
    
    // Also update the corresponding job tracking record
    try {
      await updateJobTrackingRecord({
        runId: baseStandardRunId,
        updates: {
          clientId,
          status: updates.status,
          endTime: updates.endTime,
          progress: updates.progress || `${updates.leadsProcessed || 0} leads processed`,
          itemsProcessed: updates.leadsProcessed || updates.postsProcessed,
          error: updates.errors
        },
        options: { 
          logger: log 
        }
      });
    } catch (jobError) {
      // Non-fatal, just log the error
      log.warn(`Error updating job tracking record for ${baseStandardRunId}: ${jobError.message}`);
    }
    
    return {
      id: record.id,
      runId: standardizedRunId,
      baseRunId: baseStandardRunId,
      clientId,
      ...updates
    };
  } catch (error) {
    log.error(`Error updating client run record: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a client run record
 * @param {Object} params - Completion parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.runId - Run ID (in any supported format)
 * @param {Object} [params.metrics] - Completion metrics
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Completed run record
 */
async function completeClientRunRecord(params) {
  const { clientId, runId, metrics = {}, options = {} } = params;
  const log = options.logger || logger;
  
  try {
    const endTime = new Date().toISOString();
    
    // Update with completion status and metrics
    return await updateClientRunRecord({
      clientId,
      runId,
      updates: {
        status: 'Completed',
        endTime,
        ...metrics
      },
      options
    });
  } catch (error) {
    log.error(`Error completing client run record: ${error.message}`);
    throw error;
  }
}

/**
 * Update aggregate metrics for a job by combining results from all client records
 * @param {Object} params - Parameters
 * @param {string} params.runId - Run ID (in any supported format)
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Updated job tracking record
 */
async function updateAggregateMetrics(params) {
  const { runId, options = {} } = params;
  const log = options.logger || logger;
  
  try {
    // Convert to standard format
    const standardizedRunId = unifiedRunIdService.convertToStandardFormat(runId);
    if (!standardizedRunId) {
      log.error(`Could not convert run ID to standard format: ${runId}`);
      throw new Error(`Could not convert run ID to standard format: ${runId}`);
    }
    
    log.info(`Updating aggregate metrics for run ID: ${standardizedRunId}`);
    
    // Get the master clients base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Get all client records for this run
    const clientRecords = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
      filterByFormula: `FIND('${standardizedRunId}', {Run ID}) > 0`
    }).all();
    
    if (!clientRecords || clientRecords.length === 0) {
      log.warn(`No client records found for run ID: ${standardizedRunId}`);
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
    
    // Update the job tracking record using the standardized run ID
    return await updateJobTrackingRecord({
      runId: standardizedRunId,
      updates: aggregates,
      options
    });
  } catch (error) {
    log.error(`Error updating aggregate metrics: ${error.message}`);
    throw error;
  }
}

module.exports = {
  getJobTrackingRecord,
  createJobTrackingRecord,
  updateJobTrackingRecord,
  completeJobTrackingRecord,
  getClientRunRecord,
  createClientRunRecord,
  updateClientRunRecord,
  completeClientRunRecord,
  updateAggregateMetrics
};