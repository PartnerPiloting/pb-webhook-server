/**
 * utils/simpleParamValidator.js
 * 
 * Simple, robust utility for validating common parameters like runId and clientId
 * No dependencies, no complexity, just straightforward validation
 */

/**
 * Validate and sanitize runId and clientId parameters
 * @param {string|any} runId - Run ID to validate
 * @param {string|any} clientId - Client ID to validate
 * @param {string} functionName - Calling function name for error messages
 * @returns {Object} Object containing sanitized parameters
 * @throws {Error} If parameters are invalid
 */
function validateRunParams(runId, clientId, functionName = 'unknown') {
  // Convert to strings and trim
  const safeRunId = runId ? String(runId).trim() : null;
  const safeClientId = clientId ? String(clientId).trim() : null;
  
  // Validate runId
  if (!safeRunId || safeRunId === '[object Object]' || safeRunId === 'undefined' || safeRunId === 'null') {
    throw new Error(`${functionName}: Invalid runId: ${JSON.stringify(runId)}`);
  }
  
  // Validate clientId if provided (some system functions use SYSTEM as default)
  if (clientId !== undefined && (!safeClientId || safeClientId === '[object Object]' || safeClientId === 'undefined' || safeClientId === 'null')) {
    throw new Error(`${functionName}: Invalid clientId: ${JSON.stringify(clientId)}`);
  }
  
  return { safeRunId, safeClientId: safeClientId || 'SYSTEM' };
}

/**
 * Get standardized run ID that includes client suffix if needed
 * @param {string} runId - Base run ID
 * @param {string} clientId - Client ID to add as suffix
 * @returns {string} Standardized run ID
 */
function getStandardRunId(runId, clientId) {
  if (!runId) return null;
  
  // If already has client suffix, return as is
  if (runId.includes(`-${clientId}`)) {
    return runId;
  }
  
  // Remove any existing suffix (keep only first 3 parts, typically YYMMDD-HHMMSS-XXX)
  const parts = runId.split('-');
  const baseId = parts.length >= 3 ? 
    parts.slice(0, 3).join('-') : 
    runId;
    
  // Add client suffix
  return `${baseId}-${clientId}`;
}

module.exports = {
  validateRunParams,
  getStandardRunId
};