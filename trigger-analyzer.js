const https = require('https');

console.log('🔍 Triggering log analyzer for recent errors...\n');

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  path: '/api/analyze-logs/recent',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer Diamond9753!!@@pb'
  }
};

const body = JSON.stringify({ minutes: 15 });

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}\n`);
    
    try {
      const result = JSON.parse(data);
      console.log('✅ Analyzer Results:\n');
      console.log(`Total issues found: ${result.issues || result.total || 0}`);
      console.log(`New records created: ${result.createdRecords || 0}`);
      
      if (result.summary) {
        console.log(`\nBreakdown:`);
        console.log(`  CRITICAL: ${result.summary.critical || 0}`);
        console.log(`  ERROR: ${result.summary.error || 0}`);
        console.log(`  WARNING: ${result.summary.warning || 0}`);
      }
      
      console.log('\n✅ Check Production Issues table now!');
      console.log('Stack Trace fields should be populated.\n');
    } catch (e) {
      console.log('Response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
});

req.write(body);
req.end();
