#!/usr/bin/env node
/**
 * Daily Log Analyzer - Standalone Utility
 * 
 * Purpose: Analyzes Render logs for production errors and saves them to Production Issues table
 * 
 * Features:
 * - Incremental analysis: Picks up from where previous run left off (Last Analyzed Log ID)
 * - No overlap: Only analyzes new logs since last checkpoint
 * - Stack trace lookup: Links to Stack Traces table via timestamp markers
 * - Pattern matching: Uses 31+ error patterns for comprehensive error detection
 * 
 * Usage:
 *   node daily-log-analyzer.js [--runId=YYMMDD-HHMMSS]
 * 
 * Options:
 *   --runId=YYMMDD-HHMMSS   Optional: Analyze logs for specific run ID only
 *                            If omitted, uses continuous streaming from last checkpoint
 * 
 * Examples:
 *   node daily-log-analyzer.js                    # Analyze from last checkpoint to now
 *   node daily-log-analyzer.js --runId=251013-100000  # Analyze specific run
 * 
 * Cron Setup (Render):
 *   Schedule: 0 11 * * *  (Daily at 11am UTC)
 *   Command: node daily-log-analyzer.js
 * 
 * How It Works:
 * 1. Looks up previous run's "Last Analyzed Log ID" from Job Tracking table
 * 2. Fetches Render logs from that timestamp → now
 * 3. Runs pattern matching to find errors (CRITICAL, ERROR, WARNING)
 * 4. Extracts stack trace markers (STACKTRACE:timestamp) from logs
 * 5. Looks up full stack traces from Stack Traces table
 * 6. Creates Production Issue records with error details + stack traces
 * 7. Stores new "Last Analyzed Log ID" for next run
 * 
 * Environment Variables:
 *   RENDER_API_KEY - Required for fetching logs from Render
 *   AIRTABLE_API_KEY - Required for saving Production Issues
 *   MASTER_CLIENTS_BASE_ID - Required for Production Issues table
 * 
 * Created: Oct 13, 2025
 * Part of: Production error tracking system migration to standalone utility
 */

const ProductionIssueService = require('./services/productionIssueService');
const JobTracking = require('./services/jobTracking');
const { JOB_TRACKING_FIELDS } = require('./constants/airtableUnifiedConstants');

// Simple logging that works everywhere (console instead of structured logger)
const log = {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args)
};

async function runDailyLogAnalysis(options = {}) {
  // Parse command line arguments OR use options parameter
  const args = process.argv.slice(2);
  let specificRunId = options.runId || null;

  // Command line takes precedence over options parameter
  for (const arg of args) {
    if (arg.startsWith('--runId=')) {
      specificRunId = arg.split('=')[1];
    }
  }

  log.info('🔍 DAILY LOG ANALYZER: Starting...');
  
  try {
    const logAnalysisService = new ProductionIssueService();
    
    let analysisResults;
    let runIdForContext;
    
    if (specificRunId) {
      // MANUAL MODE: Analyze specific run
      log.info(`📋 Manual mode: Analyzing logs for run ${specificRunId}`);
      
      runIdForContext = specificRunId;
      
      analysisResults = await logAnalysisService.analyzeRecentLogs({
        minutes: 1440, // 24 hours
        runId: specificRunId
      });
      
      log.info(`✅ Analysis complete for run ${specificRunId}`);
      log.info(`   Found: ${analysisResults.issues} issues (${analysisResults.summary.critical} critical, ${analysisResults.summary.error} errors, ${analysisResults.summary.warning} warnings)`);
      
      if (analysisResults.issues > 0) {
        log.info(`   Saved: ${analysisResults.createdRecords} errors to Production Issues table`);
      } else {
        log.info(`   🎉 No errors detected - clean run!`);
      }
      
    } else {
      // AUTO MODE: Continuous streaming from last checkpoint
      log.info(`🔄 Auto mode: Analyzing from last checkpoint to now`);
      
      // Get the most recent run to find where we left off
      const latestRun = await JobTracking.getLatestRun();
      
      let startTimestamp;
      
      if (latestRun && latestRun.fields) {
        runIdForContext = latestRun.fields[JOB_TRACKING_FIELDS.RUN_ID];
        startTimestamp = latestRun.fields[JOB_TRACKING_FIELDS.LAST_ANALYZED_LOG_ID];
        
        if (startTimestamp) {
          log.info(`📍 Found latest run ${runIdForContext} - continuing from ${startTimestamp}`);
        } else {
          // Latest run exists but has no timestamp, use its start time
          startTimestamp = latestRun.fields[JOB_TRACKING_FIELDS.START_TIME];
          log.info(`⚠️ Latest run ${runIdForContext} has no Last Analyzed timestamp - starting from its start time: ${startTimestamp}`);
        }
      } else {
        // No previous run found - analyze last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        startTimestamp = oneDayAgo;
        log.info(`⚠️ No previous runs found - starting from 24 hours ago: ${startTimestamp}`);
        // Note: runIdForContext remains undefined - checkpoint won't update until a Job Tracking record exists
      }
      
      // Analyze logs from startTimestamp to now (continuous streaming)
      analysisResults = await logAnalysisService.analyzeLogsFromTimestamp({
        startTimestamp,
        runId: null // Don't filter by runId - analyze ALL logs in time window
      });
      
      log.info(`✅ Analysis complete`);
      log.info(`   Time range: ${startTimestamp} → now`);
      log.info(`   Found: ${analysisResults.issues} issues (${analysisResults.summary.critical} critical, ${analysisResults.summary.error} errors, ${analysisResults.summary.warning} warnings)`);
      
      if (analysisResults.issues > 0) {
        log.info(`   Saved: ${analysisResults.createdRecords} errors to Production Issues table`);
      } else {
        log.info(`   🎉 No errors detected in logs - clean run!`);
      }
    }
    
    // Store last analyzed log timestamp for next run to continue from
    if (analysisResults.lastLogTimestamp && runIdForContext) {
      try {
        await JobTracking.updateJob({
          runId: runIdForContext,
          updates: {
            [JOB_TRACKING_FIELDS.LAST_ANALYZED_LOG_ID]: analysisResults.lastLogTimestamp
          }
        });
        log.info(`📍 Stored last analyzed timestamp: ${analysisResults.lastLogTimestamp}`);
      } catch (updateError) {
        log.error(`⚠️ Failed to store last analyzed timestamp: ${updateError.message}`);
      }
    }
    
    return analysisResults;
    
  } catch (error) {
    log.error(`❌ Daily log analysis failed: ${error.message}`);
    log.error(`Stack trace: ${error.stack}`);
    
    // When called via API, throw error instead of process.exit
    // When called as CLI, the CLI wrapper below will handle process.exit
    throw error;
  }
}

// Run if executed directly (CLI mode)
if (require.main === module) {
  runDailyLogAnalysis()
    .then(results => {
      log.info(`✅ Daily log analyzer completed successfully`);
      process.exit(0);
    })
    .catch(error => {
      log.error(`❌ Daily log analyzer failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { runDailyLogAnalysis };
