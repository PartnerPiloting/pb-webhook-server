#!/usr/bin/env node

/**
 * Client-by-Client Batch Processing Pipeline
 * 
 * For each client in the specified stream:
 * 1. Lead Scoring (profile analysis)
 * 2. Post Harvesting (LinkedIn post collection) 
 * 3. Post Scoring (post content analysis)
 * 
 * Only moves to next client after completing all 3 operations for current client.
 * Uses fire-and-forget endpoints with status polling for completion.
 */

require('dotenv').config();

const PIPELINE_VERSION = '2.0.0';
const MAX_POLL_ATTEMPTS = 60; // Max polling attempts per operation (10 minutes at 10s intervals)
const POLL_INTERVAL_MS = 10000; // 10 seconds between status checks

async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

/**
 * Execute a fire-and-forget operation and wait for completion
 */
async function executeAndWait(operationName, url, method = 'GET', headers = {}, clientName = '') {
    const startTime = Date.now();
    
    try {
        log(`🚀 Starting ${operationName} for ${clientName}...`);
        
        // Step 1: Trigger the fire-and-forget operation
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        });
        
        const responseTime = Date.now() - startTime;
        const responseText = await response.text();
        
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            responseData = { raw: responseText };
        }
        
        if (response.status !== 202) {
            log(`❌ ${operationName} failed to start: ${response.status} ${response.statusText}`, 'ERROR');
            log(`Response: ${responseText}`, 'ERROR');
            return { success: false, error: `HTTP ${response.status}`, responseTime };
        }
        
        const jobId = responseData.jobId;
        log(`✅ ${operationName} started successfully (${responseTime}ms)`);
        log(`   Job ID: ${jobId}`);
        
        // Step 2: Poll for completion
        log(`⏳ Waiting for ${operationName} to complete...`);
        
        for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            
            try {
                // Check job status via debug endpoint
                const statusUrl = `${process.env.API_PUBLIC_BASE_URL}/debug-job-status?jobId=${jobId}`;
                const statusResponse = await fetch(statusUrl);
                
                if (statusResponse.ok) {
                    const statusData = await statusResponse.json();
                    const status = statusData.status;
                    
                    log(`   Poll ${attempt}/${MAX_POLL_ATTEMPTS}: ${status}`);
                    
                    if (status === 'COMPLETED') {
                        const totalTime = Date.now() - startTime;
                        log(`✅ ${operationName} completed successfully (${Math.round(totalTime/1000)}s total)`);
                        return { 
                            success: true, 
                            jobId, 
                            totalTime,
                            attempts: attempt 
                        };
                    }
                    
                    if (status === 'FAILED' || status === 'TIMEOUT_KILLED' || status === 'JOB_TIMEOUT_KILLED') {
                        log(`❌ ${operationName} failed with status: ${status}`, 'ERROR');
                        return { 
                            success: false, 
                            error: status, 
                            jobId,
                            totalTime: Date.now() - startTime,
                            attempts: attempt 
                        };
                    }
                    
                    // Status is STARTED, RUNNING, or similar - continue polling
                } else {
                    log(`   Poll ${attempt}/${MAX_POLL_ATTEMPTS}: Status check failed (${statusResponse.status})`);
                }
                
            } catch (pollError) {
                log(`   Poll ${attempt}/${MAX_POLL_ATTEMPTS}: Error checking status - ${pollError.message}`);
            }
        }
        
        // Polling timeout
        log(`⏰ ${operationName} polling timeout after ${MAX_POLL_ATTEMPTS} attempts`, 'ERROR');
        return { 
            success: false, 
            error: 'POLLING_TIMEOUT', 
            jobId,
            totalTime: Date.now() - startTime,
            attempts: MAX_POLL_ATTEMPTS 
        };
        
    } catch (error) {
        log(`❌ ${operationName} error: ${error.message}`, 'ERROR');
        return { 
            success: false, 
            error: error.message, 
            totalTime: Date.now() - startTime 
        };
    }
}

/**
 * Process a single client through all three operations
 */
async function processClient(client, stream, leadScoringLimit, postScoringLimit, authHeaders, baseUrl) {
    const clientName = client.clientName;
    const clientId = client.clientId;
    const serviceLevel = Number(client.serviceLevel) || 0;
    
    log(`\n👤 PROCESSING CLIENT: ${clientName} (Service Level: ${serviceLevel})`);
    
    const results = {
        leadScoring: null,
        postHarvesting: null,
        postScoring: null,
        clientName,
        clientId,
        serviceLevel
    };
    
    // Operation 1: Lead Scoring
    log(`\n📊 STEP 1: Lead Scoring for ${clientName}`);
    results.leadScoring = await executeAndWait(
        'Lead Scoring',
        `${baseUrl}/run-batch-score-v2?stream=${stream}&limit=${leadScoringLimit}&clientId=${clientId}`,
        'GET',
        {},
        clientName
    );
    
    if (!results.leadScoring.success) {
        log(`❌ Skipping remaining operations for ${clientName} due to Lead Scoring failure`, 'ERROR');
        return results;
    }
    
    // Operation 2: Post Harvesting (only for service level 2+)
    if (serviceLevel >= 2) {
        log(`\n🔍 STEP 2: Post Harvesting for ${clientName}`);
        results.postHarvesting = await executeAndWait(
            'Post Harvesting',
            `${baseUrl}/api/apify/process-level2-v2?stream=${stream}&clientId=${clientId}`,
            'POST',
            authHeaders,
            clientName
        );
        
        if (!results.postHarvesting.success) {
            log(`❌ Skipping Post Scoring for ${clientName} due to Post Harvesting failure`, 'ERROR');
            return results;
        }
    } else {
        log(`\n⏭️  STEP 2: Skipping Post Harvesting for ${clientName} (Service Level ${serviceLevel} < 2)`);
        results.postHarvesting = { success: true, skipped: true, reason: 'Service level < 2' };
    }
    
    // Operation 3: Post Scoring  
    log(`\n🎯 STEP 3: Post Scoring for ${clientName}`);
    results.postScoring = await executeAndWait(
        'Post Scoring',
        `${baseUrl}/run-post-batch-score-v2?stream=${stream}&limit=${postScoringLimit}&clientId=${clientId}`,
        'POST',
        authHeaders,
        clientName
    );
    
    if (results.postScoring.success) {
        log(`✅ All operations completed successfully for ${clientName}!`);
    } else {
        log(`❌ Post Scoring failed for ${clientName}`, 'ERROR');
    }
    
    return results;
}

