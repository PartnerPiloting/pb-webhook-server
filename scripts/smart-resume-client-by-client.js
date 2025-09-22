#!/usr/bin/env node

/**
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

console.log(`🔍 TRACE: About to define log function`);
async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const runId = process.env.SMART_RESUME_RUN_ID || 'UNKNOWN';
    console.log(`🔍 SMART_RESUME_${runId} [${timestamp}] [${level}] ${message}`);
}
console.log(`🔍 TRACE: log function defined`);

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

console.log(`🔍 TRACE: About to define determineClientWorkflow function`);
async function determineClientWorkflow(client) {
    const operations = ['lead_scoring', 'post_harvesting', 'post_scoring'];
    const workflow = {
        clientId: client.clientId,
        clientName: client.clientName,
        serviceLevel: client.serviceLevel,
        needsProcessing: false,
        operationsToRun: [],
        statusSummary: {}
    };
    
    // Check each operation status
    for (const operation of operations) {
        // Skip post_harvesting for service level < 2
        if (operation === 'post_harvesting' && Number(client.serviceLevel) < 2) {
            workflow.statusSummary[operation] = { 
                completed: true, 
                reason: `Skipped (service level ${client.serviceLevel} < 2)` 
            };
            continue;
        }
        
        const status = await checkOperationStatus(client.clientId, operation);
        workflow.statusSummary[operation] = status;
        
        if (!status.completed) {
            workflow.needsProcessing = true;
            workflow.operationsToRun.push(operation);
        }
    }
    
    return workflow;
}
console.log(`🔍 TRACE: determineClientWorkflow function defined`);

console.log(`🔍 TRACE: About to define triggerOperation function`);
async function triggerOperation(baseUrl, clientId, operation, params = {}, authHeaders = {}) {
    const operationMap = {
        'lead_scoring': {
            url: `/run-batch-score-v2?stream=${params.stream}&limit=${params.limit}&clientId=${clientId}`,
            method: 'GET',
            headers: { 'x-webhook-secret': params.secret }
        },
        'post_harvesting': {
            url: `/api/apify/process-level2-v2?stream=${params.stream}&clientId=${clientId}`,
            method: 'POST',
            headers: { 'Authorization': `Bearer ${params.secret}` }
        },
        'post_scoring': {
            url: `/run-post-batch-score-v2`,
            method: 'POST',
            headers: { 'x-webhook-secret': params.secret },
            body: { stream: params.stream, limit: params.limit, clientId: clientId }
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
console.log(`🔍 TRACE: triggerOperation function defined`);

console.log(`🔍 TRACE: About to define main function`);
async function main() {
    log(`� PROGRESS: Starting main function`, 'INFO');
    
    // Use external URL for Render, localhost for local development
    const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://pb-webhook-server-staging.onrender.com';
    const secret = process.env.PB_WEBHOOK_SECRET;
    const stream = parseInt(process.env.BATCH_PROCESSING_STREAM) || 1;
    const leadScoringLimit = parseInt(process.env.LEAD_SCORING_LIMIT) || 100;
    const postScoringLimit = parseInt(process.env.POST_SCORING_LIMIT) || 100;
    
    log(`� PROGRESS: Configuration loaded - baseUrl: ${baseUrl}, stream: ${stream}`, 'INFO');
    
    // Initialize email reporting
    log(`� PROGRESS: Initializing email service...`, 'INFO');
    const emailService = require('../services/emailReportingService');
    log(`� PROGRESS: Email service initialized successfully`, 'INFO');
    
    const runStartTime = Date.now();
    const runId = `smart_resume_${runStartTime}_${Math.random().toString(36).substr(2, 5)}`;
    
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
            
            const params = { stream, limit: leadScoringLimit };
            const clientJobs = [];
            
            for (let opIndex = 0; opIndex < workflow.operationsToRun.length; opIndex++) {
                const operation = workflow.operationsToRun[opIndex];
                log(`   🚀 Starting operation [${opIndex + 1}/${workflow.operationsToRun.length}] ${operation}...`);
                const operationParams = operation === 'post_scoring' 
                    ? { stream, limit: postScoringLimit, secret }
                    : { stream, limit: leadScoringLimit, secret };
                    
                const authRequired = ['post_harvesting', 'post_scoring'].includes(operation);
                const headers = authRequired ? authHeaders : {};
                
                const result = await triggerOperation(baseUrl, workflow.clientId, operation, operationParams, headers);
                totalTriggered++;
                
                if (result.success) {
                    log(`   ✅ ${operation} triggered successfully`);
                    totalJobsStarted++;
                } else {
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
        if (emailResult.sent) {
            log(`📧 ✅ Completion report sent successfully`);
        } else {
            log(`📧 ❌ Email report failed: ${emailResult.reason}`, 'WARN');
        }
        
        log(`\n🎉 ✅ SMART RESUME FULLY COMPLETED!`);
        log(`🚀 PROGRESS: [6/6] ✅ ALL PHASES COMPLETE - Script execution finished successfully`);
        log(`📝 Summary: ${clientsNeedingWork.length} clients processed, ${totalJobsStarted} operations started`);
        log(`⏰ Duration: ${Math.round(totalDuration / 1000)} seconds`);
        log(`📊 Success Rate: ${successRate}%`);
        
    } catch (error) {
        log(`❌ Pipeline error: ${error.message}`, 'ERROR');
        log(`🔍 SCRIPT_DEBUG: Full error stack: ${error.stack}`, 'ERROR');
        
        // Send failure alert email
        const errorReportData = {
            runId,
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
console.log(`🔍 TRACE: main function defined - ALL FUNCTIONS COMPLETE`);

console.log(`🔍 TRACE: About to reach execution section`);
// FORCE EXECUTION - Always run main() regardless of how script is called
console.log(`🔍 FORCE_DEBUG: Forcing main() execution [${new Date().toISOString()}]`);
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