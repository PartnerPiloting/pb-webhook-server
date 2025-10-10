#!/usr/bin/env node

/**
 * Smart Resume Client-by-Client Processing Pipeline with Email Reporting
 * 
 * Checks each client's last execution status and resumes from where it left off:
 * - Skips clients where all operations completed successfully in the past 24 hours
 * - Resumes incomplete workflows from the failed/missing operation
 * - Sends comprehensive email reports with execution summary and data impact
 * - Reports what was skipped vs. what was processed
 */

// CRITICAL: Load dependencies FIRST before any logging
require('dotenv').config();
const { generateRunId, createLogger: createBasicLogger } = require('../utils/runIdGenerator');
const { createLogger } = require('../utils/contextLogger'); // NEW: Structured logging

// Create module logger IMMEDIATELY after imports
const moduleLogger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'smart_resume_init' });

// NOW we can use moduleLogger safely
moduleLogger.info(`🔍 MODULE_DEBUG: Script loading started [${new Date().toISOString()}]`);

// Smart error handling: Continue for minor errors, exit for critical ones
process.on('uncaughtException', (error) => {
    moduleLogger.error(`🚨 UNCAUGHT EXCEPTION - CRITICAL ERROR DETECTED`);
    moduleLogger.error(`Error Message: ${error.message}`);
    moduleLogger.error(`Error Name: ${error.name}`);
    moduleLogger.error(`Error Code: ${error.code || 'N/A'}`);
    moduleLogger.error(`Error Stack: ${error.stack}`);
    moduleLogger.error(`Process Info: PID=${process.pid}, Memory=${JSON.stringify(process.memoryUsage())}`);
    moduleLogger.error(`Environment: NODE_ENV=${process.env.NODE_ENV}, Run ID=${process.env.SMART_RESUME_RUN_ID}`);
    moduleLogger.error(`Timestamp: ${new Date().toISOString()}`);
    
    // Determine if we're running as a module (called by API) or standalone script
    const isStandalone = require.main === module;
    moduleLogger.error(`Running Mode: ${isStandalone ? 'STANDALONE SCRIPT' : 'MODULE (called by API)'}`);
    
    // Check if this is a CRITICAL error that requires immediate shutdown
    const isCriticalError = (
        error.code === 'ECONNREFUSED' ||      // Database/API unreachable
        error.code === 'ENOMEM' ||            // Out of memory
        error.code === 'ENOTFOUND' ||         // DNS/network failure
        error.name === 'SyntaxError' ||       // Code parsing error
        error.message?.includes('FATAL') ||    // Explicitly marked fatal
        error.message?.includes('Cannot find module') // Missing dependency
    );
    
    moduleLogger.error(`Critical Error Assessment: ${isCriticalError ? 'YES - CRITICAL' : 'NO - Recoverable'}`);
    
    if (isStandalone || isCriticalError) {
        moduleLogger.error(`⚡ TERMINATING PROCESS (standalone=${isStandalone}, critical=${isCriticalError})`);
        moduleLogger.error(`Exit code: 1`);
        process.exit(1);
    } else {
        moduleLogger.error(`🔧 MODULE MODE: Non-critical error detected`);
        moduleLogger.error(`⚠️ Background job or async operation failed, but main process will continue`);
        moduleLogger.error(`📊 This error will be captured by auto-analyzer and saved to Production Issues table`);
        // Don't call process.exit() - let the script continue and return Run ID
    }
});

process.on('unhandledRejection', (reason, promise) => {
    moduleLogger.error(`🚨 UNHANDLED PROMISE REJECTION DETECTED`);
    moduleLogger.error(`Rejection Reason: ${reason}`);
    moduleLogger.error(`Rejection Stack: ${reason?.stack || 'N/A'}`);
    moduleLogger.error(`Promise: ${promise}`);
    moduleLogger.error(`Timestamp: ${new Date().toISOString()}`);
    
    // Determine if we're running as a module (called by API) or standalone script
    const isStandalone = require.main === module;
    moduleLogger.error(`Running Mode: ${isStandalone ? 'STANDALONE SCRIPT' : 'MODULE (called by API)'}`);
    
    // Check if this is a CRITICAL rejection
    const isCriticalError = (
        reason?.code === 'ECONNREFUSED' ||
        reason?.code === 'ENOMEM' ||
        reason?.code === 'ENOTFOUND' ||
        reason?.message?.includes('FATAL') ||
        reason?.message?.includes('Cannot find module')
    );
    
    moduleLogger.error(`Critical Error Assessment: ${isCriticalError ? 'YES - CRITICAL' : 'NO - Recoverable'}`);
    
    if (isStandalone || isCriticalError) {
        moduleLogger.error(`⚡ TERMINATING PROCESS (standalone=${isStandalone}, critical=${isCriticalError})`);
        moduleLogger.error(`Exit code: 1`);
        process.exit(1);
    } else {
        moduleLogger.error(`🔧 MODULE MODE: Non-critical rejection detected`);
        moduleLogger.error(`⚠️ Background job promise failed, but main process will continue`);
        moduleLogger.error(`📊 This error will be captured by auto-analyzer and saved to Production Issues table`);
        // Don't call process.exit() - let the script continue and return Run ID
    }
});

moduleLogger.info(`🔍 ERROR_HANDLERS: Installed smart error handlers with critical error detection`);
moduleLogger.info(`🔍 MODULE_DEBUG: dotenv configured, NODE_ENV: ${process.env.NODE_ENV}`);
moduleLogger.info(`🔍 MODULE_DEBUG: SMART_RESUME_RUN_ID: ${process.env.SMART_RESUME_RUN_ID}`);

// FORCE EXECUTION - Skip the require.main check entirely
moduleLogger.info(`🔍 FORCE_DEBUG: About to force-call main() directly [${new Date().toISOString()}]`);

moduleLogger.info(`🔍 TRACE: About to load remaining dependencies`);
// Updated imports based on newer versions
const airtableService = require('../services/airtableService');
const { JobTracking } = require('../services/jobTracking');
const runIdSystem = require('../services/runIdSystem');
const { 
  CLIENT_RUN_STATUS_VALUES,
  JOB_TRACKING_FIELDS,
  CLIENT_RUN_FIELDS
} = require('../constants/airtableUnifiedConstants');
const jobOrchestrationService = require('../services/jobOrchestrationService');
const ParameterValidator = require('../utils/parameterValidator');
// Define runIdService for backward compatibility
const runIdService = runIdSystem;

