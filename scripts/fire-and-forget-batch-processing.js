#!/usr/bin/env node

/**
 * Fire-and-Forget Batch Processing Pipeline
 * 
 * Executes the complete batch processing pipeline for all clients:
 * 1. Lead Scoring (profile analysis)
 * 2. Post Harvesting (LinkedIn post collection) 
 * 3. Post Scoring (post content analysis)
 * 
 * Each stage uses fire-and-forget endpoints that return 202 Accepted immediately,
 * then process in background with timeout protection.
 */

require('dotenv').config();

const PIPELINE_VERSION = '1.0.0';
const MAX_STAGE_WAIT_SECONDS = 30; // Max time to wait for 202 response per stage

async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

async function executeStage(stageName, url, method = 'GET', headers = {}) {
    const startTime = Date.now();
    
    try {
        log(`Starting ${stageName}...`);
        log(`Request: ${method} ${url}`);
        
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
        
        if (response.status === 202) {
            log(`✅ ${stageName} SUCCESS: 202 Accepted in ${responseTime}ms`);
            log(`   Job ID: ${responseData.jobId || 'N/A'}`);
            log(`   Stream: ${responseData.stream || 'N/A'}`);
            log(`   Background processing initiated`);
            return { success: true, jobId: responseData.jobId, responseTime };
        } else {
            log(`❌ ${stageName} FAILED: Status ${response.status} in ${responseTime}ms`, 'ERROR');
            log(`   Response: ${JSON.stringify(responseData, null, 2)}`, 'ERROR');
            return { success: false, status: response.status, error: responseData, responseTime };
        }
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        log(`❌ ${stageName} ERROR: ${error.message} (${responseTime}ms)`, 'ERROR');
        return { success: false, error: error.message, responseTime };
    }
}

async function main() {
    const pipelineStartTime = Date.now();
    const runId = `pipeline_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    
    log(`🚀 FIRE-AND-FORGET BATCH PROCESSING PIPELINE STARTING`);
    log(`   Version: ${PIPELINE_VERSION}`);
    log(`   Run ID: ${runId}`);
    log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Get configuration
    const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
    const secret = process.env.PB_WEBHOOK_SECRET;
    
    // Configurable parameters via environment variables
    const stream = parseInt(process.env.BATCH_PROCESSING_STREAM) || 1;
    const leadScoringLimit = parseInt(process.env.LEAD_SCORING_LIMIT) || 500;
    const postScoringLimit = parseInt(process.env.POST_SCORING_LIMIT) || 500;
    
    if (!baseUrl) {
        log('❌ FATAL: API_PUBLIC_BASE_URL or NEXT_PUBLIC_API_BASE_URL required', 'ERROR');
        process.exit(1);
    }
    
    if (!secret) {
        log('❌ FATAL: PB_WEBHOOK_SECRET required', 'ERROR');
        process.exit(1);
    }
    
    log(`   Base URL: ${baseUrl}`);
    log(`   Secret: ${secret ? '[CONFIGURED]' : '[MISSING]'}`);
    log(`   Stream: ${stream}`);
    log(`   Lead Scoring Limit: ${leadScoringLimit}`);
    log(`   Post Scoring Limit: ${postScoringLimit}`);
    
    const results = {
        leadScoring: null,
        postHarvesting: null,
        postScoring: null
    };
    
    const authHeaders = { 'Authorization': `Bearer ${secret}` };
    
    // Stage 1: Lead Scoring
    log(`\n📊 STAGE 1: LEAD SCORING`);
    log(`   Purpose: AI analysis of lead profiles for all active clients`);
    results.leadScoring = await executeStage(
        'Lead Scoring',
        `${baseUrl}/run-batch-score-v2?stream=${stream}&limit=${leadScoringLimit}`,
        'GET'
    );
    
    if (!results.leadScoring.success) {
        log(`❌ Pipeline aborted: Lead Scoring failed`, 'ERROR');
        process.exit(1);
    }
    
    // Stage 2: Post Harvesting  
    log(`\n🔍 STAGE 2: POST HARVESTING`);
    log(`   Purpose: LinkedIn post collection via Apify for level 2+ clients`);
    results.postHarvesting = await executeStage(
        'Post Harvesting',
        `${baseUrl}/api/apify/process-level2-v2?stream=${stream}`,
        'POST',
        authHeaders
    );
    
    if (!results.postHarvesting.success) {
        log(`❌ Pipeline aborted: Post Harvesting failed`, 'ERROR');
        process.exit(1);
    }
    
    // Stage 3: Post Scoring
    log(`\n🎯 STAGE 3: POST SCORING`);
    log(`   Purpose: AI analysis of harvested posts for engagement opportunities`);
    results.postScoring = await executeStage(
        'Post Scoring',
        `${baseUrl}/run-post-batch-score-v2?stream=${stream}&limit=${postScoringLimit}`,
        'POST',
        authHeaders
    );
    
    if (!results.postScoring.success) {
        log(`❌ Pipeline aborted: Post Scoring failed`, 'ERROR');
        process.exit(1);
    }
    
    // Pipeline Summary
    const totalTime = Date.now() - pipelineStartTime;
    log(`\n🎉 FIRE-AND-FORGET BATCH PROCESSING PIPELINE COMPLETED`);
    log(`   Run ID: ${runId}`);
    log(`   Total Time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);
    log(`   All stages returned 202 Accepted - background processing initiated`);
    
    log(`\n📋 EXECUTION SUMMARY:`);
    log(`   ✅ Lead Scoring: ${results.leadScoring.jobId} (${results.leadScoring.responseTime}ms)`);
    log(`   ✅ Post Harvesting: ${results.postHarvesting.jobId} (${results.postHarvesting.responseTime}ms)`);
    log(`   ✅ Post Scoring: ${results.postScoring.jobId} (${results.postScoring.responseTime}ms)`);
    
    log(`\n🔍 MONITORING:`);
    log(`   - Check Airtable Client table for job status updates`);
    log(`   - Monitor server logs for background processing progress`);
    log(`   - Job tracking fields will show STARTED → RUNNING → COMPLETED`);
    
    log(`\n✨ Pipeline trigger completed successfully. Background processing in progress.`);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    log(`❌ UNCAUGHT EXCEPTION: ${error.message}`, 'ERROR');
    log(`Stack: ${error.stack}`, 'ERROR');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`❌ UNHANDLED REJECTION: ${reason}`, 'ERROR');
    process.exit(1);
});

// Run the pipeline
main().catch((error) => {
    log(`❌ PIPELINE FAILED: ${error.message}`, 'ERROR');
    process.exit(1);
});