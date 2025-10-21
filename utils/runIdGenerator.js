/**
 * DEPRECATED - Simple Run ID Generator
 * 
 * This utility is DEPRECATED and will be removed in a future version.
 * Please use services/runIdSystem.js instead, which provides more
 * robust run ID handling with format detection and normalization.
 * 
 * Format: YYMMDD-HHMMSS
 */

// Note: Deprecation warning removed to prevent Production Issues noise
// TODO: Update all imports to use services/runIdSystem.js directly

/**
 * Generates a timestamp-based run ID
 * Now delegates to runIdSystem for consistent ID generation
 * @returns {string} The timestamp run ID
 */
function generateRunId() {
  try {
    // Use the unified system if available
    const runIdSystem = require('../services/runIdSystem');
    return runIdSystem.generateRunId();
  } catch (error) {
    // Fallback to original implementation if unified service isn't available
    console.warn(`Failed to use unifiedRunIdService, falling back to legacy implementation: ${error.message}`);
    
    const now = new Date();
    
    // Format: YYMMDD-HHMMSS
    const datePart = [
      now.getFullYear().toString().slice(2),
      (now.getMonth() + 1).toString().padStart(2, '0'),
      now.getDate().toString().padStart(2, '0')
    ].join('');
    
    const timePart = [
      now.getHours().toString().padStart(2, '0'),
      now.getMinutes().toString().padStart(2, '0'),
      now.getSeconds().toString().padStart(2, '0')
    ].join('');
    
    return `${datePart}-${timePart}`;
  }
}

/**
 * Creates a logger function that includes the run ID in each log message
 * @param {string} runId - The run ID to include in log messages
 * @returns {Function} A logger function
 */
function createLogger(runId) {
  return (message, level = 'INFO') => {
    const timestamp = new Date().toISOString();
    console.log(`🔍 SMART_RESUME_${runId} [${timestamp}] [${level}] ${message}`);
  };
}

module.exports = {
  generateRunId,
  createLogger
};