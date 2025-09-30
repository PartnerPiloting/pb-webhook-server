/**
 * _archived_legacy/airtable/runIdService.js
 * 
 * ARCHIVED: This file has been archived and replaced by services/simpleJobTracking.js
 * 
 * This file is kept for reference but should not be used in new code.
 * Please use simpleJobTracking.js which provides a single source of truth
 * for run ID generation and management.
 * 
 * Original description:
 * Centralizes run ID generation and management for multi-tenant operations.
 * This service ensures consistent run ID usage across different components
 * to prevent the issue where different timestamps are generated independently.
 */

const { StructuredLogger } = require('../../utils/structuredLogger');

// Default logger
const logger = new StructuredLogger('SYSTEM', null, 'run_id_service');

// In-memory store of active run IDs per client
// Maps clientId -> runId
const activeRunIds = new Map();

/**
 * Generate a timestamp-based run ID in the format YYMMDD-HHMMSS
 * @returns {string} Timestamp run ID
 */
function generateTimestampRunId() {
  const now = new Date();
  
  // Format: YYMMDD-HHMMSS
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  
  const runId = `${year}${month}${day}-${hours}${minutes}${seconds}`;
  logger.debug(`Generated timestamp run ID: ${runId}`);
  
  return runId;
}

/**
 * Add client suffix to a base run ID
 * @param {string} baseRunId - Base run ID (YYMMDD-HHMMSS)
 * @param {string} clientId - Client ID to add as suffix
 * @returns {string} Run ID with client suffix
 */
function addClientSuffix(baseRunId, clientId) {
  if (!baseRunId || !clientId) {
    logger.warn(`Cannot add client suffix with missing values. baseRunId: ${baseRunId}, clientId: ${clientId}`);
    return baseRunId;
  }
  
  // Format: YYMMDD-HHMMSS-ClientName
  const runId = `${baseRunId}-${clientId}`;
  logger.debug(`Added client suffix to run ID: ${runId}`);
  
  return runId;
}

/**
 * Strip client suffix from a run ID
 * @param {string} runId - Run ID which may contain client suffix
 * @returns {string} Base run ID without client suffix
 */
function stripClientSuffix(runId) {
  if (!runId) return '';
  
  // Check for standard format: YYMMDD-HHMMSS-ClientName
  const match = runId.match(/^(\d{6}-\d{6})-(.+)$/);
  if (match) {
    logger.debug(`Stripped client suffix from run ID: ${runId} -> ${match[1]}`);
    return match[1]; // Return just the timestamp part
  }
  
  // If already in base format, return as is
  if (/^\d{6}-\d{6}$/.test(runId)) {
    return runId;
  }
  
  // Not in expected format, log warning and return original
  logger.warn(`Run ID ${runId} is not in expected format for stripping suffix`);
  return runId;
}

/**
 * Get or create a run ID for a client
 * If a run ID already exists for this client, returns that.
 * Otherwise, generates a new one.
 * 
 * @param {string} clientId - Client ID
 * @param {Object} [options] - Options
 * @param {boolean} [options.forceNew=false] - Force generation of a new run ID
 * @returns {string} Client-specific run ID
 */
function getOrCreateRunId(clientId, options = {}) {
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
  
  // Generate a new base run ID
  const baseRunId = generateTimestampRunId();
  
  // Add client suffix
  const clientRunId = addClientSuffix(baseRunId, clientId);
  
  // Store for future use
  activeRunIds.set(clientId, clientRunId);
  logger.debug(`Created new run ID for client ${clientId}: ${clientRunId}`);
  
  return clientRunId;
}

/**
 * Get the base run ID for a client-specific run ID
 * @param {string} clientRunId - Client-specific run ID
 * @returns {string} Base run ID
 */
function getBaseRunId(clientRunId) {
  return stripClientSuffix(clientRunId);
}

/**
 * Clear a client's active run ID
 * @param {string} clientId - Client ID
 */
function clearClientRunId(clientId) {
  if (activeRunIds.has(clientId)) {
    const runId = activeRunIds.get(clientId);
    activeRunIds.delete(clientId);
    logger.debug(`Cleared run ID for client ${clientId}: ${runId}`);
  }
}

/**
 * Clear all active run IDs
 */
function clearAllRunIds() {
  activeRunIds.clear();
  logger.debug("Cleared all active run IDs");
}

module.exports = {
  generateTimestampRunId,
  addClientSuffix,
  stripClientSuffix,
  getOrCreateRunId,
  getBaseRunId,
  clearClientRunId,
  clearAllRunIds
};