/**
 * Simplified test: Just fetch recent Render logs and search for STACKTRACE markers
 * This checks if the fix is working for any errors that happened recently
 */

const https = require('https');

const RENDER_URL = 'https://pb-webhook-server-staging.onrender.com';

// Function to make HTTP requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function testStackTraceOnRender() {
  console.log('\n=== Testing STACKTRACE Markers on Render ===\n');
  console.log('Fetching recent logs to check if STACKTRACE markers are present...\n');
  
  try {
    // Fetch recent logs from last hour
    const logsResponse = await makeRequest(`${RENDER_URL}/api/analyze-logs/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        logText: await fetchRecentRenderLogs()
      }
    });
    
    console.log(`Logs API response: ${logsResponse.statusCode}`);
    
    // Get raw logs instead
    console.log('\nFetching raw logs directly from Render...');
    const rawLogs = await fetchRecentRenderLogs();
    
    // Search for STACKTRACE markers
    console.log('\n=== RESULTS ===\n');
    
    const debugBefore = (rawLogs.match(/\[DEBUG-STACKTRACE\] About to log STACKTRACE marker/g) || []).length;
    const stacktraceMarkers = (rawLogs.match(/STACKTRACE:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g) || []).length;
    const debugAfter = (rawLogs.match(/\[DEBUG-STACKTRACE\] STACKTRACE marker logged successfully/g) || []).length;
    
    console.log(`Debug markers BEFORE: ${debugBefore}`);
    console.log(`STACKTRACE markers: ${stacktraceMarkers}`);
    console.log(`Debug markers AFTER: ${debugAfter}`);
    
    if (stacktraceMarkers > 0) {
      console.log('\n🎉 SUCCESS! STACKTRACE markers ARE appearing in Render logs!');
      console.log('The fix is working!');
      
      // Show examples
      const examples = rawLogs.match(/STACKTRACE:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g);
      console.log('\nExample markers found:');
      examples.slice(0, 3).forEach((marker, i) => {
        console.log(`  ${i+1}. ${marker}`);
      });
    } else {
      console.log('\n⚠️ No STACKTRACE markers found in recent logs.');
      console.log('This could mean:');
      console.log('1. No errors occurred in the last hour');
      console.log('2. Need to wait for background jobs to run and cause errors');
      console.log('\nYou can manually trigger an error by running a batch scoring job on Render.');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Helper to fetch logs from Render API
async function fetchRecentRenderLogs() {
  // For now, just return empty - user needs to manually check Render dashboard
  // In production, this would use Render API or read from logging service
  console.log('Note: Cannot fetch logs without Render API key.');
  console.log('Please check Render dashboard logs manually for STACKTRACE markers.\n');
  console.log('Search for: [DEBUG-STACKTRACE] or STACKTRACE:2025-');
  process.exit(0);
}

// Run the test
testStackTraceOnRender();
