// Delete old unfixed errors from pre-fix runs
// These are all from runs 251012-005615 and 251012-010957 (before bug fixes deployed)

const https = require('https');

const data = JSON.stringify({
  runIds: ['251012-005615', '251012-010957'],
  reason: 'Old errors from runs before bug fixes deployed (commits d2ccab2, a843e39, 1939c80). All 3 root causes already fixed.',
  apiKey: process.env.DEBUG_API_KEY
});

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  path: '/api/delete-production-issues',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', JSON.parse(body));
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
