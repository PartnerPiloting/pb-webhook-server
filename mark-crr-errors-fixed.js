// Mark CRR "Record not found" errors as FIXED
const https = require('https');

const data = JSON.stringify({
  pattern: 'CRR record not found',
  commitHash: 'aea54f0',
  fixNotes: 'Fixed Progress Log search to use full clientRunId with suffix (JobTracking.addClientSuffix)'
});

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  port: 443,
  path: '/api/mark-issue-fixed',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': 'Bearer Diamond9753!!@@pb'
  }
};

console.log('🔧 Marking CRR record not found errors as FIXED...\n');

const req = https.request(options, (res) => {
  let body = '';
  
  res.on('data', (chunk) => {
    body += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}\n`);
    try {
      const result = JSON.parse(body);
      console.log('✅ Response:');
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
