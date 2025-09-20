#!/usr/bin/env node

/**
 * Simple Client-by-Client Processing Pipeline
 * 
 * For each client in the stream, triggers operations sequentially:
 * 1. Lead Scoring → 2. Post Harvesting → 3. Post Scoring
 * 
 * Does NOT wait for completion - just triggers each operation in sequence.
 * You can monitor progress via Airtable tracking fields.
 */

require('dotenv').config();

async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
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
    
    const runId = `simple_client_by_client_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const authHeaders = { 'Authorization': `Bearer ${secret}` };
    
    log(`🚀 SIMPLE CLIENT-BY-CLIENT PROCESSING STARTING`);
    log(`   Run ID: ${runId}`);
    log(`   Base URL: ${baseUrl}`);
    log(`   Stream: ${stream}`);
    log(`   Lead Scoring Limit: ${leadScoringLimit}`);
    log(`   Post Scoring Limit: ${postScoringLimit}`);
    log(`   Note: Operations triggered sequentially, running in background`);
    
    // Get clients for this stream
    const { getActiveClientsByStream } = require('../services/clientService');
    
    try {
        const clients = await getActiveClientsByStream(stream);
        log(`📊 Found ${clients.length} clients on stream ${stream}`);
        
        if (clients.length === 0) {
            log(`⚠️  No clients found on stream ${stream}`, 'WARN');
            process.exit(0);
        }
        
        let totalTriggered = 0;
        let totalJobsStarted = 0;
        const jobIds = [];
        
        // Process each client individually
        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            log(`\n🎯 PROCESSING CLIENT ${i + 1}/${clients.length}: ${client.clientName} (${client.clientId})`);
            
            const params = { stream, limit: leadScoringLimit };
            const clientJobs = [];
            
            // Step 1: Lead Scoring
            log(`   Step 1/3: Lead Scoring`);
            const leadResult = await triggerOperation(baseUrl, client.clientId, 'lead_scoring', params);
            totalTriggered++;
            if (leadResult.success) {
                totalJobsStarted++;
                clientJobs.push({ operation: 'lead_scoring', jobId: leadResult.jobId });
            }
            
            // Add small delay between operations
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 2: Post Harvesting (only if client is level 2+)
            if (Number(client.serviceLevel) >= 2) {
                log(`   Step 2/3: Post Harvesting`);
                const harvestResult = await triggerOperation(baseUrl, client.clientId, 'post_harvesting', params, authHeaders);
                totalTriggered++;
                if (harvestResult.success) {
                    totalJobsStarted++;
                    clientJobs.push({ operation: 'post_harvesting', jobId: harvestResult.jobId });
                }
            } else {
                log(`   Step 2/3: Post Harvesting - SKIPPED (service level ${client.serviceLevel} < 2)`);
            }
            
            // Add small delay between operations
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 3: Post Scoring
            log(`   Step 3/3: Post Scoring`);
            const postParams = { stream, limit: postScoringLimit };
            const scoreResult = await triggerOperation(baseUrl, client.clientId, 'post_scoring', postParams, authHeaders);
            totalTriggered++;
            if (scoreResult.success) {
                totalJobsStarted++;
                clientJobs.push({ operation: 'post_scoring', jobId: scoreResult.jobId });
            }
            
            jobIds.push({
                clientId: client.clientId,
                clientName: client.clientName,
                jobs: clientJobs
            });
            
            log(`   ✅ ${client.clientName}: ${clientJobs.length} jobs triggered`);
            
            // Add delay between clients
            if (i < clients.length - 1) {
                log(`   ⏳ Waiting 2 seconds before next client...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        log(`\n🎉 CLIENT-BY-CLIENT TRIGGER COMPLETED`);
        log(`   Total Operations Triggered: ${totalTriggered}`);
        log(`   Successful Job Starts: ${totalJobsStarted}`);
        log(`   Success Rate: ${Math.round((totalJobsStarted / totalTriggered) * 100)}%`);
        
        log(`\n📋 JOB SUMMARY:`);
        jobIds.forEach(client => {
            log(`   ${client.clientName}:`);
            client.jobs.forEach(job => {
                log(`     - ${job.operation}: ${job.jobId}`);
            });
        });
        
        log(`\n🔍 MONITORING:`);
        log(`   - All jobs are now running in background`);
        log(`   - Check Airtable Client table for status updates`);
        log(`   - Jobs will complete independently with timeout protection`);
        log(`   - No further action required from this script`);
        
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