#!/usr/bin/env node
/**
 * Smart Resume Log Analyzer (Local Version)
 * 
 * This script analyzes logs provided directly (not from API) to check
 * Smart Resume job status and detect issues.
 * 
 * Usage:
 *   node analyze-smart-resume-logs.js <log-file>
 */

const fs = require('fs');
const path = require('path');

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

/**
 * Analyze logs for Smart Resume process information
 */
function analyzeSmartResumeLogs(logs) {
  // Split logs into lines
  const logLines = logs.split('\n').filter(line => line.trim());
  
  // Filter for Smart Resume related logs
  const smartResumeLogs = logLines.filter(log => 
    log.includes('Smart resume') || 
    log.includes('smart-resume') ||
    log.includes('Smart Resume') ||
    log.includes('smart_resume') || 
    log.includes('💓') || 
    log.includes('🎯') ||
    log.includes('🔓') ||
    log.includes('🔒')
  );
  
  // Extract key events
  const events = {
    startEvents: smartResumeLogs.filter(log => log.includes('background processing started') || log.includes('🎯')),
    heartbeatEvents: smartResumeLogs.filter(log => log.includes('still running') || log.includes('💓')),
    completionEvents: smartResumeLogs.filter(log => log.includes('completed successfully') || log.includes('✅')),
    errorEvents: smartResumeLogs.filter(log => log.includes('failed') || log.includes('error') || log.includes('❌')),
    lockEvents: smartResumeLogs.filter(log => log.includes('lock')),
    terminationEvents: smartResumeLogs.filter(log => log.includes('termination') || log.includes('🛑')),
    clientProcessing: logLines.filter(log => log.includes('Processing client:'))
  };
  
  // Extract job IDs
  const jobIds = new Set();
  const jobIdRegex = /\[([^\]]+)\]/;
  smartResumeLogs.forEach(log => {
    const match = log.match(jobIdRegex);
    if (match && match[1] && !match[1].includes('DEBUG')) {
      jobIds.add(match[1]);
    }
  });
  
  // Extract client IDs being processed
  const clientIds = new Set();
  const clientRegex = /Processing client: ([^,\n]+)/;
  events.clientProcessing.forEach(log => {
    const match = log.match(clientRegex);
    if (match && match[1]) {
      clientIds.add(match[1]);
    }
  });
  
  return {
    totalLogs: logLines.length,
    smartResumeLogCount: smartResumeLogs.length,
    events,
    jobIds: Array.from(jobIds),
    clientIds: Array.from(clientIds),
    rawLogs: smartResumeLogs
  };
}

/**
 * Check for common errors and provide solutions
 */
