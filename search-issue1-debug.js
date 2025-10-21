// Search Render logs for Issue #1 debug output
const https = require('https');

// Search for logs around 04:54:50 UTC (when Issue #1 occurred)
// Run ID: 251013-045332
const searchTerms = [
  '[EXEC-LOG-DEBUG]',
  '[UPDATE-LOG-DEBUG]',
  'formatExecutionLog',
  '251013-045332',
  'Execution Log'
];

console.log('🔍 Searching Render logs for Issue #1 debug output...\n');
console.log('Target Run ID: 251013-045332');
console.log('Target Timestamp: ~2025-10-13T04:54:50Z\n');
console.log('Searching for debug markers:');
searchTerms.forEach(term => console.log(`  - ${term}`));
console.log('\n📥 Fetching recent logs from Render...\n');

// Use the analyzer endpoint to get logs
const data = JSON.stringify({});

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  path: '/api/analyze-logs/recent',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer Diamond9753!!@@pb',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('❌ Failed to fetch logs:', res.statusCode);
      console.error(responseData);
      return;
    }

    console.log('✅ Logs fetched successfully\n');
    console.log('Now check Render dashboard logs manually for:');
    console.log('  1. [EXEC-LOG-DEBUG] markers');
    console.log('  2. [UPDATE-LOG-DEBUG] markers');
    console.log('  3. Around timestamp 2025-10-13T04:54:50Z');
    console.log('  4. Run ID: 251013-045332\n');
    console.log('These will show what value formatExecutionLog() received and returned.');
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(data);
req.end();
