// services/recordCache.js
// A module to cache and retrieve Airtable record IDs

// Cache for client run record IDs to prevent duplicate creation
// Structure: { 'runId-clientId': 'recordId' }
const clientRunRecordIdCache = {};

/**
 * Store a client run record ID in the cache
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} recordId - The Airtable record ID
 */
function storeClientRunRecordId(runId, clientId, recordId) {
  const cacheKey = `${runId}-${clientId}`;
  clientRunRecordIdCache[cacheKey] = recordId;
  console.log(`RecordCache: Stored record ID ${recordId} for key ${cacheKey}`);
}

/**
 * Get a client run record ID from the cache
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @returns {string|null} The Airtable record ID or null if not found
 */
function getClientRunRecordId(runId, clientId) {
  const cacheKey = `${runId}-${clientId}`;
  const recordId = clientRunRecordIdCache[cacheKey];
  if (recordId) {
    console.log(`RecordCache: Found record ID ${recordId} for key ${cacheKey}`);
  }
  return recordId || null;
}

/**
 * Clear the cache for a specific client run
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 */
function clearClientRunCache(runId, clientId) {
  const cacheKey = `${runId}-${clientId}`;
  delete clientRunRecordIdCache[cacheKey];
  console.log(`RecordCache: Cleared cache for key ${cacheKey}`);
}

/**
 * Clear the entire cache
 */
function clearAllCache() {
  Object.keys(clientRunRecordIdCache).forEach(key => delete clientRunRecordIdCache[key]);
  console.log(`RecordCache: Cleared all cache entries`);
}

module.exports = {
  storeClientRunRecordId,
  getClientRunRecordId,
  clearClientRunCache,
  clearAllCache
};