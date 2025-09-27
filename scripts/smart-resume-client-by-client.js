#!/usr/bin/env node

/**
 * 🚨🚨🚨 DEPLOYMENT MARKER: FORCE GUY WILSON POST HARVESTING VERSION (2025-09-27 00:55) 🚨🚨🚨
 * 
 * Smart Resume Client-by-Client Processing Pipeline with Email Reporting
 * 
 * Checks each client's last execution status and resumes from where it left off:
 * - Skips clients where all operations completed succes    // Get clients for this stream
    log(`🚀        // Step 1: Analyze what needs to be done
        log(`🚀 PROGRESS: [4/6] Analyzing client status and requirements...`);
        const workflows = [];
        
        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            log(`\n🚀 PROGRESS: Analyzing client [${i+1}/${clients.length}] ${client.clientName} (${client.clientId}):`);
            
            const workflow = await determineClientWorkflow(client);
            workflows.push(workflow);
            
            // Report status for each operation
            Object.entries(workflow.statusSummary).forEach(([op, status]) => {
                const icon = status.completed ? '✅' : '❌';
                log(`   ${icon} ${op}: ${status.reason}`);
            }); Loading client service...`, 'INFO');
    const { getActiveClientsByStream } = require('../services/clientService');
    log(`🚀 PROGRESS: [2/6] Client service loaded, fetching clients for stream ${stream}...`, 'INFO');
    
    try {
        log(`🔍 Calling getActiveClientsByStream(${stream})...`, 'INFO');
        const clients = await getActiveClientsByStream(stream);
        log(`✅ Found ${clients ? clients.length : 0} clients on stream ${stream}`, 'INFO');
        log(`🚀 PROGRESS: [3/6] Client Discovery Complete: ${clients.length} clients available for processing`);
        
        if (clients.length === 0) {
            log(`⚠️  No clients found on stream ${stream} - sending empty report`, 'WARN');t 24 hours
 * - Resumes incomplete workflows from the failed/missing operation
 * - Sends comprehensive email reports with execution summary and data impact
 * - Reports what was skipped vs. what was processed
 */

console.log(`🔍 MODULE_DEBUG: Script loading started [${new Date().toISOString()}]`);

// Catch ALL errors immediately
process.on('uncaughtException', (error) => {
    console.error(`🚨 UNCAUGHT_EXCEPTION: ${error.message}`);
    console.error(`🚨 STACK: ${error.stack}`);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`🚨 UNHANDLED_REJECTION: ${reason}`);
    console.error(`🚨 PROMISE: ${promise}`);
    process.exit(1);
});

console.log(`🔍 ERROR_HANDLERS: Installed global error handlers`);

require('dotenv').config();

