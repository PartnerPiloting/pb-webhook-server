/**
 * runIdGenerator.js
 * Handles generation of consistent run IDs for tracking operations
 */

/**
 * Generate a timestamp-based run ID with optional client suffix
 * @param {string} [clientId] - Optional client ID to append
 * @returns {string} Formatted run ID (YYYY-MM-DD-HH-MM-SS-[clientId])
 */
function generateRunId(clientId = null) {
  const now = new Date();
  
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  
  const timestamp = `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
  
  return clientId ? `${timestamp}-${clientId}` : timestamp;
}

/**
 * Add client suffix to a run ID if not already present
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @returns {string} Run ID with client suffix
 */
function addClientSuffix(runId, clientId) {
  if (!runId) return generateRunId(clientId);
  
  if (runId.endsWith(`-${clientId}`)) {
    return runId; // Already has suffix
  }
  
  return `${runId}-${clientId}`;
}

/**
 * Strip client suffix from run ID
 * @param {string} runId - The run ID with potential suffix
 * @returns {string} Run ID without client suffix
 */
function stripClientSuffix(runId) {
  if (!runId) return '';
  
  // Regular expression to match timestamp portion
  // Format: YYYY-MM-DD-HH-MM-SS
  const timestampPattern = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}/;
  const match = runId.match(timestampPattern);
  
  if (match) {
    return match[0]; // Return just the timestamp portion
  }
  
  return runId; // Return original if no match
}

/**
 * Normalize a run ID with the correct format
 * @param {string} runId - The run ID to normalize
 * @param {string} [clientId] - Optional client ID
 * @returns {string} Normalized run ID
 */
function normalizeRunId(runId, clientId = null) {
  if (!runId) return generateRunId(clientId);
  
  // If it's already in the correct format, return it
  const runIdPattern = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(-[\w-]+)?$/;
  if (runIdPattern.test(runId)) {
    if (clientId) {
      return addClientSuffix(stripClientSuffix(runId), clientId);
    }
    return runId;
  }
  
  // If we can't normalize, generate a new one
  return generateRunId(clientId);
}

module.exports = {
  generateRunId,
  addClientSuffix,
  stripClientSuffix,
  normalizeRunId
};