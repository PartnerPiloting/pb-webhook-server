/**
 * utils/safeLogger.js
 * 
 * Simple utility for creating safe loggers that prevents objects from being passed
 * as sessionId or clientId. No complex patterns, just straightforward validation.
 */

const { StructuredLogger } = require('./structuredLogger');

/**
 * Create a new logger with validated parameters
 * @param {string|any} clientId - Client identifier
 * @param {string|any} sessionId - Session identifier
 * @param {string} processType - Process type
 * @returns {Object} A new StructuredLogger instance with sanitized parameters
 */
function createSafeLogger(clientId, sessionId, processType) {
  // Convert to strings and sanitize
  const safeClientId = clientId ? 
    (typeof clientId === 'object' ? 
      (clientId.clientId || clientId.id || 'INVALID_OBJECT_CLIENT') : 
      String(clientId)) : 
    'SYSTEM';
    
  const safeSessionId = sessionId ? 
    (typeof sessionId === 'object' ? 
      (sessionId.runId || sessionId.id || 'INVALID_OBJECT_SESSION') : 
      String(sessionId)) : 
    null;
    
  const safeProcessType = processType ? String(processType) : null;
  
  return new StructuredLogger(safeClientId, safeSessionId, safeProcessType);
}

/**
 * Get a new logger or use an existing one from options
 * @param {string|any} clientId - Client identifier
 * @param {string|any} sessionId - Session identifier
 * @param {string} processType - Process type
 * @param {Object} options - Options object that may contain a logger
 * @returns {Object} Either the options.logger or a new StructuredLogger
 */
function getOrCreateLogger(clientId, sessionId, processType, options = {}) {
  return options.logger || createSafeLogger(clientId, sessionId, processType);
}

module.exports = {
  createSafeLogger,
  getOrCreateLogger
};