// Add defensive checks for required JobTracking methods
function validateJobTrackingMethods() {
  const requiredMethods = ['createJob', 'createClientRun', 'completeClientRun', 'completeJob', 'updateAggregateMetrics'];
  const missingMethods = [];
  
  requiredMethods.forEach(method => {
    if (typeof JobTracking[method] !== 'function') {
      missingMethods.push(method);
    }
  });
  
  if (missingMethods.length > 0) {
    throw new Error(`Required JobTracking methods not found: ${missingMethods.join(', ')}`);
  }
}

// Validate JobTracking methods are available
validateJobTrackingMethods();
let runId = 'INITIALIZING';

// moduleLogger already created at top of file (line 19)

// ROOT CAUSE FIX: Create a function to ensure normalizedRunId is always defined
function getNormalizedRunId(originalRunId) {
  // If originalRunId is null, undefined, or not a string, use the global runId
  const runIdToNormalize = (typeof originalRunId === 'string') ? originalRunId : runId;
  
  // CRITICAL FIX: Under the strict run ID handling pattern, we NEVER normalize
  // existing run IDs as that would break the single-source-of-truth principle
  // We return the original run ID unchanged to maintain consistency
  
  try {
    // Check if it's a compound run ID (master-client format)
    if (typeof runIdToNormalize === 'string' && runIdToNormalize.match(/^[\w\d]+-[\w\d]+$/)) {
      moduleLogger.info(`Detected compound run ID "${runIdToNormalize}" - preserving as is`);
      return runIdToNormalize;
    }
    
    // Only normalize if it's a non-standard format that needs standardization
    // Otherwise return the original to maintain the single source of truth
    if (typeof runIdToNormalize === 'string' && 
        !runIdToNormalize.match(/^\d{6}-\d{6}$/)) {  // Standard YYMMDD-HHMMSS format
      // Only in this case do we normalize
      return runIdSystem.normalizeRunId(runIdToNormalize);
    }
    
    // In all other cases, return the original unchanged
    return runIdToNormalize;
  } catch (error) {
    moduleLogger.error(`Error normalizing runId ${runIdToNormalize}: ${error.message}`);
    // Return the original as fallback
    return runIdToNormalize;
  }
}

// Deprecated: Legacy log function - replaced by contextLogger
// Keeping for backward compatibility during migration
let log = (message, level = 'INFO') => {
    // Map to appropriate logger level
    if (level === 'ERROR') {
        moduleLogger.error(message);
    } else if (level === 'WARN') {
        moduleLogger.warn(message);
    } else {
        moduleLogger.info(message);
    }
};
moduleLogger.info(`🔍 TRACE: Run ID generator loaded`);

moduleLogger.info(`🔍 TRACE: About to define checkOperationStatus function`);
async function checkOperationStatus(clientId, operation) {
    try {
        moduleLogger.info(`🔍 TRACE: About to require clientService`);
        const { getJobStatus } = require('../services/clientService');
        moduleLogger.info(`🔍 TRACE: clientService required successfully`);
        const status = await getJobStatus(clientId, operation);
        
        if (!status || !status.status) {
            return { completed: false, reason: 'No previous execution found' };
        }
        
        // Check if completed successfully
        if (status.status !== 'COMPLETED') {
            return { completed: false, reason: `Last status: ${status.status}` };
        }
        
        // Check if recent (within 24 hours)
        if (!status.lastRunDate) {
            return { completed: false, reason: 'No run date recorded' };
        }
        
        const lastRun = new Date(status.lastRunDate);
        const now = new Date();
        const hoursSinceRun = (now - lastRun) / (1000 * 60 * 60);
        
        if (hoursSinceRun > 24) {
            return { completed: false, reason: `Last run ${Math.round(hoursSinceRun)} hours ago (>24h)` };
        }
        
        return { 
            completed: true, 
            reason: `Completed ${Math.round(hoursSinceRun)}h ago`,
            lastRun: status.lastRunDate,
            count: status.lastRunCount || 0
        };
        
    } catch (error) {
        return { completed: false, reason: `Check failed: ${error.message}` };
    }
}
moduleLogger.info(`🔍 TRACE: checkOperationStatus function defined`);

