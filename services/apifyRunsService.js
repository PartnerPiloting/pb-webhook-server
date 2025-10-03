// services/apifyRunsService.js
// Service for managing Apify run tracking to enable multi-tenant webhook handling
// Stores mapping between Apify run IDs and client IDs in Master Clients base

require('dotenv').config();
const Airtable = require('airtable');
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
// Updated to use unified run ID service
const runIdService = require('./unifiedRunIdService');
// Import field constants
const { CLIENT_RUN_FIELDS } = require('../constants/airtableFields');
// Import status constants
const { STATUS_VALUES } = require('../constants/airtableUnifiedConstants');

// Cache for performance (short-lived since runs are typically short)
let runsCache = new Map();
const CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutes

// Master Clients base connection for Apify Runs table
let masterClientsBase = null;

// Load airtableService for updating client run metrics
let airtableService;
try {
    airtableService = require('./airtable/airtableService');
} catch (err) {
    console.error("Failed to load airtableService:", err.message);
}

/**
 * Initialize connection to the Master Clients base
 */
function initializeMasterClientsBase() {
    if (masterClientsBase) return masterClientsBase;

    if (!process.env.MASTER_CLIENTS_BASE_ID) {
        throw new Error("MASTER_CLIENTS_BASE_ID environment variable is not set");
    }
    if (!process.env.AIRTABLE_API_KEY) {
        throw new Error("AIRTABLE_API_KEY environment variable is not set");
    }

    // Configure Airtable if not already done
    Airtable.configure({
        apiKey: process.env.AIRTABLE_API_KEY
    });

    masterClientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    console.log("Master Clients base initialized for Apify Runs service");
    return masterClientsBase;
}

/**
 * Create a new Apify run record
 * @param {string} runId - Apify run ID
 * @param {string} clientId - Client ID that initiated the run
 * @param {Object} options - Additional options
 * @param {string} options.actorId - Apify Actor ID
 * @param {Array<string>} options.targetUrls - Target URLs being scraped
 * @param {string} options.mode - Run mode ('webhook' or 'inline')
 * @returns {Promise<Object>} Created record
 */
async function createApifyRun(runId, clientId, options = {}) {
    try {
        const base = initializeMasterClientsBase();
        
        // Normalize the Apify run ID with the client suffix for consistent format
        const normalizedRunId = runIdService.registerApifyRunId(runId, clientId);
        console.log(`[ApifyRuns] Normalizing Apify run ID: ${runId} -> ${normalizedRunId} for client ${clientId}`);
        
        const recordData = {
            'Run ID': normalizedRunId,
            'Client ID': clientId,
            'Status': STATUS_VALUES.RUNNING,
            'Created At': new Date().toISOString(),
            'Actor ID': options.actorId || '',
            'Target URLs': Array.isArray(options.targetUrls) ? options.targetUrls.join('\n') : '',
            // Mode field might not exist in the Apify table, remove if it causes issues
            'Mode': options.mode || 'webhook',
            // Last Updated field might not exist in the Apify table, remove if it causes issues
            'Last Updated': new Date().toISOString()
        };

        console.log(`[ApifyRuns] Creating run record: ${runId} for client: ${clientId}`);
        
        const createdRecords = await base('Apify').create([{
            fields: recordData
        }]);

        const record = createdRecords[0];
        const runData = {
            id: record.id,
            runId: record.get('Run ID'),
            clientId: record.get('Client ID'),
            status: record.get('Status'),
            createdAt: record.get('Created At'),
            actorId: record.fields['Actor ID'] ? record.get('Actor ID') : null,
            targetUrls: record.fields['Target URLs'] ? record.get('Target URLs') : '',
            // Handle potentially missing fields
            mode: record.fields['Mode'] ? record.get('Mode') : 'webhook',
            lastUpdated: record.fields['Last Updated'] ? record.get('Last Updated') : new Date().toISOString(),
            datasetId: record.fields['Dataset ID'] ? record.get('Dataset ID') : null,
            completedAt: record.fields['Completed At'] ? record.get('Completed At') : null,
            error: record.fields['Error'] ? record.get('Error') : null
        };

        // Cache the record
        runsCache.set(runId, { data: runData, timestamp: Date.now() });
        
        console.log(`[ApifyRuns] Successfully created run record: ${runId}`);
        return runData;

    } catch (error) {
        console.error(`[ApifyRuns] Error creating run record for ${runId}:`, error.message);
        throw error;
    }
}

