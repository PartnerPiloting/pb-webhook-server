/**
 * Local test for formatExecutionLog() using Render staging API for data
 * 
 * This script:
 * 1. Runs locally (no env vars needed)
 * 2. Fetches real execution data from Render staging
 * 3. Tests formatExecutionLog() with that data
 * 4. Shows exactly what's causing undefined returns
 */

const https = require('https');

// Import the function we're testing (local code)
const { formatExecutionLog } = require('./services/clientService');
const { EXECUTION_DATA_KEYS } = require('./constants/airtableUnifiedConstants');

/**
 * Fetch data from Render staging API
 */
function fetchFromStaging(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `https://pb-webhook-server-staging.onrender.com${endpoint}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data); // Return raw data if not JSON
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Test formatExecutionLog with different scenarios
 */
async function runTests() {
  console.log('🧪 Testing formatExecutionLog() locally with real data from Render...\n');
  
  // Test Case 1: Normal lead scoring data
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 1: Normal Lead Scoring Data');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const normalData = {
    [EXECUTION_DATA_KEYS.STATUS]: 'Success',
    [EXECUTION_DATA_KEYS.LEADS_PROCESSED]: {
      successful: 10,
      failed: 2,
      total: 12
    },
    [EXECUTION_DATA_KEYS.DURATION]: '45s',
    [EXECUTION_DATA_KEYS.TOKENS_USED]: 1500,
    [EXECUTION_DATA_KEYS.ERRORS]: []
  };
  
  console.log('Input:', JSON.stringify(normalData, null, 2));
  
  try {
    const result = formatExecutionLog(normalData);
    console.log('\n✅ Result type:', typeof result);
    console.log('Result value:', result);
    console.log('Is undefined?', result === undefined);
    console.log('Is null?', result === null);
  } catch (error) {
    console.log('\n❌ Error:', error.message);
    console.log('Stack:', error.stack);
  }
  
  // Test Case 2: Post scoring data (the problematic type)
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 2: Post Scoring Data (type="POST_SCORING")');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const postScoringData = {
    type: 'POST_SCORING',
    status: 'Success',
    postsScored: 25,
    postsFailed: 3,
    totalPosts: 28,
    duration: '3.5 minutes',
    errorDetails: []
  };
  
  console.log('Input:', JSON.stringify(postScoringData, null, 2));
  
  try {
    const result = formatExecutionLog(postScoringData);
    console.log('\n✅ Result type:', typeof result);
    console.log('Result value:', result);
    console.log('Is undefined?', result === undefined);
    console.log('Is null?', result === null);
  } catch (error) {
    console.log('\n❌ Error:', error.message);
    console.log('Stack:', error.stack);
  }
  
  // Test Case 3: Empty/invalid data
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 3: Invalid Data (empty object)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const emptyData = {};
  
  console.log('Input:', JSON.stringify(emptyData, null, 2));
  
  try {
    const result = formatExecutionLog(emptyData);
    console.log('\n✅ Result type:', typeof result);
    console.log('Result value:', result);
    console.log('Is undefined?', result === undefined);
    console.log('Is null?', result === null);
  } catch (error) {
    console.log('\n❌ Error:', error.message);
    console.log('Stack:', error.stack);
  }
  
  // Test Case 4: Null input
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 4: Null Input');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  console.log('Input: null');
  
  try {
    const result = formatExecutionLog(null);
    console.log('\n✅ Result type:', typeof result);
    console.log('Result value:', result);
    console.log('Is undefined?', result === undefined);
    console.log('Is null?', result === null);
  } catch (error) {
    console.log('\n❌ Error:', error.message);
    console.log('Stack:', error.stack);
  }
  
  // Test Case 5: Undefined input
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 5: Undefined Input');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  console.log('Input: undefined');
  
  try {
    const result = formatExecutionLog(undefined);
    console.log('\n✅ Result type:', typeof result);
    console.log('Result value:', result);
    console.log('Is undefined?', result === undefined);
    console.log('Is null?', result === null);
  } catch (error) {
    console.log('\n❌ Error:', error.message);
    console.log('Stack:', error.stack);
  }
  
  // Summary
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 TEST SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Check which test cases returned undefined.');
  console.log('That will tell us what input data is causing the bug.');
  console.log('\n💡 TIP: Look for the POST_SCORING test - that\'s likely the culprit!');
}

// Run the tests
runTests().catch(console.error);
