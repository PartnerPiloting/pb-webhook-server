#!/usr/bin/env node
/**
 * Call the staging server to reconcile errors for a specific runId
 * 
 * Usage: 
 *   node call-reconcile.js "251009-100355" "2025-10-09T20:03:00+10:00"
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
            },
            timeout: 120000 // 2 minutes for log fetching
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
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out after 2 minutes'));
        });
        
        if (body) {
            req.write(JSON.stringify(body));
        }
        
        req.end();
    });
}

async function callReconcile(runId, startTime) {
    console.log('\n' + '='.repeat(70));
    console.log('🔍 TRIGGERING ERROR RECONCILIATION ON STAGING');
    console.log('='.repeat(70));
    
    console.log(`\nRun ID: ${runId}`);
    console.log(`Start Time: ${startTime}`);
    
    console.log('\n📡 Calling /api/reconcile-errors on staging...');
    console.log('⏳ This may take 1-2 minutes (fetching logs from Render)...\n');
    
    const body = { runId, startTime };
    
    try {
        const result = await makeRequest('/api/reconcile-errors', 'POST', body);
        
        console.log('='.repeat(70));
        console.log('📋 RESPONSE:\n');
        
        if (result.data.success) {
            const data = result.data;
            
            console.log(`✅ Reconciliation Complete!`);
            console.log('');
            console.log(`Run ID: ${data.runId}`);
            console.log(`Start Time (UTC): ${data.startTime}`);
            console.log('');
            console.log('📊 RESULTS:');
            console.log(`  Total errors in logs:  ${data.stats.totalInLogs}`);
            console.log(`  Total errors in table: ${data.stats.totalInTable}`);
            console.log(`  ✅ Matched:            ${data.stats.matched}`);
            console.log(`  ❌ In logs NOT table:  ${data.stats.inLogNotInTable}`);
            console.log(`  ⚠️  In table NOT logs:  ${data.stats.inTableNotInLog}`);
            console.log('');
            console.log(`📈 CAPTURE RATE: ${data.stats.captureRate}%`);
            console.log('');
            
            if (data.stats.captureRate >= 95) {
                console.log('✅ EXCELLENT: Phase 1 goal achieved!');
            } else if (data.stats.captureRate >= 80) {
                console.log('⚠️  GOOD: Most errors captured, some missing');
            } else {
                console.log('❌ POOR: Significant errors not being saved');
            }
            
            if (data.stats.inLogNotInTable > 0) {
                console.log('\n❌ ERRORS IN LOGS NOT SAVED TO TABLE:');
                (data.errors.inLogNotInTable || []).forEach((err, idx) => {
                    console.log(`\n  ${idx + 1}. [${err.severity || 'UNKNOWN'}] ${err.patternMatched || 'Unknown'}`);
                    console.log(`     ${(err.errorMessage || err.message || '').substring(0, 120)}...`);
                });
            }
            
            if (data.stats.matched > 0) {
                console.log('\n✅ SAMPLE MATCHED ERRORS:');
                (data.errors.matched || []).slice(0, 3).forEach((match, idx) => {
                    console.log(`\n  ${idx + 1}. ${match.log.patternMatched || match.table.errorType}`);
                    console.log(`     ✓ Match confirmed`);
                });
            }
            
        } else {
            console.log(`❌ Reconciliation Failed`);
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

// Get parameters from command line
const runId = process.argv[2];
const startTime = process.argv[3];

if (!runId || !startTime) {
    console.error('\n❌ Usage: node call-reconcile.js <runId> <startTime>');
    console.error('\nExample:');
    console.error('  node call-reconcile.js "251009-100355" "2025-10-09T20:03:00+10:00"');
    console.error('');
    process.exit(1);
}

callReconcile(runId, startTime);
