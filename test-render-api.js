// test-render-api.js
// Quick diagnostic script to test Render API endpoint

require('dotenv').config();
const axios = require('axios');

const RENDER_API_KEY = process.env.RENDER_API_KEY;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID;
const RENDER_OWNER_ID = process.env.RENDER_OWNER_ID;

console.log('🔍 Testing Render API...');
console.log(`Owner ID: ${RENDER_OWNER_ID || 'NOT SET'}`);
console.log(`Service ID: ${RENDER_SERVICE_ID}`);
console.log(`API Key: ${RENDER_API_KEY ? `${RENDER_API_KEY.substring(0, 10)}...` : 'NOT SET'}`);
console.log('');

async function testRenderAPI() {
  try {
    // Test: Get logs using CORRECT endpoint
    console.log('📡 Testing CORRECT Render API endpoint...');
    
    const params = new URLSearchParams({
      ownerId: RENDER_OWNER_ID,
      limit: '10',
      direction: 'backward',
    });
    
    // Add resource filter (service ID)
    params.append('resource[]', RENDER_SERVICE_ID);
    
    const logsUrl = `https://api.render.com/v1/logs?${params.toString()}`;
    console.log(`URL: ${logsUrl.replace(RENDER_OWNER_ID, 'OWNER_ID')}`);
    console.log('');
    
    const logsResponse = await axios.get(logsUrl, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${RENDER_API_KEY}`
      }
    });
    
    console.log('✅ Logs fetched successfully!');
    console.log(`Logs count: ${logsResponse.data.logs?.length || 0}`);
    console.log(`Has more: ${logsResponse.data.hasMore}`);
    console.log('');
    console.log('Sample log:');
    console.log(JSON.stringify(logsResponse.data.logs?.[0], null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error(`Status: ${error.response.status} ${error.response.statusText}`);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    
    console.log('');
    console.log('🔍 Troubleshooting:');
    if (!RENDER_OWNER_ID) {
      console.log('❌ RENDER_OWNER_ID is not set!');
      console.log('   Find your workspace/owner ID in Render dashboard:');
      console.log('   1. Go to Account Settings');
      console.log('   2. Look for "Owner ID" or "Workspace ID"');
      console.log('   3. Add it to your .env file: RENDER_OWNER_ID=own_xxx');
    }
    if (!RENDER_API_KEY) {
      console.log('❌ RENDER_API_KEY is not set!');
    }
    if (error.response?.status === 403) {
      console.log('⚠️  403 Forbidden - Check API key permissions');
    }
    if (error.response?.status === 404) {
      console.log('⚠️  404 Not Found - Check owner ID or service ID');
    }
  }
}

testRenderAPI();
