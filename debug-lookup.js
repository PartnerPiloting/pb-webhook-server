#!/usr/bin/env node
/**
 * Debug: Check what's in Stack Traces table and Production Issues table
 */

const https = require('https');

const RENDER_URL = 'pb-webhook-server-staging.onrender.com';
const AUTH_TOKEN = 'Diamond9753!!@@pb';

function makeRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: RENDER_URL,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    };
    
    https.get(`https://${RENDER_URL}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

async function debug() {
  console.log('\n=== Debugging Stack Trace Lookup ===\n');
  
  console.log('The Production Issue was created but Stack Trace field is empty.');
  console.log('Let me check if the timestamp extraction and lookup is working...\n');
  
  console.log('Expected flow:');
  console.log('1. Error logged → Stack trace saved to "Stack Traces" table with timestamp');
  console.log('2. STACKTRACE:timestamp marker written to Render logs');
  console.log('3. Analyzer extracts timestamp from logs');
  console.log('4. Analyzer looks up stack trace by timestamp');
  console.log('5. Copies stack trace to Production Issue\n');
  
  console.log('One of steps 1, 3, or 4 is failing.\n');
  
  console.log('To debug, I need to check:');
  console.log('A. Is the stack trace IN the Stack Traces table?');
  console.log('B. Did the analyzer extract the timestamp correctly?');
  console.log('C. Did the lookup by timestamp work?\n');
  
  console.log('Unfortunately, I can\'t access Airtable directly without env vars.');
  console.log('\nCan you check Airtable manually?');
  console.log('\n1. Open Airtable → Master Clients base → "Stack Traces" table');
  console.log('2. Look for recent records (created in last few minutes)');
  console.log('3. Check if there\'s a record with Run ID like "TEST-1760227..."');
  console.log('4. Note the Timestamp value\n');
  
  console.log('Then:');
  console.log('5. Open "Production Issues" table');
  console.log('6. Find the TEST ERROR issue');
  console.log('7. Check what\'s in the Stack Trace field (should be populated but isn\'t)\n');
  
  console.log('This will tell us which step is failing.');
}

debug();
