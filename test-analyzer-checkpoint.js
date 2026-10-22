// Test analyzer checkpoint update for specific run
const https = require('https');

const runId = '251014-055128';

const data = JSON.stringify({
  minutes: 60,
  runId: runId
});

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  port: 443,
  path: '/api/analyze-logs/recent',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': 'Bearer ' + process.env.PB_WEBHOOK_SECRET
  }
};

console.log(`📊 Analyzing logs for run ${runId}...`);

const req = https.request(options, (res) => {
  let body = '';
  
  res.on('data', (chunk) => {
    body += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    try {
      const result = JSON.parse(body);
      console.log('\n✅ Analysis complete:');
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.log('Response:', body);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error);
});

req.write(data);
req.end();
