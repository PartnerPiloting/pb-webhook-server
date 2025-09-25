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

module.exports = {
  generateRunId
};