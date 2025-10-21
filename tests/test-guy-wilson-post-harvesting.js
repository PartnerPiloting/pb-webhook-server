// test-guy-wilson-post-harvesting.js
// Script to test post harvesting for Guy-Wilson client with IGNORE_POST_HARVESTING_LIMITS
// Usage: IGNORE_POST_HARVESTING_LIMITS=true node test-guy-wilson-post-harvesting.js

require('dotenv').config();
const fetch = require('node-fetch');

// Configuration - adjust as needed
const config = {
  clientId: 'Guy-Wilson',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
  webhookSecret: process.env.PB_WEBHOOK_SECRET,
  ignoreLimits: process.env.IGNORE_POST_HARVESTING_LIMITS === 'true'
};

async function testPostHarvesting() {
  try {
    console.log(`🚀 Testing post harvesting for client: ${config.clientId}`);
    console.log(`🔧 IGNORE_POST_HARVESTING_LIMITS=${config.ignoreLimits}`);
    
    const url = `${config.apiBaseUrl}/api/apify/process-client?clientId=${config.clientId}`;
    
    console.log(`📡 Making API call to: ${url}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': config.webhookSecret,
        'x-client-id': config.clientId
      },
      body: JSON.stringify({
        debug: true,  // Enable debug mode for more information
      })
    });
    
    const data = await response.json();
    console.log('\n📊 API Response:');
    console.log(JSON.stringify(data, null, 2));
    
    // Analyze the results
    if (data.ok) {
      console.log('\n✅ Request processed successfully');
      console.log(`📈 Stats: ${data.batches} batches processed`);
      console.log(`🎯 Posts Today: ${data.postsToday} / Target: ${data.postsTarget}`);
      
      // Check if we processed more than the target (which should happen with IGNORE_POST_LIMITS=true)
      if (data.postsToday > data.postsTarget) {
        console.log(`\n🎉 SUCCESS! Processed ${data.postsToday} posts which is more than the target of ${data.postsTarget}`);
        console.log('This confirms IGNORE_POST_LIMITS is working correctly');
      } else if (config.ignoreLimits) {
        console.log(`\n⚠️ NOTE: We didn't exceed the target (${data.postsToday} <= ${data.postsTarget})`);
        console.log('This could be normal if we ran out of eligible leads or hit maxBatches first');
      } else {
        console.log(`\n✅ Normal operation: Stopped at ${data.postsToday} posts (target: ${data.postsTarget})`);
      }
    } else {
      console.log('\n❌ Request failed');
      console.log(data.error || 'Unknown error');
    }
  } catch (error) {
    console.error('\n💥 Error executing test:', error.message);
  }
}

// Execute the test
testPostHarvesting();