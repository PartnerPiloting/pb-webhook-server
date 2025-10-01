/**
 * utils/loggerFactory.js
 * 
 * A factory for creating properly validated loggers.
 * This ensures consistent validation and prevents objects from being passed as IDs.
 */

const { StructuredLogger } = require('./structuredLogger');
const { validateLoggerParams } = require('./paramValidator');

/**
 * Creates a validated logger instance with proper parameter validation
 * @param {Object|string} clientId - Client ID or object containing logger params
 * @param {string} [sessionId] - Session ID (optional)
 * @param {string} [processType] - Process type (optional)
 * @param {Object} [options] - Additional options
 * @returns {StructuredLogger} A properly configured logger
 */
function createLogger(clientId, sessionId, processType, options = {}) {
  // Handle object as first parameter (destructuring pattern)
  if (clientId && typeof clientId === 'object' && !Array.isArray(clientId)) {
    options = sessionId || {};
    const params = clientId;
    
    // Extract common parameter patterns
    const extractedParams = {
      clientId: params.clientId || params.client,
      sessionId: params.sessionId || params.runId || params.session,
      processType: params.processType || params.process || params.type
    };
    
    // Validate the parameters
    const { clientId: validClientId, sessionId: validSessionId, processType: validProcessType } = 
      validateLoggerParams(extractedParams, { source: options.source || 'logger_factory' });
    
    // Create the logger
    return new StructuredLogger(validClientId, validSessionId, validProcessType);
  }
  
  // Handle traditional parameter pattern
  const { clientId: validClientId, sessionId: validSessionId, processType: validProcessType } = 
    validateLoggerParams({ clientId, sessionId, processType }, { source: options.source || 'logger_factory' });
  
  return new StructuredLogger(validClientId, validSessionId, validProcessType);
}

/**
 * Creates a system-level logger with proper validation
 * @param {string} [sessionId] - Session ID (optional)
 * @param {string} [processType] - Process type (optional)
 * @returns {StructuredLogger} A system logger
 */
function createSystemLogger(sessionId, processType) {
  return createLogger('SYSTEM', sessionId, processType);
}

/**
 * Creates a client-specific logger with proper validation
 * @param {string} clientId - Client ID
 * @param {string} [sessionId] - Session ID (optional)
 * @param {string} [processType] - Process type (optional)
 * @returns {StructuredLogger} A client-specific logger
 */
function createClientLogger(clientId, sessionId, processType) {
  return createLogger(clientId, sessionId, processType);
}

/**
 * Creates a process-specific logger with proper validation
 * @param {string} processType - Process type
 * @param {string} [clientId] - Client ID (defaults to 'SYSTEM')
 * @param {string} [sessionId] - Session ID (optional)
 * @returns {StructuredLogger} A process-specific logger
 */
function createProcessLogger(processType, clientId = 'SYSTEM', sessionId) {
  return createLogger(clientId, sessionId, processType);
}

module.exports = {
  createLogger,
  createSystemLogger,
  createClientLogger,
  createProcessLogger
};