// services/logFilterService.js
/**
 * Log filtering and analysis service
 * 
 * Scans Render logs for error patterns and extracts actionable issues
 * with surrounding context for debugging.
 */

const { getSeverity, getMatchedPattern } = require('../config/errorPatterns');

/**
 * Extract context lines around an error with optional runId filtering
 * @param {string[]} logLines - Array of all log lines
 * @param {number} errorIndex - Index of the error line
 * @param {number} contextSize - Number of lines before/after to include (default: 25)
 * @param {string|null} runIdFilter - Optional runId to filter context (keeps matching + no-runId lines, excludes different runIds)
 * @returns {string} - Context string with lines before and after
 */
function extractContext(logLines, errorIndex, contextSize = 25, runIdFilter = null) {
  const start = Math.max(0, errorIndex - contextSize);
  const end = Math.min(logLines.length, errorIndex + contextSize + 1);
  
  let contextLines = logLines.slice(start, end);
  
  // Apply runId filtering if provided
  if (runIdFilter) {
    const runIdPattern = /\[(\d{6}-\d{6}(?:-[\w-]+)?)\]/; // Matches [251009-153045] or [251009-153045-Guy-Wilson]
    const targetTimestamp = runIdFilter.split('-').slice(0, 2).join('-'); // Extract YYMMDD-HHMMSS portion
    
    contextLines = contextLines.filter(line => {
      const match = line.match(runIdPattern);
      
      if (!match) {
        // Line has NO runId pattern - include it (system errors, stack traces, etc.)
        return true;
      }
      
      // Line has a runId - only include if it matches our target runId
      const lineRunId = match[1];
      const lineTimestamp = lineRunId.split('-').slice(0, 2).join('-');
      
      return lineTimestamp === targetTimestamp;
    });
  }
  
  // Add line numbers for debugging
  const startLineNum = start + 1;
  return contextLines
    .map((line, idx) => {
      const lineNum = startLineNum + idx;
      const marker = lineNum === errorIndex + 1 ? '>>> ' : '    ';
      return `${marker}${lineNum.toString().padStart(6)}: ${line}`;
    })
    .join('\n');
}

/**
 * Extract stack trace if present after error line
 * @param {string[]} logLines - Array of all log lines
 * @param {number} errorIndex - Index of the error line
 * @returns {string|null} - Stack trace or null if not found
 */
function extractStackTrace(logLines, errorIndex) {
  const stackTraceLines = [];
  const stackTracePattern = /^\s+at\s+/; // Matches "  at functionName (...)"
  
  // Look ahead up to 50 lines for stack trace
  for (let i = errorIndex + 1; i < Math.min(errorIndex + 50, logLines.length); i++) {
    const line = logLines[i];
    
    if (stackTracePattern.test(line)) {
      stackTraceLines.push(line);
    } else if (stackTraceLines.length > 0) {
      // Stack trace ended
      break;
    }
  }
  
  return stackTraceLines.length > 0 ? stackTraceLines.join('\n') : null;
}

/**
 * Parse timestamp from log line if present
 * Common formats:
 * - [2025-10-07T14:23:15.123Z]
 * - 2025-10-07 14:23:15
 * - Oct 7 14:23:15
 */
function parseTimestamp(logLine) {
  // ISO 8601 format
  const isoMatch = logLine.match(/(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z)?)/);
  if (isoMatch) {
    return new Date(isoMatch[1]);
  }
  
  // If no timestamp found, return current time
  return new Date();
}

/**
 * Extract stack trace timestamp marker from context
 * Looks for STACKTRACE:2025-10-11T06:37:15.323456789Z markers
 * @param {string} context - Log context string
 * @returns {string|null} - Timestamp string or null
 */
function extractStackTraceTimestamp(context) {
  // Pattern: STACKTRACE:YYYY-MM-DDTHH:MM:SS.NNNNNNNNNZ
  const stackTraceMatch = context.match(/STACKTRACE:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
  if (stackTraceMatch) {
    return stackTraceMatch[1];
  }
  return null;
}

/**
 * Extract metadata from context (client ID, run ID, etc.)
 * @param {string} context - Log context string
 * @returns {Object} - Extracted metadata
 */
function extractMetadata(context) {
  const metadata = {
    clientId: null,
    runId: null,
    runType: null,
    service: null,
    stream: null,  // Add stream field
    stackTraceTimestamp: null,  // Add stack trace timestamp
  };
  
  // Extract client ID
  const clientMatch = context.match(/client(?:Id)?[:\s]+([a-zA-Z0-9-]+)/i);
  if (clientMatch) metadata.clientId = clientMatch[1];
  
  // Extract run ID - bulletproof pattern matching
  // Pattern 1: [YYMMDD-HHMMSS] or [YYMMDD-HHMMSS-Client-Name] in brackets
  const runIdBracketMatch = context.match(/\[(\d{6}-\d{6}(?:-[\w-]+)?)\]/);
  if (runIdBracketMatch) {
    metadata.runId = runIdBracketMatch[1];
  } else {
    // Pattern 2: Look for the exact YYMMDD-HHMMSS format anywhere in the text
    // This matches: 251012-072042 or 251012-072042-Guy-Wilson
    const runIdExactMatch = context.match(/(\d{6}-\d{6}(?:-[\w-]+)?)/);
    if (runIdExactMatch) metadata.runId = runIdExactMatch[1];
  }
  
  // Extract stream parameter from URL query strings
  // Matches: ?stream=1, &stream=2, stream=3
  const streamMatch = context.match(/[?&]stream=(\d+)/i);
  if (streamMatch) metadata.stream = streamMatch[1];
  
  // Extract stack trace timestamp marker
  metadata.stackTraceTimestamp = extractStackTraceTimestamp(context);
  
  // Detect run type from context
  if (context.includes('smart-resume') || context.includes('smartResume')) {
    metadata.runType = 'smart-resume';
  } else if (context.includes('batch') && (context.includes('scor') || context.includes('process'))) {
    metadata.runType = 'batch-score';
  } else if (context.includes('apify')) {
    metadata.runType = 'apify-webhook';
  } else if (context.match(/GET|POST|PUT|DELETE|PATCH/)) {
    metadata.runType = 'api-endpoint';
  }
  
  // Extract service/function name
  const serviceMatch = context.match(/at\s+(\w+)\s+\(/);
  if (serviceMatch) metadata.service = serviceMatch[1];
  
  return metadata;
}

/**
 * Create a unique key for deduplication
 * Same error message + severity = same issue
 */
function createIssueKey(errorMessage, severity) {
  // Normalize error message (remove timestamps, IDs, etc.)
  const normalized = errorMessage
    .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z)?/g, '[TIMESTAMP]')
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '[UUID]')
    .replace(/\brec[a-zA-Z0-9]{14}\b/g, '[RECORD_ID]')
    .replace(/\d+/g, '[NUM]');
  
  return `${severity}:${normalized}`;
}

