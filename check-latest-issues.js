// Check latest Production Issues for run 251014-055128
const https = require('https');

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  port: 443,
  path: '/api/analyze-issues?status=unfixed&days=1',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer Diamond9753!!@@pb'
  }
};

console.log('📊 Fetching all unfixed Production Issues from last 24 hours...\n');

const req = https.request(options, (res) => {
  let body = '';
  
  res.on('data', (chunk) => {
    body += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}\n`);
    try {
      const result = JSON.parse(body);
      
      if (result.topIssues && result.topIssues.length > 0) {
        console.log('🔍 Production Issues Found:\n');
        result.topIssues.forEach((issue, index) => {
          const emoji = issue.severity === 'ERROR' ? '❌' : '⚠️';
          console.log(`${index + 1}. ${emoji} [${issue.severity}] ${issue.pattern}`);
          console.log(`   Count: ${issue.count} (${issue.percentage}%)`);
          console.log(`   Message: ${issue.message.substring(0, 150)}...`);
          console.log('');
        });
      } else {
        console.log('✅ No issues found or filtered out');
      }
      
      console.log('\n📊 Summary:');
      console.log(`Total: ${result.total}`);
      console.log(`By Severity:`, result.bySeverity);
      
    } catch (e) {
      console.log('Response:', body);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error);
});

req.end();
