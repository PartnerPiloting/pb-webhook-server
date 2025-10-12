const https = require('https');

console.log('🔍 Checking Production Issues table for stack traces...\n');

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  path: '/api/analyze-issues',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer Diamond9753!!@@pb'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      
      console.log(`📊 Total issues: ${json.total}`);
      console.log(`📋 By severity:`, json.bySeverity);
      console.log('\n🔎 TEST ERROR issues:\n');
      
      const testErrors = json.topIssues?.filter(i => i.pattern.includes('TEST ERROR'));
      
      if (testErrors && testErrors.length > 0) {
        testErrors.forEach(issue => {
          console.log(`Pattern: ${issue.pattern}`);
          console.log(`Count: ${issue.count}`);
          console.log(`Severity: ${issue.severity}`);
          console.log(`\nExamples with stack traces:`);
          
          issue.examples?.forEach((ex, i) => {
            console.log(`\n  ${i + 1}. Run ID: ${ex.runId}`);
            console.log(`     Timestamp: ${ex.timestamp}`);
            console.log(`     Has Stack Trace: ${ex.stackTrace ? '✅ YES' : '❌ NO'}`);
            if (ex.stackTrace) {
              console.log(`     Stack Trace Preview: ${ex.stackTrace.substring(0, 100)}...`);
            }
          });
        });
      } else {
        console.log('❌ No TEST ERROR issues found');
      }
    } catch (e) {
      console.error('❌ Parse error:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
});

req.end();
