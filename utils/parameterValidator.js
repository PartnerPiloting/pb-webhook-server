/**
 * utils/parameterValidator.js
 * 
 * Centralized parameter validation to catch object-as-string errors at their source.
 * This utility prevents the common error where objects are passed instead of strings,
 * resulting in '[object Object]' being used as identifiers.
 */

const { createLogger } = require('./contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'parameter_validator' });

class ParameterValidator {
  /**
   * Validates and extracts string value from a parameter that might be an object
   * This catches the common error where objects are passed instead of strings
   * 
   * @param {any} param - The parameter to validate
   * @param {string} paramName - Name of the parameter (for logging)
   * @param {string} source - Source of the call (for logging)
   * @returns {string|null} - Valid string or null if invalid
   */
  static extractStringParam(param, paramName, source) {
    // If it's already a valid string, return it
    if (typeof param === 'string' && param !== '[object Object]') {
      return param;
    }
    
    // If it's null or undefined, return null
    if (param === null || param === undefined) {
      logger.error(`[ParameterValidator] ${paramName} is null/undefined at ${source}`);
      return null;
    }
    
    // If it's an object, try to extract the value
    if (typeof param === 'object') {
      logger.error(`[ParameterValidator] CRITICAL: Object passed as ${paramName} at ${source}:`, JSON.stringify(param));
      
      // Try common property names
      const possibleKeys = [paramName, 'id', paramName + 'Id', 'value'];
      for (const key of possibleKeys) {
        if (param[key] && typeof param[key] === 'string') {
          logger.info(`[ParameterValidator] Extracted ${paramName} from object.${key}`);
          return param[key];
        }
      }
      
      // Couldn't extract, return null
      return null;
    }
    
    // Convert to string as last resort
    const strValue = String(param);
    if (strValue === '[object Object]') {
      logger.error(`[ParameterValidator] ${paramName} converted to "[object Object]" at ${source}`);
      return null;
    }
    
    return strValue;
  }
  
  /**
   * Validates a set of parameters and returns cleaned versions
   * 
   * @param {Object} params - Object containing parameters to validate
   * @param {string} source - Source of the call (for logging)
   * @returns {Object} - Object with cleaned parameters
   */
  static validateParams(params, source) {
    if (!params || typeof params !== 'object') {
      logger.error(`[ParameterValidator] Invalid params object at ${source}:`, params);
      return {};
    }
    
    const cleaned = {};
    
    for (const [key, value] of Object.entries(params)) {
      cleaned[key] = this.extractStringParam(value, key, source);
    }
    
    return cleaned;
  }
  
  /**
   * Specific validation for run IDs
   * 
   * @param {any} runId - The run ID to validate
   * @param {string} source - Source of the call (for logging)
   * @returns {string|null} - Valid run ID or null if invalid
   */
  static validateRunId(runId, source) {
    const validatedRunId = this.extractStringParam(runId, 'runId', source);
    
    if (!validatedRunId) {
      return null;
    }
    
    // Additional validation specific to run IDs could go here
    // For example, checking format, length, etc.
    
    return validatedRunId;
  }
  
  /**
   * Specific validation for client IDs
   * 
   * @param {any} clientId - The client ID to validate
   * @param {string} source - Source of the call (for logging)
   * @returns {string|null} - Valid client ID or null if invalid
   */
  static validateClientId(clientId, source) {
    const validatedClientId = this.extractStringParam(clientId, 'clientId', source);
    
    if (!validatedClientId) {
      return null;
    }
    
    // Additional validation specific to client IDs could go here
    
    return validatedClientId;
  }
}

module.exports = ParameterValidator;