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
 * Generate a new simplified run ID
 * @param {string} clientId - The client ID to include in the run ID
 * @param {string} [existingRunId=null] - Optional existing run ID to try to reuse its timestamp
 * @returns {string} A new simplified run ID with timestamp and client suffix
 */
function generateRunId(clientId, existingRunId = null) {
  // Try to reuse timestamp from existing ID if provided
  if (existingRunId) {
    const normalizedWithExisting = normalizeRunId(existingRunId, clientId, false);
    if (normalizedWithExisting) {
      return normalizedWithExisting;
    }
  }
  
  // Otherwise, force creation of a new timestamp-based ID
  return normalizeRunId(null, clientId, true);
}

/**
 * Create a consistent run ID format for any input
 * @param {string} runId - The run ID to normalize (used if valid timestamp format)
 * @param {string} clientId - The client ID to include
 * @param {boolean} [forceNew=false] - Whether to force generation of a new ID
 * @returns {string} A normalized run ID with the timestamp-clientId format
 */
function normalizeRunId(runId, clientId, forceNew = false) {
  if (!clientId) return null;
  
  // Always use the clean clientId without any prefixes
  const cleanClientId = clientId.startsWith('C') ? clientId.substring(1) : clientId;

  // Regular expression to match our timestamp format (YYMMDD-HHMMSS)
  const timestampRegex = /^\d{6}-\d{6}$/;
  
  // Check if we have a valid timestamp-based ID already and we're not forcing a new one
  if (!forceNew && runId && typeof runId === 'string') {
    // Extract just the timestamp part if it includes a client ID
    const parts = runId.split('-');
    if (parts.length >= 2) {
      const possibleTimestamp = `${parts[0]}-${parts[1]}`;
      
      // If this is already a valid timestamp format, use it with the current client ID
      if (timestampRegex.test(possibleTimestamp)) {
        const standardId = `${possibleTimestamp}-${cleanClientId}`;
        console.log(`[runIdService] Using existing timestamp from ID: ${standardId} for client ${clientId}`);
        return standardId;
      }
    }
  }
  
  // If we get here, either forceNew was true or the input wasn't a valid timestamp format
  // Generate a new timestamp-based ID
  const now = new Date();
  
  // Format: YYMMDD-HHMMSS-ClientID
  const datePart = [
    now.getFullYear().toString().slice(2),
    (now.getMonth() + 1).toString().padStart(2, '0'),
    now.getDate().toString().padStart(2, '0')
  ].join('');
  
  const timePart = [
    now.getHours().toString().padStart(2, '0'),
    now.getMinutes().toString().padStart(2, '0'),
    now.getSeconds().toString().padStart(2, '0')
  ].join('');
  
  // Create the standardized format
  const standardId = `${datePart}-${timePart}-${cleanClientId}`;
  
  console.log(`[runIdService] Created new standardized ID: ${standardId} for client ${clientId}`);
  return standardId;
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
  // CRITICAL FIX: Always normalize the run ID for consistent key generation
  const normalizedId = normalizeRunId(runId, clientId);
  
  // SIMPLIFIED: Store each record with just its normalized ID as the key
  runRecordCache[normalizedId] = {
    recordId,
    baseId: runIdUtils.getBaseRunId(normalizedId),
    clientId,
    timestamp: new Date().toISOString(),
    metadata
  };
  
  console.log(`[runIdService] Registered record ${recordId} for run ${normalizedId} (client ${clientId})`);
  
  // BONUS: Also register the base run ID (without client suffix) for additional reliability
  const baseRunId = runIdUtils.getBaseRunId(runId);
  if (baseRunId !== normalizedId) {
    const baseKey = normalizeRunId(baseRunId, clientId);
    runRecordCache[baseKey] = {
      recordId,
      baseId: runIdUtils.getBaseRunId(normalizedId),
      clientId,
      timestamp: new Date().toISOString(),
      metadata
    };
    console.log(`[runIdService] Also registered record under base run ID ${baseKey}`);
  }
  
  return normalizedId;
}

/**
 * Get the record ID for a run
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @returns {string|null} The Airtable record ID or null if not found
 */
function getRunRecordId(runId, clientId) {
  // CRITICAL FIX: Consistently use normalized run ID as the key
  const normalizedId = normalizeRunId(runId, clientId);
  
  if (runRecordCache[normalizedId]) {
    console.log(`[runIdService] Found cached record ${runRecordCache[normalizedId].recordId} for run ${normalizedId}`);
    return runRecordCache[normalizedId].recordId;
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
  const key = normalizedId; // FIXED: Use consistent key format
  
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