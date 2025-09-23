#!/usr/bin/env node
/**
 * Smart Resume Log Analyzer
 * 
 * This script fetches and analyzes logs from the Render service to monitor
 * Smart Resume jobs and detect issues.
 * 
 * Usage:
 *   node check-smart-resume-logs.js --minutes=10 [--verbose] [--watch]
 * 
 * Options:
 *   --minutes=N     Check logs from the last N minutes (default: 10)
 *   --verbose       Show detailed log analysis
 *   --watch         Keep watching logs (refresh every 30 seconds)
 *   --staging       Use staging environment (default)
 *   --production    Use production environment
 */

const fetch = require('node-fetch');
const { execSync } = require('child_process');
const readline = require('readline');

// Configuration
const DEFAULT_LOG_MINUTES = 10;
const REFRESH_INTERVAL_SECONDS = 30;
const WEBHOOK_SECRET = process.env.PB_WEBHOOK_SECRET;

// Parse command-line arguments
const args = process.argv.slice(2);
const minutes = parseInt(args.find(arg => arg.startsWith('--minutes='))?.split('=')[1] || DEFAULT_LOG_MINUTES);
const verbose = args.includes('--verbose');
const watchMode = args.includes('--watch');
const useProduction = args.includes('--production');
const useStaging = !useProduction || args.includes('--staging');

// Service URLs
const SERVICE_URL = useProduction 
  ? 'https://pb-webhook-server-prod.onrender.com'
  : 'https://pb-webhook-server-staging.onrender.com';

// Headers for API requests
const headers = {
  'Content-Type': 'application/json',
  'x-webhook-secret': WEBHOOK_SECRET
};

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
 * Fetch logs from Render using curl command
 */
async function fetchRenderLogs() {
  try {
    // Use curl command to fetch logs from Render
    const cmd = `curl -s "${SERVICE_URL}/debug-logs?minutes=${minutes}" -H "x-webhook-secret: ${WEBHOOK_SECRET}"`;
    const result = execSync(cmd, { encoding: 'utf8' });
    
    try {
      return JSON.parse(result);
    } catch (parseError) {
      console.error(`${colors.red}Error parsing logs response: ${parseError.message}${colors.reset}`);
      console.error(`Raw response: ${result.substring(0, 200)}...`);
      return { logs: [] };
    }
  } catch (error) {
    console.error(`${colors.red}Error fetching logs: ${error.message}${colors.reset}`);
    return { logs: [] };
  }
}

/**
 * Fetch Smart Resume status
 */
async function fetchSmartResumeStatus() {
  try {
    const response = await fetch(`${SERVICE_URL}/debug-smart-resume-status`, {
      method: 'GET',
      headers
    });
    
    return await response.json();
  } catch (error) {
    console.error(`${colors.red}Error fetching Smart Resume status: ${error.message}${colors.reset}`);
    return null;
  }
}

/**
 * Analyze logs for Smart Resume process information
 */
function analyzeSmartResumeLogs(logs) {
  // Filter for Smart Resume related logs
  const smartResumeLogs = logs.filter(log => 
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
    clientProcessing: logs.filter(log => log.includes('Processing client:'))
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
    totalLogs: logs.length,
    smartResumeLogCount: smartResumeLogs.length,
    events,
    jobIds: Array.from(jobIds),
    clientIds: Array.from(clientIds),
    rawLogs: verbose ? smartResumeLogs : []
  };
}

/**
 * Check for common errors and provide solutions
 */
function diagnoseIssues(analysis, status) {
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
  
  // Check for mismatch between status and logs
  if (status && status.lockStatus && status.lockStatus.locked) {
    const recentStart = analysis.events.startEvents.length > 0;
    if (!recentStart) {
      issues.push({
        severity: 'medium',
        issue: 'Lock is active but no recent start event found in logs',
        details: 'Status endpoint shows active lock, but no corresponding start in recent logs',
        solution: 'The process might have started before the log timeframe. Increase --minutes parameter.'
      });
    }
  }
  
  return issues;
}

/**
 * Format and print analysis results
 */