/**
 * Get Apify run by run ID
 * @param {string} runId - Apify run ID
 * @returns {Promise<Object|null>} Run data or null if not found
 */
async function getApifyRun(runId) {
    try {
        // Check cache first
        const cached = runsCache.get(runId);
        if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION_MS) {
            console.log(`[ApifyRuns] Returning cached run data for: ${runId}`);
            return cached.data;
        }

        const base = initializeMasterClientsBase();
        
        console.log(`[ApifyRuns] Fetching run data for: ${runId}`);
        
        const records = await base('Apify').select({
            filterByFormula: `{Run ID} = '${runId}'`,
            maxRecords: 1
        }).firstPage();

        if (records.length === 0) {
            console.log(`[ApifyRuns] No run found for: ${runId}`);
            return null;
        }

        const record = records[0];
        const runData = {
            id: record.id,
            runId: record.get('Run ID'),
            clientId: record.get('Client ID'),
            status: record.get('Status'),
            createdAt: record.get('Created At'),
            actorId: record.fields['Actor ID'] ? record.get('Actor ID') : null,
            targetUrls: record.fields['Target URLs'] ? record.get('Target URLs') : '',
            // Handle potentially missing fields
            mode: record.fields['Mode'] ? record.get('Mode') : 'webhook',
            lastUpdated: record.fields['Last Updated'] ? record.get('Last Updated') : new Date().toISOString(),
            datasetId: record.fields['Dataset ID'] ? record.get('Dataset ID') : null,
            completedAt: record.fields['Completed At'] ? record.get('Completed At') : null,
            error: record.fields['Error'] ? record.get('Error') : null
        };

        // Cache the result
        runsCache.set(runId, { data: runData, timestamp: Date.now() });
        
        console.log(`[ApifyRuns] Found run for client: ${runData.clientId}`);
        return runData;

    } catch (error) {
        console.error(`[ApifyRuns] Error fetching run ${runId}:`, error.message);
        throw error;
    }
}

/**
 * Update Apify run status and related data
 * @param {string} runId - Apify run ID
 * @param {Object} updateData - Data to update
 * @param {string} updateData.status - New status
 * @param {string} updateData.datasetId - Dataset ID (when completed)
 * @param {string} updateData.error - Error message (if failed)
 * @returns {Promise<Object>} Updated record
 */
