#!/usr/bin/env node
/**
 * Trigger log analysis on staging server
 * Usage: node trigger-log-analysis.js [runId or minutes]
 */

require('dotenv').config();
const https = require('https');

const baseUrl = 'https://pb-webhook-server-staging.onrender.com';
const authToken = process.env.PB_WEBHOOK_SECRET;

function makeRequest(endpoint, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, baseUrl);
        
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: body ? 'POST' : 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
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

async function analyzeRecent() {
    const arg = process.argv[2];
    
    let endpoint, body;
    
    if (!arg) {
        // Default: last 10 minutes
        console.log('\n📊 Analyzing last 10 minutes of logs...\n');
        endpoint = '/api/analyze-logs/recent';
        body = { minutes: 10 };
    } else if (arg.match(/^\d{6}-\d{6}$/)) {
        // RunId format (251009-062404)
        console.log(`\n📊 Analyzing logs for runId: ${arg}...\n`);
        endpoint = '/api/analyze-logs/recent';
        body = { runId: arg };
    } else {
        // Minutes
        const minutes = parseInt(arg);
        console.log(`\n📊 Analyzing last ${minutes} minutes of logs...\n`);
        endpoint = '/api/analyze-logs/recent';
        body = { minutes };
    }
    
    try {
        console.log(`🔗 Calling: ${baseUrl}${endpoint}`);
        console.log(`📦 Payload:`, body);
        console.log('\n⏳ Please wait, this may take 30-60 seconds...\n');
        
        const result = await makeRequest(endpoint, body);
        
        console.log('=' .repeat(80));
        console.log('📋 RESPONSE:\n');
        console.log(JSON.stringify(result.data, null, 2));
        console.log('=' .repeat(80));
        
        if (result.data.success) {
            console.log('\n✅ Analysis complete!');
            console.log(`   Issues found: ${result.data.issues}`);
            console.log(`   Records created: ${result.data.createdRecords}`);
            console.log(`   Summary: ${result.data.summary.critical} critical, ${result.data.summary.error} errors, ${result.data.summary.warning} warnings`);
            if (result.data.runId) {
                console.log(`   Run ID: ${result.data.runId}`);
            }
        } else {
            console.log('\n❌ Analysis failed');
            console.log(`   Error: ${result.data.error || result.data.message}`);
        }
        
    } catch (error) {
        console.error('\n❌ Request failed:', error.message);
        process.exit(1);
    }
}

analyzeRecent();