/**
 * Main pipeline execution
 */
async function main() {
    const startTime = Date.now();
    
    // Get configuration from environment
    const baseUrl = process.env.API_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const secret = process.env.PB_WEBHOOK_SECRET;
    const stream = parseInt(process.env.BATCH_PROCESSING_STREAM) || 1;
    const leadScoringLimit = parseInt(process.env.LEAD_SCORING_LIMIT) || 100;
    const postScoringLimit = parseInt(process.env.POST_SCORING_LIMIT) || 100;
    
    if (!secret) {
        log('❌ PB_WEBHOOK_SECRET environment variable is required', 'ERROR');
        process.exit(1);
    }
    
    const runId = `client_pipeline_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    log(`🚀 CLIENT-BY-CLIENT BATCH PROCESSING PIPELINE STARTING`);
    log(`   Version: ${PIPELINE_VERSION}`);
    log(`   Run ID: ${runId}`);
    log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    log(`   Base URL: ${baseUrl}`);
    log(`   Secret: [CONFIGURED]`);
    log(`   Stream: ${stream}`);
    log(`   Lead Scoring Limit: ${leadScoringLimit}`);
    log(`   Post Scoring Limit: ${postScoringLimit}`);
    log(`   Poll Interval: ${POLL_INTERVAL_MS/1000}s`);
    log(`   Max Poll Time: ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS)/1000/60} minutes per operation`);
    
    const authHeaders = { 'Authorization': `Bearer ${secret}` };
    
    // Get clients for this stream
    try {
        log(`\n🔍 Getting clients for stream ${stream}...`);
        
        const { getActiveClientsByStream } = require('../services/clientService');
        const clients = await getActiveClientsByStream(stream);
        
        if (clients.length === 0) {
            log(`⚠️  No clients found for stream ${stream}`, 'WARN');
            log(`✨ Pipeline completed - nothing to process.`);
            return;
        }
        
        log(`📊 Found ${clients.length} clients to process on stream ${stream}:`);
        clients.forEach((client, index) => {
            log(`   ${index + 1}. ${client.clientName} (Service Level: ${client.serviceLevel || 'Unknown'})`);
        });
        
        // Process each client sequentially
        const allResults = [];
        let successCount = 0;
        let failureCount = 0;
        
        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            
            log(`\n${'='.repeat(80)}`);
            log(`📋 PROCESSING CLIENT ${i + 1}/${clients.length}`);
            log(`${'='.repeat(80)}`);
            
            const clientResults = await processClient(
                client, 
                stream, 
                leadScoringLimit, 
                postScoringLimit, 
                authHeaders, 
                baseUrl
            );
            
            allResults.push(clientResults);
            
            // Check if all operations succeeded for this client
            const clientSuccess = clientResults.leadScoring?.success && 
                                 (clientResults.postHarvesting?.success || clientResults.postHarvesting?.skipped) && 
                                 clientResults.postScoring?.success;
            
            if (clientSuccess) {
                successCount++;
                log(`✅ Client ${client.clientName} completed successfully`);
            } else {
                failureCount++;
                log(`❌ Client ${client.clientName} had failures`);
            }
        }
        
        // Final summary
        const totalTime = Date.now() - startTime;
        
        log(`\n${'='.repeat(80)}`);
        log(`🎉 CLIENT-BY-CLIENT PIPELINE COMPLETED`);
        log(`${'='.repeat(80)}`);
        log(`   Run ID: ${runId}`);
        log(`   Total Time: ${Math.round(totalTime/1000)}s (${Math.round(totalTime/1000/60)} minutes)`);
        log(`   Clients Processed: ${clients.length}`);
        log(`   Successful: ${successCount}`);
        log(`   Failed: ${failureCount}`);
        
        log(`\n📋 DETAILED RESULTS:`);
        allResults.forEach((result, index) => {
            const leadStatus = result.leadScoring?.success ? '✅' : '❌';
            const harvestStatus = result.postHarvesting?.success ? '✅' : result.postHarvesting?.skipped ? '⏭️' : '❌';
            const scoreStatus = result.postScoring?.success ? '✅' : '❌';
            
            log(`   ${index + 1}. ${result.clientName}: ${leadStatus} Lead | ${harvestStatus} Harvest | ${scoreStatus} Score`);
        });
        
        log(`\n✨ Client-by-client pipeline completed successfully.`);
        
    } catch (error) {
        log(`❌ Pipeline error: ${error.message}`, 'ERROR');
        console.error(error);
        process.exit(1);
    }
}

// Run the pipeline
if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled pipeline error:', error);
        process.exit(1);
    });
}

module.exports = { main, processClient, executeAndWait };