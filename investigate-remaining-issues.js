// Investigate the 4 remaining unfixed production issues
const https = require('https');

function fetchIssues() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'pb-webhook-server-staging.onrender.com',
      path: '/api/analyze-issues?status=unfixed',
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
  
  console.log('='.repeat(80));
  console.log('REMAINING UNFIXED ISSUES (excluding Execution Log & batch false positives)');
  console.log('='.repeat(80));
  
  const issues = response.topIssues.filter(issue => {
    // Exclude the ones we already fixed
    const isExecutionLog = issue.message.includes('Execution Log') && issue.message.includes('undefined');
    const isBatchFalsePositive = issue.pattern === 'batch.*failed' && issue.message.includes('0 failed');
    return !isExecutionLog && !isBatchFalsePositive;
  });
  
  issues.forEach((issue, idx) => {
    console.log(`\n[${idx + 1}] ${issue.severity}: ${issue.pattern}`);
    console.log(`Count: ${issue.count} (${issue.percentage}%)`);
    console.log(`Message: ${issue.message.substring(0, 200)}...`);
    console.log(`Run ID: ${issue.examples[0].runId}`);
    console.log(`Client: ${issue.examples[0].clientId}`);
    console.log(`Timestamp: ${issue.examples[0].timestamp}`);
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('ISSUE BREAKDOWN:\n');
  
  // Categorize by what we can address now
  const unauthorized = issues.find(i => i.pattern === 'Unauthorized');
  const renderLogFetch = issues.find(i => i.message.includes('getServiceLogs Failed'));
  const invalidValue = issues.find(i => i.pattern === 'INVALID_VALUE_FOR_COLUMN');
  const deprecated = issues.find(i => i.pattern === 'deprecated');
  const recordNotFound = issues.find(i => i.pattern === 'Record not found');
  
  console.log('🔴 HIGH PRIORITY:');
  if (renderLogFetch) {
    console.log(`  1. Log Analyzer Failure - Can't fetch Render logs (400 error)`);
    console.log(`     Impact: Prevents analyzer from working`);
    console.log(`     Message: ${renderLogFetch.message.substring(0, 150)}`);
  }
  
  if (unauthorized) {
    console.log(`  2. Unauthorized API Call - Unknown source`);
    console.log(`     Impact: Unknown API call failing`);
    console.log(`     Message: ${unauthorized.message.substring(0, 150)}`);
  }
  
  console.log('\n🟡 MEDIUM PRIORITY:');
  if (recordNotFound) {
    console.log(`  3. Job Tracking Record Not Found`);
    console.log(`     Impact: Related to Status bug (diagnostics deployed)`);
    console.log(`     Message: ${recordNotFound.message.substring(0, 150)}`);
  }
  
  if (invalidValue) {
    console.log(`  4. INVALID_VALUE_FOR_COLUMN - Generic Airtable error`);
    console.log(`     Impact: Unknown (need more context)`);
    console.log(`     Message: ${invalidValue.message.substring(0, 150)}`);
  }
  
  console.log('\n⚠️ LOW PRIORITY:');
  if (deprecated) {
    console.log(`  5. Deprecation Warning - utils/runIdGenerator.js`);
    console.log(`     Impact: Just noise, can mark as IGNORED`);
  }
  
  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
