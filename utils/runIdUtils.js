// utils/runIdUtils.js
// Utility functions for dealing with run IDs in a multi-tenant system

/**
 * Identifies standard run ID format with optional client suffix
 * SR-date-sequence-T[taskid]-S[step][-{clientId}]
 * Example: SR-250924-001-T1899-S1, SR-250924-001-T1899-S1-Guy-Wilson
 */
const STANDARD_RUN_ID_REGEX = /^(SR-\d{6}-\d{3}-T\d+-S\d+)(?:-([^-].+))?$/;

/**
 * Identifies any run ID with client suffix at the end
 * Example: anything-{clientId}
 */
const CLIENT_SUFFIX_REGEX = /-([^-][^-]+)$/;

/**
 * Helper function to identify if the run ID has any client suffix
 * @param {string} runId - The run ID to check
 * @returns {boolean} Whether the runId has any client suffix
 */
function hasClientSuffix(runId) {
  if (!runId) return false;
  // Updated to check for any suffix (not just -C)
  // The regex pattern will determine if it's valid
  return runId.lastIndexOf('-') > 0 && 
         !runId.endsWith('-') &&
         CLIENT_SUFFIX_REGEX.test(runId);
}

/**
 * Helper function to identify if the run ID has a specific client suffix
 * @param {string} runId - The run ID to check
 * @param {string} clientId - The client ID to check for
 * @returns {boolean} Whether the runId has the specific client suffix
 */
function hasSpecificClientSuffix(runId, clientId) {
  if (!runId || !clientId) return false;
  // Strip any C prefix from the clientId
  const strippedClientId = clientId.startsWith('C') ? clientId.substring(1) : clientId;
  const suffix = `-${strippedClientId}`;
  return runId.endsWith(suffix);
}

/**
 * Extracts the base run ID without client suffixes
 * @param {string} runId - The run ID which may contain a client suffix
 * @returns {string} The base run ID without client suffix
 */
function getBaseRunId(runId) {
  if (!runId) return '';
  
  // If no -C in the string, it can't have a client suffix
  if (runId.indexOf('-C') === -1) return runId;
  
  // Handle standard SR-style run IDs
  const match = runId.match(STANDARD_RUN_ID_REGEX);
  if (match) {
    return match[1]; // Return the base part
  }
  
  // Handle non-standard IDs (e.g., Apify run IDs)
  // Find all occurrences of -C pattern
  const parts = runId.split('-C');
  // If there's only one part, no client suffix
  if (parts.length === 1) return runId;
  
  // Otherwise, the base ID is the first part
  return parts[0];
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
  
  // First, get the base run ID without any client suffixes
  const baseRunId = getBaseRunId(runId);
  
  // Strip any C prefix from the clientId
  const strippedClientId = clientId.startsWith('C') ? clientId.substring(1) : clientId;
  const clientSuffix = `-${strippedClientId}`;
  
  // Always use the clean base ID + single client suffix
  return baseRunId + clientSuffix;
}

// Export the functions
module.exports = {
  getBaseRunId,
  stripClientSuffix,
  addClientSuffix,
  hasClientSuffix,
  hasSpecificClientSuffix
};