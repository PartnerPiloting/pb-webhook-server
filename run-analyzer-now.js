// Run the checkpoint-based log analyzer
const https = require('https');

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

console.log('🔍 Running checkpoint-based log analyzer...\n');

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('\nResponse:');
    try {
      const parsed = JSON.parse(responseData);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(data);
req.end();
