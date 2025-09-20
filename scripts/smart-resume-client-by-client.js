#!/usr/bin/env node

/**
 * Smart Resume Client-by-Client Processing Pipeline
 * 
 * Checks each client's last execution status and resumes from where it left off:
 * - Skips clients where all operations completed successfully in last 24 hours
 * - Resumes incomplete workflows from the failed/missing operation
 * - Reports what was skipped vs. what was processed
 */

require('dotenv').config();

async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

async function checkOperationStatus(clientId, operation) {
    try {
        const { getJobStatus } = require('../services/clientService');
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

async function triggerOperation(baseUrl, clientId, operation, params = {}, authHeaders = {}) {
    const operationMap = {
        'lead_scoring': {
            url: `/run-batch-score-v2?stream=${params.stream}&limit=${params.limit}&clientId=${clientId}`,
            method: 'GET'
        },
        'post_harvesting': {
            url: `/api/apify/process-level2-v2?stream=${params.stream}&clientId=${clientId}`,
            method: 'POST'
        },
        'post_scoring': {
            url: `/run-post-batch-score-v2?stream=${params.stream}&limit=${params.limit}&clientId=${clientId}`,
            method: 'POST'
        }
    };
    
    const config = operationMap[operation];
    if (!config) {
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    const startTime = Date.now();
    
    try {
        log(`🎯 Triggering ${operation} for ${clientId}...`);
        
        const response = await fetch(`${baseUrl}${config.url}`, {
            method: config.method,
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders
            }
        });
        
        const responseTime = Date.now() - startTime;
        const responseData = await response.json();
        
        if (response.status === 202) {
            log(`✅ ${operation} triggered for ${clientId}: 202 Accepted in ${responseTime}ms (Job: ${responseData.jobId})`);
            return { success: true, jobId: responseData.jobId };
        } else {
            log(`❌ ${operation} failed for ${clientId}: ${response.status} ${response.statusText}`, 'ERROR');
            return { success: false, error: `${response.status} ${response.statusText}` };
        }
    } catch (error) {
        log(`❌ ${operation} error for ${clientId}: ${error.message}`, 'ERROR');
        return { success: false, error: error.message };
    }
}

async function main() {
    const baseUrl = process.env.API_PUBLIC_BASE_URL || 'http://localhost:3001';
    const secret = process.env.PB_WEBHOOK_SECRET;
    const stream = parseInt(process.env.BATCH_PROCESSING_STREAM) || 1;
    const leadScoringLimit = parseInt(process.env.LEAD_SCORING_LIMIT) || 100;
    const postScoringLimit = parseInt(process.env.POST_SCORING_LIMIT) || 100;
    
    if (!secret) {
        log('❌ PB_WEBHOOK_SECRET environment variable is required', 'ERROR');
        process.exit(1);
    }
    
    const runId = `smart_resume_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const authHeaders = { 'Authorization': `Bearer ${secret}` };
    
    log(`🚀 SMART RESUME CLIENT-BY-CLIENT PROCESSING STARTING`);
    log(`   Run ID: ${runId}`);
    log(`   Base URL: ${baseUrl}`);
    log(`   Stream: ${stream}`);
    log(`   Resume Logic: Skip completed operations from last 24 hours`);
    
    // Get clients for this stream
    const { getActiveClientsByStream } = require('../services/clientService');
    
    try {
        const clients = await getActiveClientsByStream(stream);
        log(`📊 Found ${clients.length} clients on stream ${stream}`);
        
        if (clients.length === 0) {
            log(`⚠️  No clients found on stream ${stream}`, 'WARN');
            process.exit(0);
        }
        
        // Step 1: Analyze what needs to be done
        log(`\n🔍 ANALYZING CLIENT STATUS...`);
        const workflows = [];
        
        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            log(`\n📋 Checking ${client.clientName} (${client.clientId}):`);
            
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
        
        if (clientsNeedingWork.length === 0) {
            log(`\n🎉 ALL CLIENTS UP TO DATE!`);
            log(`   No operations needed - all clients completed recently`);
            log(`   Next scheduled run will check again in 24 hours`);
            return;
        }
        
        log(`\n🚀 EXECUTING NEEDED OPERATIONS...`);
        log(`   Clients needing work: ${clientsNeedingWork.length}/${clients.length}`);
        log(`   Total operations to run: ${clientsNeedingWork.reduce((sum, w) => sum + w.operationsToRun.length, 0)}`);
        
        let totalTriggered = 0;
        let totalJobsStarted = 0;
        const executionResults = [];
        
        for (let i = 0; i < clientsNeedingWork.length; i++) {
            const workflow = clientsNeedingWork[i];
            log(`\n🎯 PROCESSING ${workflow.clientName} (${i + 1}/${clientsNeedingWork.length}):`);
            log(`   Operations needed: ${workflow.operationsToRun.join(', ')}`);
            
            const params = { stream, limit: leadScoringLimit };
            const clientJobs = [];
            
            for (const operation of workflow.operationsToRun) {
                const operationParams = operation === 'post_scoring' 
                    ? { stream, limit: postScoringLimit }
                    : params;
                    
                const authRequired = ['post_harvesting', 'post_scoring'].includes(operation);
                const headers = authRequired ? authHeaders : {};
                
                const result = await triggerOperation(baseUrl, workflow.clientId, operation, operationParams, headers);
                totalTriggered++;
                
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
        
        // Final summary
        log(`\n🎉 SMART RESUME PROCESSING COMPLETED`);
        log(`   Total Operations Triggered: ${totalTriggered}`);
        log(`   Successful Job Starts: ${totalJobsStarted}`);
        log(`   Clients Processed: ${clientsNeedingWork.length}/${clients.length}`);
        log(`   Clients Skipped: ${clients.length - clientsNeedingWork.length} (up to date)`);
        
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
        
    } catch (error) {
        log(`❌ Pipeline error: ${error.message}`, 'ERROR');
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}