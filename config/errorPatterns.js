// config/errorPatterns.js
/**
 * Error pattern definitions for filtering Render logs
 * 
 * These patterns are used to identify critical issues, errors, and warnings
 * in production logs. Each pattern is a JavaScript RegExp that will be tested
 * against each line of log output.
 * 
 * MAINTENANCE:
 * - Add new patterns as production errors are discovered
 * - Test patterns with real log samples before deploying
 * - Document why each pattern exists (for future reference)
 * - Keep patterns organized by severity
 * 
 * LAST UPDATED: 2025-10-07
 */

const ERROR_PATTERNS = {
  /**
   * CRITICAL: System crashes, data loss, service completely down
   * These require immediate attention and should wake you up at 3am
   */
  CRITICAL: [
    // Node.js crashes
    /FATAL ERROR:/i,
    /Segmentation fault/i,
    /out of memory/i,
    
    // Unhandled errors that crash the process
    /uncaughtException/i,
    /unhandledRejection/i,
    
    // Database/Connection failures
    /ECONNREFUSED/i,
    /Connection refused/i,
    /Cannot connect to database/i,
    
    // Service completely unavailable
    /Service unavailable/i,
    /All workers dead/i,
  ],

  /**
   * ERROR: Operations failed but system still running
   * These break functionality and need fixing soon, but service continues
   */
  ERROR: [
    // Airtable API errors (common in your system)
    /Unknown field name:/i,
    /INVALID_REQUEST_BODY/i,
    /INVALID_VALUE_FOR_COLUMN/i,
    /INVALID_REQUEST_UNKNOWN/i,
    /Record not found/i,
    
    // Your specific business logic errors
    /Client run record not found/i,
    /Failed to (create|update|fetch|delete)/i,
    /scoring failed/i,
    // Match actual batch failures, not "0 failed" success summaries
    // Matches: "batch failed", "batch run failed", "Batch Failed Critically", "Failed: batch operation", "Failed batch processing"
    // Excludes: "0 failed", "Summary: 1 successful, 0 failed in batch"
    /batch\s+(?:run\s+)?failed/i,  // "batch failed" or "batch run failed"
    /\b(?:failed|error):\s*.*batch/i,  // "failed: batch" or "error: batch" (colon required)
    /\bfailed\s+batch/i,  // "failed batch" (at word boundary to avoid "0 failed")
    
    // HTTP error codes (4xx, 5xx) - require context to avoid false positives
    /status\s*[45]\d{2}/i,
    /(?:http|error|status|code|response).*?\b(404|500|502|503|504)\b/i,
    /\b(404|500|502|503|504)\b.*?(?:error|status|code|response|http)/i,
    
    // API timeouts
    /ETIMEDOUT/i,
    /Request timeout/i,
    /timeout of \d+ms exceeded/i,
    
    // Authentication/Authorization failures
    /Unauthorized/i,
    /Authentication failed/i,
    /Invalid API key/i,
    /Permission denied/i,
  ],

  /**
   * WARNING: Potential issues, degraded performance, things to investigate
   * These don't break functionality but indicate problems building up
   */
  WARNING: [
    // Deprecated code (will break in future)
    /deprecated/i,
    /DeprecationWarning/i,
    
    // Slow operations (not timeout yet, but slow)
    /slow query/i,
    /operation took \d{4,} ms/i,  // Operations over 1000ms
    
    // Retry logic triggered (flaky operations)
    /retrying/i,
    /retry attempt \d+/i,
    
    // Rate limiting warnings (specific patterns to avoid matching run IDs, URLs, or random text)
    /rate limit/i,
    /too many requests/i,
    /(status code|HTTP status|response).*429/i,
    /429.*(too many|rate limit|throttle)/i,
    
    // Data validation warnings
    /validation warning/i,
    /missing optional field/i,
    
    // Resource usage warnings
    /high memory usage/i,
    /CPU usage above/i,
  ],
};

/**
 * Helper function to test if a log line matches any pattern in a severity category
 * @param {string} logLine - Single line from log output
 * @param {string} severity - 'CRITICAL', 'ERROR', or 'WARNING'
 * @returns {boolean} - True if line matches any pattern in that severity
 */
function matchesPattern(logLine, severity) {
  const patterns = ERROR_PATTERNS[severity];
  if (!patterns) return false;
  
  return patterns.some(pattern => pattern.test(logLine));
}

/**
 * Determine the severity of a log line
 * @param {string} logLine - Single line from log output
 * @returns {string|null} - 'CRITICAL', 'ERROR', 'WARNING', or null if no match
 */
function getSeverity(logLine) {
  // Check in order of severity (most critical first)
  if (matchesPattern(logLine, 'CRITICAL')) return 'CRITICAL';
  if (matchesPattern(logLine, 'ERROR')) return 'ERROR';
  if (matchesPattern(logLine, 'WARNING')) return 'WARNING';
  return null;
}

/**
 * Get the specific pattern that matched a log line
 * @param {string} logLine - Single line from log output
 * @param {string} severity - Known severity level
 * @returns {string|null} - String representation of matched pattern, or null
 */
function getMatchedPattern(logLine, severity) {
  const patterns = ERROR_PATTERNS[severity];
  if (!patterns) return null;
  
  const matched = patterns.find(pattern => pattern.test(logLine));
  return matched ? matched.source : null;
}

module.exports = {
  ERROR_PATTERNS,
  matchesPattern,
  getSeverity,
  getMatchedPattern,
};
