// services/logFilterService.js
/**
 * Log filtering and analysis service
 * 
 * Scans Render logs for error patterns and extracts actionable issues
 * with surrounding context for debugging.
 */

const { getSeverity, getMatchedPattern } = require('../config/errorPatterns');

/**
 * Extract context lines around an error
 * @param {string[]} logLines - Array of all log lines
 * @param {number} errorIndex - Index of the error line
 * @param {number} contextSize - Number of lines before/after to include (default: 25)
 * @returns {string} - Context string with lines before and after
 */
function extractContext(logLines, errorIndex, contextSize = 25) {
  const start = Math.max(0, errorIndex - contextSize);
  const end = Math.min(logLines.length, errorIndex + contextSize + 1);
  
  const contextLines = logLines.slice(start, end);
  
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
  };
  
  // Extract client ID
  const clientMatch = context.match(/client(?:Id)?[:\s]+([a-zA-Z0-9-]+)/i);
  if (clientMatch) metadata.clientId = clientMatch[1];
  
  // Extract run ID
  const runMatch = context.match(/run(?:Id)?[:\s]+([a-zA-Z0-9-]+)/i);
  if (runMatch) metadata.runId = runMatch[1];
  
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
 * @returns {Array<Object>} - Array of detected issues
 */
function filterLogs(logText, options = {}) {
  const {
    deduplicateIssues = true,
    contextSize = 25,
  } = options;
  
  // Split into lines
  const logLines = logText.split('\n');
  const issues = [];
  const seenIssues = new Set();
  
  // Scan each line
  for (let i = 0; i < logLines.length; i++) {
    const line = logLines[i];
    const severity = getSeverity(line);
    
    if (!severity) continue; // No pattern matched
    
    // Extract details
    const errorMessage = line.trim();
    const context = extractContext(logLines, i, contextSize);
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
      clientId: metadata.clientId,
      service: metadata.service,
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