function diagnoseIssues(analysis) {
  const issues = [];
  
  // Check for module loading errors
  const moduleLoadErrors = analysis.events.errorEvents.filter(log => 
    log.includes('Module loading failed') || 
    log.includes('Failed to load smart resume module')
  );
  
  if (moduleLoadErrors.length > 0) {
    issues.push({
      severity: 'high',
      issue: 'Smart Resume module failed to load',
      details: moduleLoadErrors[0],
      solution: 'Check if the smart-resume-client-by-client.js file exists and is properly formatted. Verify the path is correct.'
    });
  }
  
  // Check for export structure errors
  const exportErrors = analysis.events.errorEvents.filter(log => 
    log.includes('does not export') || 
    log.includes('Module must export')
  );
  
  if (exportErrors.length > 0) {
    issues.push({
      severity: 'high',
      issue: 'Smart Resume module export structure is incorrect',
      details: exportErrors[0],
      solution: 'Check that the module exports its functionality correctly (e.g., module.exports = { runSmartResume: main }).'
    });
  }
  
  // Check for stale locks
  const staleLockEvents = analysis.events.lockEvents.filter(log => 
    log.includes('Stale lock detected')
  );
  
  if (staleLockEvents.length > 0) {
    issues.push({
      severity: 'medium',
      issue: 'Stale lock was detected and auto-released',
      details: staleLockEvents[0],
      solution: 'This is normal recovery behavior. Check what caused the previous process to crash or hang.'
    });
  }
  
  // Check for termination events
  const terminationEvents = analysis.events.terminationEvents;
  
  if (terminationEvents.length > 0) {
    issues.push({
      severity: 'info',
      issue: 'Process was terminated by admin request',
      details: terminationEvents[0],
      solution: 'This is expected behavior when using the termination feature.'
    });
  }
  
  // Check for no start events but job ID exists
  if (analysis.jobIds.length > 0 && analysis.events.startEvents.length === 0) {
    issues.push({
      severity: 'high',
      issue: 'Job ID was created but process did not start',
      details: `Job IDs found: ${analysis.jobIds.join(', ')}`,
      solution: 'Check for syntax errors or exceptions in the executeSmartResume function or the module itself.'
    });
  }
  
  // Check for no heartbeats after start
  if (analysis.events.startEvents.length > 0 && analysis.events.heartbeatEvents.length === 0) {
    issues.push({
      severity: 'high',
      issue: 'Process started but no heartbeat logs found',
      details: 'Process might have crashed immediately after starting',
      solution: 'Check for exceptions in the early execution phase of the Smart Resume process.'
    });
  }
  
  // Check for general issues if no specific issues found
  if (issues.length === 0 && analysis.smartResumeLogCount === 0) {
    issues.push({
      severity: 'medium',
      issue: 'No Smart Resume related logs found',
      details: 'Cannot detect any Smart Resume activity in the logs',
      solution: 'Check if the Smart Resume endpoint was hit correctly and verify timestamps in the logs.'
    });
  }
  
  return issues;
}

/**
 * Format and print analysis results
 */
function printAnalysis(analysis, issues) {
  console.log(`\n${colors.cyan}=== Smart Resume Process Analysis ===${colors.reset}`);
  console.log(`${colors.gray}Analyzing ${analysis.totalLogs} log lines${colors.reset}\n`);
  
  // Print process summary
  console.log(`${colors.cyan}Process Summary:${colors.reset}`);
  console.log(`  Total Relevant Logs: ${analysis.smartResumeLogCount}`);
  console.log(`  Job IDs Found: ${analysis.jobIds.length > 0 ? analysis.jobIds.join(', ') : 'None'}`);
  console.log(`  Process Started: ${analysis.events.startEvents.length > 0 ? `${colors.green}YES${colors.reset}` : `${colors.red}NO${colors.reset}`}`);
  console.log(`  Heartbeats: ${analysis.events.heartbeatEvents.length}`);
  console.log(`  Completed Successfully: ${analysis.events.completionEvents.length > 0 ? `${colors.green}YES${colors.reset}` : `${colors.gray}No${colors.reset}`}`);
  console.log(`  Errors Detected: ${analysis.events.errorEvents.length > 0 ? `${colors.red}YES (${analysis.events.errorEvents.length})${colors.reset}` : `${colors.green}NO${colors.reset}`}`);
  
  // Print lock events
  if (analysis.events.lockEvents.length > 0) {
    console.log(`\n${colors.cyan}Lock Events:${colors.reset}`);
    analysis.events.lockEvents.forEach((log, index) => {
      console.log(`  ${index + 1}. ${log}`);
    });
  }
  
  // Print client processing info
  console.log(`\n${colors.cyan}Client Processing:${colors.reset}`);
  if (analysis.clientIds.length > 0) {
    console.log(`  Clients Processed: ${analysis.clientIds.length}`);
    analysis.clientIds.forEach((clientId, index) => {
      console.log(`    ${index + 1}. ${colors.yellow}${clientId}${colors.reset}`);
    });
  } else {
    console.log(`  ${colors.gray}No client processing detected in logs${colors.reset}`);
  }
  
  // Print issues and solutions
  if (issues.length > 0) {
    console.log(`\n${colors.cyan}Issues Detected:${colors.reset}`);
    issues.forEach((issue, index) => {
      const severityColor = 
        issue.severity === 'high' ? colors.red :
        issue.severity === 'medium' ? colors.yellow :
        colors.blue;
      
      console.log(`\n  ${severityColor}Issue #${index + 1} (${issue.severity.toUpperCase()}):${colors.reset} ${issue.issue}`);
      console.log(`    ${colors.gray}Details: ${issue.details}${colors.reset}`);
      console.log(`    ${colors.green}Solution: ${issue.solution}${colors.reset}`);
    });
  } else if (analysis.events.startEvents.length > 0) {
    console.log(`\n${colors.green}No issues detected! Process appears to be running correctly.${colors.reset}`);
  }
  
  // Print raw logs
  if (analysis.rawLogs.length > 0) {
    console.log(`\n${colors.cyan}Smart Resume Logs:${colors.reset}`);
    analysis.rawLogs.forEach(log => {
      // Add color to different log types
      let coloredLog = log;
      if (log.includes('❌') || log.includes('error') || log.includes('failed')) {
        coloredLog = `${colors.red}${log}${colors.reset}`;
      } else if (log.includes('✅') || log.includes('completed successfully')) {
        coloredLog = `${colors.green}${log}${colors.reset}`;
      } else if (log.includes('💓')) {
        coloredLog = `${colors.blue}${log}${colors.reset}`;
      } else if (log.includes('🎯')) {
        coloredLog = `${colors.yellow}${log}${colors.reset}`;
      }
      
      console.log(`  ${coloredLog}`);
    });
  }
}

