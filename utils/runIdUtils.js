// utils/runIdUtils.js
// Utility functions for dealing with run IDs in a multi-tenant system
// SIMPLIFIED IMPLEMENTATION - Only supports timestamp-based IDs with exact client ID

/**
 * Identifies our standard timestamp format with client suffix
 * Format: YYMMDD-HHMMSS-{clientId}
 * Example: 250924-152230-Dean-Hobin
 */
const TIMESTAMP_RUN_ID_REGEX = /^(\d{6}-\d{6})-(.+)$/;

/**
 * Helper function to identify if the run ID has any client suffix
 * @param {string} runId - The run ID to check
 * @returns {boolean} Whether the runId has any client suffix
 */
function hasClientSuffix(runId) {
  if (!runId) return false;
  return TIMESTAMP_RUN_ID_REGEX.test(runId);
}

/**
 * Helper function to identify if the run ID has a specific client suffix
 * @param {string} runId - The run ID to check
 * @param {string} clientId - The client ID to check for
 * @returns {boolean} Whether the runId has the specific client suffix
 */
function hasSpecificClientSuffix(runId, clientId) {
  if (!runId || !clientId) return false;
  
  const match = runId.match(TIMESTAMP_RUN_ID_REGEX);
  if (!match) return false;
  
  return match[2] === clientId;
}

/**
 * Extracts the base run ID without client suffixes
 * @param {string} runId - The run ID which may contain a client suffix
 * @returns {string} The base run ID without client suffix
 */
function getBaseRunId(runId) {
  if (!runId) return '';
  
  const match = runId.match(TIMESTAMP_RUN_ID_REGEX);
  if (match) {
    return match[1]; // Return just the timestamp part (YYMMDD-HHMMSS)
  }
  
  // If it's not our format, log a warning and return an empty string
  console.warn(`[METDEBUG] Encountered non-standard run ID format: ${runId}`);
  return '';
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
  
  // Get just the base part without client suffix
  const baseRunId = getBaseRunId(runId);
  if (!baseRunId) return runId; // Return original if not in our format
  
  // Create the standard format with the exact client ID (no modifications)
  return `${baseRunId}-${clientId}`;
}

// Export the functions
module.exports = {
  getBaseRunId,
  stripClientSuffix,
  addClientSuffix,
  hasClientSuffix,
  hasSpecificClientSuffix
};