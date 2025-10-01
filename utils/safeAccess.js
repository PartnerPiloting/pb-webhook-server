/**
 * utils/safeAccess.js
 * 
 * Utilities for safely accessing properties in objects.
 * Prevents "Cannot read properties of undefined" errors.
 */

/**
 * Safely access nested properties in objects
 * @param {Object} obj - The object to access
 * @param {string} path - The property path (e.g., 'fields.Status')
 * @param {any} defaultValue - Default value if property doesn't exist
 * @returns {any} The property value or default
 */
function safeGet(obj, path, defaultValue = null) {
  if (obj === null || obj === undefined) {
    return defaultValue;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined) {
      return defaultValue;
    }
    current = current[key];
  }
  
  return current !== undefined ? current : defaultValue;
}

/**
 * Safely set nested properties in objects
 * @param {Object} obj - The object to modify
 * @param {string} path - The property path
 * @param {any} value - The value to set
 * @returns {boolean} True if successful
 */
function safeSet(obj, path, value) {
  if (obj === null || obj === undefined) {
    return false;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[keys[keys.length - 1]] = value;
  return true;
}

module.exports = {
  safeGet,
  safeSet
};