moduleLogger.info(`🔍 TRACE: About to define checkUnscoredPostsCount function`);
async function checkUnscoredPostsCount(clientId) {
    try {
        moduleLogger.info(`� UNSCORED CHECK: Starting check for unscored posts for client ${clientId}`);
        const { getClientBase } = require('../config/airtableClient');
        const clientBase = await getClientBase(clientId);
        
        if (!clientBase) {
            moduleLogger.warn(`⚠️ Could not get client base for ${clientId}`);
            return { hasUnscoredPosts: false, count: 0, error: 'Could not access client base' };
        }
        
        moduleLogger.info(`🚨 UNSCORED CHECK: Successfully connected to client base for ${clientId}`);
        
        // FIRST: Do a count using formula to get TRUE count of unscored posts
        try {
            moduleLogger.info(`🚨 UNSCORED CHECK: PHASE 1 - Getting TRUE count of unscored posts using formula...`);
            const allUnscoredRecords = await clientBase('Leads').select({
                filterByFormula: "AND({Posts Content} != '', {Date Posts Scored} = BLANK())",
                maxRecords: 1 // Only need count, minimize data transfer
            }).all(); // Get ALL records, not just first page
            
            const trueCount = allUnscoredRecords.length;
            moduleLogger.info(`🚨 UNSCORED CHECK: TRUE COUNT = ${trueCount} total unscored posts exist in database`);
        } catch (countError) {
            moduleLogger.error(`❌ UNSCORED CHECK: Failed to get true count: ${countError.message}`);
        }
        
        // Try to get the view first - this is how the post scoring normally works
        try {
            // First try using the "Leads with Posts not yet scored" view
            moduleLogger.info(`🚨 UNSCORED CHECK: PHASE 2 - Attempting to use view "Leads with Posts not yet scored" for ${clientId}`);
            const viewRecords = await clientBase('Leads').select({
                view: 'Leads with Posts not yet scored',
                maxRecords: 100 // Increase to get actual count up to 100
            }).firstPage();
            
            const count = viewRecords.length;
            moduleLogger.info(`🚨 UNSCORED CHECK: VIEW returned ${count} records (maxRecords=100, so could be more)`);
            
            // If we found records, log the first few record IDs
            if (count > 0) {
                moduleLogger.info(`🚨 UNSCORED CHECK: First ${Math.min(5, count)} records from VIEW:`);
                viewRecords.slice(0, 5).forEach(record => {
                    const hasPostsContent = !!record.fields['Posts Content'];
                    const hasDateScored = !!record.fields['Date Posts Scored'];
                    moduleLogger.info(`🚨 UNSCORED CHECK: - ID: ${record.id}, Name: ${record.fields['Full Name'] || 'N/A'}, Has Posts: ${hasPostsContent}, Has Date Scored: ${hasDateScored}`);
                });
            } else {
                moduleLogger.info(`⚠️ UNSCORED CHECK: VIEW returned 0 records - this is suspicious if true count > 0!`);
            }
            
            return { 
                hasUnscoredPosts: count > 0, 
                count,
                source: 'view'
            };
        } catch (viewError) {
            moduleLogger.warn(`⚠️ UNSCORED CHECK: Could not use view for ${clientId}, falling back to formula: ${viewError.message}`);
            
            // Fallback - use formula to check for unscored posts
            moduleLogger.info(`🚨 UNSCORED CHECK: PHASE 3 - Falling back to formula method for ${clientId}`);
            const formulaRecords = await clientBase('Leads').select({
                filterByFormula: "AND({Posts Content} != '', {Date Posts Scored} = BLANK())",
                maxRecords: 100 // Increase to get actual count up to 100
            }).firstPage();
            
            const count = formulaRecords.length;
            moduleLogger.info(`🚨 UNSCORED CHECK: FORMULA returned ${count} records (maxRecords=100, so could be more)`);
            
            // If we found records, log the first few record IDs
            if (count > 0) {
                moduleLogger.info(`🚨 UNSCORED CHECK: First ${Math.min(5, count)} records from FORMULA:`);
                formulaRecords.slice(0, 5).forEach(record => {
                    const hasPostsContent = !!record.fields['Posts Content'];
                    const hasDateScored = !!record.fields['Date Posts Scored'];
                    moduleLogger.info(`🚨 UNSCORED CHECK: - ID: ${record.id}, Name: ${record.fields['Full Name'] || 'N/A'}, Has Posts: ${hasPostsContent}, Has Date Scored: ${hasDateScored}`);
                });
            } else {
                moduleLogger.info(`⚠️ UNSCORED CHECK: FORMULA returned 0 records - this is suspicious if true count > 0!`);
            }
            
            return { 
                hasUnscoredPosts: count > 0, 
                count,
                source: 'formula'
            };
        }
    } catch (error) {
        moduleLogger.error(`❌ UNSCORED CHECK: Error checking unscored posts: ${error.message}`);
        moduleLogger.error(`❌ UNSCORED CHECK: Stack trace:`, error.stack);
        return { hasUnscoredPosts: false, count: 0, error: error.message };
    }
}
moduleLogger.info(`🔍 TRACE: checkUnscoredPostsCount function defined`);

moduleLogger.info(`🔍 TRACE: About to define determineClientWorkflow function`);
async function determineClientWorkflow(client) {
    moduleLogger.info(`🔍 WORKFLOW-DEBUG: ========== determineClientWorkflow CALLED for ${client.clientName} (${client.clientId}) ==========`);
    
    const operations = ['lead_scoring', 'post_harvesting', 'post_scoring'];
    moduleLogger.info(`🔍 WORKFLOW-DEBUG: Operations to check: ${operations.join(', ')}`);
    
    const workflow = {
        clientId: client.clientId,
        clientName: client.clientName,
        serviceLevel: client.serviceLevel,
        needsProcessing: false,
        operationsToRun: [],
        statusSummary: {}
    };
    
    moduleLogger.info(`🔍 WORKFLOW-DEBUG: Starting operation status checks for ${client.clientName}...`);
    
    moduleLogger.info(`🔍 [WORKFLOW-DEBUG] Determining workflow for ${client.clientName} (${client.clientId})`);
    
    // Check each operation status
    for (const operation of operations) {
        moduleLogger.info(`🔍 [WORKFLOW-DEBUG] Checking operation: ${operation}`);
        
        // Skip post_harvesting for service level < 2
        if (operation === 'post_harvesting' && Number(client.serviceLevel) < 2) {
            moduleLogger.info(`⚠️ [WORKFLOW-DEBUG] Skipping ${operation} - service level ${client.serviceLevel} < 2`);
            workflow.statusSummary[operation] = { 
                completed: true, 
                reason: `Skipped (service level ${client.serviceLevel} < 2)` 
            };
            continue;
        }
        
        const status = await checkOperationStatus(client.clientId, operation);
        moduleLogger.info(`🔍 [WORKFLOW-DEBUG] Operation ${operation} status:`, JSON.stringify(status));
        workflow.statusSummary[operation] = status;
        
        // Special handling for post_scoring - check if there are unscored posts regardless of last run time
        if (operation === 'post_scoring' && status.completed) {
            const testingMode = process.env.FIRE_AND_FORGET_BATCH_PROCESS_TESTING === 'true';
            const testingModeLimit = parseInt(process.env.POST_SCORING_TESTING_LIMIT) || 10;
            
            moduleLogger.info(`�🚨 POST SCORING CHECK: Client ${client.clientName} (${client.clientId}) has completed post_scoring recently`);
            moduleLogger.info(`🚨 POST SCORING CHECK: Last run: ${status.lastRun}, Status: ${status.status}, Testing mode = ${testingMode}`);
            
            // In testing mode, always run post scoring regardless of recent completion (with limit)
            if (testingMode) {
                moduleLogger.info(`🧪 POST SCORING TESTING MODE: FORCE RUNNING post_scoring despite recent completion (limit: ${testingModeLimit})`);
                status.completed = false;
                status.overrideReason = `Testing mode active - forcing execution (max ${testingModeLimit} posts)`;
                status.testingModeLimit = testingModeLimit;
                workflow.statusSummary[operation] = status;
            } else {
                // In normal mode, check for unscored posts
                moduleLogger.info(`🚨 POST SCORING CHECK: Checking for unscored posts...`);
                const unscoredPostsStatus = await checkUnscoredPostsCount(client.clientId);
                
                moduleLogger.info(`🚨 POST SCORING DECISION: Client ${client.clientName} - Unscored posts check results:`, JSON.stringify(unscoredPostsStatus));
                
                // If we have unscored posts, we should run post_scoring even if it was recent
                if (unscoredPostsStatus.hasUnscoredPosts) {
                    moduleLogger.info(`✅ POST SCORING OVERRIDE: Found ${unscoredPostsStatus.count} unscored posts for ${client.clientName} - WILL RUN post_scoring even though last run was recent`);
                    
                    // Override the completed status and add a reason
                    status.completed = false;
                    status.overrideReason = `Found ${unscoredPostsStatus.count} unscored posts`;
                    status.originalStatus = { ...status }; // Keep original status for reference
                    
                    // Update in the workflow summary
                    workflow.statusSummary[operation] = status;
                } else {
                    moduleLogger.info(`🚨 POST SCORING SKIPPED: No unscored posts found for ${client.clientName} - skipping post_scoring as it ran recently`);
                }
            }
        }
        
        if (!status.completed) {
            moduleLogger.info(`✅ [WORKFLOW-DEBUG] Operation ${operation} will be executed (status.completed=false)`);
            workflow.needsProcessing = true;
            workflow.operationsToRun.push(operation);
        } else {
            moduleLogger.info(`⏭️ [WORKFLOW-DEBUG] Operation ${operation} skipped (status.completed=true)`);
        }
    }
    
    moduleLogger.info(`🔍 [WORKFLOW-DEBUG] Final workflow for ${client.clientName}:`);
    moduleLogger.info(`   - needsProcessing: ${workflow.needsProcessing}`);
    moduleLogger.info(`   - operationsToRun: ${workflow.operationsToRun.join(', ') || 'NONE'}`);
    moduleLogger.info(`   - statusSummary:`, JSON.stringify(workflow.statusSummary, null, 2));
    
    return workflow;
}
moduleLogger.info(`🔍 TRACE: determineClientWorkflow function defined`);

