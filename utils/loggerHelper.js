/**
 * utils/loggerHelper.js
 * 
 * Simple, safe logger creation without complex dependencies
 */

const { StructuredLogger } = require('./structuredLogger');

/**
 * Create a safe logger with validated parameters
 * @param {string|Object} clientId - Client ID or object with clientId property
 * @param {string|Object} sessionId - Session ID or object with runId/id property
 * @param {string} processType - Process type for filtering logs
 * @returns {Object} - A properly initialized logger
 */
function createSafeLogger(clientId, sessionId, processType) {
  // Handle clientId
  let safeClientId = 'SYSTEM';
  if (clientId) {
    // If object, try to extract clientId
    if (typeof clientId === 'object') {
      safeClientId = clientId.clientId || clientId.id || 'INVALID_OBJECT_CLIENT_ID';
    } else {
      safeClientId = String(clientId);
    }
  }
  
  // Handle sessionId
  let safeSessionId = null;
  if (sessionId) {
    // If object, try to extract runId
    if (typeof sessionId === 'object') {
      safeSessionId = sessionId.runId || sessionId.id || 'INVALID_OBJECT_SESSION_ID';
    } else {
      safeSessionId = String(sessionId);
    }
  }
  
  // Create logger with safe values
  return new StructuredLogger(safeClientId, safeSessionId, processType);
}

module.exports = {
  createSafeLogger
};