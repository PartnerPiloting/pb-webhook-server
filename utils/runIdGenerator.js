/**
 * Run ID Generator
 * 
 * Creates structured, filterable run IDs for better log organization and searching.
 * Format: SR-YYMMDD-NNN-SSTREAM-CCLIENT-ISSUE
 * Example: SR-250922-001-S2-CABC-POSTS
 */

const fs = require('fs').promises;
const path = require('path');

// Store run numbers in a simple JSON file
const RUN_COUNTER_FILE = path.join(__dirname, '../.run-counter.json');

/**
 * Gets the next run number for today and increments the counter
 * @returns {Promise<number>} The run number for today
 */
async function getRunNumberForToday() {
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
  
  let counterData = {};
  
  try {
    // Try to read existing counter file
    const data = await fs.readFile(RUN_COUNTER_FILE, 'utf8');
    counterData = JSON.parse(data);
  } catch (err) {
    // File doesn't exist or is invalid, start fresh
    counterData = {};
  }
  
  // Initialize or increment today's counter
  if (!counterData[dateKey]) {
    counterData[dateKey] = 1;
  } else {
    counterData[dateKey]++;
  }
  
  // Save updated counter
  await fs.writeFile(RUN_COUNTER_FILE, JSON.stringify(counterData, null, 2), 'utf8');
  
  return counterData[dateKey];
}

/**
 * Generates a structured, filterable run ID
 * @returns {Promise<string>} The formatted run ID
 */
async function generateRunId() {
  const today = new Date();
  const dateStr = today.getFullYear().toString().substr(-2) + 
                 (today.getMonth() + 1).toString().padStart(2, '0') + 
                 today.getDate().toString().padStart(2, '0');
  
  // Get run number for today
  const runNumber = await getRunNumberForToday();
  const runNumberStr = runNumber.toString().padStart(3, '0');
  
  // Add a timestamp component to ensure uniqueness (last 4 digits of current timestamp)
  const timestamp = Date.now().toString().slice(-4);
  
  // Base ID (always present) with timestamp for uniqueness
  let runId = `SR-${dateStr}-${runNumberStr}-T${timestamp}`;
  
  // Optional components from environment variables
  const stream = process.env.DEBUG_STREAM || '';
  const client = process.env.DEBUG_CLIENT || '';
  const issue = process.env.DEBUG_ISSUE || '';
  
  // Add optional components if they have content
  if (stream.trim()) runId += `-S${stream}`;
  if (client.trim()) runId += `-C${client}`;
  if (issue.trim()) runId += `-${issue}`;
  
  return runId;
}

/**
 * Creates a logging function that prefixes all messages with the run ID
 * @param {string} runId - The run ID to use for logging
 * @returns {Function} A logging function
 */
function createLogger(runId) {
  return function log(message, level = 'INFO') {
    console.log(`[${runId}] [${level}] ${message}`);
  };
}

module.exports = {
  generateRunId,
  createLogger
};