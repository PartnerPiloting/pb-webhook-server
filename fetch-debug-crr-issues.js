// Fetch DEBUG-CRR issues from Production Issues table
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

console.log('📊 Fetching Production Issues...');

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('\n✅ Response received');
    try {
      const parsed = JSON.parse(responseData);
      
      // Filter for DEBUG-CRR issues
      const debugCrrIssues = parsed.topIssues?.filter(issue => 
        issue.pattern && issue.pattern.includes('DEBUG-CRR')
      ) || [];
      
      console.log(`\n🔍 Found ${debugCrrIssues.length} DEBUG-CRR issues\n`);
      
      debugCrrIssues.forEach((issue, idx) => {
        console.log(`\n--- Issue ${idx + 1} ---`);
        console.log(`Pattern: ${issue.pattern}`);
        console.log(`Count: ${issue.count}`);
        console.log(`Message: ${issue.message.substring(0, 500)}...`);
        
        if (issue.examples && issue.examples.length > 0) {
          console.log(`\nExample from run: ${issue.examples[0].runId}`);
          console.log(`Client: ${issue.examples[0].clientId}`);
        }
      });
      
    } catch (e) {
      console.log('Raw response:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error);
});

req.end();