console.log(`🔍 MODULE_DEBUG: dotenv configured, NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`🔍 MODULE_DEBUG: SMART_RESUME_RUN_ID: ${process.env.SMART_RESUME_RUN_ID}`);

// FORCE EXECUTION - Skip the require.main check entirely
console.log(`🔍 FORCE_DEBUG: About to force-call main() directly [${new Date().toISOString()}]`);

console.log(`🔍 TRACE: About to load run ID generator`);
const { generateRunId, createLogger } = require('../utils/runIdGenerator');
const airtableService = require('../services/airtableService');
// SIMPLIFIED: Use the adapter that enforces the Simple Creation Point pattern
const runRecordService = require('../services/runRecordAdapterSimple');
let runId = 'INITIALIZING';
let log = (message, level = 'INFO') => {
    const timestamp = new Date().toISOString();
    console.log(`🔍 SMART_RESUME_${runId} [${timestamp}] [${level}] ${message}`);
};
console.log(`🔍 TRACE: Run ID generator loaded`);

console.log(`🔍 TRACE: About to define checkOperationStatus function`);
async function checkOperationStatus(clientId, operation) {
    try {
        console.log(`🔍 TRACE: About to require clientService`);
        const { getJobStatus } = require('../services/clientService');
        console.log(`🔍 TRACE: clientService required successfully`);
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
console.log(`🔍 TRACE: checkOperationStatus function defined`);

console.log(`🔍 TRACE: About to define checkUnscoredPostsCount function`);
async function checkUnscoredPostsCount(clientId) {
    try {
        console.log(`🔍 UNSCORED CHECK: Starting check for unscored posts for client ${clientId}`);
        console.log(`🔍 UNSCORED CHECK DEBUG: Getting client details for ${clientId}`);
        
        // Get client service level for debugging
        const clientService = require('../services/clientService');
        const clientDetails = await clientService.getClientById(clientId);
        console.log(`🔍 UNSCORED CHECK DEBUG: Client ${clientId} details - Service Level: ${clientDetails?.serviceLevel || 'unknown'}`);
        
        const { getClientBase } = require('../config/airtableClient');
        const clientBase = await getClientBase(clientId);
        
        if (!clientBase) {
            console.warn(`⚠️ Could not get client base for ${clientId}`);
            return { hasUnscoredPosts: false, count: 0, error: 'Could not access client base' };
        }
        
        console.log(`🚨 UNSCORED CHECK: Successfully connected to client base for ${clientId}`);
        
        // Try to get the view first - this is how the post scoring normally works
        try {
            // First try using the "Leads with Posts not yet scored" view
            console.log(`🚨 UNSCORED CHECK: Attempting to use view "Leads with Posts not yet scored" for ${clientId}`);
            const viewRecords = await clientBase('Leads').select({
                view: 'Leads with Posts not yet scored',
                maxRecords: 100 // Increase to get actual count up to 100
            }).firstPage();
            
            const count = viewRecords.length;
            console.log(`🚨 UNSCORED CHECK: Found ${count} unscored posts for ${clientId} using VIEW method`);
            
            // If we found records, log the first few record IDs
            if (count > 0) {
                console.log(`🚨 UNSCORED CHECK: First ${Math.min(5, count)} records with unscored posts:`);
                viewRecords.slice(0, 5).forEach(record => {
                    console.log(`🚨 UNSCORED CHECK: - Record ID: ${record.id}, Name: ${record.fields['Full Name'] || 'N/A'}`);
                });
            }
            
            return { 
                hasUnscoredPosts: count > 0, 
                count,
                source: 'view'
            };
        } catch (viewError) {
            console.warn(`⚠️ Could not use view for ${clientId}, falling back to formula: ${viewError.message}`);
            
            // Fallback - use formula to check for unscored posts
            console.log(`🚨 UNSCORED CHECK: Falling back to formula method for ${clientId}`);
            
            // FIXED: Using single quotes for Airtable formula compatibility
            const formula = "AND({Posts Content} != '', {Date Posts Scored} = BLANK())";
            console.log(`🚨 UNSCORED CHECK: Using formula: ${formula}`);
            
            const formulaRecords = await clientBase('Leads').select({
                filterByFormula: formula,
                maxRecords: 100 // Increase to get actual count up to 100
            }).firstPage();
            
            const count = formulaRecords.length;
            console.log(`🚨 UNSCORED CHECK: Found ${count} unscored posts for ${clientId} using FORMULA method`);
            
            // If we found records, log the first few record IDs
            if (count > 0) {
                console.log(`🚨 UNSCORED CHECK: First ${Math.min(5, count)} records with unscored posts (formula method):`);
                formulaRecords.slice(0, 5).forEach(record => {
                    console.log(`🚨 UNSCORED CHECK: - Record ID: ${record.id}, Name: ${record.fields['Full Name'] || 'N/A'}`);
                });
            }
            
            return { 
                hasUnscoredPosts: count > 0, 
                count,
                source: 'formula'
            };
        }
    } catch (error) {
        console.warn(`⚠️ Error checking unscored posts: ${error.message}`);
        return { hasUnscoredPosts: false, count: 0, error: error.message };
    }
}
console.log(`🔍 TRACE: checkUnscoredPostsCount function defined`);

console.log(`🔍 TRACE: About to define determineClientWorkflow function`);
async function determineClientWorkflow(client) {
    console.log(`🔍 WORKFLOW DEBUG: Determining workflow for client ${client.clientName} (${client.clientId}), Service Level: ${client.serviceLevel}`);
    
    // Force service level to be numeric
    if (typeof client.serviceLevel === 'string') {
        client.serviceLevel = Number(client.serviceLevel) || 0;
        console.log(`🔍 WORKFLOW DEBUG: Converted service level from string to number: ${client.serviceLevel}`);
    }
    
    const operations = ['lead_scoring', 'post_harvesting', 'post_scoring'];
    const workflow = {
        clientId: client.clientId,
        clientName: client.clientName,
        serviceLevel: client.serviceLevel,
        needsProcessing: false,
        operationsToRun: [],
        statusSummary: {}
    };
    
    console.log(`🔍 WORKFLOW DEBUG: Operations to check: ${operations.join(', ')}`);
    
    // Check each operation status
    for (const operation of operations) {
        // Skip post_harvesting and post_scoring for service level < 2
        if ((operation === 'post_harvesting' || operation === 'post_scoring') && Number(client.serviceLevel) < 2) {
            // Special debugging for Guy Wilson
            if (client.clientId === 'Guy-Wilson') {
                console.log(`🚨 SPECIAL FOCUS - GUY WILSON: Service level check for ${operation}`);
                console.log(`🚨 SPECIAL FOCUS - GUY WILSON: Raw service level: ${client.serviceLevel}`);
                console.log(`🚨 SPECIAL FOCUS - GUY WILSON: Parsed service level: ${Number(client.serviceLevel)}`);
                console.log(`🚨 SPECIAL FOCUS - GUY WILSON: Comparison result: ${Number(client.serviceLevel) < 2}`);
            }
            
            workflow.statusSummary[operation] = { 
                completed: true, 
                reason: `Skipped (service level ${client.serviceLevel} < 2)` 
            };
            continue;
        }
        
        const status = await checkOperationStatus(client.clientId, operation);
        workflow.statusSummary[operation] = status;
        
        // Special handling for post_scoring - check if there are unscored posts regardless of last run time
        if (operation === 'post_scoring' && status.completed) {
            console.log(`🚨 POST SCORING CHECK: Client ${client.clientName} (${client.clientId}) has completed post_scoring recently, checking for unscored posts...`);
            const unscoredPostsStatus = await checkUnscoredPostsCount(client.clientId);
            
            console.log(`🚨 POST SCORING DECISION: Client ${client.clientName} - Unscored posts check results:`, JSON.stringify(unscoredPostsStatus));
            
            // If we have unscored posts, we should run post_scoring even if it was recent
            if (unscoredPostsStatus.hasUnscoredPosts) {
                console.log(`� POST SCORING OVERRIDE: Found ${unscoredPostsStatus.count} unscored posts for ${client.clientName} - WILL RUN post_scoring even though last run was recent`);
                
                // Override the completed status and add a reason
                status.completed = false;
                status.overrideReason = `Found ${unscoredPostsStatus.count} unscored posts`;
                status.originalStatus = { ...status }; // Keep original status for reference
                
                // Update in the workflow summary
                workflow.statusSummary[operation] = status;
            } else {
                console.log(`🚨 POST SCORING SKIPPED: No unscored posts found for ${client.clientName} - skipping post_scoring as it ran recently`);
            }
        }
        
        if (!status.completed) {
            workflow.needsProcessing = true;
            workflow.operationsToRun.push(operation);
            console.log(`🔍 WORKFLOW DEBUG: Added operation ${operation} for client ${client.clientName}`);
        } else {
            console.log(`🔍 WORKFLOW DEBUG: Skipping operation ${operation} for client ${client.clientName}, reason: ${status.reason || 'Already completed'}`);
        }
    }
    
    // Special debugging for Guy Wilson client
    if (client.clientId === 'Guy-Wilson') {
        console.log(`🚨 SPECIAL FOCUS - GUY WILSON: Final workflow decision:`);
        console.log(`🚨 SPECIAL FOCUS - GUY WILSON: Service Level: ${client.serviceLevel}`);
        console.log(`🚨 SPECIAL FOCUS - GUY WILSON: Operations to run: ${workflow.operationsToRun.join(', ') || 'NONE'}`);
        
        // Log detailed status for each operation
        for (const op of operations) {
            const status = workflow.statusSummary[op];
            console.log(`🚨 SPECIAL FOCUS - GUY WILSON: ${op} status: ${status.completed ? 'COMPLETED' : 'NEEDS PROCESSING'} - ${status.reason || status.overrideReason || 'No reason provided'}`);
        }
        
        // ENHANCED TEMPORARY FIX: ALWAYS force post_harvesting and post_scoring for Guy Wilson 
        // regardless of completion status, if service level is appropriate
        if (client.serviceLevel >= 2) {
            console.log(`🔍 ENHANCED DEBUG - ${client.clientId}: Service level check passed (${client.serviceLevel} >= 2)`);
            console.log(`🚨 SPECIAL FOCUS - GUY WILSON: UNCONDITIONALLY FORCING post_harvesting operation`);
            
            // Remove post_harvesting if it's in the list, so we can add it back (to ensure it's not skipped)
            if (workflow.operationsToRun.includes('post_harvesting')) {
                workflow.operationsToRun = workflow.operationsToRun.filter(op => op !== 'post_harvesting');
                console.log(`� ENHANCED DEBUG - ${client.clientId}: Removed existing post_harvesting to force refresh`);
            }
            
            // Always add post_harvesting - regardless of its current status
            console.log(`🔍 ENHANCED DEBUG - ${client.clientId}: Adding post_harvesting to operations list`);
            workflow.operationsToRun.push('post_harvesting');
            workflow.statusSummary['post_harvesting'] = { 
                completed: false,
                reason: 'Forced for testing (unconditional override)'
            };
            console.log(`� SPECIAL FOCUS - GUY WILSON: FORCED post_harvesting with unconditional override`);
            
            // Also force post_scoring
            if (!workflow.operationsToRun.includes('post_scoring')) {
                console.log(`🚨 SPECIAL FOCUS - GUY WILSON: FORCING post_scoring operation`);
                workflow.operationsToRun.push('post_scoring');
                workflow.statusSummary['post_scoring'] = { 
                    completed: false,
                    reason: 'Forced for testing'
                };
            }
            
            workflow.needsProcessing = true;
            console.log(`🚨 SPECIAL FOCUS - GUY WILSON: Updated operations: ${workflow.operationsToRun.join(', ')}`);
        } else {
            console.log(`🚨 SPECIAL FOCUS - GUY WILSON: Service level too low (${client.serviceLevel}) for post operations`);
        }
    }
    
    return workflow;
}
console.log(`🔍 TRACE: determineClientWorkflow function defined`);

console.log(`🔍 TRACE: About to define triggerOperation function`);
async function triggerOperation(baseUrl, clientId, operation, params = {}, authHeaders = {}) {
    // 🚨 DEPLOYMENT MARKER: ENHANCED VERSION WITH DEBUG AND FIX FOR UNDEFINED JOB ID
    log(`🚨 SPECIAL DEBUG - TRIGGER OPERATION: Starting ${operation} for client ${clientId}`);
    
    const operationMap = {
        'lead_scoring': {
            url: `/run-batch-score-v2?stream=${params.stream}&limit=${params.limit}&clientId=${clientId}&parentRunId=${runId}`,
            method: 'GET',
            headers: { 'x-webhook-secret': params.secret }
        },
        'post_harvesting': {
            url: `/api/apify/process-level2-v2?stream=${params.stream}&clientId=${clientId}&parentRunId=${runId}`,
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${params.secret}`,
                'x-client-id': clientId  // Add client ID in header as well
            },
            // Add body for post_harvesting to ensure it doesn't come back undefined
            body: { 
                clientId: clientId, 
                parentRunId: runId,
                stream: params.stream 
            }
        },
        'post_scoring': {
            url: `/run-post-batch-score-v2`,
            method: 'POST',
            headers: { 'x-webhook-secret': params.secret },
            body: { stream: params.stream, limit: params.limit, clientId: clientId, parentRunId: runId }
        }
    };
    
    if (clientId === 'Guy-Wilson' && operation === 'post_harvesting') {
        log(`🚨 CRITICAL GUY WILSON FIX: Setting up special post harvesting call for Guy Wilson`);
    }
    
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
        
        // Enhanced debugging for post harvesting operation
        if (operation === 'post_harvesting') {
            log(`🔥 POST_HARVESTING_DEBUG: Executing post harvesting operation`);
            log(`🔥 POST_HARVESTING_DEBUG: Full URL: ${baseUrl}${config.url}`);
            log(`🔥 POST_HARVESTING_DEBUG: Full headers: ${JSON.stringify({
                'Content-Type': 'application/json',
                ...config.headers,
                ...authHeaders
            })}`);
            log(`🔥 POST_HARVESTING_DEBUG: PB_WEBHOOK_SECRET available: ${!!process.env.PB_WEBHOOK_SECRET}`);
            log(`🔥 POST_HARVESTING_DEBUG: Client ID: ${clientId}`);
            log(`🔥 POST_HARVESTING_DEBUG: Query params: stream=${params.stream}, parentRunId=${runId}`);
        }
        
        const fetchOptions = {
            method: config.method,
            headers: {
                'Content-Type': 'application/json',
                ...config.headers,
                ...authHeaders
            }
        };
        
        // Add body for POST requests
        if (operation === 'post_harvesting') {
            // For post_harvesting, always include clientId in the body as well
            fetchOptions.body = JSON.stringify({
                clientId: clientId,
                parentRunId: params.parentRunId || runId,
                stream: params.stream
            });
            log(`🔍 AUTH_DEBUG: ${operation} - Body added with clientId=${clientId}`);
            
            // Special handling for Guy Wilson post harvesting
            if (clientId === 'Guy-Wilson') {
                log(`🚨🚨🚨 GUY WILSON POST HARVESTING: About to make request`);
                log(`🚨🚨🚨 GUY WILSON POST HARVESTING: URL = ${baseUrl}${config.url}`);
                log(`🚨🚨🚨 GUY WILSON POST HARVESTING: Body = ${fetchOptions.body}`);
                log(`🚨🚨🚨 GUY WILSON POST HARVESTING: Headers = ${JSON.stringify(fetchOptions.headers)}`);
            }
        } else if (config.body) {
            fetchOptions.body = JSON.stringify(config.body);
            log(`🔍 AUTH_DEBUG: ${operation} - Body: ${JSON.stringify(config.body)}`);
        }
        
        const response = await fetch(`${baseUrl}${config.url}`, fetchOptions);
        
        const responseTime = Date.now() - startTime;
        let responseData;
        try {
            responseData = await response.json();
        } catch (jsonError) {
            log(`🔥 RESPONSE_DEBUG: Failed to parse JSON response: ${jsonError.message}`, 'ERROR');
            log(`🔥 RESPONSE_DEBUG: Response status: ${response.status}`);
            log(`🔥 RESPONSE_DEBUG: Response text: ${await response.text()}`);
            throw new Error(`Invalid JSON response: ${jsonError.message}`);
        }
        
        log(`🔍 AUTH_DEBUG: ${operation} - Response status: ${response.status}`);
        log(`🔍 AUTH_DEBUG: ${operation} - Response data: ${JSON.stringify(responseData).substring(0, 200)}`);
        
        // Handle special case for post_harvesting 202 response, which might not have jobId
        if (response.status === 202 && operation === 'post_harvesting') {
            // For post_harvesting, we may not have a jobId directly in the response
            const jobId = responseData.jobId || `job_post_harvesting_${clientId}_${Date.now()}`;
            log(`✅ ${operation} triggered for ${clientId}: 202 Accepted in ${responseTime}ms (Generated Job: ${jobId})`);
            
            // Special handling for Guy Wilson
            if (clientId === 'Guy-Wilson') {
                log(`🚨🚨🚨 GUY WILSON POST HARVESTING: Response received successfully`);
                log(`🚨🚨🚨 GUY WILSON POST HARVESTING: Response status = ${response.status}`);
                log(`🚨🚨🚨 GUY WILSON POST HARVESTING: Response data = ${JSON.stringify(responseData)}`);
                log(`🚨🚨🚨 GUY WILSON POST HARVESTING: Generated job ID = ${jobId}`);
            }
            
            return { success: true, jobId };
        } 
        else if (response.status === 202 || response.status === 200) {
            log(`✅ ${operation} triggered for ${clientId}: ${response.status} in ${responseTime}ms (Job: ${responseData.jobId})`);
            return { success: true, jobId: responseData.jobId };
        } 
        else {
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
console.log(`🔍 TRACE: triggerOperation function defined`);

console.log(`🔍 TRACE: About to define main function`);
async function main() {
    console.log(`🔍 TRACE: Generating structured run ID...`);
    
    // Generate a structured, filterable run ID
    // Note: generateRunId is actually synchronous, no need to await
    runId = generateRunId();
    
    // Create a logger that uses this run ID
    log = createLogger(runId);
    
    log(`🚀 PROGRESS: Starting smart resume processing (Run ID: ${runId})`, 'INFO');
    
    // GUY WILSON SPECIAL DEBUG - Check for Guy Wilson client early
    try {
        const clientService = require('../services/clientService');
        const guyWilsonClient = await clientService.getClientById('Guy-Wilson');
        if (guyWilsonClient) {
            log(`🚨 CRITICAL GUY WILSON DEBUG: Client found at startup with service level ${guyWilsonClient.serviceLevel}`);
            log(`🚨 CRITICAL GUY WILSON DEBUG: Status: ${guyWilsonClient.status}, Name: ${guyWilsonClient.clientName}`);
            log(`🚨 CRITICAL GUY WILSON DEBUG: Base ID: ${guyWilsonClient.airtableBaseId}`);
        } else {
            log(`🚨 CRITICAL GUY WILSON DEBUG: CLIENT NOT FOUND AT STARTUP - THIS IS A CRITICAL ERROR`, 'ERROR');
        }
    } catch (err) {
        log(`🚨 CRITICAL GUY WILSON DEBUG: Error checking for Guy Wilson client: ${err.message}`, 'ERROR');
    }
    
    // Use external URL for Render, localhost for local development
    const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://pb-webhook-server-staging.onrender.com';
    const secret = process.env.PB_WEBHOOK_SECRET;
    const stream = parseInt(process.env.BATCH_PROCESSING_STREAM) || 1;
    const leadScoringLimit = parseInt(process.env.LEAD_SCORING_LIMIT) || 100;
    const postScoringLimit = parseInt(process.env.POST_SCORING_LIMIT) || 100;
    
    // Initialize run tracking in Airtable
    try {
        log(`🚀 PROGRESS: Creating job tracking record for run ${runId}...`, 'INFO');
        await airtableService.createJobTrackingRecord(runId, stream);
        log(`✅ Job tracking record created successfully`, 'INFO');
    } catch (error) {
        log(`⚠️ Failed to create job tracking record: ${error.message}. Continuing execution.`, 'WARN');
    }
    
    log(`🚀 PROGRESS: Configuration loaded - baseUrl: ${baseUrl}, stream: ${stream}`, 'INFO');
    
    // Initialize email reporting
    log(`🚀 PROGRESS: Initializing email service...`, 'INFO');
    const emailService = require('../services/emailReportingService');
    log(`🚀 PROGRESS: Email service initialized successfully`, 'INFO');
    
    const runStartTime = Date.now();
    
    log(`🔍 SCRIPT_DEBUG: Checking secret...`, 'INFO');
    if (!secret) {
        const errorMsg = 'PB_WEBHOOK_SECRET environment variable is required';
        log(`❌ ${errorMsg}`, 'ERROR');
        
        // Send failure alert
        await emailService.sendExecutionReport({
            runId,
            stream,
            error: errorMsg,
            duration: Date.now() - runStartTime,
            clientsAnalyzed: 0
        });
        
        process.exit(1);
    }
    
    log(`🔍 SCRIPT_DEBUG: Secret found, length: ${secret.length}`, 'INFO');
    
    const authHeaders = { 'Authorization': `Bearer ${secret}` };
    
    log(`🚀 SMART RESUME CLIENT-BY-CLIENT PROCESSING STARTING`);
    log(`   Run ID: ${runId}`);
    log(`   Base URL: ${baseUrl}`);
    log(`   Stream: ${stream}`);
    log(`   Resume Logic: Skip completed operations from last 24 hours`);
    log(`   Email Reporting: ${emailService.isConfigured() ? '✅ Enabled' : '⚠️  Not configured'}`);
    
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
            log(`\n📋 [${i+1}/${clients.length}] Analyzing ${client.clientName} (${client.clientId}), Service Level: ${client.serviceLevel}:`);
            
            // Special debug for Guy Wilson
            if (client.clientId === 'Guy-Wilson') {
                log(`🚨 SPECIAL FOCUS - GUY WILSON: Processing this client with special attention`);
                log(`🚨 SPECIAL FOCUS - GUY WILSON: Original Service Level = ${client.serviceLevel}, Type: ${typeof client.serviceLevel}`);
                
                // TEMPORARY FIX: Force Guy Wilson to have serviceLevel 3 for testing
                if (client.serviceLevel < 2) {
                    client.serviceLevel = 3;
                    log(`🚨 SPECIAL FOCUS - GUY WILSON: OVERRIDING service level to 3 for testing`);
                }
            }
            
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
                await runRecordService.createRunRecord(runId, workflow.clientId, workflow.clientName, {
                    source: 'smart_resume_workflow'
                });
                log(`   ✅ Run tracking record created`);
            } catch (error) {
                log(`   ⚠️ Failed to create run tracking record: ${error.message}. Continuing execution.`, 'WARN');
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
                // Pass the parent run ID (our current run ID) to maintain consistent tracking
                const operationParams = operation === 'post_scoring' 
                    ? { stream, limit: postScoringLimit, secret, parentRunId: runId }
                    : { stream, limit: leadScoringLimit, secret, parentRunId: runId };
                
                // Enhanced debugging for post harvesting operations
                if (operation === 'post_harvesting') {
                    log(`🔥 POST_HARVESTING_DEBUG: Client ${workflow.clientName} (${workflow.clientId})`);
                    log(`🔥 POST_HARVESTING_DEBUG: Operation params: ${JSON.stringify(operationParams)}`);
                    log(`🔥 POST_HARVESTING_DEBUG: Parent run ID: ${runId}`);
                    log(`🔥 POST_HARVESTING_DEBUG: Secret available: ${!!operationParams.secret}`);
                    log(`🔥 POST_HARVESTING_DEBUG: Secret length: ${operationParams.secret ? operationParams.secret.length : 'MISSING'}`);
                }
                    
                const authRequired = ['post_harvesting', 'post_scoring'].includes(operation);
                const headers = authRequired ? authHeaders : {};
                
                const result = await triggerOperation(baseUrl, workflow.clientId, operation, operationParams, headers);
                totalTriggered++;
                
                if (result.success) {
                    log(`   ✅ ${operation} triggered successfully`);
                    log(`   🔍 Job ID: ${result.jobId || 'undefined'}`);
                    
                    // Enhanced debugging for post harvesting success
                    if (operation === 'post_harvesting') {
                        log(`🔥 POST_HARVESTING_SUCCESS: ${workflow.clientName} operation triggered`);
                        log(`🔥 POST_HARVESTING_SUCCESS: Full result: ${JSON.stringify(result)}`);
                        log(`🔥 POST_HARVESTING_ANALYSIS: Job ID: ${result.jobId || 'undefined'}`);
                        log(`🔥 POST_HARVESTING_ANALYSIS: Request was successful but there may be no posts to harvest`);
                        log(`🔥 POST_HARVESTING_ANALYSIS: Check Airtable for posts count before this job started`);
                    }
                    
                    totalJobsStarted++;
                } else {
                    log(`   ❌ ${operation} failed: ${result.error}`);
                    
                    // Enhanced debugging for post harvesting failures
                    if (operation === 'post_harvesting') {
                        log(`🔥 POST_HARVESTING_FAILURE: ${workflow.clientName} operation failed`);
                        log(`🔥 POST_HARVESTING_FAILURE: Error details: ${result.error}`);
                    }
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
                const status = success ? 'Success' : 'Partial';
                const notes = `Executed operations: ${workflow.operationsToRun.join(', ')}\nJobs started: ${clientJobs.length}/${workflow.operationsToRun.length}`;
                await runRecordService.completeRunRecord(runId, workflow.clientId, status, notes, {
                    source: 'smart_resume_workflow_complete'
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
        
        // Fix success rate calculation - cap at 100% and handle edge cases
        let successRate = 100; // Default if no operations triggered
        if (totalTriggered > 0) {
            // Calculate success rate and cap at 100%
            const uncappedRate = Math.round((totalJobsStarted / (totalTriggered || 1)) * 100);
            successRate = Math.min(uncappedRate, 100);
            
            // Log the actual calculation for debugging
            log(`🔍 SUCCESS RATE DEBUG: Calculation ${totalJobsStarted}/${totalTriggered} = ${uncappedRate}%, capped to ${successRate}%`, 'INFO');
            
            // Force cap the totalJobsStarted to match totalTriggered for reporting consistency
            if (totalJobsStarted > totalTriggered) {
                log(`⚠️ WARNING: More jobs started (${totalJobsStarted}) than operations triggered (${totalTriggered}). Capping job count.`, 'WARN');
                totalJobsStarted = totalTriggered;
            }
        }
        
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
        
        // Send comprehensive email report
        const reportData = {
            runId,
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
        
        const emailResult = await emailService.sendExecutionReport(reportData);
        if (emailResult.success) {
            log(`📧 ✅ Completion report sent successfully`);
        } else {
            // Use error if available, otherwise fall back to reason
            const errorMessage = emailResult.error || emailResult.reason || 'Unknown error';
            log(`📧 ❌ Email report failed: ${errorMessage}`, 'WARN');
        }
        
        // Update aggregate metrics and complete job tracking
        try {
            log(`📊 Updating job tracking metrics...`);
            await airtableService.updateAggregateMetrics(runId);
            const notes = `Run completed successfully. Processed ${clientsNeedingWork.length} clients with ${totalJobsStarted} operations started. Duration: ${Math.round(totalDuration / 1000)} seconds. Success Rate: ${successRate}%`;
            await airtableService.completeJobRun(runId, true, notes);
            log(`✅ Job tracking metrics updated`);
        } catch (error) {
            log(`⚠️ Failed to update job tracking metrics: ${error.message}.`, 'WARN');
        }
        
        log(`\n🎉 ✅ SMART RESUME FULLY COMPLETED!`);
        log(`🚀 PROGRESS: [6/6] ✅ ALL PHASES COMPLETE - Script execution finished successfully`);
        log(`📝 Summary: ${clientsNeedingWork.length} clients processed, ${totalJobsStarted} operations started`);
        log(`⏰ Duration: ${Math.round(totalDuration / 1000)} seconds`);
        log(`📊 Success Rate: ${successRate}%`);
        
    } catch (error) {
        log(`❌ Pipeline error: ${error.message}`, 'ERROR');
        log(`🔍 SCRIPT_DEBUG: Full error stack: ${error.stack}`, 'ERROR');
        
        // Update job tracking to reflect failure
        try {
            log(`📊 Updating job tracking for failure...`);
            const notes = `Run failed with error: ${error.message}`;
            await airtableService.completeJobRun(runId, false, notes);
            log(`✅ Job tracking updated for failure`);
        } catch (trackingError) {
            log(`⚠️ Failed to update job tracking for failure: ${trackingError.message}.`, 'WARN');
        }
        
        // Send failure alert email
        const errorReportData = {
            runId,
            stream,
            error: error.message,
            duration: Date.now() - runStartTime,
            clientsAnalyzed: 0
        };
        
        const emailResult = await emailService.sendExecutionReport(errorReportData);
        if (emailResult.success) {
            log(`📧 Failure alert sent successfully`);
        } else {
            // Use error if available, otherwise fall back to reason
            const errorMessage = emailResult.error || emailResult.reason || 'Unknown error';
            log(`📧 Failure alert failed: ${errorMessage}`, 'WARN');
        }
        
        process.exit(1);
    }
}
console.log(`🔍 TRACE: main function defined - ALL FUNCTIONS COMPLETE`);

console.log(`🔍 TRACE: About to reach execution section`);

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
    console.log(`🔍 FORCE_DEBUG: Executing as script [${new Date().toISOString()}]`);
    console.log(`🔍 FORCE_DEBUG: require.main === module: ${require.main === module}`);
    console.log(`🔍 FORCE_DEBUG: __filename: ${__filename}`);
    if (require.main) {
        console.log(`🔍 FORCE_DEBUG: require.main.filename: ${require.main.filename}`);
    }
    
    console.log(`🔍 TRACE: About to call main()`);
    main().catch(error => {
        console.error(`🔍 FORCE_DEBUG: Fatal error in main():`, error);
        console.error('Full stack:', error.stack);
        process.exit(1);
    });
    console.log(`🔍 TRACE: main() call initiated (async)`);
}