/**
 * utils/statusUtils.js
 * 
 * Utility functions for working with status values.
 * Provides safe methods for handling, converting, and validating status values.
 */

// Import the constants for status values
const { CLIENT_RUN_STATUS_VALUES } = require('../constants/airtableUnifiedConstants');

/**
 * Gets a lowercase status string with safe fallbacks if status values aren't properly initialized.
 * This function prevents "Cannot read properties of undefined (reading 'toLowerCase')" errors.
 * 
 * @param {string} statusType - The status key (e.g., 'COMPLETED', 'FAILED')
 * @param {string} [defaultValue='unknown'] - Default value if no match is found
 * @returns {string} Lowercase status string or default value
 */
function getStatusString(statusType = 'COMPLETED', defaultValue = 'unknown') {
  // Always fallback to safe defaults if CLIENT_RUN_STATUS_VALUES is not properly initialized
  const statusMap = {
    'COMPLETED': 'completed',
    'FAILED': 'failed',
    'RUNNING': 'running',
    'COMPLETED_WITH_ERRORS': 'completed_with_errors',
    'NO_LEADS': 'no_leads_to_score',
    'SKIPPED': 'skipped'
  };
  
  // Use CLIENT_RUN_STATUS_VALUES if available, otherwise use our fallback map
  if (CLIENT_RUN_STATUS_VALUES && 
      typeof CLIENT_RUN_STATUS_VALUES === 'object' && 
      statusType in CLIENT_RUN_STATUS_VALUES && 
      typeof CLIENT_RUN_STATUS_VALUES[statusType] === 'string') {
    return CLIENT_RUN_STATUS_VALUES[statusType].toLowerCase();
  }
  
  // Fallback to our safe defaults
  return statusMap[statusType] || defaultValue;
}

/**
 * Safely gets the raw status value without converting to lowercase.
 * Provides fallbacks if status values aren't properly initialized.
 * 
 * @param {string} statusType - The status key (e.g., 'COMPLETED', 'FAILED')
 * @param {string} [defaultValue='Unknown'] - Default value if no match is found
 * @returns {string} The status value with proper capitalization or default value
 */
function getRawStatusValue(statusType = 'COMPLETED', defaultValue = 'Unknown') {
  // Always fallback to safe defaults if CLIENT_RUN_STATUS_VALUES is not properly initialized
  const statusMap = {
    'COMPLETED': 'Completed',
    'FAILED': 'Failed',
    'RUNNING': 'Running',
    'COMPLETED_WITH_ERRORS': 'Completed with Errors',
    'NO_LEADS': 'No Leads To Score',
    'SKIPPED': 'Skipped'
  };
  
  // Use CLIENT_RUN_STATUS_VALUES if available, otherwise use our fallback map
  if (CLIENT_RUN_STATUS_VALUES && 
      typeof CLIENT_RUN_STATUS_VALUES === 'object' && 
      statusType in CLIENT_RUN_STATUS_VALUES) {
    return CLIENT_RUN_STATUS_VALUES[statusType];
  }
  
  // Fallback to our safe defaults
  return statusMap[statusType] || defaultValue;
}

module.exports = {
  getStatusString,
  getRawStatusValue
};