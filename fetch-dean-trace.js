// Fetch all DEBUG-CRR issues and organize by client
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

console.log('📊 Fetching all Production Issues for Dean Hobin trace...\n');

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    try {
      const parsed = JSON.parse(responseData);
      
      // Get all DEBUG-CRR issues
      const allIssues = parsed.topIssues || [];
      
      // Filter for issues mentioning Dean
      const deanIssues = allIssues.filter(issue => 
        (issue.message && (issue.message.includes('Dean Hobin') || issue.message.includes('Dean-Hobin'))) ||
        (issue.examples && issue.examples.some(ex => ex.clientId && ex.clientId.includes('Dean')))
      );
      
      console.log(`🔍 Found ${deanIssues.length} issues mentioning Dean Hobin\n`);
      console.log('='.repeat(80));
      
      deanIssues.forEach((issue, idx) => {
        console.log(`\n[${idx + 1}] Pattern: ${issue.pattern}`);
        console.log(`    Severity: ${issue.severity}`);
        console.log(`    Count: ${issue.count}`);
        console.log(`    Message:\n    ${issue.message.substring(0, 400)}`);
        console.log();
      });
      
      // Also show Guy Wilson for comparison
      console.log('\n' + '='.repeat(80));
      console.log('GUY WILSON FOR COMPARISON:\n');
      
      const guyIssues = allIssues.filter(issue => 
        (issue.message && issue.message.includes('Guy Wilson')) ||
        (issue.examples && issue.examples.some(ex => ex.clientId === 'Guy-Wilson'))
      );
      
      guyIssues.forEach((issue, idx) => {
        console.log(`\n[${idx + 1}] ${issue.message.substring(0, 400)}`);
      });
      
    } catch (e) {
      console.error('Parse error:', e.message);
      console.log('Raw response:', responseData.substring(0, 1000));
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error);
});

req.end();
