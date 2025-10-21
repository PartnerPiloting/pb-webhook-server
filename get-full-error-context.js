// Get full error message context for each unfixed issue
const https = require('https');

function fetchIssues() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'pb-webhook-server-staging.onrender.com',
      path: '/api/analyze-issues?status=unfixed&format=detailed',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const response = await fetchIssues();
  
  // Focus on the issues we need to address (exclude already-fixed ones)
  const patterns = [
    'INVALID_VALUE_FOR_COLUMN',
    'Unauthorized',
    'getServiceLogs Failed',
    'Record not found'
  ];
  
  console.log('='.repeat(80));
  console.log('FULL ERROR CONTEXT FOR REMAINING ISSUES');
  console.log('='.repeat(80));
  
  response.topIssues.forEach((issue, idx) => {
    // Skip already-fixed issues
    if (issue.message.includes('Execution Log') && issue.message.includes('undefined')) return;
    if (issue.pattern === 'batch.*failed' && issue.message.includes('0 failed')) return;
    if (issue.pattern === 'DEBUG-CRR') return; // Skip debug logs
    if (issue.pattern === 'deprecated') return; // Skip low priority
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${idx + 1}] ${issue.severity}: ${issue.pattern}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Count: ${issue.count} occurrences`);
    console.log(`Run: ${issue.examples[0].runId}`);
    console.log(`Client: ${issue.examples[0].clientId}`);
    console.log(`Time: ${issue.examples[0].timestamp}`);
    console.log(`\nFull Message:\n${issue.message}`);
  });
}

main().catch(console.error);
