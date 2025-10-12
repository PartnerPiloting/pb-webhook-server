const https = require('https');

console.log('🧪 Triggering simple test error on Render...\n');

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  path: '/api/test-stacktrace-markers',
  method: 'GET'
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(`Response Status: ${res.statusCode}`);
    console.log(`Response Body:\n${data}`);
    
    try {
      const json = JSON.parse(data);
      if (json.timestamp) {
        console.log(`\n✅ Timestamp returned: ${json.timestamp}`);
        console.log('\n📝 Next: Check Render dashboard logs manually for:');
        console.log(`   [DEBUG-STACKTRACE] About to log STACKTRACE marker: ${json.timestamp}`);
        console.log(`   STACKTRACE:${json.timestamp}`);
      }
    } catch (e) {
      // Not JSON
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
});

req.end();
