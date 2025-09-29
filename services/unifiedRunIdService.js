/**
 * services/unifiedRunIdService.js
 * 
 * A unified service for run ID generation, conversion and management.
 * This service consolidates all run ID functionality to ensure consistent
 * handling across the entire application.
 */

const { StructuredLogger } = require('../utils/structuredLogger');

// Default logger
const logger = new StructuredLogger('SYSTEM', null, 'unified_run_id_service');

// In-memory store of active run IDs per client
const activeRunIds = new Map();

// Cache for record IDs to prevent redundant lookups
const recordIdCache = new Map();

/**
 * Run ID formats supported by the system
 * Each format has:
 * - name: String identifier for the format
 * - regex: Regular expression that matches this format
 * - extractTimestamp: Function to extract timestamp parts from this format
 * - toStandardFormat: Function to convert to standard YYMMDD-HHMMSS format
 */
const RUN_ID_FORMATS = {
  // Standard timestamp format: "YYMMDD-HHMMSS"
  STANDARD: {
    name: 'STANDARD',
    regex: /^(\d{6})-(\d{6})$/,
    extractTimestamp: (match) => ({
      year: match[1].substring(0, 2),
      month: match[1].substring(2, 4),
      day: match[1].substring(4, 6),
      hour: match[2].substring(0, 2),
      minute: match[2].substring(2, 4),
      second: match[2].substring(4, 6)
    }),
    toStandardFormat: (match) => match[0] // Already in standard format
  },
  
  // Client-suffixed format: "YYMMDD-HHMMSS-ClientId"
  CLIENT_SUFFIX: {
    name: 'CLIENT_SUFFIX',
    regex: /^(\d{6})-(\d{6})-(.+)$/,
    extractTimestamp: (match) => ({
      year: match[1].substring(0, 2),
      month: match[1].substring(2, 4),
      day: match[1].substring(4, 6),
      hour: match[2].substring(0, 2),
      minute: match[2].substring(2, 4),
      second: match[2].substring(4, 6),
      clientId: match[3]
    }),
    toStandardFormat: (match) => `${match[1]}-${match[2]}`
  },
  
  // Job process format: "job_post_scoring_stream1_20250929094802"
  JOB_PROCESS: {
    name: 'JOB_PROCESS',
    regex: /^job_\w+_stream\d+_(\d{8})(\d{6})$/,
    extractTimestamp: (match) => ({
      year: match[1].substring(2, 4),
      month: match[1].substring(4, 6),
      day: match[1].substring(6, 8),
      hour: match[2].substring(0, 2),
      minute: match[2].substring(2, 4),
      second: match[2].substring(4, 6)
    }),
    toStandardFormat: (match) => {
      const timestamp = match[1] + match[2];
      const year = timestamp.substring(2, 4);
      const month = timestamp.substring(4, 6);
      const day = timestamp.substring(6, 8);
      const hour = timestamp.substring(8, 10);
      const minute = timestamp.substring(10, 12);
      const second = timestamp.substring(12, 14);
      return `${year}${month}${day}-${hour}${minute}${second}`;
    }
  }
};

/**
 * Detect the format of a run ID
 * @param {string} runId - Run ID to detect format for
 * @returns {Object|null} The detected format or null if no match
 */
function detectRunIdFormat(runId) {
  if (!runId || typeof runId !== 'string') {
    return null;
  }
  
  for (const formatKey in RUN_ID_FORMATS) {
    const format = RUN_ID_FORMATS[formatKey];
    const match = runId.match(format.regex);
    if (match) {
      return {
        format,
        match,
        formatKey
      };
    }
  }
  
  return null;
}

/**
 * Convert any run ID format to the standard YYMMDD-HHMMSS format
 * @param {string} runId - Run ID to convert
 * @returns {string|null} Standardized run ID or null if conversion fails
 */
function convertToStandardFormat(runId) {
  if (!runId || typeof runId !== 'string') {
    logger.error(`Cannot convert null or non-string run ID to standard format: ${runId}`);
    return null;
  }
  
  const formatInfo = detectRunIdFormat(runId);
  if (formatInfo) {
    return formatInfo.format.toStandardFormat(formatInfo.match);
  }
  
  logger.warn(`Couldn't detect format of run ID: ${runId}`);
  return null;
}

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
  
  // Convert to standard format first if it's not already
  const standardBaseRunId = convertToStandardFormat(baseRunId) || baseRunId;
  
  // Format: YYMMDD-HHMMSS-ClientName
  const runId = `${standardBaseRunId}-${clientId}`;
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
  
  const formatInfo = detectRunIdFormat(runId);
  if (formatInfo) {
    return formatInfo.format.toStandardFormat(formatInfo.match);
  }
  
  // If not in any known format, log warning and return original
  logger.warn(`Run ID ${runId} is not in a recognized format for stripping suffix`);
  return runId;
}

/**
 * Extract client ID from a run ID if present
 * @param {string} runId - Run ID which may contain client suffix
 * @returns {string|null} Client ID or null if not present
 */
function extractClientId(runId) {
  if (!runId) return null;
  
  const formatInfo = detectRunIdFormat(runId);
  if (formatInfo && formatInfo.formatKey === 'CLIENT_SUFFIX') {
    return formatInfo.match[3];  // Third capture group in CLIENT_SUFFIX regex
  }
  
  return null;
}

/**
 * Get or create a run ID for a client
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
 * Register a record ID for a run ID to avoid redundant lookups
 * @param {string} runId - Run ID
 * @param {string} recordId - Airtable record ID
 */
function cacheRecordId(runId, recordId) {
  // Standardize the runId first
  const standardRunId = convertToStandardFormat(runId) || runId;
  
  if (standardRunId && recordId) {
    recordIdCache.set(standardRunId, recordId);
    logger.debug(`Cached record ID ${recordId} for run ID ${standardRunId}`);
  }
}

/**
 * Get a cached record ID for a run ID
 * @param {string} runId - Run ID
 * @returns {string|undefined} Cached record ID or undefined if not found
 */
function getCachedRecordId(runId) {
  // Try direct lookup first
  if (recordIdCache.has(runId)) {
    return recordIdCache.get(runId);
  }
  
  // Try standardized version
  const standardRunId = convertToStandardFormat(runId);
  if (standardRunId && recordIdCache.has(standardRunId)) {
    return recordIdCache.get(standardRunId);
  }
  
  return undefined;
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
 * Convert a job process ID to a standard timestamp format
 * Example: job_post_scoring_stream1_20250929094802 -> 250929-094802
 * 
 * @param {string} jobId - Job ID in process format
 * @returns {string|null} Timestamp format or null if conversion fails
 */
function jobIdToTimestamp(jobId) {
  const formatInfo = detectRunIdFormat(jobId);
  if (formatInfo && formatInfo.formatKey === 'JOB_PROCESS') {
    return formatInfo.format.toStandardFormat(formatInfo.match);
  }
  
  logger.warn(`Could not convert job ID to timestamp: ${jobId}`);
  return null;
}

module.exports = {
  // Core functions
  generateTimestampRunId,
  addClientSuffix,
  stripClientSuffix,
  extractClientId,
  getOrCreateRunId,
  getBaseRunId,
  clearClientRunId,
  
  // Format detection and conversion
  detectRunIdFormat,
  convertToStandardFormat,
  jobIdToTimestamp,
  
  // Record ID caching
  cacheRecordId,
  getCachedRecordId,
  
  // Format constants
  RUN_ID_FORMATS
};