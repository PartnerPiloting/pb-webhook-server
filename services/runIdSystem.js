/**
const { logCriticalError } = require('../utils/errorLogger');
 * services/runIdSystem.js
 * 
 * Single source of truth for all run ID operations in the system.
 * Implements the clean-break refactoring design from RUN-ID-SYSTEM-REFACTORING.md.
 * 
 * Key principles:
 * 1. Generate IDs correctly once, then use them unchanged
 * 2. Clear separation between base run IDs and client run IDs
 * 3. Consistent patterns for record creation and lookup
 * 4. No hidden side effects or transformations
 */

const { format } = require('date-fns');
const { createLogger } = require('../utils/unifiedLoggerFactory');

// Create a dedicated logger for this service
const logger = createLogger('SYSTEM', null, 'run_id_system');

// In-memory cache for job tracking record IDs
const jobTrackingRecordCache = new Map();

/**
 * Generates a new timestamp-based run ID in the standard format: YYMMDD-HHMMSS
 * This is the single source of truth for creating new run IDs
 * @returns {string} New run ID in format YYMMDD-HHMMSS
 */
function generateRunId() {
  const now = new Date();
  return format(now, 'yyMMdd-HHmmss');
}

/**
 * Creates a client-specific run ID by adding client suffix to base run ID
 * @param {string} baseRunId - Base run ID (YYMMDD-HHMMSS)
 * @param {string} clientId - Client ID to add as suffix
 * @returns {string} Client run ID (YYMMDD-HHMMSS-ClientID)
 */
function createClientRunId(baseRunId, clientId) {
  if (!baseRunId) {
    const errorMessage = 'baseRunId is required to create client run ID';
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }
  
  if (!clientId) {
    const errorMessage = 'clientId is required to create client run ID';
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }
  
  return `${baseRunId}-${clientId}`;
}

/**
 * Extracts the base run ID from a client-specific run ID
 * @param {string} clientRunId - Client-specific run ID (YYMMDD-HHMMSS-ClientID)
 * @returns {string} Base run ID (YYMMDD-HHMMSS)
 */
function getBaseRunId(clientRunId) {
  if (!clientRunId) {
    logger.warn('Attempted to extract base run ID from null/undefined client run ID');
    return null;
  }
  
  const parts = clientRunId.split('-');
  
  // If we have at least 2 parts and they match our expected format
  if (parts.length >= 2 && /^\d{6}$/.test(parts[0]) && /^\d{6}$/.test(parts[1])) {
    return `${parts[0]}-${parts[1]}`;
  }
  
  // If it doesn't match our expected format, log a warning and return the original
  logger.warn(`Could not extract base run ID from ${clientRunId} - format not recognized`);
  return clientRunId;
}

/**
 * Extracts the client ID from a client-specific run ID
 * @param {string} clientRunId - Client-specific run ID (YYMMDD-HHMMSS-ClientID)
 * @returns {string|null} Client ID or null if not a client-specific run ID
 */
function getClientId(clientRunId) {
  if (!clientRunId) {
    return null;
  }
  
  const parts = clientRunId.split('-');
  
  // Must have at least 3 parts to contain a client ID
  if (parts.length < 3) {
    return null;
  }
  
  // First two parts are timestamp, everything else is the client ID
  return parts.slice(2).join('-');
}

/**
 * Validates that a run ID has the correct format
 * @param {string} runId - Run ID to validate
 * @returns {boolean} True if valid, throws error if invalid
 */
function validateRunId(runId) {
  if (!runId) {
    throw new Error('Run ID cannot be null or undefined');
  }
  
  if (typeof runId !== 'string') {
    throw new Error(`Run ID must be a string, received ${typeof runId}`);
  }
  
  return true;
}

/**
 * Creates a job tracking record with the provided run ID
 * @param {string} runId - Run ID to use for the record
 * @param {Object} jobTrackingTable - Airtable table for job tracking records
 * @param {Object} data - Additional data to store in the record
 * @returns {Promise<Object>} Created record
 */
