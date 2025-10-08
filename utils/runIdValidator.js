// utils/runIdValidator.js
// Simple validation utilities for run IDs and client IDs
// This provides lightweight validation at API entry points to prevent object parameters
// from propagating through the system

/**
 * Validates and normalizes a run ID to ensure it's a string
 * @param {string|Object} runId - Run ID or object containing runId
 * @param {string} [clientId] - Optional client ID for logging
 * @returns {string|null} - Normalized string runId or null if invalid
 */
function validateAndNormalizeRunId(runId, clientId) {
    // Handle various input formats
    if (runId === null || runId === undefined) return null;
    
    if (typeof runId === 'object') {
        // Extract from object if needed
        runId = runId.runId || runId.id || runId.Run_ID;
        
        // If we still couldn't get a value, log and return null
        if (!runId) {
            logger.warn(`[runIdValidator] Received object as runId but couldn't extract ID: ${JSON.stringify(runId)} for client ${clientId || 'unknown'}`);
            return null;
        }
    }
    
    // Ensure it's a string
    return String(runId);
}

/**
 * Validates and normalizes a client ID to ensure it's a string
 * @param {string|Object} clientId - Client ID or object containing clientId
 * @returns {string|null} - Normalized string clientId or null if invalid
 */
function validateAndNormalizeClientId(clientId) {
    // Handle various input formats
    if (clientId === null || clientId === undefined) return null;
    
    if (typeof clientId === 'object') {
        // Extract from object if needed  
        clientId = clientId.clientId || clientId.id || clientId.Client_ID;
        
        // If we still couldn't get a value, log and return null
        if (!clientId) {
            logger.warn(`[runIdValidator] Received object as clientId but couldn't extract ID: ${JSON.stringify(clientId)}`);
            return null;
        }
    }
    
    // Ensure it's a string
    return String(clientId);
}

module.exports = {
    validateAndNormalizeRunId,
    validateAndNormalizeClientId,
    // Aliases for backward compatibility
    validateAndNormalize: validateAndNormalizeRunId,
    validateClientId: validateAndNormalizeClientId
};