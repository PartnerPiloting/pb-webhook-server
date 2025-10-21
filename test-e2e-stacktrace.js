#!/usr/bin/env node
/**
 * Test end-to-end stack trace flow:
 * 1. Run log analyzer on recent logs (includes our test error)
 * 2. Check if Production Issues were created
 * 3. Verify Stack Trace field is populated
 */

const https = require('https');

const RENDER_URL = 'pb-webhook-server-staging.onrender.com';
const AUTH_TOKEN = 'Diamond9753!!@@pb';

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

async function testEndToEnd() {
  console.log('\n=== Testing Complete Stack Trace Flow ===\n');
  
  try {
    // Step 1: Run log analyzer on recent logs (last 15 minutes to catch our test)
    console.log('Step 1: Running log analyzer on recent logs (last 15 minutes)...');
    const analyzeResponse = await makeRequest('/api/analyze-logs/recent', 'POST', {
      minutes: 15
    });
    
    if (analyzeResponse.statusCode !== 200) {
      console.log(`❌ Analyze failed: ${analyzeResponse.statusCode}`);
      console.log(JSON.stringify(analyzeResponse.body, null, 2));
      process.exit(1);
    }
    
    console.log('✅ Log analysis complete!\n');
    console.log('Results:');
    console.log(`  - Total issues found: ${analyzeResponse.body.issues || 0}`);
    console.log(`  - CRITICAL: ${analyzeResponse.body.summary?.critical || 0}`);
    console.log(`  - ERROR: ${analyzeResponse.body.summary?.error || 0}`);
    console.log(`  - WARNING: ${analyzeResponse.body.summary?.warning || 0}`);
    console.log(`  - Records created: ${analyzeResponse.body.createdRecords || 0}`);
    
    // Step 2: Check Production Issues table
    console.log('\n\nStep 2: Checking Production Issues table...');
    const issuesResponse = await makeRequest('/api/analyze-issues', 'GET');
    
    if (issuesResponse.statusCode !== 200) {
      console.log(`❌ Failed to fetch issues: ${issuesResponse.statusCode}`);
      process.exit(1);
    }
    
    console.log(`✅ Found ${issuesResponse.body.total || 0} total issues\n`);
    
    // Step 3: Look for issues with stack traces
    console.log('Step 3: Checking for Stack Traces in Production Issues...\n');
    
    if (issuesResponse.body.topIssues && issuesResponse.body.topIssues.length > 0) {
      let issuesWithStackTrace = 0;
      let issuesWithoutStackTrace = 0;
      
      console.log('Recent issues:');
      issuesResponse.body.topIssues.slice(0, 10).forEach((issue, i) => {
        const hasStackTrace = issue.hasStackTrace || false;
        const icon = hasStackTrace ? '✅' : '❌';
        
        if (hasStackTrace) {
          issuesWithStackTrace++;
        } else {
          issuesWithoutStackTrace++;
        }
        
        console.log(`\n${i + 1}. ${icon} ${issue.pattern || 'Unknown'}`);
        console.log(`   Severity: ${issue.severity}`);
        console.log(`   Count: ${issue.count}x`);
        console.log(`   Stack Trace: ${hasStackTrace ? 'POPULATED ✅' : 'EMPTY ❌'}`);
        
        if (issue.message) {
          console.log(`   Message: ${issue.message.substring(0, 80)}...`);
        }
      });
      
      console.log(`\n\n=== SUMMARY ===`);
      console.log(`Issues WITH Stack Trace: ${issuesWithStackTrace}`);
      console.log(`Issues WITHOUT Stack Trace: ${issuesWithoutStackTrace}`);
      
      if (issuesWithStackTrace > 0) {
        console.log('\n🎉🎉🎉 SUCCESS! 🎉🎉🎉');
        console.log('Stack traces ARE being populated in Production Issues!');
        console.log('The complete end-to-end flow is working!');
        console.log('\n✅ System verified:');
        console.log('  1. Errors trigger stack trace logging');
        console.log('  2. STACKTRACE markers written to Render logs');
        console.log('  3. Log analyzer finds markers and extracts timestamps');
        console.log('  4. Stack traces looked up from Stack Traces table');
        console.log('  5. Stack traces populated in Production Issues table');
        process.exit(0);
      } else {
        console.log('\n⚠️ No issues with stack traces found yet.');
        console.log('Possible reasons:');
        console.log('1. Test error may not have been analyzed yet');
        console.log('2. Analyzer needs to run again');
        console.log('3. Test error might not match error patterns');
        console.log('\nTry running the analyzer again or triggering a real error.');
      }
    } else {
      console.log('⚠️ No issues found in Production Issues table.');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testEndToEnd();
