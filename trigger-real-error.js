#!/usr/bin/env node
/**
 * Trigger a real error that matches error patterns and will be captured
 */

const https = require('https');

const RENDER_URL = 'pb-webhook-server-staging.onrender.com';
const AUTH_TOKEN = 'Diamond9753!!@@pb';

function makeRequest(path, method = 'POST', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: RENDER_URL,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'x-client-id': 'NONEXISTENT-CLIENT-TEST'
      }
    };
    
    if (body) {
      const postData = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function triggerRealError() {
  console.log('\n=== Triggering Real Error for Stack Trace Test ===\n');
  
  try {
    // Try to call an endpoint with a non-existent client
    // This should trigger a real error in one of the 11 error handlers
    console.log('Attempting to call endpoint with invalid client ID...');
    console.log('This should trigger a "Client not found" or similar error\n');
    
    const response = await makeRequest('/run-post-batch-score', 'POST', {
      runId: 'TEST-STACKTRACE-' + Date.now()
    });
    
    console.log(`Response: ${response.statusCode}`);
    console.log('Body:', JSON.stringify(response.body, null, 2));
    
    console.log('\n✅ Error triggered!');
    console.log('\nNext steps:');
    console.log('1. Wait 10 seconds for error to be logged');
    console.log('2. Run log analyzer');
    console.log('3. Check Production Issues for stack trace');
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log('\n Running analyzer...');
    const analyzeResp = await makeRequest('/api/analyze-logs/recent', 'POST', { minutes: 5 });
    
    if (analyzeResp.statusCode === 200) {
      console.log('✅ Analyzer complete');
      console.log(`Created ${analyzeResp.body.createdRecords || 0} new Production Issue records`);
      
      if (analyzeResp.body.createdRecords > 0) {
        console.log('\n🎯 New issues created! Check Production Issues table for stack traces.');
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

triggerRealError();
