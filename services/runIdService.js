// services/runIdService.js
// Simple service for managing run IDs

const runIdUtils = require('../utils/runIdUtils');
const { generateRunId: createRunId } = require('../utils/runIdGenerator');

/**
 * In-memory cache for run records
 * Structure: { 'runId-clientId': { recordId, clientId, timestamp } }
 */
const runRecordCache = {};

/**
 * Generate a client-specific run ID
 * @param {string} clientId - The client ID to include in the run ID
 * @returns {string} A new run ID with client suffix
 */
function generateRunId(clientId) {
  if (!clientId) {
    console.log(`[runIdService] ERROR: Missing clientId in generateRunId call`);
    return null;
  }
  
  // Clean client ID (remove C prefix if present)
  const cleanClientId = clientId.startsWith('C') ? clientId.substring(1) : clientId;
  
  // Get base timestamp ID
  const baseId = createRunId();
  
  // Add client ID
  return `${baseId}-${cleanClientId}`;
}

/**
 * Normalize a run ID to our standard format
 * @param {string} runId - The run ID to normalize
 * @param {string} clientId - The client ID to include
 * @param {boolean} [forceNew=false] - Whether to force generation of a new ID
 * @returns {string} A normalized run ID with the timestamp-clientId format
 */
function normalizeRunId(runId, clientId, forceNew = false) {
  console.log(`[runIdService] normalizeRunId called with runId=${runId}, clientId=${clientId}, forceNew=${forceNew}`);
  console.log(`[METDEBUG] normalizeRunId processing run ID: ${runId}`);
  console.log(`[METDEBUG] normalizeRunId for client: ${clientId}`);
  console.log(`[METDEBUG] normalizeRunId forceNew flag: ${forceNew}`);
  
  if (!clientId) {
    console.log(`[runIdService] ERROR: Missing clientId in normalizeRunId call`);
    console.error(`[METDEBUG] ERROR: Missing clientId in normalizeRunId call`);
    return null;
  }
  
  // Check if runId is a Promise and log a warning with stack trace to help debugging
  if (runId && typeof runId === 'object' && runId.then) {
    console.error(`[runIdService] WARNING: Received Promise instead of string for runId. This is likely a bug.`);
    console.error(`[runIdService] Stack trace:`, new Error().stack);
    // Continue with standard ID generation - ignore the Promise
  }
  
  // Clean client ID (remove C prefix if present)
  const cleanClientId = clientId.startsWith('C') ? clientId.substring(1) : clientId;
  
  // Extract the base ID if it exists and looks valid, otherwise create a new one
  let baseId;
  if (runId && typeof runId === 'string') {
    // Check if runId has our expected timestamp format (YYMMDD-HHMMSS...)
    const timestampMatch = runId.match(/^(\d{6}-\d{6})/);
    if (timestampMatch) {
      baseId = timestampMatch[1]; // Use the existing timestamp
      console.log(`[runIdService] Using existing timestamp: ${baseId} from ${runId}`);
    } else {
      baseId = createRunId(); // Create new if not in expected format
      console.log(`[runIdService] Created new timestamp: ${baseId} (original format not recognized)`);
    }
  } else {
    baseId = createRunId(); // Create new if runId is not a string
    console.log(`[runIdService] Created new timestamp: ${baseId} (no valid runId provided)`);
  }
  
  const standardId = `${baseId}-${cleanClientId}`;
  console.log(`[runIdService] Standardized ID: ${standardId}`);
  return standardId;
}

/**
 * Register a run record mapping
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} recordId - The Airtable record ID
 * @returns {string} The normalized run ID
 */
function registerRunRecord(runId, clientId, recordId) {
  try {
    // Handle if runId is a Promise
    if (runId && typeof runId === 'object' && runId.then) {
      console.error(`[runIdService] WARNING: Received Promise instead of string for runId in registerRunRecord.`);
      console.error(`[runIdService] Stack trace:`, new Error().stack);
      
      // Use client ID with timestamp as a fallback
      const fallbackId = createRunId();
      console.log(`[runIdService] Using fallback run ID: ${fallbackId} for client ${clientId}`);
      runId = fallbackId;
    }
    
    // Handle null or undefined runId
    if (!runId) {
      console.error(`[runIdService] ERROR: Received null/undefined runId in registerRunRecord for client ${clientId}`);
      const fallbackId = createRunId();
      console.log(`[runIdService] Using fallback run ID: ${fallbackId} for client ${clientId}`);
      runId = fallbackId;
    }
    
    // Always normalize the run ID for consistent key generation
    const normalizedId = normalizeRunId(runId, clientId);
    
    if (!normalizedId) {
      console.error(`[runIdService] ERROR: Failed to normalize run ID ${runId} for client ${clientId}`);
      return null;
    }
    
    // Store the record with a simple key structure
    runRecordCache[normalizedId] = {
      recordId,
      clientId,
      timestamp: new Date().toISOString()
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
        timestamp: new Date().toISOString()
      };
      console.log(`[runIdService] Also registered record under base run ID ${baseKey}`);
    }
    
    return normalizedId;
  } catch (error) {
    console.log(`[runIdService] ERROR in registerRunRecord: ${error.message}`);
    // Return a fallback ID
    const fallbackId = `${createRunId()}-${clientId}`;
    console.log(`[runIdService] Using fallback ID: ${fallbackId}`);
    return fallbackId;
  }
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