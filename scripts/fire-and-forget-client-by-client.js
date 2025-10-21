#!/usr/bin/env node

/**
 * Client-by-Client Fire-and-Forget Processing Pipeline
 * 
 * For each client in the stream, executes:
 * 1. Lead Scoring → 2. Post Harvesting → 3. Post Scoring
 * 
 * Only moves to next client after completing all 3 operations for current client.
 */

require('dotenv').config();

async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

async function waitForJobCompletion(baseUrl, operation, clientId, jobId, maxWaitMinutes = 30) {
    const maxWaitMs = maxWaitMinutes * 60 * 1000;
    const pollIntervalMs = 10000; // 10 seconds
    const startTime = Date.now();
    
    log(`⏳ Waiting for ${operation} completion for ${clientId} (job: ${jobId})`);
    
    while (Date.now() - startTime < maxWaitMs) {
        try {
            const response = await fetch(`${baseUrl}/debug-job-status/${clientId}/${operation}`);
            const data = await response.json();
            
            if (data.status === 'COMPLETED') {
                log(`✅ ${operation} completed for ${clientId}`);
                return true;
            } else if (data.status === 'FAILED' || data.status === 'CLIENT_TIMEOUT_KILLED' || data.status === 'JOB_TIMEOUT_KILLED') {
                log(`❌ ${operation} failed for ${clientId}: ${data.status}`, 'ERROR');
                return false;
            } else {
                log(`🔄 ${operation} still ${data.status} for ${clientId}...`);
            }
        } catch (error) {
            log(`⚠️  Error checking job status: ${error.message}`, 'WARN');
        }
        
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    log(`⏰ Timeout waiting for ${operation} completion for ${clientId}`, 'ERROR');
    return false;
}

async function processClientOperation(baseUrl, clientId, operation, params = {}, authHeaders = {}) {
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
        log(`🎯 Starting ${operation} for ${clientId}...`);
        
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
            log(`✅ ${operation} started for ${clientId}: 202 Accepted in ${responseTime}ms`);
            log(`   Job ID: ${responseData.jobId}`);
            
            // Wait for completion
            const success = await waitForJobCompletion(baseUrl, operation, clientId, responseData.jobId);
            return { success, jobId: responseData.jobId };
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
    
    const runId = `client_by_client_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const authHeaders = { 'Authorization': `Bearer ${secret}` };
    
    log(`🚀 CLIENT-BY-CLIENT PROCESSING PIPELINE STARTING`);
    log(`   Run ID: ${runId}`);
    log(`   Base URL: ${baseUrl}`);
    log(`   Stream: ${stream}`);
    log(`   Lead Scoring Limit: ${leadScoringLimit}`);
    log(`   Post Scoring Limit: ${postScoringLimit}`);
    
    // Get clients for this stream
    const { getActiveClientsByStream } = require('../services/clientService');
    
    try {
        const clients = await getActiveClientsByStream(stream);
        log(`📊 Found ${clients.length} clients on stream ${stream}`);
        
        if (clients.length === 0) {
            log(`⚠️  No clients found on stream ${stream}`, 'WARN');
            process.exit(0);
        }
        
        let totalProcessed = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        
        // Process each client individually
        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            log(`\n🎯 PROCESSING CLIENT ${i + 1}/${clients.length}: ${client.clientName} (${client.clientId})`);
            
            let clientSuccess = true;
            const params = { stream, limit: leadScoringLimit };
            
            // Step 1: Lead Scoring
            log(`   Step 1/3: Lead Scoring`);
            const leadResult = await processClientOperation(baseUrl, client.clientId, 'lead_scoring', params);
            if (!leadResult.success) {
                log(`   ❌ Skipping remaining steps for ${client.clientName}`, 'ERROR');
                clientSuccess = false;
            }
            
            // Step 2: Post Harvesting (only if client is level 2+)
            if (clientSuccess && Number(client.serviceLevel) >= 2) {
                log(`   Step 2/3: Post Harvesting`);
                const harvestResult = await processClientOperation(baseUrl, client.clientId, 'post_harvesting', params, authHeaders);
                if (!harvestResult.success) {
                    log(`   ❌ Skipping post scoring for ${client.clientName}`, 'ERROR');
                    clientSuccess = false;
                }
            } else if (clientSuccess) {
                log(`   Step 2/3: Post Harvesting - SKIPPED (service level ${client.serviceLevel} < 2)`);
            }
            
            // Step 3: Post Scoring
            if (clientSuccess) {
                log(`   Step 3/3: Post Scoring`);
                const postParams = { stream, limit: postScoringLimit };
                const scoreResult = await processClientOperation(baseUrl, client.clientId, 'post_scoring', postParams, authHeaders);
                if (!scoreResult.success) {
                    clientSuccess = false;
                }
            }
            
            totalProcessed++;
            if (clientSuccess) {
                totalSuccessful++;
                log(`   ✅ ${client.clientName} completed successfully`);
            } else {
                totalFailed++;
                log(`   ❌ ${client.clientName} failed`);
            }
        }
        
        log(`\n🎉 CLIENT-BY-CLIENT PROCESSING COMPLETED`);
        log(`   Total Clients: ${totalProcessed}`);
        log(`   Successful: ${totalSuccessful}`);
        log(`   Failed: ${totalFailed}`);
        log(`   Success Rate: ${Math.round((totalSuccessful / totalProcessed) * 100)}%`);
        
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