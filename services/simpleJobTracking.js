/**
 * services/simpleJobTracking.js
 * 
 * A simplified service for job tracking operations.
 * This consolidates job ID generation and record management
 * into a single service with clear, consistent behavior.
 */

const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
const baseManager = require('./airtable/baseManager');
const { STATUS_VALUES, CLIENT_RUN_FIELDS, JOB_TRACKING_FIELDS, MASTER_TABLES } = require('../constants/airtableUnifiedConstants');

// Table names
const JOB_TRACKING_TABLE = MASTER_TABLES.JOB_TRACKING;
const CLIENT_RUN_RESULTS_TABLE = MASTER_TABLES.CLIENT_RUN_RESULTS;

// Default logger - using safe creation
const logger = createSafeLogger('SYSTEM', null, 'simple_job_tracking');

/**
 * Generate a standardized run ID in YYMMDD-HHMMSS format
 * @returns {string} A timestamp-based run ID
 */
function generateRunId() {
    const now = new Date();
    const year = String(now.getFullYear()).slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Add client suffix to a base run ID
 * @param {string} baseRunId - Base run ID (YYMMDD-HHMMSS)
 * @param {string} clientId - Client ID to add as suffix
 * @returns {string} Run ID with client suffix
 */
function addClientSuffix(baseRunId, clientId) {
    if (!baseRunId || !clientId) {
        logger.warn(`Cannot add client suffix with missing values. baseRunId: ${baseRunId}, clientId: ${clientId}`);
        return baseRunId;
    }
    
    // Format: YYMMDD-HHMMSS-ClientName
    const runId = `${baseRunId}-${clientId}`;
    logger.debug(`Added client suffix to run ID: ${runId}`);
    
    return runId;
}

/**
 * Create a job tracking record
 * @param {Object} params - Parameters
 * @param {string} params.runId - Run ID for the job
 * @param {string} params.jobType - Type of job
 * @param {Object} [params.initialData={}] - Initial data for the record
 * @param {Object} [params.options={}] - Additional options
 * @returns {Promise<Object>} Created record
 */
async function createJobTrackingRecord(params) {
    const { runId, jobType = 'job', initialData = {}, options = {} } = params;
    const log = options.logger || logger;
    
    if (!runId) {
        log.error("Run ID is required to create job tracking record");
        throw new Error("Run ID is required to create job tracking record");
    }
    
    try {
        // Get the master base
        const masterBase = baseManager.getMasterClientsBase();
        
        // Check if record already exists
        const existingRecords = await masterBase(JOB_TRACKING_TABLE).select({
            filterByFormula: `{Run ID} = '${runId}'`,
            maxRecords: 1
        }).firstPage();
        
        if (existingRecords && existingRecords.length > 0) {
            log.warn(`Job tracking record already exists for run ID ${runId}. Not creating duplicate.`);
            return {
                id: existingRecords[0].id,
                runId,
                alreadyExists: true
            };
        }
        
        // Default values
        const startTime = new Date().toISOString();
        
        // Prepare record data
        const recordData = {
            'Run ID': runId,
            'Status': 'Running',
            'Start Time': startTime,
            'Job Type': jobType,
            ...initialData
        };
        
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
 * @returns {Promise<Object>} Updated record
 */
async function updateJobTrackingRecord(params) {
    const { runId, updates = {}, options = {} } = params;
    const log = options.logger || logger;
    
    if (!runId) {
        log.error("Run ID is required to update job tracking record");
        throw new Error("Run ID is required to update job tracking record");
    }
    
    try {
        // Get the master base
        const masterBase = baseManager.getMasterClientsBase();
        
        // Find the record
        const records = await masterBase(JOB_TRACKING_TABLE).select({
            filterByFormula: `{Run ID} = '${runId}'`,
            maxRecords: 1
        }).firstPage();
        
        if (!records || records.length === 0) {
            log.error(`Job tracking record not found for run ID ${runId}`);
            throw new Error(`Job tracking record not found for run ID ${runId}`);
        }
        
        const record = records[0];
        
        // Prepare update fields
        const updateFields = {};
        
        // Map common update fields to Airtable field names using constants
        if (updates.status) updateFields[JOB_TRACKING_FIELDS.STATUS] = updates.status;
        if (updates.endTime) updateFields[JOB_TRACKING_FIELDS.END_TIME] = updates.endTime;
        if (updates.error) updateFields['Error'] = updates.error; // Keep as is if no constant available
        if (updates.progress) updateFields['Progress'] = updates.progress; // Keep as is if no constant available
        if (updates.itemsProcessed) updateFields['Items Processed'] = updates.itemsProcessed; // Keep as is if no constant available
        if (updates.notes) updateFields[JOB_TRACKING_FIELDS.SYSTEM_NOTES] = updates.notes;
        
        // Add any other custom fields from updates, except formula fields and mapped fields
        // CRITICAL: Don't add fields that are already mapped above (status, endTime, etc.) to avoid duplicates with wrong casing
        // Use case-insensitive comparison to handle 'Status' vs 'status'
        const excludedKeys = ['status', 'endtime', 'error', 'progress', 'itemsprocessed', 'notes', 'success rate', 'duration'];
        Object.keys(updates).forEach(key => {
            if (!excludedKeys.includes(key.toLowerCase())) {
                updateFields[key] = updates[key];
            }
        });
        
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
 * Create a client run record
 * @param {Object} params - Parameters
 * @param {string} params.runId - Base run ID
 * @param {string} params.clientId - Client ID
 * @param {Object} [params.initialData={}] - Initial data
 * @param {Object} [params.options={}] - Additional options
 * @returns {Promise<Object>} Created record
 */
async function createClientRunRecord(params) {
    const { runId, clientId, initialData = {}, options = {} } = params;
    const log = options.logger || logger;
    
    if (!runId || !clientId) {
        log.error("Run ID and Client ID are required to create client run record");
        throw new Error("Run ID and Client ID are required to create client run record");
    }
    
    try {
        // Create client-specific run ID
        const clientRunId = addClientSuffix(runId, clientId);
        
        // Get the master base
        const masterBase = baseManager.getMasterClientsBase();
        
        // Check if record already exists
        const existingRecords = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
            filterByFormula: `{Run ID} = '${clientRunId}'`,
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
        
        // Prepare record data
        const recordData = {
            'Run ID': clientRunId,
            'Client ID': clientId,
            'Status': 'Running',
            'Start Time': startTime,
            ...initialData
        };
        
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
 * Update a client run record
 * @param {Object} params - Parameters
 * @param {string} params.runId - Base run ID
 * @param {string} params.clientId - Client ID
 * @param {Object} params.updates - Updates to apply
 * @param {boolean} [params.createIfMissing=false] - Whether to create the record if it doesn't exist
 * @param {Object} [params.options={}] - Additional options
 * @returns {Promise<Object>} Updated record
 */
async function updateClientRunRecord(params) {
    const { runId, clientId, updates = {}, createIfMissing = false, options = {} } = params;
    const log = options.logger || logger;
    
    if (!runId || !clientId) {
        log.error("Run ID and Client ID are required to update client run record");
        throw new Error("Run ID and Client ID are required to update client run record");
    }
    
    try {
        // Create client-specific run ID
        const clientRunId = addClientSuffix(runId, clientId);
        
        // Get the master base
        const masterBase = baseManager.getMasterClientsBase();
        
        // Find the record
        const records = await masterBase(CLIENT_RUN_RESULTS_TABLE).select({
            filterByFormula: `{Run ID} = '${clientRunId}'`,
            maxRecords: 1
        }).firstPage();
        
        // If record not found and createIfMissing is true, create it
        if ((!records || records.length === 0) && createIfMissing) {
            log.warn(`Client run record for ${clientRunId} not found, creating it...`);
            return await createClientRunRecord({
                runId,
                clientId,
                initialData: updates,
                options
            });
        } else if (!records || records.length === 0) {
            log.error(`Client run record not found for ${clientRunId} and createIfMissing is false`);
            throw new Error(`Client run record not found for ${clientRunId}`);
        }
        
        const record = records[0];
        
        // Prepare update fields
        const updateFields = {};
        
        // Map common update fields to Airtable field names using constants
        if (updates.status) updateFields[CLIENT_RUN_FIELDS.STATUS] = updates.status;
        if (updates.endTime) updateFields[CLIENT_RUN_FIELDS.END_TIME] = updates.endTime;
        if (updates.leadsProcessed) updateFields[CLIENT_RUN_FIELDS.PROFILES_EXAMINED] = updates.leadsProcessed;
        if (updates.postsProcessed) updateFields[CLIENT_RUN_FIELDS.POSTS_EXAMINED] = updates.postsProcessed;
        if (updates.errors) updateFields[CLIENT_RUN_FIELDS.LEAD_SCORING_ERRORS] = updates.errors;
        if (updates.notes) updateFields[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = updates.notes;
        if (updates.tokenUsage) updateFields[CLIENT_RUN_FIELDS.LEAD_SCORING_TOKENS] = updates.tokenUsage;
        if (updates.promptTokens) updateFields['Prompt Tokens'] = updates.promptTokens;
        if (updates.completionTokens) updateFields['Completion Tokens'] = updates.completionTokens;
        if (updates.totalTokens) updateFields['Total Tokens'] = updates.totalTokens;
        
        // Add any other custom fields from updates, except formula fields
        // Use case-insensitive comparison to prevent duplicate fields when updates object has different casing
        const excludedClientRunKeys = ['status', 'endtime', 'leadsprocessed', 'postsprocessed', 'errors', 'notes', 
            'tokenusage', 'prompttokens', 'completiontokens', 'totaltokens', 'success rate'];
        Object.keys(updates).forEach(key => {
            if (!excludedClientRunKeys.includes(key.toLowerCase())) {
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
 * @param {string} [params.status=STATUS_VALUES.COMPLETED] - Final status
 * @param {Object} [params.updates={}] - Additional updates
 * @param {Object} [params.options={}] - Additional options
 * @returns {Promise<Object>} Completed record
 */
async function completeJobTrackingRecord(params) {
    const { runId, status = STATUS_VALUES.COMPLETED, updates = {}, options = {} } = params;
    
    // Add completion details to updates
    const completeUpdates = {
        ...updates,
        status,
        endTime: updates.endTime || new Date().toISOString()
    };
    
    // Update the record with completion details
    return await updateJobTrackingRecord({
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
 * @param {string} [params.status=STATUS_VALUES.COMPLETED] - Final status
 * @param {Object} [params.updates={}] - Additional updates
 * @param {Object} [params.options={}] - Additional options
 * @returns {Promise<Object>} Completed record
 */
async function completeClientRunRecord(params) {
    const { runId, clientId, status = STATUS_VALUES.COMPLETED, updates = {}, options = {} } = params;
    
    // Add completion details to updates
    const completeUpdates = {
        ...updates,
        status,
        endTime: updates.endTime || new Date().toISOString()
    };
    
    // Update the record with completion details
    return await updateClientRunRecord({
        runId,
        clientId,
        updates: completeUpdates,
        options
    });
}

module.exports = {
    // ID generation and manipulation
    generateRunId,
    addClientSuffix,
    
    // Job tracking operations
    createJobTrackingRecord,
    updateJobTrackingRecord,
    completeJobTrackingRecord,
    
    // Client run operations
    createClientRunRecord,
    updateClientRunRecord,
    completeClientRunRecord
};