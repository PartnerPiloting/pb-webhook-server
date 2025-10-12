// Mark remaining old errors as FIXED using broader patterns

const https = require('https');

async function markIssueFixed(pattern, commitHash, fixNotes) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ pattern, commitHash, fixNotes });
    
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
        console.log(`✅ Marked "${pattern}" as FIXED - Status: ${res.statusCode}`);
        console.log(JSON.parse(body));
        resolve();
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  // Use shorter patterns that will match the error messages
  await markIssueFixed(
    "Cannot access 'logger'",
    'd2ccab2',
    'Fixed TDZ error by creating tempLogger for early validation'
  );
  
  await markIssueFixed(
    'analyzeRecentLogs',
    'd2ccab2',
    'Fixed by instantiating ProductionIssueService class'
  );
  
  await markIssueFixed(
    'Failed to update metrics',
    'd2ccab2',
    'Fixed by adding success: true to updateClientRun return value'
  );
  
  console.log('\n✅ All old errors marked as FIXED');
})();