async function updateApifyRun(runId, updateData) {
    try {
        const base = initializeMasterClientsBase();
        
        // First get the record to update
        const existingRun = await getApifyRun(runId);
        if (!existingRun) {
            throw new Error(`Run not found: ${runId}`);
        }

        const updateFields = {
            'Last Updated': new Date().toISOString()
        };

        if (updateData.status) {
            // Map Apify status values to our standardized status values
            let normalizedStatus = updateData.status;
            if (updateData.status === 'FAILED') {
                normalizedStatus = STATUS_VALUES.FAILED;
            } else if (updateData.status === 'SUCCEEDED') {
                normalizedStatus = STATUS_VALUES.COMPLETED;
            }
            
            updateFields[CLIENT_RUN_FIELDS.STATUS] = normalizedStatus;
            if (updateData.status === 'SUCCEEDED' || updateData.status === 'FAILED') {
                updateFields['Completed At'] = new Date().toISOString();
            }
        }

        if (updateData.datasetId) {
            updateFields['Dataset ID'] = updateData.datasetId;
        }

        if (updateData.error) {
            updateFields['Error'] = updateData.error;
        }

        console.log(`[ApifyRuns] Updating run ${runId} with status: ${updateData.status}`);
        
        const updatedRecords = await base('Apify').update([{
            id: existingRun.id,
            fields: updateFields
        }]);

        const record = updatedRecords[0];
        const runData = {
            id: record.id,
            runId: record.get('Run ID'),
            clientId: record.get('Client ID'),
            status: record.get('Status'),
            createdAt: record.get('Created At'),
            actorId: record.fields['Actor ID'] ? record.get('Actor ID') : null,
            targetUrls: record.fields['Target URLs'] ? record.get('Target URLs') : '',
            // Handle potentially missing fields
            mode: record.fields['Mode'] ? record.get('Mode') : 'webhook',
            lastUpdated: record.fields['Last Updated'] ? record.get('Last Updated') : new Date().toISOString(),
            datasetId: record.fields['Dataset ID'] ? record.get('Dataset ID') : null,
            completedAt: record.fields['Completed At'] ? record.get('Completed At') : null,
            error: record.fields['Error'] ? record.get('Error') : null
        };

        // Update cache
        runsCache.set(runId, { data: runData, timestamp: Date.now() });
        
        console.log(`[ApifyRuns] Successfully updated run: ${runId}`);
        return runData;

    } catch (error) {
        console.error(`[ApifyRuns] Error updating run ${runId}:`, error.message);
        throw error;
    }
}

/**
 * Get client ID for a specific run ID (main use case for webhooks)
 * @param {string} runId - Apify run ID
 * @returns {Promise<string|null>} Client ID or null if not found
 */
async function getClientIdForRun(runId) {
    try {
        const runData = await getApifyRun(runId);
        return runData ? runData.clientId : null;
    } catch (error) {
        console.error(`[ApifyRuns] Error getting client ID for run ${runId}:`, error.message);
        return null;
    }
}

/**
 * Get recent runs for a client (debugging/monitoring)
 * @param {string} clientId - Client ID
 * @param {number} limit - Maximum number of runs to return (default: 10)
 * @returns {Promise<Array>} Array of run records
 */
async function getClientRuns(clientId, limit = 10) {
    try {
        const base = initializeMasterClientsBase();
        
        console.log(`[ApifyRuns] Fetching recent runs for client: ${clientId}`);
        
        const records = await base('Apify').select({
            filterByFormula: `{Client ID} = '${clientId}'`, // Reverted back to Client ID based on confirmation of Airtable schema
            sort: [{ field: 'Created At', direction: 'desc' }],
            maxRecords: limit
        }).firstPage();

        const runs = records.map(record => ({
            id: record.id,
            runId: record.get('Run ID'),
            clientId: record.get('Client ID'),
            status: record.get('Status'),
            createdAt: record.get('Created At'),
            actorId: record.fields['Actor ID'] ? record.get('Actor ID') : null,
            targetUrls: record.fields['Target URLs'] ? record.get('Target URLs') : '',
            // Handle potentially missing fields
            mode: record.fields['Mode'] ? record.get('Mode') : 'webhook',
            lastUpdated: record.fields['Last Updated'] ? record.get('Last Updated') : new Date().toISOString(),
            datasetId: record.fields['Dataset ID'] ? record.get('Dataset ID') : null,
            completedAt: record.fields['Completed At'] ? record.get('Completed At') : null,
            error: record.fields['Error'] ? record.get('Error') : null
        }));

        console.log(`[ApifyRuns] Found ${runs.length} runs for client: ${clientId}`);
        return runs;

    } catch (error) {
        console.error(`[ApifyRuns] Error fetching runs for client ${clientId}:`, error.message);
        throw error;
    }
}

/**
 * Extract run ID from webhook payload
 * @param {Object} body - Webhook payload body
 * @returns {string|null} Run ID or null if not found
 */
