/**
 * utils/unifiedLoggerFactory.js
 * 
 * SINGLE SOURCE OF TRUTH for logger creation in the system.
 * This file consolidates the previous approaches from loggerHelper.js and loggerFactory.js
 * into a unified, consistent API for creating properly validated loggers.
 */

// Import StructuredLogger directly but don't expose it
const StructuredLogger = require('./structuredLogger').StructuredLogger;

/**
 * Creates a logger with validated parameters to prevent "Object passed as sessionId" errors
 * This is the primary function for creating loggers throughout the codebase
 * 
 * @param {string|Object} clientId - Client ID or object with clientId property
 * @param {string|Object} [sessionId] - Session ID or object with runId/id property
 * @param {string} [processType] - Process type for filtering logs
 * @param {Object} [options] - Additional options
 * @returns {Object} - A properly initialized logger
 */
function createLogger(clientId, sessionId, processType, options = {}) {
  // Handle object as first parameter (destructuring pattern)
  if (clientId && typeof clientId === 'object' && !Array.isArray(clientId)) {
    // If first parameter is an object, treat it as a parameter object
    options = sessionId || {};
    const params = clientId;
    
    // Extract values from object using common property names
    clientId = params.clientId || params.client;
    sessionId = params.sessionId || params.runId || params.session;
    processType = params.processType || params.process || params.type;
  }

  // Handle clientId - ensure string
  let safeClientId = 'SYSTEM';
  if (clientId) {
    if (typeof clientId === 'object') {
      safeClientId = clientId.clientId || clientId.id || 'INVALID_OBJECT_CLIENT_ID';
    } else {
      safeClientId = String(clientId);
    }
  }
  
  // Handle sessionId - ensure string or null
  let safeSessionId = null;
  if (sessionId) {
    if (typeof sessionId === 'object') {
      safeSessionId = sessionId.runId || sessionId.id || 'INVALID_OBJECT_SESSION_ID';
    } else {
      safeSessionId = String(sessionId);
    }
  }
  
  // Handle processType - ensure string
  const safeProcessType = processType ? String(processType) : 'unknown';
  
  // Create logger with safe values
  return new StructuredLogger(safeClientId, safeSessionId, safeProcessType);
}

/**
 * Creates a system-level logger
 * @param {string|Object} [sessionId] - Session ID
 * @param {string} [processType] - Process type
 * @returns {Object} - A properly initialized system logger
 */
function createSystemLogger(sessionId = null, processType = 'system') {
  return createLogger('SYSTEM', sessionId, processType);
}

/**
 * Get an existing logger from options or create a new one
 * Common pattern replacement for: options.logger || new StructuredLogger(...)
 * 
 * @param {Object} options - Options object that may contain logger
 * @param {string|Object} clientId - Client ID
 * @param {string|Object} [sessionId] - Session ID
 * @param {string} [processType] - Process type
 * @returns {Object} - An existing or new logger
 */
function getOrCreateLogger(options = {}, clientId = 'SYSTEM', sessionId = null, processType = 'unknown') {
  return options.logger || createLogger(clientId, sessionId, processType);
}

// Only export the factory functions, not the StructuredLogger class
module.exports = {
  createLogger,
  createSystemLogger,
  getOrCreateLogger,
  
  // Alias for backward compatibility
  createSafeLogger: createLogger
};