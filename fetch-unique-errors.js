// Fetch all production issues grouped by pattern
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

console.log('📊 Fetching all unique Production Issues...\n');

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    try {
      const parsed = JSON.parse(responseData);
      
      console.log(`Total Issues: ${parsed.total}`);
      console.log(`By Severity: ${JSON.stringify(parsed.bySeverity)}\n`);
      console.log('='.repeat(80));
      
      // Filter out DEBUG-CRR issues (those are temporary)
      const realIssues = parsed.topIssues.filter(issue => 
        !issue.pattern.includes('DEBUG-CRR') && !issue.pattern.includes('DEBUG-STATUS')
      );
      
      console.log(`\n🔍 REAL PRODUCTION ISSUES (excluding debug logs): ${realIssues.length}\n`);
      
      // Group by severity
      const critical = realIssues.filter(i => i.severity === 'CRITICAL');
      const errors = realIssues.filter(i => i.severity === 'ERROR');
      const warnings = realIssues.filter(i => i.severity === 'WARNING');
      
      if (critical.length > 0) {
        console.log('\n🔴 CRITICAL ISSUES:\n');
        critical.forEach((issue, idx) => {
          console.log(`${idx + 1}. [${issue.count}x] ${issue.pattern}`);
          console.log(`   ${issue.message.substring(0, 200).replace(/\n/g, ' ')}...`);
          console.log();
        });
      }
      
      if (errors.length > 0) {
        console.log('\n❌ ERROR ISSUES:\n');
        errors.forEach((issue, idx) => {
          console.log(`${idx + 1}. [${issue.count}x] ${issue.pattern}`);
          console.log(`   ${issue.message.substring(0, 200).replace(/\n/g, ' ')}...`);
          console.log();
        });
      }
      
      if (warnings.length > 0) {
        console.log('\n⚠️  WARNING ISSUES:\n');
        warnings.forEach((issue, idx) => {
          console.log(`${idx + 1}. [${issue.count}x] ${issue.pattern}`);
          console.log(`   ${issue.message.substring(0, 150).replace(/\n/g, ' ')}...`);
        });
      }
      
      console.log('\n' + '='.repeat(80));
      console.log(`\nSummary:`);
      console.log(`  CRITICAL: ${critical.length} unique issues`);
      console.log(`  ERROR: ${errors.length} unique issues`);
      console.log(`  WARNING: ${warnings.length} unique issues`);
      
    } catch (e) {
      console.error('Parse error:', e.message);
      console.log('Raw response:', responseData.substring(0, 500));
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error);
});

req.end();