moduleLogger.info(`🔍 TRACE: About to define triggerOperation function`);
async function triggerOperation(baseUrl, clientId, operation, params = {}, authHeaders = {}) {
    // PURE CONSUMER ARCHITECTURE: params.runId is ALREADY the complete client run ID
    // (e.g., "251007-064024-Guy-Wilson") created by smart-resume at line 620.
    // DO NOT reconstruct it - just pass it exactly as-is to operations.
    // Operations are pure consumers and will use it without modification.
    const clientRunId = params.runId; // Use exactly as-is, no reconstruction
    
    const operationMap = {
        'lead_scoring': {
            url: `/run-batch-score-v2?stream=${params.stream}&limit=${params.limit}&clientId=${clientId}&parentRunId=${params.runId || ''}&clientRunId=${clientRunId || ''}`,
            method: 'GET',
            headers: { 'x-webhook-secret': params.secret }
        },
        'post_harvesting': {
            url: `/api/apify/process-level2-v2?stream=${params.stream}&clientId=${clientId}&parentRunId=${params.runId || ''}&clientRunId=${clientRunId || ''}`,
            method: 'POST',
            headers: { 'Authorization': `Bearer ${params.secret}` }
        },
        'post_scoring': {
            url: `/run-post-batch-score-v2`,
            method: 'POST',
            headers: { 'x-webhook-secret': params.secret },
            body: { stream: params.stream, limit: params.limit, clientId: clientId, parentRunId: params.runId, clientRunId: clientRunId }
        }
    };
    
    const config = operationMap[operation];
    if (!config) {
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    const startTime = Date.now();
    
    try {
        log(`🎯 Triggering ${operation} for ${clientId}...`);
        log(`🔍 AUTH_DEBUG: ${operation} - URL: ${baseUrl}${config.url}`);
        log(`🔍 AUTH_DEBUG: ${operation} - Method: ${config.method}`);
        log(`🔍 AUTH_DEBUG: ${operation} - Headers: ${JSON.stringify(config.headers)}`);
        log(`🔍 AUTH_DEBUG: ${operation} - Secret length: ${params.secret ? params.secret.length : 'MISSING'}`);
        
        const fetchOptions = {
            method: config.method,
            headers: {
                'Content-Type': 'application/json',
                ...config.headers,
                ...authHeaders
            }
        };
        
        // Add body for POST requests
        if (config.body) {
            fetchOptions.body = JSON.stringify(config.body);
            log(`🔍 AUTH_DEBUG: ${operation} - Body: ${JSON.stringify(config.body)}`);
        }
        
        const response = await fetch(`${baseUrl}${config.url}`, fetchOptions);
        
        const responseTime = Date.now() - startTime;
        const responseData = await response.json();
        
        log(`🔍 AUTH_DEBUG: ${operation} - Response status: ${response.status}`);
        log(`🔍 AUTH_DEBUG: ${operation} - Response data: ${JSON.stringify(responseData).substring(0, 200)}`);
        
        if (response.status === 202) {
            log(`✅ ${operation} triggered for ${clientId}: 202 Accepted in ${responseTime}ms (Job: ${responseData.jobId})`);
            return { success: true, jobId: responseData.jobId };
        } else {
            log(`❌ ${operation} failed for ${clientId}: ${response.status} ${response.statusText}`, 'ERROR');
            log(`🔍 AUTH_DEBUG: ${operation} - Full response: ${JSON.stringify(responseData)}`, 'ERROR');
            return { success: false, error: `${response.status} ${response.statusText}` };
        }
    } catch (error) {
        log(`❌ ${operation} error for ${clientId}: ${error.message}`, 'ERROR');
        log(`🔍 AUTH_DEBUG: ${operation} - Fetch error: ${error.stack}`, 'ERROR');
        return { success: false, error: error.message };
    }
}
moduleLogger.info(`🔍 TRACE: triggerOperation function defined`);

moduleLogger.info(`🔍 TRACE: About to define main function`);
async function main() {
    moduleLogger.info(`🔍 TRACE: Generating structured run ID...`);
    
    // Generate a structured, filterable run ID
    runId = await generateRunId();
    
    // Create a normalized run ID
    const normalizedRunId = getNormalizedRunId(runId);
    
    // Create structured context logger (NEW)
    const logger = createLogger({
        runId: runId,
        clientId: 'SYSTEM',
        operation: 'smart-resume'
    });
    
    logger.info(`🚀 PROGRESS: Starting smart resume processing (Run ID: ${runId}, Normalized: ${normalizedRunId})`);
    
    // Track actual start and end times for log analysis
    const runStartTimestamp = new Date(); // Actual start time for log fetching
    
    // Use external URL for Render, localhost for local development
    const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://pb-webhook-server-staging.onrender.com';
    const secret = process.env.PB_WEBHOOK_SECRET;
    const stream = parseInt(process.env.BATCH_PROCESSING_STREAM) || 1;
    const leadScoringLimit = parseInt(process.env.LEAD_SCORING_LIMIT) || 100;
    const postScoringLimit = parseInt(process.env.POST_SCORING_LIMIT) || 100;
    
    // Initialize run tracking in Airtable
    try {
        logger.info(`🚀 PROGRESS: Creating job tracking record for run ${runId}...`);
        const jobRecord = await JobTracking.createJob({
            runId: normalizedRunId, 
            jobType: 'smart_resume', 
            initialData: { [JOB_TRACKING_FIELDS.STREAM]: stream }
        });
        logger.info(`✅ Job tracking record created successfully (ID: ${jobRecord?.recordId || 'unknown'})`);
    } catch (error) {
        logger.warn(`⚠️ Failed to create job tracking record: ${error.message}. Continuing execution.`);
        logger.debug(`🔍 Error details: ${error.stack || 'No stack trace'}`);
    }
    
    logger.info(`🚀 PROGRESS: Configuration loaded - baseUrl: ${baseUrl}, stream: ${stream}`);
    
    // Initialize email reporting
    logger.info(`🚀 PROGRESS: Initializing email service...`);
    const emailService = require('../services/emailReportingService');
    logger.info(`🚀 PROGRESS: Email service initialized successfully`);
    
    const runStartTime = Date.now();
    
    logger.debug(`🔍 SCRIPT_DEBUG: Checking secret...`);
    if (!secret) {
        const errorMsg = 'PB_WEBHOOK_SECRET environment variable is required';
        logger.error(`❌ ${errorMsg}`);
        
        // Send failure alert
        await emailService.sendExecutionReport({
            runId,
            normalizedRunId,
            stream,
            error: errorMsg,
            duration: Date.now() - runStartTime,
            clientsAnalyzed: 0
        });
        
        process.exit(1);
    }
    
    logger.debug(`🔍 SCRIPT_DEBUG: Secret found, length: ${secret.length}`);
    
    const authHeaders = { 'Authorization': `Bearer ${secret}` };
    
    logger.info(`🚀 SMART RESUME CLIENT-BY-CLIENT PROCESSING STARTING`);
    logger.info(`   Run ID: ${runId}`);
    logger.info(`   Base URL: ${baseUrl}`);
    logger.info(`   Stream: ${stream}`);
    logger.info(`   Resume Logic: Skip completed operations from last 24 hours`);
    logger.info(`   Email Reporting: ${emailService.isConfigured() ? '✅ Enabled' : '⚠️  Not configured'}`);
    
    // Get clients for this stream
    log(`� PROGRESS: [1/6] Loading client service...`, 'INFO');
    const { getActiveClientsByStream } = require('../services/clientService');
    log(`� PROGRESS: [2/6] Client service loaded, fetching clients...`, 'INFO');
    
    try {
        log(`🔍 Calling getActiveClientsByStream(${stream})...`, 'INFO');
        const clients = await getActiveClientsByStream(stream);
        log(`✅ Found ${clients ? clients.length : 0} clients on stream ${stream}`, 'INFO');
        log(`📊 Client Discovery Complete: ${clients.length} clients available for processing`);
        
        if (clients.length === 0) {
            log(`⚠️  No clients found on stream ${stream} - sending empty report`, 'WARN');
            
            // Send empty stream report
            await emailService.sendExecutionReport({
                runId,
                normalizedRunId,
                stream,
                startTime: runStartTime,
                endTime: Date.now(),
                duration: Date.now() - runStartTime,
                clientsAnalyzed: 0,
                clientsSkipped: 0,
                clientsProcessed: 0,
                totalOperationsTriggered: 0,
                totalJobsStarted: 0,
                successRate: 100,
                executionResults: [],
                skippedClients: [],
                errors: [`No clients found on stream ${stream}`]
            });
            
            process.exit(0);
        }
        
        // Step 1: Analyze what needs to be done
        log(`� PROGRESS: [3/6] Analyzing client status and requirements...`);
        const workflows = [];
        
        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            log(`\n📋 [${i+1}/${clients.length}] Analyzing ${client.clientName} (${client.clientId}):`);
            
            const workflow = await determineClientWorkflow(client);
            workflows.push(workflow);
            
            // Report status for each operation
            Object.entries(workflow.statusSummary).forEach(([op, status]) => {
                const icon = status.completed ? '✅' : '❌';
                log(`   ${icon} ${op}: ${status.reason}`);
            });
            
            if (workflow.needsProcessing) {
                log(`   🎯 NEEDS: ${workflow.operationsToRun.join(', ')}`);
            } else {
                log(`   ✅ UP TO DATE: All operations completed recently`);
            }
        }
        
        // Step 2: Execute needed operations
        const clientsNeedingWork = workflows.filter(w => w.needsProcessing);
        
        log(`� PROGRESS: [5/6] Analysis complete - preparing execution plan...`);
        log(`📊 EXECUTION PLAN: ${clientsNeedingWork.length} clients need processing, ${workflows.length - clientsNeedingWork.length} clients up to date`);
        
        if (clientsNeedingWork.length === 0) {
            log(`\n🎉 ALL CLIENTS UP TO DATE!`);
            log(`   No operations needed - all clients completed recently`);
            log(`   Next scheduled run will check again in 24 hours`);
            
            log(`� PROGRESS: [6/6] No work needed - sending success report...`);
            
            // Send success report for no-work scenario
            await emailService.sendExecutionReport({
                runId,
                normalizedRunId,
                stream,
                startTime: runStartTime,
                endTime: Date.now(),
                duration: Date.now() - runStartTime,
                clientsAnalyzed: clients.length,
                clientsSkipped: clients.length,
                clientsProcessed: 0,
                totalOperationsTriggered: 0,
                totalJobsStarted: 0,
                successRate: 100,
                executionResults: [],
                skippedClients: workflows.map(w => ({
                    clientName: w.clientName,
                    reason: 'All operations up to date'
                })),
                errors: []
            });
            
            log(`� PROGRESS: [6/6] ✅ COMPLETE - All clients up to date!`);
            return;
        }
        
        log(`� PROGRESS: [6/6] Executing operations for ${clientsNeedingWork.length} clients...`);
        log(`📊 EXECUTION SUMMARY: ${clientsNeedingWork.length} clients need work, ${workflows.length - clientsNeedingWork.length} clients up to date`);
        log(`📋 Total operations to run: ${clientsNeedingWork.reduce((sum, w) => sum + w.operationsToRun.length, 0)}`);
        
        let totalTriggered = 0;
        let totalJobsStarted = 0;
        const executionResults = [];
        
        for (let i = 0; i < clientsNeedingWork.length; i++) {
            const workflow = clientsNeedingWork[i];
            log(`\n🚀 PROGRESS: Processing client [${i + 1}/${clientsNeedingWork.length}] ${workflow.clientName}:`);
            log(`   Operations needed: ${workflow.operationsToRun.join(', ')}`);
            
            // Create client run record in Airtable
            try {
                log(`   📊 Creating run tracking record for ${workflow.clientName}...`);
                const clientRunRecord = await JobTracking.createClientRun({
                    runId: normalizedRunId,
                    clientId: workflow.clientId,
                    initialData: { 
                        [CLIENT_RUN_FIELDS.CLIENT_NAME]: workflow.clientName 
                    }
                });
                log(`   ✅ Run tracking record created (ID: ${clientRunRecord?.recordId || 'unknown'})`);
                
                // Store client run ID for passing to operations
                workflow.clientRunId = clientRunRecord?.runId;
                workflow.trackingRecordId = clientRunRecord?.recordId;
            } catch (error) {
                log(`   ⚠️ Failed to create run tracking record: ${error.message}. Continuing execution.`, 'WARN');
                log(`   🔍 Error details: ${error.stack || 'No stack trace'}`, 'DEBUG');
            }
            
            // Log more details about post_scoring status if it's going to be executed
            if (workflow.operationsToRun.includes('post_scoring')) {
                const postScoringStatus = workflow.statusSummary['post_scoring'];
                if (postScoringStatus.overrideReason) {
                    log(`   📌 POST SCORING: ${postScoringStatus.overrideReason}`);
                    if (postScoringStatus.originalStatus) {
                        log(`   📌 Original reason: ${postScoringStatus.originalStatus.reason}`);
                    }
                }
            }
            
            const params = { stream, limit: leadScoringLimit };
            const clientJobs = [];
            
            for (let opIndex = 0; opIndex < workflow.operationsToRun.length; opIndex++) {
                const operation = workflow.operationsToRun[opIndex];
                log(`   🚀 Starting operation [${opIndex + 1}/${workflow.operationsToRun.length}] ${operation}...`);
                moduleLogger.info(`🔍 [TRIGGER-DEBUG] About to trigger ${operation} for ${workflow.clientId}`);
                
                if (operation === 'post_scoring') {
                }
                
                const operationParams = operation === 'post_scoring' 
                    ? { stream, limit: postScoringLimit, secret, runId: workflow.clientRunId || normalizedRunId }
                    : { stream, limit: leadScoringLimit, secret, runId: workflow.clientRunId || normalizedRunId };
                
                if (operation === 'post_scoring') {
                }
                
                moduleLogger.info(`🔍 [TRIGGER-DEBUG] Operation params for ${operation}:`, JSON.stringify(operationParams));
                    
                const authRequired = ['post_harvesting', 'post_scoring'].includes(operation);
                const headers = authRequired ? authHeaders : {};
                
                if (operation === 'post_scoring') {
                }
                
                moduleLogger.info(`🔍 [TRIGGER-DEBUG] Calling triggerOperation for ${operation}...`);
                const result = await triggerOperation(baseUrl, workflow.clientId, operation, operationParams, headers);
                
                if (operation === 'post_scoring') {
                }
                
                moduleLogger.info(`🔍 [TRIGGER-DEBUG] Result for ${operation}:`, JSON.stringify(result));
                totalTriggered++;
                
                if (result.success) {
                    if (operation === 'post_scoring') {
                    }
                    log(`   ✅ ${operation} triggered successfully`);
                    totalJobsStarted++;
                } else {
                    if (operation === 'post_scoring') {
                    }
                    log(`   ❌ ${operation} failed: ${result.error}`);
                }
                
                if (result.success) {
                    totalJobsStarted++;
                    clientJobs.push({ operation, jobId: result.jobId });
                }
                
                // Small delay between operations
                if (workflow.operationsToRun.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            executionResults.push({
                clientId: workflow.clientId,
                clientName: workflow.clientName,
                operationsRun: workflow.operationsToRun,
                jobs: clientJobs
            });
            
            // Update client run record on completion
            try {
                log(`   📊 Updating run tracking for ${workflow.clientName}...`);
                const success = clientJobs.length === workflow.operationsToRun.length;
                const notes = `Executed operations: ${workflow.operationsToRun.join(', ')}\nJobs started: ${clientJobs.length}/${workflow.operationsToRun.length}`;
                await JobTracking.completeClientRun({
                    runId: normalizedRunId,
                    clientId: workflow.clientId,
                    updates: { 
                        [CLIENT_RUN_FIELDS.STATUS]: success ? CLIENT_RUN_STATUS_VALUES.COMPLETED : CLIENT_RUN_STATUS_VALUES.FAILED,
                        [CLIENT_RUN_FIELDS.SYSTEM_NOTES]: notes 
                    }
                });
                log(`   ✅ Run tracking updated`);
            } catch (error) {
                log(`   ⚠️ Failed to update run tracking: ${error.message}.`, 'WARN');
            }
            
            log(`   ✅ ${workflow.clientName}: ${clientJobs.length}/${workflow.operationsToRun.length} jobs started`);
            
            // Delay between clients
            if (i < clientsNeedingWork.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Comprehensive reporting
        log(`🔄 PROGRESS: [6/6] Finalizing results and sending report...`);
        
        const runEndTime = Date.now();
        const totalDuration = runEndTime - runStartTime;
        const clientsSkipped = workflows.filter(w => !w.needsProcessing);
        const successRate = totalTriggered > 0 ? Math.round((totalJobsStarted / totalTriggered) * 100) : 100;
        const errors = [];
        
        // Collect any errors from failed job starts
        if (totalJobsStarted < totalTriggered) {
            errors.push(`${totalTriggered - totalJobsStarted} operations failed to start`);
        }
        
        // Final console summary
        log(`\n🎉 SMART RESUME PROCESSING COMPLETED ✅`);
        log(`   📊 FINAL STATS:`);
        log(`   └─ Total Operations Triggered: ${totalTriggered}`);
        log(`   └─ Successful Job Starts: ${totalJobsStarted}`);
        log(`   └─ Clients Processed: ${clientsNeedingWork.length}/${clients.length}`);
        log(`   └─ Clients Skipped: ${clients.length - clientsNeedingWork.length} (up to date)`);
        log(`   └─ Success Rate: ${successRate}%`);
        log(`   └─ Total Duration: ${Math.round(totalDuration / 1000)}s`);
        
        if (executionResults.length > 0) {
            log(`\n📋 EXECUTION SUMMARY:`);
            executionResults.forEach(result => {
                log(`   ${result.clientName}:`);
                result.jobs.forEach(job => {
                    log(`     - ${job.operation}: ${job.jobId}`);
                });
            });
        }
        
        log(`\n🔍 MONITORING:`);
        log(`   - ${totalJobsStarted} jobs now running in background`);
        log(`   - Check Airtable Client table for status updates`);
        log(`   - Jobs will complete independently with timeout protection`);
        
        // DEBUG: Comprehensive diagnostics before reportData creation
        log(`\n🔍 DEBUG [STEP 1]: Checking all variables BEFORE creating reportData...`);
        log(`🔍 DEBUG: runId = "${runId}" (type: ${typeof runId}, defined: ${runId !== undefined})`);
        log(`🔍 DEBUG: normalizedRunId = "${normalizedRunId}" (type: ${typeof normalizedRunId})`);
        log(`🔍 DEBUG: stream = "${stream}" (type: ${typeof stream})`);
        log(`🔍 DEBUG: runStartTime = ${runStartTime} (type: ${typeof runStartTime})`);
        log(`🔍 DEBUG: runEndTime = ${runEndTime} (type: ${typeof runEndTime})`);
        log(`🔍 DEBUG: totalDuration = ${totalDuration} (type: ${typeof totalDuration})`);
        log(`🔍 DEBUG: clients.length = ${clients?.length} (is array: ${Array.isArray(clients)})`);
        log(`🔍 DEBUG: clientsSkipped.length = ${clientsSkipped?.length} (is array: ${Array.isArray(clientsSkipped)})`);
        log(`🔍 DEBUG: clientsNeedingWork.length = ${clientsNeedingWork?.length} (is array: ${Array.isArray(clientsNeedingWork)})`);
        log(`🔍 DEBUG: totalTriggered = ${totalTriggered} (type: ${typeof totalTriggered})`);
        log(`🔍 DEBUG: totalJobsStarted = ${totalJobsStarted} (type: ${typeof totalJobsStarted})`);
        log(`🔍 DEBUG: successRate = ${successRate}% (type: ${typeof successRate})`);
        log(`🔍 DEBUG: executionResults.length = ${executionResults?.length} (is array: ${Array.isArray(executionResults)})`);
        log(`🔍 DEBUG: errors.length = ${errors?.length} (is array: ${Array.isArray(errors)})`);
        
        log(`\n🔍 DEBUG [STEP 2]: Creating reportData object NOW...`);
        
        // Send comprehensive email report
        const reportData = {
            runId,
            normalizedRunId,
            stream,
            startTime: runStartTime,
            endTime: runEndTime,
            duration: totalDuration,
            clientsAnalyzed: clients.length,
            clientsSkipped: clientsSkipped.length,
            clientsProcessed: clientsNeedingWork.length,
            totalOperationsTriggered: totalTriggered,
            totalJobsStarted: totalJobsStarted,
            successRate,
            executionResults,
            skippedClients: clientsSkipped,
            errors
        };
        
        log(`🔍 DEBUG [STEP 3]: reportData object created SUCCESSFULLY!`);
        log(`🔍 DEBUG: reportData has ${Object.keys(reportData).length} keys`);
        log(`🔍 DEBUG: Keys are: ${Object.keys(reportData).join(', ')}`);
        
        // Test if reportData can be stringified (checks for circular references)
        try {
            const jsonTest = JSON.stringify(reportData);
            log(`🔍 DEBUG: reportData JSON.stringify() SUCCESS - ${jsonTest.length} characters`);
        } catch (stringifyErr) {
            log(`❌ DEBUG: reportData JSON.stringify() FAILED: ${stringifyErr.message}`);
            log(`🔍 DEBUG: This indicates circular references - likely in executionResults or errors`);
        }
        
        log(`\n🔍 DEBUG [STEP 4]: Checking for special case (all clients up to date)...`);
        
        if (clientsNeedingWork.length === 0) {
            // Special case: all clients up to date
            log(`\n🎉 ALL CLIENTS UP TO DATE!`);
            log(`   No operations needed - all clients completed recently`);
            log(`   Next scheduled run will check again in 24 hours`);
            
            reportData.totalOperationsTriggered = 0;
            reportData.totalJobsStarted = 0;
            reportData.successRate = 100;
            reportData.executionResults = [];
            reportData.errors = [];
        }
        
        log(`\n🔍 DEBUG [STEP 5]: About to trigger email send (fire-and-forget)...`);
        
        // Send email report (fire-and-forget - don't block return for email delivery)
        log(`📧 Triggering completion report email (background)...`);
        emailService.sendExecutionReport(reportData)
            .then(emailResult => {
                if (emailResult.sent) {
                    log(`📧 ✅ DEBUG: Email promise resolved - Completion report sent successfully`);
                } else {
                    log(`📧 ❌ DEBUG: Email promise resolved with failure: ${emailResult.reason}`, 'WARN');
                }
            })
            .catch(error => {
                log(`📧 ❌ DEBUG: Email promise rejected with error: ${error.message}`, 'WARN');
                log(`🔍 DEBUG: Email error stack: ${error.stack}`, 'WARN');
            });
        
        log(`� DEBUG [STEP 6]: Email send triggered successfully (fire-and-forget mode)`);
        log(`🔍 DEBUG: Script continuing without waiting for email completion...`);
        
        log(`\n🔍 DEBUG [STEP 7]: About to trigger job tracking update (fire-and-forget)...`);
        
        // Update aggregate metrics and complete job tracking (fire-and-forget to avoid blocking return)
        // This is non-critical metadata - the important work (job starts) already succeeded
        log(`📊 Triggering job tracking metrics update (background)...`);
        JobTracking.updateAggregateMetrics({ runId: normalizedRunId })
            .then(() => {
                log(`🔍 DEBUG: updateAggregateMetrics completed, calling completeJob...`);
                const notes = `Run completed successfully. Processed ${clientsNeedingWork.length} clients with ${totalJobsStarted} operations started. Duration: ${Math.round(totalDuration / 1000)} seconds. Success Rate: ${successRate}%`;
                return JobTracking.completeJob({
                    runId: normalizedRunId,
                    status: CLIENT_RUN_STATUS_VALUES.COMPLETED,
                    updates: { [JOB_TRACKING_FIELDS.SYSTEM_NOTES]: notes }
                });
            })
            .then(() => {
                log(`✅ DEBUG: Job tracking promise chain completed successfully`);
            })
            .catch(error => {
                log(`⚠️ DEBUG: Job tracking promise rejected: ${error.message}`, 'WARN');
                log(`🔍 DEBUG: Job tracking error stack: ${error.stack}`, 'WARN');
            });
        
        log(`� DEBUG [STEP 8]: Job tracking update triggered successfully (fire-and-forget mode)`);
        log(`🔍 DEBUG: Script continuing without waiting for job tracking completion...`);
        
        // Track end timestamp for log analysis
        const runEndTimestamp = new Date();
        log(`🔍 DEBUG [STEP 9]: runEndTimestamp = ${runEndTimestamp.toISOString()}`);
        
        // NOTE: Log analysis moved to API route's finally block
        // This ensures analysis runs AFTER script completes and properly passes runId
        // See routes/apiAndJobRoutes.js line ~5280 for the auto-analysis implementation
        
        log(`\n🔍 DEBUG [STEP 10]: Preparing return value...`);
        log(`\n🎉 ✅ SMART RESUME FULLY COMPLETED!`);
        log(`🚀 PROGRESS: [6/6] ✅ ALL PHASES COMPLETE - Script execution finished successfully`);
        log(`📝 Summary: ${clientsNeedingWork.length} clients processed, ${totalJobsStarted} operations started`);
        log(`⏰ Duration: ${Math.round(totalDuration / 1000)} seconds`);
        log(`📊 Success Rate: ${successRate}%`);
        
        // CRITICAL DEBUG: Log what we're about to return
        log(`🔍 DEBUG: About to return result object with runId=${runId}, normalizedRunId=${normalizedRunId}`);
        log(`🔍 DEBUG: Return object will include: success, runId, normalizedRunId, stream, clientsProcessed, jobsStarted, duration, successRate`);
        
        // Return success result with runId for parent to use (e.g., for log analysis)
        const returnValue = {
            success: true,
            runId: runId,
            normalizedRunId: normalizedRunId,
            stream: stream,
            clientsProcessed: clientsNeedingWork.length,
            jobsStarted: totalJobsStarted,
            duration: totalDuration,
            successRate: successRate
        };
        
        log(`🔍 DEBUG: Returning result object: ${JSON.stringify(returnValue, null, 2)}`);
        return returnValue;
        
    } catch (error) {
        log(`❌ Pipeline error: ${error.message}`, 'ERROR');
        log(`🔍 SCRIPT_DEBUG: Full error stack: ${error.stack}`, 'ERROR');
        
        // Update job tracking to reflect failure
        try {
            log(`📊 Updating job tracking for failure...`);
            const notes = `Run failed with error: ${error.message}`;
            await JobTracking.completeJob({
                runId: normalizedRunId,
                status: CLIENT_RUN_STATUS_VALUES.FAILED,
                updates: { [JOB_TRACKING_FIELDS.SYSTEM_NOTES]: notes }
            });
            log(`✅ Job tracking updated for failure`);
        } catch (trackingError) {
            log(`⚠️ Failed to update job tracking for failure: ${trackingError.message}.`, 'WARN');
        }
        
        // Send failure alert email
        const errorReportData = {
            runId,
            normalizedRunId,
            stream,
            error: error.message,
            duration: Date.now() - runStartTime,
            clientsAnalyzed: 0
        };
        
        const emailResult = await emailService.sendExecutionReport(errorReportData);
        if (emailResult.sent) {
            log(`📧 Failure alert sent successfully`);
        } else {
            log(`📧 Failure alert failed: ${emailResult.reason}`, 'WARN');
        }
        
        process.exit(1);
    }
}
moduleLogger.info(`🔍 TRACE: main function defined - ALL FUNCTIONS COMPLETE`);

moduleLogger.info(`🔍 TRACE: About to reach execution section`);

// Export the main function and other important functions
// Make sure this export is before any conditional execution
module.exports = {
    runSmartResume: main,
    main: main,
    checkOperationStatus,
    determineClientWorkflow,
    triggerOperation
};

// When run directly as script, execute main()
if (require.main === module) {
    moduleLogger.info(`🔍 FORCE_DEBUG: Executing as script [${new Date().toISOString()}]`);
    moduleLogger.info(`🔍 FORCE_DEBUG: require.main === module: ${require.main === module}`);
    moduleLogger.info(`🔍 FORCE_DEBUG: __filename: ${__filename}`);
    if (require.main) {
        moduleLogger.info(`🔍 FORCE_DEBUG: require.main.filename: ${require.main.filename}`);
    }
    
    moduleLogger.info(`🔍 TRACE: About to call main()`);
    main().catch(error => {
        moduleLogger.error(`🔍 FORCE_DEBUG: Fatal error in main():`, error);
        moduleLogger.error('Full stack:', error.stack);
        process.exit(1);
    });
    moduleLogger.info(`🔍 TRACE: main() call initiated (async)`);
}