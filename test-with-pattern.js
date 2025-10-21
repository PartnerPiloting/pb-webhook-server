#!/usr/bin/env node
/**
 * Complete test with TEST ERROR pattern enabled
 * This will verify the full stack trace flow
 */

const https = require('https');

const RENDER_URL = 'pb-webhook-server-staging.onrender.com';
const AUTH_TOKEN = 'Diamond9753!!@@pb';

function makeRequest(path, method = 'POST', body = null) {
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

async function fullTest() {
  console.log('\n=== Complete Stack Trace Flow Test ===\n');
  console.log('Waiting for deployment...\n');
  
  // Wait for deployment
  const maxAttempts = 12;
  let deployed = false;
  
  for (let i = 1; i <= maxAttempts && !deployed; i++) {
    console.log(`Attempt ${i}/${maxAttempts}: Checking deployment...`);
    
    try {
      const healthCheck = await makeRequest('/health', 'GET');
      if (healthCheck.statusCode === 200) {
        // Wait a bit more to ensure new code is loaded
        console.log('  ✅ Service is up');
        console.log('  Waiting 10 more seconds for code to reload...\n');
        await new Promise(r => setTimeout(r, 10000));
        deployed = true;
      }
    } catch (e) {
      console.log('  ⏳ Not ready yet');
    }
    
    if (!deployed && i < maxAttempts) {
      await new Promise(r => setTimeout(r, 15000));
    }
  }
  
  if (!deployed) {
    console.log('❌ Timeout waiting for deployment');
    process.exit(1);
  }
  
  try {
    // Step 1: Trigger new test error
    console.log('Step 1: Triggering new test error with TEST ERROR pattern...');
    const testResp = await makeRequest('/api/test-stacktrace-markers', 'GET');
    console.log(`✅ Test error triggered (status: ${testResp.statusCode})\n`);
    
    // Step 2: Wait for logging
    console.log('Step 2: Waiting 5 seconds for logs to be captured...');
    await new Promise(r => setTimeout(r, 5000));
    
    // Step 3: Run analyzer
    console.log('\nStep 3: Running log analyzer on recent logs...');
    const analyzeResp = await makeRequest('/api/analyze-logs/recent', 'POST', { minutes: 10 });
    
    if (analyzeResp.statusCode !== 200) {
      console.log(`❌ Analyzer failed: ${analyzeResp.statusCode}`);
      console.log(JSON.stringify(analyzeResp.body, null, 2));
      process.exit(1);
    }
    
    console.log('✅ Analyzer complete!\n');
    console.log('Results:');
    console.log(`  - Issues found: ${analyzeResp.body.issues || 0}`);
    console.log(`  - New records created: ${analyzeResp.body.createdRecords || 0}`);
    console.log(`  - CRITICAL: ${analyzeResp.body.summary?.critical || 0}`);
    console.log(`  - ERROR: ${analyzeResp.body.summary?.error || 0}`);
    console.log(`  - WARNING: ${analyzeResp.body.summary?.warning || 0}`);
    
    if (analyzeResp.body.createdRecords > 0) {
      console.log('\n✅ Production Issue records created!');
    }
    
    // Step 4: Check Production Issues table
    console.log('\n\nStep 4: Checking Production Issues table for stack traces...');
    const issuesResp = await makeRequest('/api/analyze-issues', 'GET');
    
    if (issuesResp.statusCode !== 200) {
      console.log(`❌ Failed to fetch issues`);
      process.exit(1);
    }
    
    console.log(`✅ Found ${issuesResp.body.total || 0} total issues\n`);
    
    // Look for TEST ERROR with stack trace
    let testErrorFound = false;
    let testErrorHasStackTrace = false;
    
    if (issuesResp.body.topIssues) {
      console.log('Searching for TEST ERROR issue...\n');
      
      for (const issue of issuesResp.body.topIssues) {
        if (issue.pattern && issue.pattern.includes('TEST ERROR')) {
          testErrorFound = true;
          testErrorHasStackTrace = issue.hasStackTrace || false;
          
          console.log('🎯 FOUND TEST ERROR ISSUE!');
          console.log(`   Pattern: ${issue.pattern}`);
          console.log(`   Count: ${issue.count}x`);
          console.log(`   Severity: ${issue.severity}`);
          console.log(`   Stack Trace: ${testErrorHasStackTrace ? '✅ POPULATED!' : '❌ EMPTY'}`);
          
          if (issue.message) {
            console.log(`   Message: ${issue.message.substring(0, 100)}...`);
          }
          break;
        }
      }
    }
    
    // Final verdict
    console.log('\n\n=== FINAL VERDICT ===\n');
    
    if (testErrorFound && testErrorHasStackTrace) {
      console.log('🎉🎉🎉 COMPLETE SUCCESS! 🎉🎉🎉\n');
      console.log('✅ Full stack trace flow is working:');
      console.log('  1. Error triggers stack trace logging');
      console.log('  2. STACKTRACE marker written to Render logs');
      console.log('  3. Analyzer finds marker and extracts timestamp');
      console.log('  4. Looks up stack trace from Stack Traces table');
      console.log('  5. Populates Stack Trace field in Production Issues');
      console.log('\n✅ System is FULLY OPERATIONAL!\n');
      process.exit(0);
    } else if (testErrorFound && !testErrorHasStackTrace) {
      console.log('⚠️ PARTIAL SUCCESS\n');
      console.log('✅ TEST ERROR was detected and Production Issue created');
      console.log('❌ BUT Stack Trace field is empty');
      console.log('\nPossible issues:');
      console.log('- Timestamp lookup failed');
      console.log('- Stack trace not saved to Stack Traces table');
      console.log('- Timing issue (check manually in a few minutes)');
      process.exit(1);
    } else {
      console.log('❌ TEST ERROR not found in Production Issues\n');
      console.log('Pattern matching may still have issues.');
      console.log('Check Render logs manually.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fullTest();
