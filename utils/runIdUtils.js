// utils/runIdUtils.js
// Utility functions for dealing with run IDs in a multi-tenant system

/**
 * Identifies standard run ID format
 * SR-date-sequence-T[taskid]-S[step]
 * Example: SR-250924-001-T1899-S1
 */
const STANDARD_RUN_ID_REGEX = /^(SR-\d{6}-\d{3}-T\d+-S\d+)(?:-C(.+))?$/;

/**
 * Helper function to identify if the last part of the run ID is a client suffix
 * @param {string} runId - The run ID to check
 * @returns {boolean} Whether the runId ends with a client suffix
 */
function hasClientSuffix(runId) {
  if (!runId) return false;
  return STANDARD_RUN_ID_REGEX.test(runId) && runId.lastIndexOf('-C') > 0;
}

/**
 * Extracts the base run ID without client suffixes
 * @param {string} runId - The run ID which may contain a client suffix
 * @returns {string} The base run ID without client suffix
 */
function getBaseRunId(runId) {
  if (!runId) return '';
  
  // Special handling for "SR-250924-001-C123-T1899-S1" format where C is in the middle
  // This is not a client suffix case, just return the original
  if (runId.includes('-C') && !runId.includes('-S')) {
    return runId;
  }
  
  // For standard pattern with client suffix
  const match = runId.match(STANDARD_RUN_ID_REGEX);
  if (match) {
    return match[1]; // Return the base part
  }
  
  // Not a standard run ID, return as is
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
  
  // Get the base run ID without client suffix
  const baseRunId = getBaseRunId(runId);
  
  // Check if the runId already has this specific client suffix
  if (runId === `${baseRunId}-C${clientId}`) {
    return runId;
  }
  
  // Add the new client suffix
  return `${baseRunId}-C${clientId}`;
}

// Export the functions
module.exports = {
  getBaseRunId,
  stripClientSuffix,
  addClientSuffix,
  hasClientSuffix
};

// Export the functions
module.exports = {
  getBaseRunId,
  stripClientSuffix,
  addClientSuffix,
  hasClientSuffix
};

// Export the functions
module.exports = {
  getBaseRunId,
  stripClientSuffix,
  addClientSuffix,
  hasClientSuffix
};

module.exports = {
  getBaseRunId,
  stripClientSuffix,
  addClientSuffix
};