#!/usr/bin/env node

// Quick log checker for specific smart resume job
const jobId = process.argv[2] || 'smart_resume_1758453262123_m7oyf';

console.log(`🔍 Checking logs for job: ${jobId}`);

const https = require('https');

const options = {
  hostname: 'api.render.com',
  path: `/v1/services/srv-crtoplfqf0us73d3sop0/logs?limit=100`,
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${process.env.RENDER_API_KEY}`,
    'Accept': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Raw response:', data.substring(0, 200) + '...');
    
    try {
      const logs = JSON.parse(data);
      
      if (!logs || !Array.isArray(logs)) {
        console.log('❌ Invalid logs response');
        return;
      }
      
      // Filter logs for our job
      const jobLogs = logs.filter(log => 
        log.message && (
          log.message.includes(jobId) ||
          log.message.includes(`SMART_RESUME_${jobId}`) ||
          log.message.includes('AUTH_DEBUG')
        )
      );
      
      console.log(`\n📋 Found ${jobLogs.length} relevant log entries:`);
      
      if (jobLogs.length === 0) {
        console.log('⚠️  No logs found yet. Job may still be starting...');
        console.log('Try again in 30-60 seconds.');
        return;
      }
      
      jobLogs.forEach(log => {
        const timestamp = new Date(log.timestamp).toLocaleTimeString();
        console.log(`[${timestamp}] ${log.message}`);
      });
      
    } catch (error) {
      console.error('❌ Error parsing logs:', error.message);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request error:', error.message);
});

req.end();