/**
 * Main function
 */
function main() {
  const logContent = `
2025-09-22T04:03:01.743634821Z postScoreBatchApi.js: /api/internal/trigger-post-scoring-batch route mounted.
2025-09-22T04:03:01.744495651Z queueDispatcher.js: Starting heartbeat interval...
2025-09-22T04:03:01.744513902Z queueDispatcher.js: Heartbeat interval set up.
2025-09-22T04:03:01.744522472Z index.js: Queue Dispatcher mounted.
2025-09-22T04:03:01.747123123Z index.js: Webhook routes mounted.
2025-09-22T04:03:01.750109614Z index.js: Apify webhook routes mounted.
2025-09-22T04:03:01.755655114Z index.js: Apify control routes mounted.
2025-09-22T04:03:01.756287609Z index.js: Apify runs management routes mounted.
2025-09-22T04:03:01.757242761Z index.js: Apify process routes mounted.
2025-09-22T04:03:01.869378517Z index.js: Authenticated LinkedIn routes mounted at /api/linkedin
2025-09-22T04:03:01.870149695Z index.js: Authentication test routes mounted at /api/auth
2025-09-22T04:03:01.870514114Z index.js: Debug routes mounted at /api/debug
2025-09-22T04:03:01.872603593Z [TopScoringLeads] Mounted. ENABLED=true
2025-09-22T04:03:01.873942865Z [TopScoringLeads] Routes registered: [
2025-09-22T04:03:01.873952215Z   { path: '/status', methods: [ 'get' ] },
2025-09-22T04:03:01.873955305Z   { path: '/_debug/ping', methods: [ 'get' ] },
2025-09-22T04:03:01.873959175Z   { path: '/_debug/routes2', methods: [ 'get' ] },
2025-09-22T04:03:01.873962345Z   { path: '/_meta/params', methods: [ 'get' ] },
2025-09-22T04:03:01.873965275Z   { path: '/_meta', methods: [ 'get' ] },
2025-09-22T04:03:01.873968045Z   { path: '/dev/sanity-check', methods: [ 'post' ] },
2025-09-22T04:03:01.873970635Z   { path: '/threshold', methods: [ 'get' ] },
2025-09-22T04:03:01.873976445Z   { path: '/threshold', methods: [ 'put' ] },
2025-09-22T04:03:01.873979906Z   { path: '/eligible', methods: [ 'get' ] },
2025-09-22T04:03:01.873983366Z   { path: '/eligible/count', methods: [ 'get' ] },
2025-09-22T04:03:01.873985155Z   { path: '/export/last', methods: [ 'get' ] },
2025-09-22T04:03:01.873986886Z   { path: '/export/last', methods: [ 'put' ] },
2025-09-22T04:03:01.873988986Z   { path: '/eligible/all', methods: [ 'get' ] },
2025-09-22T04:03:01.873990696Z   { path: '/batch/current', methods: [ 'get' ] },
2025-09-22T04:03:01.873993316Z   { path: '/batch/select', methods: [ 'post' ] },
2025-09-22T04:03:01.874015536Z   { path: '/batch/finalize', methods: [ 'post' ] },
2025-09-22T04:03:01.874019726Z   { path: '/batch/reset', methods: [ 'post' ] },
2025-09-22T04:03:01.874022456Z   { path: '/_debug/routes', methods: [ 'get' ] }
2025-09-22T04:03:01.874025036Z ]
2025-09-22T04:03:01.874041837Z index.js: Top Scoring Leads routes mounted at /api/top-scoring-leads
2025-09-22T04:03:01.87416327Z index.js: Emergency debug routes added
2025-09-22T04:03:01.874257792Z index.js: Help Start Here endpoint mounted at /api/help/start-here
2025-09-22T04:03:01.874477887Z index.js: Environment management endpoints added
2025-09-22T04:03:01.879557426Z ▶︎ batchScorer module loaded (DEBUG Profile, High Output, Increased Timeout, filterByFormula, Prompt Length Log). CHUNK_SIZE: 10, TIMEOUT: 900000ms. Ready for dependencies.
2025-09-22T04:03:01.944603966Z ℹ️ Smart resume stale lock timeout configured: 3.5 hours
2025-09-22T04:03:01.944815531Z index.js: App/API/Job routes mounted.
2025-09-22T04:03:01.944824831Z index.js: Attempting to mount Custom GPT support APIs...
2025-09-22T04:03:01.946103721Z index.js: pointerApi mounted.
2025-09-22T04:03:01.946213433Z index.js: latestLeadApi mounted.
2025-09-22T04:03:01.946370997Z index.js: updateLeadApi mounted.
2025-09-22T04:03:01.947426092Z ▶︎ Server starting – Version: Gemini Integrated (Refactor 8.4) – Commit d4ceec21efbeb40f3afa11c5791c2abd4daeffd1 – 2025-09-22T04:03:01.947Z
2025-09-22T04:03:01.949028679Z ⚠️  SAFETY WARNING: Running in NODE_ENV=development while AIRTABLE_BASE_ID is set to the production base (appXySOLo6V9PfMfa).
2025-09-22T04:03:01.94903949Z If this is intentional (legacy fallback), ensure you always supply ?testClient=... so client-specific bases are used.
2025-09-22T04:03:01.949817098Z Server running on port 10000.
2025-09-22T04:03:01.949842229Z Final Check: Server started and essential services (Gemini client, default model, Airtable) appear to be loaded and all routes mounted.
2025-09-22T04:03:12.289513312Z ℹ️ Smart resume status check requested
2025-09-22T04:03:01.944603966Z ℹ️ Smart resume stale lock timeout configured: 3.5 hours
2025-09-22T04:03:12.289513312Z ℹ️ Smart resume status check requested
2025-09-22T04:03:00.513780041Z 🚨 Emergency reset: /reset-smart-resume-lock endpoint hit
2025-09-22T04:03:00.513983455Z 🔓 Emergency reset: Lock forcefully cleared
2025-09-22T04:03:00.513991164Z    Previous state: running=false, jobId=null, age=unknown minutes
  `;
  
  // Run analysis
  const analysis = analyzeSmartResumeLogs(logContent);
  const issues = diagnoseIssues(analysis);
  
  // Print results
  printAnalysis(analysis, issues);
}

// Run the script
main();