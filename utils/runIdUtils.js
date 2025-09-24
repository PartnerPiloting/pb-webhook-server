// utils/runIdUtils.js
// Utility functions for dealing with run IDs in a multi-tenant system

/**
 * Extracts the base run ID without client suffixes
 * @param {string} runId - The run ID which may contain a client suffix
 * @returns {string} The base run ID without client suffix
 */
function getBaseRunId(runId) {
  if (!runId) return '';
  
  // Match client suffix pattern -C[clientId] or -C[clientId]-[extra]
  const clientSuffixPattern = /-C[^-]+-?[^-]*/;
  return runId.replace(clientSuffixPattern, '');
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
  
  // Check if already has this client suffix
  if (runId.includes(`-C${clientId}`)) {
    return runId;
  }
  
  // Strip any existing client suffix first
  const baseRunId = getBaseRunId(runId);
  
  // Add the new client suffix
  return `${baseRunId}-C${clientId}`;
}

module.exports = {
  getBaseRunId,
  stripClientSuffix,
  addClientSuffix
};