/**
 * Filter logs for issues
 * @param {string} logText - Full log output as string
 * @param {Object} options - Filtering options
 * @param {boolean} options.deduplicateIssues - Whether to deduplicate similar issues
 * @param {number} options.contextSize - Number of lines before/after error to include
 * @param {string|null} options.runIdFilter - Optional runId to filter which errors to save (only saves errors with matching runId)
 * @returns {Array<Object>} - Array of detected issues
 */
function filterLogs(logText, options = {}) {
  const {
    deduplicateIssues = true,
    contextSize = 25,
    runIdFilter = null,
  } = options;
  
  // Split into lines
  const logLines = logText.split('\n');
  const issues = [];
  const seenIssues = new Set();
  
  // Pattern to extract runId from log line
  const runIdPattern = /\[(\d{6}-\d{6}(?:-[\w-]+)?)\]/;
  const targetTimestamp = runIdFilter ? runIdFilter.split('-').slice(0, 2).join('-') : null;
  
  // Scan each line for errors (don't pre-filter by runId - find ALL errors first)
  for (let i = 0; i < logLines.length; i++) {
    const line = logLines[i];
    const severity = getSeverity(line);
    
    if (!severity) continue; // No error pattern matched
    
    // Check if this error line has our target runId (if filtering is enabled)
    if (runIdFilter) {
      const match = line.match(runIdPattern);
      
      if (match) {
        // Line has a runId - check if it matches our target
        const lineRunId = match[1];
        const lineTimestamp = lineRunId.split('-').slice(0, 2).join('-');
        
        if (lineTimestamp !== targetTimestamp) {
          // This error belongs to a DIFFERENT run - skip it
          continue;
        }
      } else {
        // Error line has NO runId pattern
        // This could be a system error - include it for now, but mark it
        // (We'll still save it since we can't confirm it's from another job)
      }
    }
    
    // Extract details (context will be filtered by runId)
    const errorMessage = line.trim();
    const context = extractContext(logLines, i, contextSize, runIdFilter);
    const stackTrace = extractStackTrace(logLines, i);
    const timestamp = parseTimestamp(line);
    const patternMatched = getMatchedPattern(line, severity);
    const metadata = extractMetadata(context);
    
    // Deduplication
    const issueKey = createIssueKey(errorMessage, severity);
    if (deduplicateIssues && seenIssues.has(issueKey)) {
      // Find existing issue and increment occurrences
      const existing = issues.find(issue => issue.issueKey === issueKey);
      if (existing) {
        existing.occurrences++;
        existing.lastSeen = timestamp;
      }
      continue;
    }
    
    // Add new issue
    const issue = {
      issueKey,
      timestamp,
      severity,
      patternMatched,
      errorMessage,
      context,
      stackTrace,
      runType: metadata.runType,
      runId: metadata.runId, // Extract Run ID from error message/context
      clientId: metadata.clientId,
      service: metadata.service,
      stream: metadata.stream, // Add stream number
      stackTraceTimestamp: metadata.stackTraceTimestamp, // Add stack trace timestamp for lookup
      occurrences: 1,
      firstSeen: timestamp,
      lastSeen: timestamp,
    };
    
    issues.push(issue);
    seenIssues.add(issueKey);
  }
  
  // Sort by severity (CRITICAL first, then ERROR, then WARNING)
  const severityOrder = { CRITICAL: 0, ERROR: 1, WARNING: 2 };
  issues.sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    
    // Within same severity, sort by timestamp (newest first)
    return b.timestamp - a.timestamp;
  });
  
  return issues;
}

/**
 * Generate summary statistics from filtered issues
 */
function generateSummary(issues) {
  const summary = {
    total: issues.length,
    critical: issues.filter(i => i.severity === 'CRITICAL').length,
    error: issues.filter(i => i.severity === 'ERROR').length,
    warning: issues.filter(i => i.severity === 'WARNING').length,
    totalOccurrences: issues.reduce((sum, i) => sum + i.occurrences, 0),
    byRunType: {},
    byClient: {},
  };
  
  // Group by run type
  issues.forEach(issue => {
    if (issue.runType) {
      summary.byRunType[issue.runType] = (summary.byRunType[issue.runType] || 0) + 1;
    }
    if (issue.clientId) {
      summary.byClient[issue.clientId] = (summary.byClient[issue.clientId] || 0) + 1;
    }
  });
  
  return summary;
}

module.exports = {
  filterLogs,
  generateSummary,
  extractContext,
  extractStackTrace,
  parseTimestamp,
  extractMetadata,
};
