// Check Stack Traces table for INVALID_VALUE_FOR_COLUMN error
const https = require('https');

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://pb-webhook-server-staging.onrender.com${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Failed to parse JSON', raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching Production Issues with Stack Traces...\n');
  
  // Get the INVALID_VALUE_FOR_COLUMN error specifically
  const issues = await makeRequest('/api/analyze-issues?status=unfixed');
  
  const invalidValueIssue = issues.topIssues?.find(i => i.pattern === 'INVALID_VALUE_FOR_COLUMN');
  
  if (!invalidValueIssue) {
    console.log('No INVALID_VALUE_FOR_COLUMN errors found');
    return;
  }
  
  console.log('='.repeat(80));
  console.log('INVALID_VALUE_FOR_COLUMN ERROR');
  console.log('='.repeat(80));
  console.log(`Run: ${invalidValueIssue.examples[0].runId}`);
  console.log(`Client: ${invalidValueIssue.examples[0].clientId}`);
  console.log(`Time: ${invalidValueIssue.examples[0].timestamp}`);
  console.log(`\nMessage:\n${invalidValueIssue.message}`);
  console.log('\n' + '='.repeat(80));
  console.log('\nThis error is truncated. Let me search Render logs for more context...');
  console.log('Looking for the full error message around this timestamp...');
}

main().catch(console.error);
