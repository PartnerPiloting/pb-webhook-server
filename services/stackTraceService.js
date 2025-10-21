// services/stackTraceService.js
/**
 * Service for managing Stack Traces in Airtable
 * Saves stack traces with unique timestamps for later lookup by analyzer
 */

const { getMasterClientsBase } = require('../config/airtableClient');
const { createSafeLogger } = require('../utils/loggerHelper');

const logger = createSafeLogger('STACK-TRACE', 'SERVICE');

const STACK_TRACES_TABLE = 'Stack Traces';
const FIELDS = {
  TIMESTAMP: 'Timestamp',
  RUN_ID: 'Run ID',
  CLIENT_ID: 'Client ID',
  ERROR_MESSAGE: 'Error Message',
  STACK_TRACE: 'Stack Trace',
};

class StackTraceService {
  constructor() {
    this.masterBase = getMasterClientsBase();
  }

  /**
   * Save a stack trace to Airtable with unique timestamp
   * @param {Object} options - Stack trace details
   * @param {string} options.timestamp - Unique timestamp (ISO format with high precision)
   * @param {string} options.runId - Run ID
   * @param {string} options.clientId - Client ID (optional)
   * @param {string} options.errorMessage - Error message
   * @param {string} options.stackTrace - Full stack trace
   * @returns {Promise<Object>} - Created Airtable record
   */
  async saveStackTrace({ timestamp, runId, clientId = null, errorMessage, stackTrace }) {
    try {
      if (!timestamp || !stackTrace) {
        logger.warn('saveStackTrace', 'Missing required fields: timestamp or stackTrace');
        return null;
      }

      const fields = {
        [FIELDS.TIMESTAMP]: timestamp, // Unique ISO timestamp string
        [FIELDS.STACK_TRACE]: stackTrace.substring(0, 100000), // Airtable limit
      };

      // Optional fields
      if (runId) {
        fields[FIELDS.RUN_ID] = runId;
      }

      if (clientId) {
        fields[FIELDS.CLIENT_ID] = clientId;
      }

      if (errorMessage) {
        fields[FIELDS.ERROR_MESSAGE] = errorMessage.substring(0, 100000);
      }

      const record = await this.masterBase(STACK_TRACES_TABLE).create(fields);
      
      logger.debug('saveStackTrace', `Saved stack trace with timestamp: ${timestamp}`);
      
      return record;
    } catch (error) {
      logger.error('saveStackTrace', `Failed to save stack trace: ${error.message}`);
      // Don't throw - stack trace saving should never break the main flow
      return null;
    }
  }

  /**
   * Lookup a stack trace by timestamp
   * @param {string} timestamp - Unique timestamp to lookup
   * @returns {Promise<string|null>} - Stack trace string or null if not found
   */
  async lookupStackTrace(timestamp) {
    try {
      if (!timestamp) {
        return null;
      }

      logger.debug('lookupStackTrace', `Looking up stack trace for timestamp: ${timestamp}`);

      // Query Airtable for record with this timestamp
      const records = await this.masterBase(STACK_TRACES_TABLE)
        .select({
          filterByFormula: `{${FIELDS.TIMESTAMP}} = '${timestamp}'`,
          maxRecords: 1,
        })
        .firstPage();

      if (records && records.length > 0) {
        const stackTrace = records[0].fields[FIELDS.STACK_TRACE];
        logger.debug('lookupStackTrace', `Found stack trace for timestamp: ${timestamp}`);
        return stackTrace || null;
      }

      logger.debug('lookupStackTrace', `No stack trace found for timestamp: ${timestamp}`);
      return null;
    } catch (error) {
      logger.error('lookupStackTrace', `Failed to lookup stack trace: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate a unique high-precision timestamp for stack trace identification
   * Uses ISO format with microseconds for uniqueness
   * @returns {string} - Unique timestamp string
   */
  static generateUniqueTimestamp() {
    const now = new Date();
    const isoString = now.toISOString();
    
    // Add additional precision with microseconds (simulated with random digits)
    // Format: 2025-10-11T06:37:15.323456789Z
    const microseconds = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const nanoseconds = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    // Insert microseconds and nanoseconds before the 'Z'
    const uniqueTimestamp = isoString.replace('Z', `${microseconds}${nanoseconds}Z`);
    
    return uniqueTimestamp;
  }
}

module.exports = StackTraceService;
