// DELETE old production issues - Run this ON RENDER via SSH
// This script uses the DEBUG_API_KEY from Render's environment variables

const https = require('https');

async function deleteIssues(runIds, reason, apiKey) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ runIds, reason, apiKey });
    
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
        console.log(`Status: ${res.statusCode}`);
        try {
          console.log('Response:', JSON.parse(body));
        } catch (e) {
          console.log('Response (raw):', body);
        }
        resolve();
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const apiKey = process.env.DEBUG_API_KEY;
  
  if (!apiKey) {
    console.error('❌ DEBUG_API_KEY not found in environment variables');
    console.error('This script must be run on Render where DEBUG_API_KEY is set');
    process.exit(1);
  }
  
  console.log('🗑️ Deleting old production issues from runs before bug fixes...');
  console.log('Runs to delete: 251012-005615, 251012-010957, 251012-072642');
  
  // Delete all issues from these old runs (before bug fixes deployed)
  await deleteIssues(
    ['251012-005615', '251012-010957', '251012-072642'],
    'Old errors from runs before bug fixes deployed (commits d2ccab2, a843e39, 1939c80). All root causes already fixed. Deleting rather than marking as FIXED.',
    apiKey
  );
  
  console.log('\n✅ All old production issues deleted');
})();
