// services/runIdService.js
// Central service for managing run IDs in a multi-tenant system

const runIdUtils = require('../utils/runIdUtils');
const { v4: uuidv4 } = require('uuid');

/**
 * In-memory cache for run records
 * Structure: { 'runId-clientId': { recordId, baseId, clientId, timestamp, metadata } }
 */
const runRecordCache = {};

/**
 * Sequence counter for run IDs (with rollover at 1000)
 */
let sequenceCounter = 1;

/**
 * Get the next sequence number for run IDs
 * @returns {string} The next sequence number, padded to 3 digits
 */
function getNextSequence() {
  const seq = sequenceCounter.toString().padStart(3, '0');
  sequenceCounter = (sequenceCounter % 999) + 1;
  return seq;
}

/**
 * Generate a new standardized run ID
 * @param {string} clientId - The client ID to include in the run ID
 * @param {string|number} [taskId=null] - Optional task identifier
 * @param {string|number} [stepId=null] - Optional step identifier
 * @returns {string} A new standardized run ID with client suffix
 */
function generateRunId(clientId, taskId = null, stepId = null) {
  // Generate date part YYMMDD
  const now = new Date();
  const datePart = [
    now.getFullYear().toString().slice(2),
    (now.getMonth() + 1).toString().padStart(2, '0'),
    now.getDate().toString().padStart(2, '0')
  ].join('');
  
  // Generate sequence part
  const sequencePart = getNextSequence();
  
  // Assemble base ID
  let baseId = `SR-${datePart}-${sequencePart}`;
  if (taskId) baseId += `-T${taskId}`;
  if (stepId) baseId += `-S${stepId}`;
  
  // Add client suffix
  return normalizeRunId(baseId, clientId);
}

/**
 * Create a consistent run ID format for any input
 * @param {string} runId - The run ID to normalize
 * @param {string} clientId - The client ID to ensure is added
 * @returns {string} A normalized run ID with proper client suffix
 */
function normalizeRunId(runId, clientId) {
  if (!runId) return null;
  if (!clientId) return runId;
  
  // First check if the client ID is already in the run ID
  if (runIdUtils.hasSpecificClientSuffix(runId, clientId)) {
    console.log(`[runIdService] Client ID ${clientId} already in run ID ${runId}, returning as is`);
    return runId;
  }
  
  const baseId = runIdUtils.getBaseRunId(runId);
  
  // Strip existing C prefix if present
  const strippedClientId = clientId.startsWith('C') ? clientId.substring(1) : clientId;
  
  // Return without the "C" prefix
  return `${baseId}-${strippedClientId}`;
}

/**
 * Register a run record mapping
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} recordId - The Airtable record ID
 * @param {Object} [metadata={}] - Additional metadata to store with the record
 * @returns {string} The normalized run ID
 */
function registerRunRecord(runId, clientId, recordId, metadata = {}) {
  const normalizedId = normalizeRunId(runId, clientId);
  // Use just the normalized ID as the key - client ID is already part of it
  const key = normalizedId;
  
  runRecordCache[key] = {
    recordId,
    baseId: runIdUtils.getBaseRunId(normalizedId),
    clientId,
    timestamp: new Date().toISOString(),
    metadata
  };
  
  console.log(`[runIdService] Registered record ${recordId} for run ${normalizedId} (client ${clientId})`);
  return normalizedId;
}

/**
 * Get the record ID for a run
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @returns {string|null} The Airtable record ID or null if not found
 */
function getRunRecordId(runId, clientId) {
  const normalizedId = normalizeRunId(runId, clientId);
  // Use just the normalized ID as the key - client ID is already part of it
  const key = normalizedId;
  
  if (runRecordCache[key]) {
    console.log(`[runIdService] Found cached record ${runRecordCache[key].recordId} for run ${normalizedId}`);
    return runRecordCache[key].recordId;
  }
  
  console.log(`[runIdService] No record found for run ${normalizedId}`);
  return null;
}

/**
 * Clear cache entries
 * @param {string} [runId=null] - The run ID to clear (if specific)
 * @param {string} [clientId=null] - The client ID to clear (if specific)
 */
function clearCache(runId = null, clientId = null) {
  if (!runId && !clientId) {
    // Clear all
    Object.keys(runRecordCache).forEach(key => delete runRecordCache[key]);
    console.log('[runIdService] Cleared all run record cache entries');
    return;
  }
  
  if (runId && clientId) {
    // Clear specific entry
    const normalizedId = normalizeRunId(runId, clientId);
    // Use just the normalized ID as the key
    const key = normalizedId;
    delete runRecordCache[key];
    console.log(`[runIdService] Cleared cache for run ${normalizedId} (client ${clientId})`);
    return;
  }
  
  // Clear by client
  if (clientId) {
    // Find keys that contain the client ID (now embedded in the normalized run ID)
    Object.keys(runRecordCache)
      .filter(key => {
        const cacheItem = runRecordCache[key];
        return cacheItem && cacheItem.clientId === clientId;
      })
      .forEach(key => delete runRecordCache[key]);
    console.log(`[runIdService] Cleared all cache entries for client ${clientId}`);
  }
}

/**
 * Register an Apify run ID with our system
 * @param {string} apifyRunId - The Apify run ID
 * @param {string} clientId - The client ID
 * @returns {string} The normalized run ID
 */
function registerApifyRunId(apifyRunId, clientId) {
  return normalizeRunId(apifyRunId, clientId);
}

/**
 * Get the cached run info for a run
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @returns {Object|null} The cached run info or null if not found
 */
function getCachedRunInfo(runId, clientId) {
  const normalizedId = normalizeRunId(runId, clientId);
  const key = `${normalizedId}-${clientId}`;
  
  return runRecordCache[key] || null;
}

module.exports = {
  generateRunId,
  normalizeRunId,
  registerRunRecord,
  getRunRecordId,
  clearCache,
  registerApifyRunId,
  getCachedRunInfo
};