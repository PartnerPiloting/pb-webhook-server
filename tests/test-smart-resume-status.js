/**
 * Test script for Smart Resume status endpoint
 * 
 * This script checks the current status of the Smart Resume process
 * using the new status endpoint.
 */

require('dotenv').config();
const https = require('https');
const http = require('http');

// Environment-specific configuration
const useLocalServer = process.argv.includes('--local');
const envTarget = useLocalServer ? 'LOCAL' : 'STAGING';
const hostname = useLocalServer ? 'localhost' : 'pb-webhook-server-staging.onrender.com';
const port = useLocalServer ? 3001 : 443;
const protocol = useLocalServer ? http : https;

console.log(`🚀 Checking smart-resume status on ${envTarget} server`);
console.log(`🔍 Target: http${useLocalServer ? '' : 's'}://${hostname}:${port}/smart-resume-status`);

// Get webhook secret from environment or fallback to value if testing
const webhookSecret = process.env.PB_WEBHOOK_SECRET || 'Diamond9753!!@@pb';

const options = {
  hostname: hostname,
  port: port,
  path: '/smart-resume-status',
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-secret': webhookSecret
  }
};

console.log('📤 Sending request...');

const req = protocol.request(options, (res) => {
  console.log(`📥 Status: ${res.statusCode}`);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    try {
      // Parse and display the response data
      const parsedData = JSON.parse(responseData);
      console.log('\n📋 Smart Resume Status:');
      console.log(JSON.stringify(parsedData, null, 2));
      
      // Show success message
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('\n✅ Status check complete');
        
        if (parsedData.status?.isRunning) {
          console.log(`⏳ Process is currently running: jobId=${parsedData.status.currentJobId}`);
          console.log(`⏱️ Running for: ${parsedData.status.lockAgeMinutes} minutes`);
          
          if (parsedData.status.isStale) {
            console.log(`⚠️ WARNING: Process appears to be stale/hung`);
          }
        } else {
          console.log(`🔓 No process currently running`);
        }
      } else {
        console.log(`\n❌ Status check failed - Server returned status code ${res.statusCode}`);
      }
    } catch (error) {
      console.error('\n❌ Failed to parse response:', error);
      console.log('Raw response:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('\n❌ Request error:', error);
  process.exit(1);
});

req.end();