function printAnalysis(analysis, status, issues) {
  console.clear();
  console.log(`\n${colors.cyan}=== Smart Resume Process Analysis ===${colors.reset}`);
  console.log(`${colors.gray}Environment: ${useProduction ? 'PRODUCTION' : 'STAGING'}${colors.reset}`);
  console.log(`${colors.gray}Analyzing logs from last ${minutes} minutes${colors.reset}\n`);
  
  // Print current status
  console.log(`${colors.cyan}Current Status:${colors.reset}`);
  if (status) {
    const lockStatus = status.lockStatus || {};
    console.log(`  Lock Active: ${lockStatus.locked ? `${colors.green}YES${colors.reset}` : `${colors.gray}No${colors.reset}`}`);
    
    if (lockStatus.locked) {
      console.log(`  Current Job: ${colors.yellow}${lockStatus.currentJobId}${colors.reset}`);
      console.log(`  Lock Age: ${colors.yellow}${lockStatus.lockDuration || 'Unknown'}${colors.reset}`);
    }
    
    if (status.activeProcess) {
      console.log(`\n  ${colors.cyan}Active Process:${colors.reset}`);
      console.log(`    Status: ${formatProcessStatus(status.activeProcess.status)}`);
      console.log(`    Job ID: ${colors.yellow}${status.activeProcess.jobId || 'Unknown'}${colors.reset}`);
      console.log(`    Stream: ${status.activeProcess.stream || 'Unknown'}`);
      console.log(`    Runtime: ${colors.yellow}${status.activeProcess.runtime || 'Unknown'}${colors.reset}`);
      
      if (status.activeProcess.error) {
        console.log(`    Error: ${colors.red}${status.activeProcess.error}${colors.reset}`);
      }
    }
  } else {
    console.log(`  ${colors.red}Unable to fetch current status${colors.reset}`);
  }
  
  // Print process summary
  console.log(`\n${colors.cyan}Process Summary:${colors.reset}`);
  console.log(`  Total Relevant Logs: ${analysis.smartResumeLogCount}`);
  console.log(`  Job IDs Found: ${analysis.jobIds.length > 0 ? analysis.jobIds.join(', ') : 'None'}`);
  console.log(`  Process Started: ${analysis.events.startEvents.length > 0 ? `${colors.green}YES${colors.reset}` : `${colors.red}NO${colors.reset}`}`);
  console.log(`  Heartbeats: ${analysis.events.heartbeatEvents.length}`);
  console.log(`  Completed Successfully: ${analysis.events.completionEvents.length > 0 ? `${colors.green}YES${colors.reset}` : `${colors.gray}No${colors.reset}`}`);
  console.log(`  Errors Detected: ${analysis.events.errorEvents.length > 0 ? `${colors.red}YES (${analysis.events.errorEvents.length})${colors.reset}` : `${colors.green}NO${colors.reset}`}`);
  
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
  
  // Print raw logs if verbose mode is enabled
  if (verbose && analysis.rawLogs.length > 0) {
    console.log(`\n${colors.cyan}Raw Smart Resume Logs:${colors.reset}`);
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
  
  console.log(`\n${colors.gray}Last updated: ${new Date().toISOString()}${colors.reset}`);
  
  if (watchMode) {
    console.log(`\n${colors.cyan}Watch mode active. Refreshing in ${REFRESH_INTERVAL_SECONDS} seconds... Press Ctrl+C to exit.${colors.reset}`);
  }
}

/**
 * Format process status with colors
 */
function formatProcessStatus(status) {
  if (!status) return `${colors.gray}unknown${colors.reset}`;
  
  switch (status.toLowerCase()) {
    case 'running':
      return `${colors.green}RUNNING${colors.reset}`;
    case 'completed':
      return `${colors.blue}COMPLETED${colors.reset}`;
    case 'failed':
      return `${colors.red}FAILED${colors.reset}`;
    default:
      return `${colors.yellow}${status.toUpperCase()}${colors.reset}`;
  }
}

/**
 * Main function
 */
async function main() {
  // Verify webhook secret is available
  if (!WEBHOOK_SECRET) {
    console.error(`${colors.red}ERROR: PB_WEBHOOK_SECRET environment variable is required.${colors.reset}`);
    console.error(`Please set it before running this script: export PB_WEBHOOK_SECRET='your_secret_here'`);
    process.exit(1);
  }
  
  console.log(`${colors.cyan}Smart Resume Log Analyzer${colors.reset}`);
  console.log(`Checking ${useProduction ? 'PRODUCTION' : 'STAGING'} environment for the last ${minutes} minutes...`);
  
  // One-time execution or watch mode loop
  if (!watchMode) {
    await runAnalysis();
  } else {
    // Initial run
    await runAnalysis();
    
    // Set up interval for watch mode
    const intervalId = setInterval(async () => {
      await runAnalysis();
    }, REFRESH_INTERVAL_SECONDS * 1000);
    
    // Handle Ctrl+C to exit watch mode cleanly
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log(`\n${colors.gray}Watch mode terminated.${colors.reset}`);
      process.exit(0);
    });
  }
}

/**
 * Run a single analysis iteration
 */
async function runAnalysis() {
  try {
    const [logs, status] = await Promise.all([
      fetchRenderLogs(),
      fetchSmartResumeStatus()
    ]);
    
    const analysis = analyzeSmartResumeLogs(logs.logs || []);
    const issues = diagnoseIssues(analysis, status);
    
    printAnalysis(analysis, status, issues);
    return { analysis, status, issues };
  } catch (error) {
    console.error(`${colors.red}Error in analysis: ${error.message}${colors.reset}`);
    console.error(error.stack);
  }
}

// Start the script
main().catch(error => {
  console.error(`${colors.red}Unhandled error: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});