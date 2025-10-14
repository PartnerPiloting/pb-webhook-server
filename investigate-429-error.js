// Investigate the 429 rate limit error
const https = require('https');

function fetchIssues() {
  return new Promise((resolve, reject) => {
    https.get('https://pb-webhook-server-staging.onrender.com/api/analyze-issues?status=unfixed&runId=251013-101946', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const response = await fetchIssues();
  
  console.log('='.repeat(80));
  console.log('429 RATE LIMIT ERROR INVESTIGATION');
  console.log('='.repeat(80));
  console.log(`\nTotal issues in run 251013-101946: ${response.total}\n`);
  
  const rateLimitIssue = response.topIssues?.find(i => 
    i.pattern.includes('429') || i.message.includes('429')
  );
  
  if (rateLimitIssue) {
    console.log('Found 429 rate limit error:');
    console.log(`  Severity: ${rateLimitIssue.severity}`);
    console.log(`  Pattern: ${rateLimitIssue.pattern}`);
    console.log(`  Count: ${rateLimitIssue.count}`);
    console.log(`  Run: ${rateLimitIssue.examples[0].runId}`);
    console.log(`  Client: ${rateLimitIssue.examples[0].clientId}`);
    console.log(`  Time: ${rateLimitIssue.examples[0].timestamp}`);
    console.log(`\nFull Message:\n${rateLimitIssue.message}`);
  } else {
    console.log('No 429 rate limit error found in that run.');
    console.log('\nShowing all issues from run 251013-101946:');
    response.topIssues.forEach((issue, idx) => {
      console.log(`\n[${idx + 1}] ${issue.severity}: ${issue.pattern}`);
      console.log(`    Message: ${issue.message.substring(0, 150)}...`);
    });
  }
  
  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
