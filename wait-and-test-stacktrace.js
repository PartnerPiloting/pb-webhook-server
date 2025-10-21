#!/usr/bin/env node
/**
 * Wait for Render deployment and then test STACKTRACE markers
 */

const https = require('https');

const RENDER_URL = 'pb-webhook-server-staging.onrender.com';

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://${RENDER_URL}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

async function waitAndTest() {
  console.log('\n=== Waiting for Render Deployment ===\n');
  console.log('Checking every 15 seconds for up to 3 minutes...\n');
  
  const maxAttempts = 12; // 12 x 15 seconds = 3 minutes
  let attempt = 0;
  
  while (attempt < maxAttempts) {
    attempt++;
    console.log(`Attempt ${attempt}/${maxAttempts}: Checking if test endpoint is available...`);
    
    try {
      const response = await makeRequest('/api/test-stacktrace-markers');
      
      if (response.statusCode === 200) {
        console.log('\n✅ Deployment complete! Test endpoint is live.\n');
        console.log('=== TEST RESULTS ===\n');
        console.log(JSON.stringify(response.body, null, 2));
        
        if (response.body.testPassed) {
          console.log('\n🎉🎉🎉 SUCCESS! 🎉🎉🎉');
          console.log(response.body.verdict);
          console.log('\nDetails:');
          console.log(`  ✅ Specific timestamp found: ${response.body.checks.specificTimestampFound}`);
          console.log(`  ✅ Debug marker BEFORE: ${response.body.checks.debugMarkerBefore}`);
          console.log(`  ✅ Debug marker AFTER: ${response.body.checks.debugMarkerAfter}`);
          console.log(`\nTotal STACKTRACE markers in logs: ${response.body.stats.totalStacktraceMarkers}`);
          console.log(`Log size fetched: ${response.body.stats.logLength} characters\n`);
        } else {
          console.log('\n❌ Test FAILED');
          console.log(response.body.verdict);
          console.log('\nWhat was found:');
          console.log(`  - Specific timestamp: ${response.body.checks.specificTimestampFound ? '✅' : '❌'}`);
          console.log(`  - Debug marker BEFORE: ${response.body.checks.debugMarkerBefore ? '✅' : '❌'}`);
          console.log(`  - Debug marker AFTER: ${response.body.checks.debugMarkerAfter ? '✅' : '❌'}`);
          console.log(`\nLog size fetched: ${response.body.stats.logLength} characters`);
        }
        
        process.exit(response.body.testPassed ? 0 : 1);
      } else if (response.statusCode === 404) {
        console.log('  ⏳ Endpoint not found yet (old deployment still running)');
      } else {
        console.log(`  ⚠️ Unexpected response: ${response.statusCode}`);
        console.log('  Response:', response.body);
      }
      
    } catch (error) {
      console.log(`  ⚠️ Connection failed: ${error.message}`);
    }
    
    if (attempt < maxAttempts) {
      console.log('  Waiting 15 seconds before retry...\n');
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
  
  console.log('\n❌ Timeout: Deployment took longer than 3 minutes');
  console.log('Check Render dashboard manually: https://dashboard.render.com\n');
  process.exit(1);
}

// Run the test
waitAndTest();
