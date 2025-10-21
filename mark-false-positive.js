const https = require('https');

const data = JSON.stringify({
  pattern: 'Summary: 1 successful, 0 failed',
  commitHash: 'N/A',
  fixNotes: 'False positive - success summary message containing "0 failed" matched batch.*failed pattern'
});

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  path: '/api/mark-issue-fixed',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': 'Bearer Diamond9753!!@@pb'
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    const result = JSON.parse(body);
    console.log('✅ Marked as IGNORED:', result);
  });
});

req.on('error', console.error);
req.write(data);
req.end();
