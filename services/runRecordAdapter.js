// runRecordAdapter.js
// Adapter to bridge from the old service to the new V2 service with Single Creation Point pattern

const runRecordServiceV2 = require('./runRecordServiceV2');
const runIdService = require('./runIdService');

// We don't need to import the original service since we're implementing all functionality directly

/**
 * Adapts from the original runRecordService.createRunRecord pattern to new V2 pattern
 * @param {string} runId - Run ID
 * @param {string} clientId - Client ID
 * @param {string} clientName - Client name 
 * @param {Object} options - Options including logger and source
 * @returns {Promise<Object>} - The created or fetched record
 */
async function adaptCreateRunRecord(runId, clientId, clientName, options = {}) {
    const logger = options.logger;
    const source = options.source || 'unknown';
    
    if (logger) {
        logger.debug(`[Adapter] Adapting createRunRecord call from source: ${source}`);
    }
    
    try {
        // Strip client suffix if present to get the base run ID
        const baseRunId = runIdService.stripClientSuffix(runId);
        
        if (logger) {
            logger.debug(`[Adapter] Base run ID: ${baseRunId} from original: ${runId}`);
        }
        
        // Normalize the run ID with client suffix
        const normalizedId = runIdService.normalizeRunId(baseRunId, clientId);
        
        if (logger) {
            logger.debug(`[Adapter] Normalized run ID: ${normalizedId}`);
        }
        
        // First try to get an existing record - V2 never creates during updates
        const existingRecord = await runRecordServiceV2.getRunRecord(normalizedId, clientId, {
            logger,
            source: `adapter_from_${source}`
        });
        
        if (existingRecord) {
            if (logger) {
                logger.debug(`[Adapter] Run record already exists for ${normalizedId}, client ${clientId} - using existing`);
            }
            
            // Record exists, return it
            return existingRecord;
        }
        
        // Determine if this source is authorized to create records
        const allowedSources = ['orchestrator', 'master_process', 'smart_resume_workflow', 'batch_process'];
        
        // Check if the source is directly allowed
        let isAuthorized = allowedSources.includes(source);
        
        // Special case mappings for common sources
        const sourceMap = {
            'batchScorer_process': 'batch_process',
            'batchScorer_skip': 'batch_process'
        };
        
        // If not directly allowed, check if there's a mapping
        if (!isAuthorized && sourceMap[source]) {
            isAuthorized = true;
            
            // Use the mapped source
            if (logger) {
                logger.debug(`[Adapter] Mapping source ${source} to ${sourceMap[source]}`);
            }
            
            options.source = sourceMap[source];
        }
        
        if (!isAuthorized) {
            if (logger) {
                logger.error(`[Adapter] Unauthorized source "${source}" attempted to create run record`);
            }
            throw new Error(`Unauthorized source "${source}" attempted to create run record`);
        }
        
        // Create the record with V2 service using normalized ID
        if (logger) {
            logger.debug(`[Adapter] Creating new run record for ${normalizedId}, client ${clientId} with source ${options.source}`);
        }
        
        return await runRecordServiceV2.createClientRunRecord(normalizedId, clientId, clientName, options);
    } catch (error) {
        if (logger) {
            logger.error(`[Adapter] Error in adaptCreateRunRecord: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Adapts from the original completeRunRecord pattern to new V2 pattern
 * @param {string} runId - Run ID
 * @param {string} clientId - Client ID 
 * @param {string} status - Status (Success, Error, Skipped)
 * @param {string} notes - Notes
 * @param {Object} options - Options
 * @returns {Promise<Object>} - Updated record
 */
async function adaptCompleteRunRecord(runId, clientId, status, notes = '', options = {}) {
    const logger = options.logger;
    const source = options.source || 'unknown';
    
    if (logger) {
        logger.debug(`[Adapter] Adapting completeRunRecord call for ${runId}, client ${clientId} from source: ${source}`);
    }
    
    // Just use the V2 service which will verify record exists
    return await runRecordServiceV2.completeRunRecord(runId, clientId, status, notes, options);
}

/**
 * Adapts from the original updateMetrics pattern to new V2 pattern
 * @param {string} runId - Run ID
 * @param {string} clientId - Client ID
 * @param {Object} metrics - Metrics to update
 * @param {Object} options - Options
 * @returns {Promise<Object>} - Updated record
 */
async function adaptUpdateClientMetrics(runId, clientId, metrics, options = {}) {
    const logger = options.logger;
    const source = options.source || 'unknown';
    
    if (logger) {
        logger.debug(`[Adapter] Adapting updateClientMetrics call for ${runId}, client ${clientId}`);
    }
    
    // Just use the V2 service which will verify record exists
    return await runRecordServiceV2.updateClientMetrics(runId, clientId, metrics, options);
}

/**
 * Creates a job record - restricted to orchestrator/master process
 * @param {string} runId - Run ID
 * @param {number} stream - Stream number
 * @param {Object} options - Options
 */
async function adaptCreateJobRecord(runId, stream, options = {}) {
    const logger = options.logger;
    const source = options.source || 'unknown';
    
    if (logger) {
        logger.debug(`[Adapter] Adapting createJobRecord call for ${runId} from source: ${source}`);
    }
    
    // Check if source is authorized
    const allowedSources = ['orchestrator', 'master_process', 'scheduler'];
    if (!allowedSources.includes(source)) {
        const errorMsg = `Unauthorized source "${source}" attempted to create job record`;
        if (logger) {
            logger.error(`[Adapter] ${errorMsg}`);
        }
        throw new Error(errorMsg);
    }
    
    // Use the V2 service
    return await runRecordServiceV2.createJobRecord(runId, stream, options);
}

/**
 * Update a job record
 * @param {string} runId - Run ID
 * @param {Object} updates - Updates
 * @param {Object} options - Options
 */
async function adaptUpdateJobRecord(runId, updates, options = {}) {
    const logger = options.logger;
    
    if (logger) {
        logger.debug(`[Adapter] Adapting updateJobRecord call for ${runId}`);
    }
    
    // Use the V2 service
    return await runRecordServiceV2.updateJobRecord(runId, updates, options);
}

/**
 * Complete a job record
 * @param {string} runId - Run ID 
 * @param {boolean} success - Whether the job was successful
 * @param {string} notes - Notes
 * @param {Object} options - Options
 */
async function adaptCompleteJobRecord(runId, success, notes, options = {}) {
    const logger = options.logger;
    
    if (logger) {
        logger.debug(`[Adapter] Adapting completeJobRecord call for ${runId}`);
    }
    
    // Use the V2 service
    return await runRecordServiceV2.completeJobRecord(runId, success, notes, options);
}

/**
 * Initialize the V2 service
 * @returns {Object} - The initialized base
 */
function initialize() {
    return runRecordServiceV2.initialize();
}

module.exports = {
    // Map to original service names for drop-in compatibility
    initialize,
    createRunRecord: adaptCreateRunRecord,
    completeRunRecord: adaptCompleteRunRecord,
    updateClientMetrics: adaptUpdateClientMetrics,
    createJobRecord: adaptCreateJobRecord,
    updateJobRecord: adaptUpdateJobRecord,
    completeJobRecord: adaptCompleteJobRecord,
    
    // Direct access to V2 service for specific needs
    serviceV2: runRecordServiceV2,
    
    // New method that enforces the single creation point pattern
    getRunRecord: runRecordServiceV2.getRunRecord
};