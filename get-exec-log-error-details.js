// Get the full error message about Execution Log
const https = require('https');

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  port: 443,
  path: '/api/analyze-issues?status=unfixed',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer Diamond9753!!@@pb'
  }
};

console.log('📊 Fetching full Execution Log error details...\n');

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    try {
      const parsed = JSON.parse(responseData);
      
      // Find Execution Log related errors
      const execLogErrors = parsed.topIssues.filter(issue => 
        issue.message && issue.message.includes('Execution Log')
      );
      
      console.log(`Found ${execLogErrors.length} Execution Log errors:\n`);
      console.log('='.repeat(80));
      
      execLogErrors.forEach((issue, idx) => {
        console.log(`\n[${idx + 1}] Pattern: ${issue.pattern}`);
        console.log(`    Severity: ${issue.severity}`);
        console.log(`    Count: ${issue.count}`);
        console.log(`\n    Full Message:\n`);
        console.log(issue.message);
        console.log('\n' + '-'.repeat(80));
        
        if (issue.examples && issue.examples.length > 0) {
          console.log(`\n    Example:`);
          console.log(`    Run ID: ${issue.examples[0].runId}`);
          console.log(`    Client: ${issue.examples[0].clientId}`);
          console.log(`    Timestamp: ${issue.examples[0].timestamp}`);
        }
      });
      
    } catch (e) {
      console.error('Parse error:', e.message);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error);
});

req.end();
