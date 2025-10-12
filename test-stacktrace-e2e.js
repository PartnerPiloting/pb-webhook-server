#!/usr/bin/env node
/**
 * Full end-to-end test:
 * 1. Trigger an error on Render
 * 2. Wait for it to be logged
 * 3. Fetch and analyze logs
 * 4. Check for STACKTRACE markers
 * 5. Check Production Issues table for stack traces
 */

const https = require('https');

const RENDER_URL = 'pb-webhook-server-staging.onrender.com';
const AUTH_TOKEN = 'Diamond9753!!@@pb';

// Function to make HTTPS request
function makeRequest(path, method, body = null) {
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

async function testEndToEnd() {
  console.log('\n=== Full End-to-End STACKTRACE System Test ===\n');
  
  try {
    // Step 1: Check current Production Issues count
    console.log('Step 1: Checking Production Issues API...');
    const issuesResponse = await makeRequest('/api/analyze-issues', 'GET');
    
    if (issuesResponse.statusCode === 200) {
      console.log(`✅ Current issues: ${issuesResponse.body.total || 0}`);
      if (issuesResponse.body.topIssues && issuesResponse.body.topIssues.length > 0) {
        console.log('\nTop recent issues:');
        issuesResponse.body.topIssues.slice(0, 3).forEach((issue, i) => {
          console.log(`  ${i + 1}. ${issue.pattern} (${issue.count}x, ${issue.severity})`);
        });
      }
    } else {
      console.log(`⚠️ Issues API returned: ${issuesResponse.statusCode}`);
    }
    
    // Step 2: Trigger a test error by calling a non-existent endpoint
    console.log('\n\nStep 2: Triggering a test error...');
    console.log('(Calling non-existent endpoint to generate 404 error)');
    
    const errorResponse = await makeRequest('/api/test-stacktrace-marker-' + Date.now(), 'GET');
    console.log(`Response: ${errorResponse.statusCode} (expected 404)`);
    
    // Step 3: Wait for error to be logged
    console.log('\nStep 3: Waiting 10 seconds for error to be logged...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Step 4: Analyze recent logs
    console.log('\nStep 4: Analyzing recent logs (last 15 minutes)...');
    const analysisResponse = await makeRequest('/api/analyze-logs/recent', 'POST', { minutes: 15 });
    
    if (analysisResponse.statusCode === 200) {
      const result = analysisResponse.body;
      console.log(`✅ Analysis complete: ${result.message || 'No message'}`);
      console.log(`   Total issues found: ${result.issues || result.total || 0}`);
      
      if (result.summary) {
        console.log(`   - CRITICAL: ${result.summary.critical || 0}`);
        console.log(`   - ERROR: ${result.summary.error || 0}`);
        console.log(`   - WARNING: ${result.summary.warning || 0}`);
      }
      
      // Check for STACKTRACE markers in the analysis
      if (result.issuesWithStackTrace !== undefined) {
        console.log(`\n🎯 Issues WITH Stack Traces: ${result.issuesWithStackTrace}`);
      }
      
      if (result.newIssues && result.newIssues.length > 0) {
        console.log(`\n✅ New issues created: ${result.newIssues.length}`);
        result.newIssues.slice(0, 3).forEach((issue, i) => {
          console.log(`\n  ${i + 1}. ${issue.errorMessage?.substring(0, 80) || 'Unknown error'}...`);
          if (issue.stackTraceFound) {
            console.log(`     ✅ Stack trace: FOUND and linked`);
          } else {
            console.log(`     ❌ Stack trace: NOT found`);
          }
        });
      }
    } else {
      console.log(`❌ Analysis failed: ${analysisResponse.statusCode}`);
      console.log(JSON.stringify(analysisResponse.body, null, 2));
    }
    
    // Step 5: Check Production Issues again
    console.log('\n\nStep 5: Checking Production Issues again...');
    const issuesResponse2 = await makeRequest('/api/analyze-issues', 'GET');
    
    if (issuesResponse2.statusCode === 200) {
      console.log(`✅ Total issues now: ${issuesResponse2.body.total || 0}`);
      
      // Look for issues with stack traces
      let withStackTrace = 0;
      if (issuesResponse2.body.topIssues) {
        issuesResponse2.body.topIssues.forEach(issue => {
          if (issue.hasStackTrace) {
            withStackTrace++;
          }
        });
      }
      
      console.log(`✅ Issues with stack traces: ${withStackTrace}`);
    }
    
    // Final verdict
    console.log('\n\n=== TEST RESULTS ===\n');
    console.log('To verify STACKTRACE markers are working:');
    console.log('1. Go to Render dashboard logs');
    console.log('2. Search for: [DEBUG-STACKTRACE]');
    console.log('3. You should see:');
    console.log('   - [DEBUG-STACKTRACE] About to log STACKTRACE marker');
    console.log('   - [ERROR] ... STACKTRACE:2025-10-...');
    console.log('   - [DEBUG-STACKTRACE] STACKTRACE marker logged successfully');
    console.log('\n4. Go to Airtable Master Clients base > Production Issues');
    console.log('5. Check if recent errors have Stack Trace field populated');
    console.log('\nIf both are YES, the system is working! 🎉\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testEndToEnd()
  .then(() => {
    console.log('✅ Test sequence completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
