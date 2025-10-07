// services/apifyRunsService.js
const { logCriticalError } = require('../utils/errorLogger');
// Service for managing Apify run tracking to enable multi-tenant webhook handling
// Stores mapping between Apify run IDs and client IDs in Master Clients base

require('dotenv').config();
const Airtable = require('airtable');
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
// Using the new runIdSystem service as the single source of truth
const runIdSystem = require('./runIdSystem');
// Import unified constants for Apify table and Client Run Results table
const { 
    APIFY_FIELDS,
    APIFY_STATUS_VALUES,
    CLIENT_RUN_FIELDS, 
    CLIENT_RUN_STATUS_VALUES,
    MASTER_TABLES 
} = require('../constants/airtableUnifiedConstants');

// Cache for performance (short-lived since runs are typically short)
let runsCache = new Map();
const CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutes

// Master Clients base connection for Apify Runs table
let masterClientsBase = null;

// Load airtableService for updating client run metrics
let airtableService;
try {
    airtableService = require('./airtableService');
} catch (err) {
    console.error("Failed to load airtableService:", err.message);
    logCriticalError(err, { context: 'Module initialization error', service: 'apifyRunsService.js' }).catch(() => {});
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
 * @param {string} options.systemRunId - Our system-generated run ID to maintain mapping
 * @returns {Promise<Object>} Created record
 */
async function createApifyRun(runId, clientId, options = {}) {
    try {
        const base = initializeMasterClientsBase();
        
        // Use systemRunId if provided, otherwise create a client run ID
        // This prevents trying to normalize non-standard Apify run IDs
        let normalizedRunId;
        
        if (options.systemRunId) {
            normalizedRunId = options.systemRunId;
            console.log(`[ApifyRuns] Using provided system run ID: ${normalizedRunId} for Apify run: ${runId} and client ${clientId}`);
        } else {
            // Generate a new run ID and add client suffix
            const baseRunId = runIdSystem.generateRunId();
            normalizedRunId = runIdSystem.createClientRunId(baseRunId, clientId);
            console.log(`[ApifyRuns] Created new run ID: ${normalizedRunId} for Apify run: ${runId} and client ${clientId}`);
        }
        
        const recordData = {
            [APIFY_FIELDS.RUN_ID]: normalizedRunId,
            [APIFY_FIELDS.CLIENT_ID]: clientId,
            [APIFY_FIELDS.STATUS]: APIFY_STATUS_VALUES.RUNNING,
            [APIFY_FIELDS.CREATED_AT]: new Date().toISOString(),
            [APIFY_FIELDS.ACTOR_ID]: options.actorId || '',
            [APIFY_FIELDS.TARGET_URLS]: Array.isArray(options.targetUrls) ? options.targetUrls.join('\n') : '',
            [APIFY_FIELDS.MODE]: options.mode || 'webhook',
            // Store the original Apify run ID to maintain the mapping
            [APIFY_FIELDS.APIFY_RUN_ID]: runId,
            [APIFY_FIELDS.LAST_UPDATED]: new Date().toISOString()
        };

        console.log(`[ApifyRuns] Creating run record: ${runId} for client: ${clientId}`);
        
        const createdRecords = await base(MASTER_TABLES.APIFY).create([{
            fields: recordData
        }]);

        const record = createdRecords[0];
        const runData = {
            id: record.id,
            runId: record.get(APIFY_FIELDS.RUN_ID),
            clientId: record.get(APIFY_FIELDS.CLIENT_ID),
            status: record.get(APIFY_FIELDS.STATUS),
            createdAt: record.get(APIFY_FIELDS.CREATED_AT),
            actorId: record.fields[APIFY_FIELDS.ACTOR_ID] ? record.get(APIFY_FIELDS.ACTOR_ID) : null,
            targetUrls: record.fields[APIFY_FIELDS.TARGET_URLS] ? record.get(APIFY_FIELDS.TARGET_URLS) : '',
            mode: record.fields[APIFY_FIELDS.MODE] ? record.get(APIFY_FIELDS.MODE) : 'webhook',
            lastUpdated: record.fields[APIFY_FIELDS.LAST_UPDATED] ? record.get(APIFY_FIELDS.LAST_UPDATED) : new Date().toISOString(),
            datasetId: record.fields[APIFY_FIELDS.DATASET_ID] ? record.get(APIFY_FIELDS.DATASET_ID) : null,
            completedAt: record.fields[APIFY_FIELDS.COMPLETED_AT] ? record.get(APIFY_FIELDS.COMPLETED_AT) : null,
            error: record.fields[APIFY_FIELDS.ERROR] ? record.get(APIFY_FIELDS.ERROR) : null,
            apifyRunId: record.get(APIFY_FIELDS.APIFY_RUN_ID)
        };

        // Cache the record
        runsCache.set(runId, { data: runData, timestamp: Date.now() });
        
        console.log(`[ApifyRuns] Successfully created run record: ${runId}`);
        return runData;

    } catch (error) {
        console.error(`[ApifyRuns] Error creating run record for ${runId}:`, error.message);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'apifyRunsService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Get Apify run by run ID or Apify run ID
 * @param {string} runId - Either system run ID or Apify run ID
 * @param {Object} options - Options for retrieval
 * @param {boolean} options.isApifyId - Whether the ID is an Apify run ID (defaults to checking both)
 * @returns {Promise<Object|null>} Run data or null if not found
 */
async function getApifyRun(runId, options = {}) {
    try {
        // Check cache first
        const cached = runsCache.get(runId);
        if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION_MS) {
            console.log(`[ApifyRuns] Returning cached run data for: ${runId}`);
            return cached.data;
        }

        const base = initializeMasterClientsBase();
        
        console.log(`[ApifyRuns] Fetching run data for: ${runId}`);
        
        // Build the filter formula based on whether we're looking up by Apify run ID or system run ID
        let filterFormula;
        if (options.isApifyId === true) {
            // Only check the Apify Run ID column
            filterFormula = `{${APIFY_FIELDS.APIFY_RUN_ID}} = '${runId}'`;
        } else if (options.isApifyId === false) {
            // Only check the system Run ID column
            filterFormula = `{${APIFY_FIELDS.RUN_ID}} = '${runId}'`;
        } else {
            // Check both columns (default behavior)
            filterFormula = `OR({${APIFY_FIELDS.RUN_ID}} = '${runId}', {${APIFY_FIELDS.APIFY_RUN_ID}} = '${runId}')`;
        }
        
        const records = await base(MASTER_TABLES.APIFY).select({
            filterByFormula: filterFormula,
            maxRecords: 1
        }).firstPage();

        if (records.length === 0) {
            console.log(`[ApifyRuns] No run found for: ${runId}`);
            return null;
        }

        const record = records[0];
        const runData = {
            id: record.id,
            runId: record.get(APIFY_FIELDS.RUN_ID),
            clientId: record.get(APIFY_FIELDS.CLIENT_ID),
            status: record.get(APIFY_FIELDS.STATUS),
            createdAt: record.get(APIFY_FIELDS.CREATED_AT),
            actorId: record.fields[APIFY_FIELDS.ACTOR_ID] ? record.get(APIFY_FIELDS.ACTOR_ID) : null,
            targetUrls: record.fields[APIFY_FIELDS.TARGET_URLS] ? record.get(APIFY_FIELDS.TARGET_URLS) : '',
            apifyRunId: record.fields[APIFY_FIELDS.APIFY_RUN_ID] ? record.get(APIFY_FIELDS.APIFY_RUN_ID) : null,
            mode: record.fields[APIFY_FIELDS.MODE] ? record.get(APIFY_FIELDS.MODE) : 'webhook',
            lastUpdated: record.fields[APIFY_FIELDS.LAST_UPDATED] ? record.get(APIFY_FIELDS.LAST_UPDATED) : new Date().toISOString(),
            datasetId: record.fields[APIFY_FIELDS.DATASET_ID] ? record.get(APIFY_FIELDS.DATASET_ID) : null,
            completedAt: record.fields[APIFY_FIELDS.COMPLETED_AT] ? record.get(APIFY_FIELDS.COMPLETED_AT) : null,
            error: record.fields[APIFY_FIELDS.ERROR] ? record.get(APIFY_FIELDS.ERROR) : null
        };

        // Cache the result
        runsCache.set(runId, { data: runData, timestamp: Date.now() });
        
        console.log(`[ApifyRuns] Found run for client: ${runData.clientId}`);
        return runData;

    } catch (error) {
        console.error(`[ApifyRuns] Error fetching run ${runId}:`, error.message);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'apifyRunsService.js' }).catch(() => {});
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
            [APIFY_FIELDS.LAST_UPDATED]: new Date().toISOString()
        };

        if (updateData.status) {
            // Map Apify status values - keep them as-is since they match Airtable dropdown options
            // Apify uses: RUNNING, SUCCEEDED, FAILED (all caps)
            // No need to normalize - use Apify's values directly
            updateFields[APIFY_FIELDS.STATUS] = updateData.status;
            if (updateData.status === 'SUCCEEDED' || updateData.status === 'FAILED') {
                updateFields[APIFY_FIELDS.COMPLETED_AT] = new Date().toISOString();
            }
        }

        if (updateData.datasetId) {
            updateFields[APIFY_FIELDS.DATASET_ID] = updateData.datasetId;
        }

        if (updateData.error) {
            updateFields[APIFY_FIELDS.ERROR] = updateData.error;
        }

        console.log(`[ApifyRuns] Updating run ${runId} with status: ${updateData.status}`);
        
        const updatedRecords = await base(MASTER_TABLES.APIFY).update([{
            id: existingRun.id,
            fields: updateFields
        }]);

        const record = updatedRecords[0];
        const runData = {
            id: record.id,
            runId: record.get(APIFY_FIELDS.RUN_ID),
            clientId: record.get(APIFY_FIELDS.CLIENT_ID),
            status: record.get(APIFY_FIELDS.STATUS),
            createdAt: record.get(APIFY_FIELDS.CREATED_AT),
            actorId: record.fields[APIFY_FIELDS.ACTOR_ID] ? record.get(APIFY_FIELDS.ACTOR_ID) : null,
            targetUrls: record.fields[APIFY_FIELDS.TARGET_URLS] ? record.get(APIFY_FIELDS.TARGET_URLS) : '',
            mode: record.fields[APIFY_FIELDS.MODE] ? record.get(APIFY_FIELDS.MODE) : 'webhook',
            lastUpdated: record.fields[APIFY_FIELDS.LAST_UPDATED] ? record.get(APIFY_FIELDS.LAST_UPDATED) : new Date().toISOString(),
            datasetId: record.fields[APIFY_FIELDS.DATASET_ID] ? record.get(APIFY_FIELDS.DATASET_ID) : null,
            completedAt: record.fields[APIFY_FIELDS.COMPLETED_AT] ? record.get(APIFY_FIELDS.COMPLETED_AT) : null,
            error: record.fields[APIFY_FIELDS.ERROR] ? record.get(APIFY_FIELDS.ERROR) : null
        };

        // Update cache
        runsCache.set(runId, { data: runData, timestamp: Date.now() });
        
        console.log(`[ApifyRuns] Successfully updated run: ${runId}`);
        return runData;

    } catch (error) {
        console.error(`[ApifyRuns] Error updating run ${runId}:`, error.message);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'apifyRunsService.js' }).catch(() => {});
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
        await logCriticalError(error, { context: 'Service error (swallowed)', service: 'apifyRunsService.js' }).catch(() => {});
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
        
        const records = await base(MASTER_TABLES.APIFY).select({
            filterByFormula: `{${APIFY_FIELDS.CLIENT_ID}} = '${clientId}'`,
            sort: [{ field: APIFY_FIELDS.CREATED_AT, direction: 'desc' }],
            maxRecords: limit
        }).firstPage();

        const runs = records.map(record => ({
            id: record.id,
            runId: record.get(APIFY_FIELDS.RUN_ID),
            clientId: record.get(APIFY_FIELDS.CLIENT_ID),
            status: record.get(APIFY_FIELDS.STATUS),
            createdAt: record.get(APIFY_FIELDS.CREATED_AT),
            actorId: record.fields[APIFY_FIELDS.ACTOR_ID] ? record.get(APIFY_FIELDS.ACTOR_ID) : null,
            targetUrls: record.fields[APIFY_FIELDS.TARGET_URLS] ? record.get(APIFY_FIELDS.TARGET_URLS) : '',
            mode: record.fields[APIFY_FIELDS.MODE] ? record.get(APIFY_FIELDS.MODE) : 'webhook',
            lastUpdated: record.fields[APIFY_FIELDS.LAST_UPDATED] ? record.get(APIFY_FIELDS.LAST_UPDATED) : new Date().toISOString(),
            datasetId: record.fields[APIFY_FIELDS.DATASET_ID] ? record.get(APIFY_FIELDS.DATASET_ID) : null,
            completedAt: record.fields[APIFY_FIELDS.COMPLETED_AT] ? record.get(APIFY_FIELDS.COMPLETED_AT) : null,
            error: record.fields[APIFY_FIELDS.ERROR] ? record.get(APIFY_FIELDS.ERROR) : null
        }));

        console.log(`[ApifyRuns] Found ${runs.length} runs for client: ${clientId}`);
        return runs;

    } catch (error) {
        console.error(`[ApifyRuns] Error fetching runs for client ${clientId}:`, error.message);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'apifyRunsService.js' }).catch(() => {});
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
        logCriticalError(error, { context: 'Service error (swallowed)', service: 'apifyRunsService.js' }).catch(() => {});
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
            airtableService = require('./airtableService');
        }
        
        // CRITICAL: In orchestrated runs, the runId passed here is ALREADY the complete
        // client run ID (e.g., "251007-041822-Guy-Wilson") created by the orchestrator.
        // We use it EXACTLY as-is with NO reconstruction or suffix manipulation.
        const standardizedRunId = runId;
        
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
        
        // Update the client run record with all metrics - Use constants for field names to prevent errors
        const updated = await airtableService.updateClientRun(standardizedRunId, clientId, {
            [UNIFIED_CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: data.postsCount,
            [UNIFIED_CLIENT_RUN_FIELDS.APIFY_COST]: estimatedCost,
            [UNIFIED_CLIENT_RUN_FIELDS.APIFY_RUN_ID]: runId,
            [UNIFIED_CLIENT_RUN_FIELDS.PROFILES_SUBMITTED]: data.profilesCount
        });
        
        
        return updated;
    } catch (error) {
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'apifyRunsService.js' }).catch(() => {});
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
            [APIFY_FIELDS.LAST_UPDATED]: new Date().toISOString()
        };
        
        // Add the Apify run ID if available
        if (webhookData.defaultDatasetId) {
            metrics[APIFY_FIELDS.APIFY_RUN_ID] = webhookData.defaultDatasetId;
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
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'apifyRunsService.js' }).catch(() => {});
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
