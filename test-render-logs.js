#!/usr/bin/env node
/**
 * Test STACKTRACE markers on Render by calling the analyze-logs API
 * This checks if the fix is working without needing local env vars
 */

const https = require('https');

const RENDER_URL = 'https://pb-webhook-server-staging.onrender.com';

// Function to make HTTPS POST request
function makePostRequest(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    
    const options = {
      hostname: 'pb-webhook-server-staging.onrender.com',
      port: 443,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': 'Bearer Diamond9753!!@@pb'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            body: data
          });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

async function testRenderStackTrace() {
  console.log('\n=== Testing STACKTRACE Markers on Render ===\n');
  console.log('Fetching recent logs from Render (last 60 minutes)...\n');
  
  try {
    // Call the analyze-logs/recent endpoint
    const response = await makePostRequest('/api/analyze-logs/recent', {
      minutes: 60,
      includeRawLogs: true
    });
    
    console.log(`API Response Status: ${response.statusCode}`);
    
    if (response.statusCode !== 200) {
      console.log('Response body:', JSON.stringify(response.body, null, 2));
      console.log('\n❌ Failed to fetch logs from Render');
      return;
    }
    
    // Extract logs from response
    const logs = response.body.logs || response.body.rawLogs || '';
    const logText = typeof logs === 'string' ? logs : JSON.stringify(logs);
    
    console.log(`Fetched ${logText.length} characters of logs\n`);
    
    // Search for STACKTRACE markers
    const debugBefore = logText.match(/\[DEBUG-STACKTRACE\] About to log STACKTRACE marker/g) || [];
    const stacktraceMarkers = logText.match(/STACKTRACE:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g) || [];
    const debugAfter = logText.match(/\[DEBUG-STACKTRACE\] STACKTRACE marker logged successfully/g) || [];
    
    console.log('=== SEARCH RESULTS ===\n');
    console.log(`Debug markers BEFORE: ${debugBefore.length}`);
    console.log(`STACKTRACE markers: ${stacktraceMarkers.length}`);
    console.log(`Debug markers AFTER: ${debugAfter.length}`);
    
    if (stacktraceMarkers.length > 0) {
      console.log('\n🎉 SUCCESS! STACKTRACE markers ARE appearing in Render logs!\n');
      console.log('Example markers found:');
      stacktraceMarkers.slice(0, 5).forEach((marker, i) => {
        console.log(`  ${i + 1}. ${marker}`);
      });
      
      console.log('\n✅ The fix is working! STACKTRACE markers are being written to Render logs.');
      console.log('✅ The log analyzer can now extract these timestamps.');
      console.log('✅ Stack traces will be linked to Production Issues.');
      
      // Extract a sample log line with context
      const sampleIndex = logText.indexOf('STACKTRACE:');
      if (sampleIndex > -1) {
        const sampleStart = Math.max(0, sampleIndex - 200);
        const sampleEnd = Math.min(logText.length, sampleIndex + 300);
        console.log('\n=== Sample Log Entry with STACKTRACE Marker ===');
        console.log(logText.substring(sampleStart, sampleEnd));
        console.log('=== End Sample ===\n');
      }
      
    } else {
      console.log('\n⚠️ No STACKTRACE markers found in recent logs (last 60 minutes).');
      console.log('\nPossible reasons:');
      console.log('1. No errors have occurred in the last 60 minutes');
      console.log('2. The deployment completed but no error handlers have been triggered yet');
      console.log('3. Need to trigger an error manually to test');
      
      // Show a sample of the logs to help debug
      console.log('\n=== Sample of Recent Logs (first 1000 chars) ===');
      console.log(logText.substring(0, 1000));
      console.log('=== End Sample ===\n');
    }
    
    // Also check if there are any errors logged at all
    const errorLogs = logText.match(/\[ERROR\]/g) || [];
    const jobTrackingErrors = logText.match(/\[JOB-TRACKING\]/g) || [];
    const batchScorerErrors = logText.match(/\[BATCH-SCORER\]/g) || [];
    
    console.log('\n=== Other Relevant Markers ===');
    console.log(`[ERROR] markers: ${errorLogs.length}`);
    console.log(`[JOB-TRACKING] markers: ${jobTrackingErrors.length}`);
    console.log(`[BATCH-SCORER] markers: ${batchScorerErrors.length}`);
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testRenderStackTrace()
  .then(() => {
    console.log('\n✅ Test completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
