#!/usr/bin/env node
/**
 * Final test with Timestamp field fixed to Text type
 */

const https = require('https');

const RENDER_URL = 'pb-webhook-server-staging.onrender.com';
const AUTH_TOKEN = process.env.PB_WEBHOOK_SECRET;

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: RENDER_URL,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    };
    
    if (body) {
      const postData = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function finalTest() {
  console.log('\n=== FINAL TEST - Timestamp Field Fixed to Text ===\n');
  
  try {
    // Step 1: Trigger new test error
    console.log('Step 1: Triggering NEW test error...');
    const testResp = await makeRequest('/api/test-stacktrace-markers', 'GET');
    console.log(`✅ Test error triggered (status: ${testResp.statusCode})`);
    
    if (testResp.body.timestamp) {
      console.log(`   Timestamp: ${testResp.body.timestamp}`);
    }
    
    // Step 2: Wait for logging
    console.log('\nStep 2: Waiting 5 seconds for Stack Trace to be saved...');
    await new Promise(r => setTimeout(r, 5000));
    
    // Step 3: Run analyzer
    console.log('\nStep 3: Running log analyzer...');
    const analyzeResp = await makeRequest('/api/analyze-logs/recent', 'POST', { minutes: 5 });
    
    if (analyzeResp.statusCode !== 200) {
      console.log(`❌ Analyzer failed: ${analyzeResp.statusCode}`);
      console.log(JSON.stringify(analyzeResp.body, null, 2));
      process.exit(1);
    }
    
    console.log('✅ Analyzer complete!');
    console.log(`   Issues found: ${analyzeResp.body.issues || 0}`);
    console.log(`   New records created: ${analyzeResp.body.createdRecords || 0}`);
    
    // Step 4: Check Production Issues
    console.log('\nStep 4: Checking Production Issues table...');
    const issuesResp = await makeRequest('/api/analyze-issues', 'GET');
    
    if (issuesResp.statusCode !== 200) {
      console.log(`❌ Failed to fetch issues`);
      process.exit(1);
    }
    
    console.log(`✅ Found ${issuesResp.body.total || 0} total issues\n`);
    
    // Look for TEST ERROR with stack trace
    let found = false;
    let hasStackTrace = false;
    
    if (issuesResp.body.topIssues) {
      for (const issue of issuesResp.body.topIssues) {
        if (issue.pattern && issue.pattern.includes('TEST ERROR')) {
          found = true;
          hasStackTrace = issue.hasStackTrace || false;
          
          console.log('🎯 FOUND TEST ERROR!');
          console.log(`   Pattern: ${issue.pattern}`);
          console.log(`   Count: ${issue.count}x`);
          console.log(`   Severity: ${issue.severity}`);
          console.log(`   Stack Trace: ${hasStackTrace ? '✅ POPULATED!' : '❌ EMPTY'}`);
          break;
        }
      }
    }
    
    // Final verdict
    console.log('\n\n=== FINAL VERDICT ===\n');
    
    if (found && hasStackTrace) {
      console.log('🎉🎉🎉 COMPLETE SUCCESS! 🎉🎉🎉\n');
      console.log('✅ Full stack trace system is working:');
      console.log('  1. Error triggers stack trace logging ✅');
      console.log('  2. Stack trace saved to Stack Traces table (with TEXT timestamp) ✅');
      console.log('  3. STACKTRACE marker written to Render logs ✅');
      console.log('  4. Analyzer extracts timestamp from logs ✅');
      console.log('  5. Looks up stack trace by exact timestamp match ✅');
      console.log('  6. Populates Stack Trace field in Production Issues ✅');
      console.log('\n🚀 System is FULLY OPERATIONAL!\n');
      console.log('You can now remove the TEST ERROR pattern from errorPatterns.js');
      process.exit(0);
    } else if (found && !hasStackTrace) {
      console.log('⚠️ PARTIAL - Issue created but Stack Trace still empty\n');
      console.log('Please check:');
      console.log('1. Airtable Stack Traces table - verify timestamp is saved as TEXT');
      console.log('2. Check Render logs for the exact timestamp');
      console.log('3. Manually verify the lookup is working\n');
      process.exit(1);
    } else {
      console.log('⚠️ TEST ERROR not found yet\n');
      console.log('Wait a moment and check manually in Airtable.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

finalTest();
