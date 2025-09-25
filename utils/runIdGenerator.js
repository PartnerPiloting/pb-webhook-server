/**
 * Simple Run ID Generator
 * 
 * Creates timestamp-based run IDs that are unique and sortable.
 * Format: YYMMDD-HHMMSS
 */

/**
 * Generates a timestamp-based run ID
 * @returns {string} The timestamp run ID
 */
function generateRunId() {
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