// Test the smart resume endpoint
const https = require('https');

const data = JSON.stringify({
  stream: 1,
  leadScoringLimit: 2,
  postScoringLimit: 2
});

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  port: 443,
  path: '/smart-resume-client-by-client',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-secret': 'Diamond9753!!@@pb',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('\nResponse:');
    console.log(responseData);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();