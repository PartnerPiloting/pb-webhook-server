#!/usr/bin/env node
/**
 * Test Daily Log Analyzer on Render Staging
 * 
 * This script calls the /api/run-daily-log-analyzer endpoint on staging
 * where all the environment variables are configured.
 * 
 * Usage:
 *   node test-daily-log-analyzer-staging.js [runId]
 * 
 * Examples:
 *   node test-daily-log-analyzer-staging.js              # Auto mode from last checkpoint
 *   node test-daily-log-analyzer-staging.js 251013-100000  # Specific run
 */

const https = require('https');

// Get runId from command line if provided
const runId = process.argv[2];

const postData = runId ? JSON.stringify({ runId }) : '{}';

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  port: 443,
  path: '/api/run-daily-log-analyzer',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'Authorization': `Bearer ${process.env.PB_WEBHOOK_SECRET || 'Diamond9753!!@@pb'}`
  }
};

console.log(`\n🔍 Testing Daily Log Analyzer on Render Staging`);
console.log(`   Mode: ${runId ? `Specific run (${runId})` : 'Auto (from last checkpoint)'}`);
console.log(`   Endpoint: https://${options.hostname}${options.path}\n`);

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Status: ${res.statusCode}\n`);
    
    try {
      const result = JSON.parse(data);
      
      if (result.ok) {
        console.log('✅ SUCCESS');
        console.log(`\n${result.message}\n`);
        
        if (result.summary) {
          console.log('Summary:');
          console.log(`  - Critical: ${result.summary.critical}`);
          console.log(`  - Errors: ${result.summary.error}`);
          console.log(`  - Warnings: ${result.summary.warning}`);
          console.log(`  - Total Issues: ${result.issues}`);
          console.log(`  - Created Records: ${result.createdRecords || 0}`);
        }
        
        if (result.lastLogTimestamp) {
          console.log(`\nLast Analyzed Timestamp: ${result.lastLogTimestamp}`);
        }
        
      } else {
        console.log('❌ FAILED');
        console.log(`\nError: ${result.error}`);
        if (result.stack) {
          console.log(`\nStack Trace:\n${result.stack}`);
        }
      }
      
    } catch (e) {
      console.log('Response (raw):', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
});

req.write(postData);
req.end();
