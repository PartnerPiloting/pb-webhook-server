const https = require('https');

const timestamp = '2025-10-12T00:41:17.951976679Z';

// Step 1: Fetch recent logs from Render
console.log('🔍 Checking Render logs for STACKTRACE marker...');

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  path: '/api/analyze-logs/recent',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer Diamond9753!!@@pb'
  }
};

const body = JSON.stringify({ minutes: 10, returnRaw: true });

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`❌ API error (${res.statusCode}):`, data);
      return;
    }
    
    const response = JSON.parse(data);
    const logs = response.logs || '';
    
    console.log('\n📋 Log excerpt (last 5000 chars):');
    console.log(logs.slice(-5000));
    
    // Check for our timestamp
    if (logs.includes(timestamp)) {
      console.log(`\n✅ Found STACKTRACE:${timestamp} in Render logs!`);
    } else {
      console.log(`\n❌ STACKTRACE:${timestamp} NOT found in Render logs`);
      
      // Look for ANY STACKTRACE markers
      const stacktraceMarkers = logs.match(/STACKTRACE:[^\s]+/g);
      if (stacktraceMarkers) {
        console.log('\n📍 Found other STACKTRACE markers:');
        stacktraceMarkers.forEach(m => console.log(`   ${m}`));
      }
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
});

req.write(body);
req.end();
