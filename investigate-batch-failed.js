// Get full details of batch.*failed errors
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

console.log('📊 Fetching batch.*failed error details...\n');

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    try {
      const parsed = JSON.parse(responseData);
      
      // Find batch failed errors
      const batchErrors = parsed.topIssues.filter(issue => 
        issue.pattern && issue.pattern.includes('batch.*failed')
      );
      
      console.log(`Found ${batchErrors.length} batch.*failed errors:\n`);
      console.log('='.repeat(80));
      
      batchErrors.forEach((issue, idx) => {
        console.log(`\n[${idx + 1}] Pattern: ${issue.pattern}`);
        console.log(`    Severity: ${issue.severity}`);
        console.log(`    Count: ${issue.count}`);
        console.log(`\n    Full Message:\n`);
        console.log(issue.message);
        console.log('\n' + '-'.repeat(80));
        
        if (issue.examples && issue.examples.length > 0) {
          console.log(`\n    Examples:`);
          issue.examples.forEach((ex, i) => {
            console.log(`    [${i+1}] Run: ${ex.runId}, Client: ${ex.clientId}, Time: ${ex.timestamp}`);
          });
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
