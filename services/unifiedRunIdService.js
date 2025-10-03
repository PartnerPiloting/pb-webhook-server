/**
 * Unified Run ID Service - Simplified Version
 * 
 * This service manages run IDs throughout the system in a simplified manner.
 * Key principles:
 * 1. Run IDs are created once and passed through unchanged
 * 2. Clear distinction between base run IDs and client-specific run IDs
 * 3. Simple string operations instead of complex regex
 * 4. No format detection or conversion - consistent format throughout
 */

const { format } = require('date-fns');
const { createLogger } = require('../utils/unifiedLoggerFactory');
const logger = createLogger('SYSTEM', null, 'unified_run_id_service');

// In-memory cache for run IDs to record IDs mapping
const recordIdCache = new Map();

// In-memory cache for active run IDs by client
const activeRunIds = new Map();

/**
 * Generate a timestamp-based run ID in the format YYMMDD-HHMMSS
 * This is the single source of truth for creating new run IDs
 * @returns {string} New run ID in standard format
 */
function generateRunId() {
  const now = new Date();
  return format(now, 'yyMMdd-HHmmss');
}

/**
 * Create a client-specific run ID by adding client suffix to base run ID
 * @param {string} baseRunId - Base run ID in YYMMDD-HHMMSS format
 * @param {string} clientId - Client ID to add as suffix
 * @returns {string} Client-specific run ID
 */
function createClientRunId(baseRunId, clientId) {
  if (!baseRunId || !clientId) {
    logger.warn(`Cannot create client run ID with missing values. baseRunId: ${baseRunId}, clientId: ${clientId}`);
    throw new Error('Both baseRunId and clientId are required to create a client run ID');
  }
  
  // Format: YYMMDD-HHMMSS-ClientName
  return `${baseRunId}-${clientId}`;
}

/**
 * Extract the base run ID from a client-specific run ID
 * @param {string} clientRunId - Client-specific run ID
 * @returns {string} Base run ID
 */
function getBaseRunIdFromClientRunId(clientRunId) {
  if (!clientRunId) {
    return null;
  }
  
  const parts = clientRunId.split('-');
  if (parts.length < 2) {
    return clientRunId; // Not a client-specific run ID
  }
  
  // Ensure the first two parts look like a date and time
  const datePart = parts[0];
  const timePart = parts[1];
  
  if (datePart.length === 6 && /^\d{6}$/.test(datePart) && 
      timePart.length === 6 && /^\d{6}$/.test(timePart)) {
    return `${datePart}-${timePart}`;  // Return YYMMDD-HHMMSS portion
  }
  
  // If it doesn't match our expected format, log a warning and return the original
  logger.warn(`Could not extract base run ID from ${clientRunId} - format not recognized`);
  return clientRunId;
}

/**
 * Extract the client ID from a client-specific run ID
 * @param {string} clientRunId - Client-specific run ID
 * @returns {string|null} Client ID or null if not a client-specific run ID
 */
function getClientIdFromClientRunId(clientRunId) {
  if (!clientRunId) {
    return null;
  }
  
  const parts = clientRunId.split('-');
  if (parts.length < 3) {
    return null; // Not a client-specific run ID
  }
  
  // Everything after the timestamp parts is the client ID (supports multi-part client IDs with hyphens)
  return parts.slice(2).join('-');
}

/**
 * Get or create a client-specific run ID
 * If a run ID already exists for the client, it will be returned
 * Otherwise, a new run ID will be created
 * @param {string} clientId - Client ID
 * @param {Object} options - Options
 * @param {boolean} options.forceNew - If true, always create a new run ID
 * @returns {string} Client-specific run ID
 */
function getOrCreateClientRunId(clientId, options = {}) {
  if (!clientId) {
    logger.error("Client ID is required to get or create run ID");
    throw new Error("Client ID is required to get or create run ID");
  }
  
  // Check if we already have an active run ID for this client
  if (!options.forceNew && activeRunIds.has(clientId)) {
    const existingRunId = activeRunIds.get(clientId);
    logger.debug(`Using existing run ID for client ${clientId}: ${existingRunId}`);
    return existingRunId;
  }
  
  // Generate a new base run ID and add client suffix
  const baseRunId = generateRunId();
  const clientRunId = createClientRunId(baseRunId, clientId);
  
  // Store for future use
  activeRunIds.set(clientId, clientRunId);
  logger.debug(`Created new run ID for client ${clientId}: ${clientRunId}`);
  
  return clientRunId;
}

/**
 * Clear the cached run ID for a client
 * @param {string} clientId - Client ID to clear
 */
function clearClientRunId(clientId) {
  if (activeRunIds.has(clientId)) {
    activeRunIds.delete(clientId);
    logger.debug(`Cleared run ID for client ${clientId}`);
  }
}

