/**
 * services/runIdValidator.js
 * 
 * Provides robust validation and normalization of run IDs and client IDs.
 * Prevents common issues like [object Object] being passed as run IDs,
 * undefined values, and improperly formatted IDs.
 */

const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');

class RunIdValidator {
  /**
   * Validate and normalize a run ID parameter
   * This catches the [object Object] issue at the source
   * 
   * @param {any} runIdParam - The run ID parameter (could be string, object, etc)
   * @param {string} source - Where this is being called from
   * @returns {string|null} - Normalized run ID or null if invalid
   */
  static validateAndNormalize(runIdParam, source = 'unknown') {
    const logger = createSafeLogger('SYSTEM', null, 'run_id_validator');
    
    // Check if it's null or undefined
    if (runIdParam === null || runIdParam === undefined) {
      logger.error(`[${source}] Run ID is null or undefined`);
      return null;
    }
    
    // Check if someone passed an object instead of a string
    if (typeof runIdParam === 'object') {
      logger.error(`[${source}] CRITICAL: Object passed as run ID instead of string. Object: ${JSON.stringify(runIdParam)}`);
      
      // Try to extract actual run ID from common object structures
      if (runIdParam.runId) {
        logger.info(`[${source}] Extracting runId from object.runId`);
        return this.validateAndNormalize(runIdParam.runId, source);
      }
      if (runIdParam.id) {
        logger.info(`[${source}] Extracting runId from object.id`);
        return this.validateAndNormalize(runIdParam.id, source);
      }
      
      // Can't extract, return null
      return null;
    }
    
    // Convert to string and trim
    const runIdStr = String(runIdParam).trim();
    
    // Check if it's empty or just whitespace
    if (!runIdStr || runIdStr === '') {
      logger.error(`[${source}] Run ID is empty string`);
      return null;
    }
    
    // Check if it's the string "[object Object]" (common JavaScript error)
    if (runIdStr === '[object Object]') {
      logger.error(`[${source}] CRITICAL: Run ID is literally "[object Object]" - indicates toString() on an object`);
      return null;
    }
    
    // Validate format (should be like YYMMDD-HHMMSS-NNN or variations)
    const validFormats = [
      /^\d{6}-\d{6}-\d{3}$/,           // YYMMDD-HHMMSS-NNN
      /^\d{6}-\d{6}-\d{3}-[\w-]+$/,    // YYMMDD-HHMMSS-NNN-ClientName
      /^\d{8}-\d{6}$/,                 // YYYYMMDD-HHMMSS
      /^\d{6}-\d{6}$/                  // YYMMDD-HHMMSS
    ];
    
    const isValidFormat = validFormats.some(regex => regex.test(runIdStr));
    
    if (!isValidFormat) {
      logger.warn(`[${source}] Run ID has unexpected format: ${runIdStr}`);
      // Don't reject it, but log warning
    }
    
    logger.debug(`[${source}] Validated run ID: ${runIdStr}`);
    return runIdStr;
  }
  
  /**
   * Validate a client ID parameter
   * 
   * @param {any} clientIdParam - The client ID parameter
   * @param {string} source - Where this is being called from
   * @returns {string|null} - Validated client ID or null if invalid
   */
  static validateClientId(clientIdParam, source = 'unknown') {
    const logger = createSafeLogger('SYSTEM', null, 'run_id_validator');
    
    if (clientIdParam === null || clientIdParam === undefined) {
      logger.error(`[${source}] Client ID is null or undefined`);
      return null;
    }
    
    if (typeof clientIdParam === 'object') {
      logger.error(`[${source}] CRITICAL: Object passed as client ID. Object: ${JSON.stringify(clientIdParam)}`);
      
      // Try to extract
      if (clientIdParam.clientId) {
        return this.validateClientId(clientIdParam.clientId, source);
      }
      if (clientIdParam.id) {
        return this.validateClientId(clientIdParam.id, source);
      }
      
      return null;
    }
    
    const clientIdStr = String(clientIdParam).trim();
    
    if (!clientIdStr || clientIdStr === '' || clientIdStr === '[object Object]') {
      logger.error(`[${source}] Invalid client ID: ${clientIdStr}`);
      return null;
    }
    
    return clientIdStr;
  }
}

module.exports = RunIdValidator;