function extractRunIdFromPayload(body) {
    try {
        if (!body) return null;
        
        // Common Apify webhook payload shapes:
        // - { resource: { id: 'runId' }, ... }
        // - { runId: 'runId' }
        // - { id: 'runId' }
        
        if (typeof body === 'string') {
            try { 
                body = JSON.parse(body); 
            } catch { 
                return null; 
            }
        }
        
        if (body && typeof body === 'object') {
            if (body.resource && body.resource.id) return body.resource.id;
            if (body.runId) return body.runId;
            if (body.id) return body.id;
        }
        
        return null;
    } catch (error) {
        console.error('[ApifyRuns] Error extracting run ID from payload:', error.message);
        return null;
    }
}

/**
 * Clear the runs cache (useful for testing)
 */
function clearRunsCache() {
    runsCache.clear();
    console.log("[ApifyRuns] Cache cleared");
}

/**
 * Update client run metrics with post harvesting data
 * This centralizes the logic for updating metrics in both webhook and inline modes
 * 
 * @param {string} runId - Apify run ID
 * @param {string} clientId - Client ID
 * @param {Object} data - The data to update
 * @param {number} data.postsCount - Number of posts harvested
 * @param {number} data.profilesCount - Number of profiles submitted for harvesting
 * @returns {Promise<Object>} - The updated client run record
 */
async function updateClientRunMetrics(runId, clientId, data) {
    try {
        if (!airtableService) {
            airtableService = require('./airtable/airtableService');
        }
        
        // Ensure we have a client-suffixed run ID in our standard format
        const standardizedRunId = runIdService.normalizeRunId(runId, clientId);
        
        console.log(`[METDEBUG] updateClientRunMetrics called for ${standardizedRunId}`);
        console.log(`[METDEBUG] - Client: ${clientId}`);
        console.log(`[METDEBUG] - Apify Run ID: ${runId}`);
        console.log(`[METDEBUG] - Posts Count: ${data.postsCount}`);
        console.log(`[METDEBUG] - Profiles Count: ${data.profilesCount}`);
        
        // Calculate estimated API costs (based on LinkedIn post queries)
        const estimatedCost = data.postsCount * 0.02; // $0.02 per post as estimate
        
        // Import the new ParameterValidator utility
        const ParameterValidator = require('../utils/parameterValidator');
        const { StructuredLogger } = require('../utils/structuredLogger');
        
        // First validate the parameters to prevent [object Object] issues
        const validatedRunId = ParameterValidator.validateRunId(standardizedRunId, 'updateClientRunMetrics');
        const validatedClientId = ParameterValidator.validateClientId(clientId, 'updateClientRunMetrics');
        
        if (!validatedRunId || !validatedClientId) {
            const errorMsg = `Invalid parameters: runId=${JSON.stringify(standardizedRunId)}, clientId=${JSON.stringify(clientId)}`;
            console.error(`[APIFY_METRICS] ${errorMsg}`);
            throw new Error(errorMsg);
        }
        
        // First check if the run record exists using the runRecordAdapter for consistency
        const runRecordAdapter = require('./runRecordAdapterSimple');
        const recordExists = await runRecordAdapter.checkRunRecordExists({
            runId: validatedRunId,
            clientId: validatedClientId,
            options: { source: 'apify_metrics' }
        });
        
        console.log(`[APIFY_METRICS] Run record exists check for ${validatedRunId}: ${recordExists ? 'YES' : 'NO'}`);
        
        if (!recordExists) {
            const errorMsg = `No run record exists for ${validatedRunId}/${validatedClientId} - cannot update metrics`;
            console.error(`[APIFY_METRICS] CRITICAL ERROR: ${errorMsg}`);
            throw new Error(errorMsg);
        }
        
        // Update the client run record with all metrics
        const updated = await airtableService.updateClientRun(standardizedRunId, clientId, {
            'Total Posts Harvested': data.postsCount,
            'Apify API Costs': estimatedCost,
            'Apify Run ID': runId,
            'Profiles Submitted for Post Harvesting': data.profilesCount
        });
        
        console.log(`[METDEBUG] Updated client run metrics for ${clientId}:`);
        console.log(`[METDEBUG] - Total Posts Harvested: ${data.postsCount}`);
        console.log(`[METDEBUG] - Apify Run ID: ${runId}`);
        console.log(`[METDEBUG] - Using standardized run ID: ${standardizedRunId}`);
        
        return updated;
    } catch (error) {
        console.error(`[METDEBUG] Failed to update client run metrics: ${error.message}`);
        throw error;
    }
}

