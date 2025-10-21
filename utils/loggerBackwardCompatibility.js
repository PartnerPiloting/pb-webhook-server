/**
 * utils/loggerBackwardCompatibility.js
 * 
 * Provides backward compatibility for older code using loggerHelper.js and loggerFactory.js.
 * This file ensures that code using the old patterns will automatically use the unified factory.
 */

const {
  createLogger,
  createSystemLogger,
  getOrCreateLogger
} = require('./unifiedLoggerFactory');

// Export all functions from unified factory with both original names
module.exports = {
  // From loggerHelper.js
  createSafeLogger: createLogger,
  getLoggerFromOptions: getOrCreateLogger,

  // From loggerFactory.js
  createLogger,
  createSystemLogger,
  getOrCreateLogger
};