// services/recordCache.js
// A module to cache and retrieve Airtable record IDs

const runIdService = require('./runIdService');

// DEPRECATED: This module is being replaced by runIdService
// Keeping for backwards compatibility during migration
// New code should use runIdService directly

/**
 * Store a client run record ID in the cache
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} recordId - The Airtable record ID
 */
function storeClientRunRecordId(runId, clientId, recordId) {
  // Delegate to runIdService
  const normalizedId = runIdService.registerRunRecord(runId, clientId, recordId);
  console.log(`RecordCache: Stored record ID ${recordId} for run ${normalizedId} (delegated to runIdService)`);
}

/**
 * Get a client run record ID from the cache
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @returns {string|null} The Airtable record ID or null if not found
 */
function getClientRunRecordId(runId, clientId) {
  // Delegate to runIdService
  const recordId = runIdService.getRunRecordId(runId, clientId);
  if (recordId) {
    console.log(`RecordCache: Found record ID ${recordId} for run ${runId} (delegated to runIdService)`);
  }
  return recordId;
}

/**
 * Clear the cache for a specific client run
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 */
function clearClientRunCache(runId, clientId) {
  // Delegate to runIdService
  runIdService.clearCache(runId, clientId);
  console.log(`RecordCache: Cleared cache for ${runId}-${clientId} (delegated to runIdService)`);
}

/**
 * Clear the entire cache
 */
function clearAllCache() {
  // Delegate to runIdService
  runIdService.clearCache();
  console.log(`RecordCache: Cleared all cache entries (delegated to runIdService)`);
}

module.exports = {
  storeClientRunRecordId,
  getClientRunRecordId,
  clearClientRunCache,
  clearAllCache
};