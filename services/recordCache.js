// services/recordCache.js
// A module to cache and retrieve Airtable record IDs

// Updated to use new run ID system
const runIdSystem = require('./runIdSystem');

// DEPRECATED: This module is being replaced by runIdSystem
// Keeping for backwards compatibility during migration
// New code should use runIdSystem directly

/**
 * Store a client run record ID in the cache
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} recordId - The Airtable record ID
 */
function storeClientRunRecordId(runId, clientId, recordId) {
  // Delegate to runIdSystem
  runIdSystem.registerRunRecord(runId, clientId, recordId);
  console.log(`RecordCache: Stored record ID ${recordId} for run ${runId} (delegated to runIdSystem)`);
}

/**
 * Get a client run record ID from the cache
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @returns {string|null} The Airtable record ID or null if not found
 */
function getClientRunRecordId(runId, clientId) {
  // Delegate to runIdSystem
  const recordId = runIdSystem.getRunRecordId(runId, clientId);
  if (recordId) {
    console.log(`RecordCache: Found record ID ${recordId} for run ${runId} (delegated to runIdSystem)`);
  }
  return recordId;
}

/**
 * Clear the cache for a specific client run
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 */
function clearClientRunCache(runId, clientId) {
  // Delegate to runIdSystem
  runIdSystem.clearCache(runId);
  console.log(`RecordCache: Cleared cache for ${runId}-${clientId} (delegated to runIdSystem)`);
}

/**
 * Clear the entire cache
 */
function clearAllCache() {
  // Delegate to runIdSystem
  runIdSystem.clearCache();
  console.log(`RecordCache: Cleared all cache entries (delegated to runIdSystem)`);
}

module.exports = {
  storeClientRunRecordId,
  getClientRunRecordId,
  clearClientRunCache,
  clearAllCache
};