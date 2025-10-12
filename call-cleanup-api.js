const https = require('https');

console.log('\n🧹 Calling cleanup API to delete false "Record not found" errors...\n');

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  path: '/api/cleanup-record-not-found-errors',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer Diamond9753!!@@pb',
    'Content-Type': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}\n`);
    
    try {
      const result = JSON.parse(data);
      
      if (result.success) {
        console.log('✅ Cleanup successful!\n');
        console.log(`📊 Deleted Records:`);
        console.log(`   Production Issues: ${result.deleted.productionIssues}`);
        console.log(`   Stack Traces: ${result.deleted.stackTraces}`);
        console.log(`   Total: ${result.deleted.total}`);
        console.log(`\n💬 ${result.message}\n`);
      } else {
        console.log('❌ Cleanup failed:', result.error);
      }
    } catch (e) {
      console.log('Response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
});

req.end();