/**
 * Store a record ID for a run ID
 * @param {string} runId - Run ID
 * @param {string} recordId - Record ID
 */
function cacheRecordId(runId, recordId) {
  if (!runId || !recordId) {
    logger.warn(`Cannot cache record ID with missing values. runId: ${runId}, recordId: ${recordId}`);
    return;
  }
  
  // Always use the base run ID to avoid client-specific duplicates
  const baseRunId = getBaseRunIdFromClientRunId(runId);
  recordIdCache.set(baseRunId, recordId);
  logger.debug(`Cached record ID for run ID ${baseRunId}: ${recordId}`);
}

/**
 * Get the cached record ID for a run ID
 * @param {string} runId - Run ID
 * @returns {string|undefined} Record ID if found
 */
function getCachedRecordId(runId) {
  if (!runId) {
    return undefined;
  }
  
  // Always use the base run ID to avoid client-specific duplicates
  const baseRunId = getBaseRunIdFromClientRunId(runId);
  return recordIdCache.get(baseRunId);
}

/**
 * Legacy compatibility: aliases for renamed functions to maintain API compatibility
 */
const generateTimestampRunId = generateRunId;
const addClientSuffix = createClientRunId;
const stripClientSuffix = getBaseRunIdFromClientRunId;
const extractClientId = getClientIdFromClientRunId;
const getOrCreateRunId = getOrCreateClientRunId;
const getBaseRunId = getBaseRunIdFromClientRunId;

/**
 * Simple validation that a run ID is a string and not empty
 * @param {string} runId - Run ID to validate
 * @param {string} source - Source of the validation (for logging)
 * @returns {boolean} True if valid
 */
function validateRunId(runId, source = 'unknown') {
  if (!runId) {
    logger.error(`[${source}] Run ID cannot be null or undefined`);
    throw new Error(`[${source}] Run ID cannot be null or undefined`);
  }
  
  if (typeof runId !== 'string') {
    logger.error(`[${source}] Run ID must be a string, received ${typeof runId}: ${runId}`);
    throw new Error(`[${source}] Run ID must be a string, received ${typeof runId}: ${runId}`);
  }
  
  return true;
}

/**
 * This function is kept for backward compatibility.
 * In the simplified approach, we don't attempt to normalize - we just pass IDs through.
 * @param {string} runId - Run ID 
 * @returns {string} The same run ID
 */
function normalizeRunId(runId) {
  return runId;
}

/**
 * This function is kept for backward compatibility.
 * @param {string} runId - Run ID 
 * @returns {Object|null} Always null in simplified implementation
 */
function detectRunIdFormat(runId) {
  // In the simplified approach, we don't need to detect format
  return null;
}

/**
 * Standardizes run IDs to the format YYMMDD-HHMMSS
 * @param {string} runId - Run ID in any format
 * @returns {string} Standardized run ID
 */
function convertToStandardFormat(runId) {
  if (!runId) {
    return null;
  }
  
  // If the runId is already in the format YYMMDD-HHMMSS or YYMMDD-HHMMSS-ClientName
  if (runId.includes('-')) {
    const parts = runId.split('-');
    if (parts.length >= 2) {
      const datePart = parts[0];
      const timePart = parts[1];
      
      // Check if first part looks like a date (YYMMDD) and second part looks like a time (HHMMSS)
      if (datePart.length === 6 && /^\d{6}$/.test(datePart) && 
          timePart.length === 6 && /^\d{6}$/.test(timePart)) {
        return `${datePart}-${timePart}`;
      }
    }
  }
  
  // For run IDs that don't match our format, log a warning but return the original
  logger.warn(`Could not standardize run ID format: ${runId}`);
  return runId;
}

module.exports = {
  // Core functions (new names)
  generateRunId,
  createClientRunId,
  getBaseRunIdFromClientRunId,
  getClientIdFromClientRunId,
  getOrCreateClientRunId,
  clearClientRunId,
  
  // Record ID caching
  cacheRecordId,
  getCachedRecordId,
  
  // Legacy compatibility functions (old names)
  generateTimestampRunId,
  addClientSuffix,
  stripClientSuffix,
  extractClientId,
  getOrCreateRunId,
  getBaseRunId,
  
  // Legacy compatibility functions (simplified implementations)
  normalizeRunId,
  validateRunId,
  detectRunIdFormat,
  convertToStandardFormat,
  
  // Unused but exported for backward compatibility
  jobIdToTimestamp: (jobId) => jobId,
  getRunRecordId: getCachedRecordId,
  registerApifyRunId: (apifyRunId) => apifyRunId,
  registerRunRecord: (runId, recordId) => cacheRecordId(runId, recordId)
};