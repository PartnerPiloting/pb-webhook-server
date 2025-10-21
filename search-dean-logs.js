// Search Render logs for Dean Hobin in run 251013-114042
const https = require('https');

// We'll analyze the text logs directly looking for Dean Hobin mentions
const data = JSON.stringify({
  minutes: 60  // Look back 60 minutes to capture the full run
});

const options = {
  hostname: 'pb-webhook-server-staging.onrender.com',
  port: 443,
  path: '/api/analyze-logs/text',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': 'Bearer Diamond9753!!@@pb'
  }
};

console.log('📊 Searching logs for Dean Hobin in run 251013-114042...\n');

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('✅ Response received');
    
    // Check if we got raw logs
    const lines = responseData.split('\n');
    
    // Filter for lines mentioning Dean Hobin or Dean-Hobin
    const deanLines = lines.filter(line => 
      line.includes('Dean Hobin') || 
      line.includes('Dean-Hobin') ||
      line.includes('251013-114042-Dean')
    );
    
    console.log(`\nFound ${deanLines.length} lines mentioning Dean Hobin:\n`);
    console.log('='.repeat(80));
    
    deanLines.slice(0, 50).forEach((line, idx) => {
      console.log(`[${idx + 1}] ${line.substring(0, 300)}`);
    });
    
    if (deanLines.length > 50) {
      console.log(`\n... and ${deanLines.length - 50} more lines`);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error);
});

req.write(data);
req.end();
