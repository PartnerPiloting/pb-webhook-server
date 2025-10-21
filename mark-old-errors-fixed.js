// Mark old unfixed errors as FIXED
// These are all from runs 251012-005615 and 251012-010957 (before bug fixes deployed)

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
  // Mark the 3 bugs we already fixed
  await markIssueFixed(
    "Cannot access 'logger' before initialization",
    'd2ccab2',
    'Fixed TDZ error by creating tempLogger for early validation before proper logger initialization'
  );
  
  await markIssueFixed(
    'analyzeRecentLogs is not a function',
    'd2ccab2',
    'Fixed by instantiating ProductionIssueService class before calling analyzeRecentLogs method'
  );
  
  await markIssueFixed(
    'Failed to update metrics: Unknown error',
    'd2ccab2',
    'Fixed by adding success: true to updateClientRun return value for consistency'
  );
  
  await markIssueFixed(
    'Summary: 1 successful, 0 failed',
    'N/A',
    'False positive - success message matched batch.*failed pattern'
  );
  
  console.log('\n✅ All old unfixed errors marked as FIXED');
})();
