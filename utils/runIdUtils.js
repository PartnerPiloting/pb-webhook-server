// utils/runIdUtils.js
// Utility functions for dealing with run IDs in a multi-tenant system
// CLEAN SLATE IMPLEMENTATION - Simple timestamp-based IDs only

/**
 * Identifies our standard timestamp format with client suffix
 * Format: YYMMDD-HHMMSS-{clientId}
 * Example: 250924-152230-Dean-Hobin
 */
const TIMESTAMP_RUN_ID_REGEX = /^(\d{6}-\d{6})(?:-(.+))?$/;

/**
 * Helper function to identify if the run ID has any client suffix
 * @param {string} runId - The run ID to check
 * @returns {boolean} Whether the runId has any client suffix
 */
function hasClientSuffix(runId) {
  if (!runId) return false;
  // Our format always has exactly two hyphens: YYMMDD-HHMMSS-ClientID
  const parts = runId.split('-');
  return parts.length >= 3;
}

/**
 * Helper function to identify if the run ID has a specific client suffix
 * @param {string} runId - The run ID to check
 * @param {string} clientId - The client ID to check for
 * @returns {boolean} Whether the runId has the specific client suffix
 */
function hasSpecificClientSuffix(runId, clientId) {
  if (!runId || !clientId) return false;
  
  // Clean the client ID (remove C prefix if present)
  const cleanClientId = clientId.startsWith('C') ? clientId.substring(1) : clientId;
  
  // Split the run ID by hyphens
  const parts = runId.split('-');
  
  // If it's our format, the client ID is everything after the second hyphen
  if (parts.length >= 3) {
    const runIdClientPart = parts.slice(2).join('-');
    return runIdClientPart === cleanClientId;
  }
  
  return false;
}

/**
 * Extracts the base run ID without client suffixes
 * @param {string} runId - The run ID which may contain a client suffix
 * @returns {string} The base run ID without client suffix
 */
function getBaseRunId(runId) {
  if (!runId) return '';
  
  // With our clean slate format, the base is always just the timestamp part
  const match = runId.match(TIMESTAMP_RUN_ID_REGEX);
  if (match) {
    return match[1]; // Return just the timestamp part (YYMMDD-HHMMSS)
  }
  
  // If it's not our format, return the original (shouldn't happen with clean slate)
  return runId;
}

/**
 * Strips client suffix from a run ID if present
 * @param {string} runId - The run ID which may contain a client suffix
 * @returns {string} The run ID without client suffix
 */
function stripClientSuffix(runId) {
  return getBaseRunId(runId);
}

/**
 * Adds client suffix to a run ID if not already present
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @returns {string} The run ID with client suffix
 */
function addClientSuffix(runId, clientId) {
  if (!runId || !clientId) return runId;
  
  // Get just the timestamp part
  const baseRunId = getBaseRunId(runId);
  
  // Clean the client ID (remove C prefix if present)
  const cleanClientId = clientId.startsWith('C') ? clientId.substring(1) : clientId;
  
  // Create the standard format
  return `${baseRunId}-${cleanClientId}`;
}

// Export the functions
module.exports = {
  getBaseRunId,
  stripClientSuffix,
  addClientSuffix,
  hasClientSuffix,
  hasSpecificClientSuffix
};