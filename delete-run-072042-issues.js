// Delete issues from run 251012-072042
// This run's auto-analyzer captured old errors from previous runs via Phase 2 catch-up
// These are duplicates of errors that happened before our bug fixes were deployed

const https = require('https');

const data = JSON.stringify({
  pattern: '251012-072042',  // Match the Run ID
  commitHash: 'N/A',
  fixNotes: 'Deleting Phase 2 catch-up errors from run 251012-072042 - these are old errors from pre-fix runs captured by the catch-up logic'
});

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  path: '/api/mark-issue-fixed',
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
    console.log(`Status: ${res.statusCode}`);
    const response = JSON.parse(body);
    console.log('Response:', JSON.stringify(response, null, 2));
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