async function createJobTrackingRecord(runId, jobTrackingTable, data = {}) {
  validateRunId(runId);
  
  if (!jobTrackingTable) {
    throw new Error('Job tracking table is required');
  }
  
  try {
    // Always use the base run ID to prevent duplicate records
    const baseRunId = getBaseRunId(runId);
    
    // Create record with standardized fields
    const record = await jobTrackingTable.create({
      'Run ID': baseRunId,
      'Status': data.status || 'pending',
      'Created At': new Date().toISOString(),
      ...data
    });
    
    // Cache the record ID for faster lookups
    jobTrackingRecordCache.set(baseRunId, record.id);
    logger.debug(`Created job tracking record for run ID ${baseRunId}: ${record.id}`);
    
    return record;
  } catch (error) {
    logger.error(`Failed to create job tracking record for run ID ${runId}: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'runIdSystem.js' }).catch(() => {});
    throw error;
  }
}

/**
 * Finds a job tracking record for the given run ID
 * @param {string} runId - Run ID to find
 * @param {Object} jobTrackingTable - Airtable table for job tracking records
 * @returns {Promise<Object|null>} Found record or null if not found
 */
async function findJobTrackingRecord(runId, jobTrackingTable) {
  validateRunId(runId);
  
  if (!jobTrackingTable) {
    throw new Error('Job tracking table is required');
  }
  
  try {
    // Always use the base run ID for consistent lookups
    const baseRunId = getBaseRunId(runId);
    
    // Check cache first for performance
    const cachedRecordId = jobTrackingRecordCache.get(baseRunId);
    if (cachedRecordId) {
      try {
        const record = await jobTrackingTable.find(cachedRecordId);
        logger.debug(`Found job tracking record for run ID ${baseRunId} from cache: ${cachedRecordId}`);
        return record;
      } catch (error) {
        // If cached record not found, continue to normal lookup
        logger.debug(`Cached record ${cachedRecordId} not found for run ID ${baseRunId}, falling back to query`);
    await logCriticalError(error, { operation: 'unknown', isSearch: true }).catch(() => {});
        jobTrackingRecordCache.delete(baseRunId);
      }
    }
    
    // Find by run ID if not in cache
    const records = await jobTrackingTable.select({
      filterByFormula: `{Run ID} = '${baseRunId}'`,
      maxRecords: 1
    }).firstPage();
    
    if (records && records.length > 0) {
      // Cache the result for future lookups
      jobTrackingRecordCache.set(baseRunId, records[0].id);
      logger.debug(`Found job tracking record for run ID ${baseRunId}: ${records[0].id}`);
      return records[0];
    }
    
    logger.debug(`No job tracking record found for run ID ${baseRunId}`);
    return null;
  } catch (error) {
    logger.error(`Error finding job tracking record for run ID ${runId}: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (swallowed)', service: 'runIdSystem.js' }).catch(() => {});
    return null;
  }
}

/**
 * Updates a job tracking record with new data
 * @param {string} runId - Run ID of the record to update
 * @param {Object} jobTrackingTable - Airtable table for job tracking records
 * @param {Object} data - Data to update in the record
 * @returns {Promise<Object|null>} Updated record or null if not found
 */
async function updateJobTrackingRecord(runId, jobTrackingTable, data) {
  try {
    const record = await findJobTrackingRecord(runId, jobTrackingTable);
    
    if (!record) {
      logger.warn(`Could not update job tracking record - not found for run ID ${runId}`);
      return null;
    }
    
    // Update record with new data
    const updatedRecord = await jobTrackingTable.update(record.id, {
      ...data,
      'Last Updated': new Date().toISOString()
    });
    
    logger.debug(`Updated job tracking record for run ID ${runId}: ${record.id}`);
    return updatedRecord;
  } catch (error) {
    logger.error(`Error updating job tracking record for run ID ${runId}: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (swallowed)', service: 'runIdSystem.js' }).catch(() => {});
    return null;
  }
}

/**
 * Validates and standardizes a run ID to ensure it matches the expected format
 * This provides a migration path for old run ID formats
 * @param {string} runId - Run ID to validate and standardize
 * @returns {string} Standardized run ID
 */
function validateAndStandardizeRunId(runId) {
  if (!runId) {
    const errorMessage = 'Run ID cannot be null or undefined';
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }
  
  // If already in the correct format, just return it
  if (/^\d{6}-\d{6}(-[\w-]+)?$/.test(runId)) {
    return runId;
  }
  
  logger.warn(`Run ID ${runId} is not in standard format, attempting to normalize`);
  
  // Handle legacy format with .0 suffix (from old format)
  if (runId.endsWith('.0')) {
    runId = runId.slice(0, -2);
  }
  
  // Handle mixed timestamp formats
  const timestampMatch = runId.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(-[\w-]+)?$/);
  if (timestampMatch) {
    // Already in the correct format or close to it
    return runId;
  }
  
  // For any other format, we can't reliably convert, so return as is with warning
  logger.warn(`Could not standardize run ID: ${runId} - returning as is`);
  return runId;
}

// Map to cache client run record IDs
const clientRunRecordCache = new Map();

/**
 * Gets the cached run record ID for a client run
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @returns {string|null} The record ID if found, null otherwise
 */
function getRunRecordId(runId, clientId) {
  if (!runId || !clientId) {
    return null;
  }

  // Standardize the run ID
  const standardRunId = validateAndStandardizeRunId(runId);
  
  // Create a compound key for the cache
  const cacheKey = `${standardRunId}-${clientId}`;
  
  // Return from cache if exists
  return clientRunRecordCache.get(cacheKey) || null;
}

/**
 * Registers a run record ID for a client run
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {string} recordId - The record ID to register
 */
function registerRunRecord(runId, clientId, recordId) {
  if (!runId || !clientId || !recordId) {
    logger.warn(`Cannot register run record with missing parameters: runId=${runId}, clientId=${clientId}, recordId=${recordId}`);
    return;
  }
  
  // Standardize the run ID
  const standardRunId = validateAndStandardizeRunId(runId);
  
  // Create a compound key for the cache
  const cacheKey = `${standardRunId}-${clientId}`;
  
  // Store in cache
  clientRunRecordCache.set(cacheKey, recordId);
  logger.debug(`Registered run record ID ${recordId} for run ${standardRunId} and client ${clientId}`);
}

/**
 * Clears the job tracking record cache
 * @param {string} [runId] - Specific run ID to clear from cache, or all if not provided
 */
function clearCache(runId = null) {
  if (runId) {
    const baseRunId = getBaseRunId(runId);
    jobTrackingRecordCache.delete(baseRunId);
    logger.debug(`Cleared job tracking record cache for run ID ${baseRunId}`);
  } else {
    jobTrackingRecordCache.clear();
    clientRunRecordCache.clear();
    logger.debug('Cleared all cache entries');
  }
}

module.exports = {
  // Core ID generation and manipulation
  generateRunId,
  createClientRunId,
  getBaseRunId,
  getClientId,
  validateRunId,
  validateAndStandardizeRunId,
  
  // Job tracking record operations
  createJobTrackingRecord,
  findJobTrackingRecord,
  updateJobTrackingRecord,
  
  // Client run record operations
  getRunRecordId,
  registerRunRecord,
  
  // Cache management
  clearCache
};