/**
 * Process an Apify webhook payload and update the appropriate client run record
 * This is a clean implementation that properly validates all inputs
 * 
 * @param {Object} webhookData - The webhook payload data
 * @param {string} clientId - The client ID
 * @param {string} runId - The run ID
 * @returns {Promise<Object>} - Result of the operation
 */
async function processApifyWebhook(webhookData, clientId, runId) {
    // Import required dependencies
    const { StructuredLogger } = require('../utils/structuredLogger');
    const ParameterValidator = require('../utils/parameterValidator');
    const runRecordAdapter = require('./runRecordAdapterSimple');
    
    // Validate parameters to prevent [object Object] errors
    const validatedRunId = ParameterValidator.validateRunId(runId, 'processApifyWebhook');
    const validatedClientId = ParameterValidator.validateClientId(clientId, 'processApifyWebhook');
    
    if (!validatedRunId || !validatedClientId) {
        const errorMsg = `Invalid parameters: runId=${JSON.stringify(runId)}, clientId=${JSON.stringify(clientId)}`;
        console.error(`[APIFY_WEBHOOK] ${errorMsg}`);
        throw new Error(errorMsg);
    }
    
    const logger = createSafeLogger(validatedClientId, validatedRunId, 'apify_webhook');
    
    try {
        logger.debug(`Processing Apify webhook for ${validatedClientId} with run ID ${validatedRunId}`);
        
        // Validate webhook data
        if (!webhookData || typeof webhookData !== 'object') {
            logger.error(`Invalid webhook data: ${JSON.stringify(webhookData)}`);
            throw new Error(`Invalid webhook data`);
        }
        
        // First check if record exists
        const recordExists = await runRecordAdapter.checkRunRecordExists({
            runId: validatedRunId,
            clientId: validatedClientId,
            options: { source: 'apify_webhook', logger }
        });
        
        if (!recordExists) {
            const errorMsg = `No run record exists for ${validatedRunId}/${validatedClientId}`;
            logger.error(`Webhook received but ${errorMsg}`);
            throw new Error(errorMsg);
        }
        
        // Extract the metrics from the webhook data
        const metrics = {
            'Apify Status': webhookData.status || 'UNKNOWN',
            'System Notes': `Webhook received at ${new Date().toISOString()}`,
            'Last Updated': new Date().toISOString()
        };
        
        // Add the Apify run ID if available
        if (webhookData.defaultDatasetId) {
            metrics['Apify Run ID'] = webhookData.defaultDatasetId;
        }
        
        // Update the run record with webhook data
        await runRecordAdapter.updateRunRecord({
            runId: validatedRunId,
            clientId: validatedClientId,
            updates: metrics,
            options: { source: 'apify_webhook', logger }
        });
        
        logger.info(`Successfully processed Apify webhook for ${validatedClientId}`);
        return { success: true };
        
    } catch (error) {
        logger.error(`Error processing Apify webhook: ${error.message}`);
        throw error;
    }
}

module.exports = {
    createApifyRun,
    updateClientRunMetrics,
    getApifyRun,
    updateApifyRun,
    getClientIdForRun,
    getClientRuns,
    extractRunIdFromPayload,
    clearRunsCache,
    processApifyWebhook // Export the new function
};
