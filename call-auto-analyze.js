#!/usr/bin/env node
/**
 * Call the staging server to auto-analyze its own latest run
 * This triggers analysis on the server which HAS the Render credentials
 * 
 * Usage: 
 *   node call-auto-analyze.js                    (uses Job Tracking start time)
 *   node call-auto-analyze.js "2025-10-09T06:20:00.000Z"  (uses custom start time)
 */

const https = require('https');

const baseUrl = 'https://pb-webhook-server-staging.onrender.com';

function makeRequest(endpoint, method = 'POST', body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, baseUrl);
        
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        if (body) {
            req.write(JSON.stringify(body));
        }
        
        req.end();
    });
}

async function callAutoAnalyze(customStartTime) {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TRIGGERING AUTO-ANALYZE ON STAGING SERVER');
    console.log('='.repeat(70));
    
    if (customStartTime) {
        console.log(`\n⏰ Using custom start time: ${customStartTime}`);
    }
    
    console.log('\n📡 Calling /api/auto-analyze-latest-run on staging...');
    console.log('⏳ This may take 30-60 seconds...\n');
    
    const body = customStartTime ? { startTime: customStartTime } : null;
    
    try {
        const result = await makeRequest('/api/auto-analyze-latest-run', 'POST', body);
        
        console.log('=' .repeat(70));
        console.log('📋 RESPONSE:\n');
        
        if (result.data.success) {
            const data = result.data;
            
            console.log(`✅ Analysis Complete!`);
            console.log('');
            console.log(`Run Information:`);
            console.log(`  Run ID: ${data.runId}`);
            console.log(`  Status: ${data.status}`);
            console.log(`  Start Time: ${data.startTime}`);
            if (data.endTime) {
                console.log(`  End Time: ${data.endTime}`);
            }
            console.log('');
            console.log(`Flow Analysis:`);
            console.log(`  1. Endpoint called:         ${data.flowChecks.endpointCalled ? '✅' : '❌'}`);
            console.log(`  2. Lock acquired:           ${data.flowChecks.lockAcquired ? '✅' : '❌'}`);
            console.log(`  3. Background started:      ${data.flowChecks.backgroundStarted ? '✅' : '❌'}`);
            console.log(`  4. Script loaded:           ${data.flowChecks.scriptLoaded ? '✅' : '❌'}`);
            console.log(`  5. Script completed:        ${data.flowChecks.scriptCompleted ? '✅' : '❌'}`);
            console.log(`  6. Auto-analysis started:   ${data.flowChecks.autoAnalysisStarted ? '✅' : '❌'}`);
            console.log(`  7. Auto-analysis completed: ${data.flowChecks.autoAnalysisCompleted ? '✅' : '❌'}`);
            console.log('');
            console.log(`Error Analysis:`);
            console.log(`  Total issues: ${data.errorAnalysis.totalIssues}`);
            console.log(`  Critical: ${data.errorAnalysis.summary.critical}`);
            console.log(`  Errors: ${data.errorAnalysis.summary.error}`);
            console.log(`  Warnings: ${data.errorAnalysis.summary.warning}`);
            console.log('');
            console.log(`Diagnosis: ${data.diagnosis}`);
            
            if (data.errorAnalysis.issues && data.errorAnalysis.issues.length > 0) {
                console.log('');
                console.log(`Top Issues:`);
                data.errorAnalysis.issues.slice(0, 3).forEach((issue, idx) => {
                    console.log(`  ${idx + 1}. [${issue.severity}] ${issue.patternMatched}`);
                    console.log(`     ${issue.errorMessage.substring(0, 80)}...`);
                });
            }
            
        } else {
            console.log(`❌ Analysis Failed`);
            console.log(`Error: ${result.data.error || result.data.message}`);
            console.log('');
            console.log('Full response:');
            console.log(JSON.stringify(result.data, null, 2));
        }
        
        console.log('=' .repeat(70) + '\n');
        
    } catch (error) {
        console.error('\n❌ Request failed:', error.message);
        process.exit(1);
    }
}

// Get optional start time from command line argument
const customStartTime = process.argv[2];

callAutoAnalyze(customStartTime);
