/**
 * utils/simpleValidator.js
 * 
 * Simple, reliable parameter validation without complex dependencies
 */

/**
 * Validate that a parameter is a valid string (not object, not undefined)
 * @param {*} value - The value to validate
 * @param {string} paramName - Parameter name for error messages
 * @param {string} functionName - Function name for error context
 * @returns {string} - The validated string value
 * @throws {Error} - If validation fails
 */
function validateString(value, paramName, functionName) {
  // Convert everything to string and validate
  if (value === null || value === undefined) {
    throw new Error(`${functionName}: ${paramName} cannot be null or undefined`);
  }
  
  // Convert to string
  const strValue = String(value).trim();
  
  // Check for empty string
  if (strValue === '') {
    throw new Error(`${functionName}: ${paramName} cannot be empty`);
  }
  
  // Check for [object Object] which indicates stringified object
  if (strValue === '[object Object]') {
    throw new Error(`${functionName}: ${paramName} cannot be an object, received [object Object]`);
  }
  
  return strValue;
}

/**
 * Validate an object has required parameters
 * @param {Object} params - The parameters object
 * @param {Array<string>} requiredParams - List of required parameter names
 * @param {string} functionName - Function name for error context
 * @throws {Error} - If validation fails
 */
function validateRequiredParams(params, requiredParams, functionName) {
  // Ensure params is an object
  if (!params || typeof params !== 'object') {
    throw new Error(`${functionName}: Expected object params but got ${typeof params}`);
  }
  
  // Check each required parameter
  for (const paramName of requiredParams) {
    if (params[paramName] === undefined || params[paramName] === null) {
      throw new Error(`${functionName}: Missing required parameter: ${paramName}`);
    }
  }
}

module.exports = {
  validateString,
  validateRequiredParams
};