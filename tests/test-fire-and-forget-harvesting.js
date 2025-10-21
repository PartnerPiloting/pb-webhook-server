#!/usr/bin/env node

/**
 * Test script for fire-and-forget post harvesting endpoint
 * Tests /api/apify/process-level2-v2 with 202 Accepted response
 */

require('dotenv').config();

async function testPostHarvestingV2() {
  const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
  const secret = process.env.PB_WEBHOOK_SECRET;

  if (!secret) {
    console.error('❌ PB_WEBHOOK_SECRET environment variable required');
    process.exit(1);
  }

  const url = `${baseUrl}/api/apify/process-level2-v2?stream=1`;
  console.log(`🧪 Testing fire-and-forget post harvesting: ${url}`);

  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/json'
      }
    });

    const responseTime = Date.now() - startTime;
    const data = await response.json();

    console.log(`\n📊 Response Details:`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Response Time: ${responseTime}ms`);
    console.log(`   Data:`, JSON.stringify(data, null, 2));

    if (response.status === 202) {
      console.log(`\n✅ SUCCESS: Fire-and-forget post harvesting started!`);
      console.log(`   Job ID: ${data.jobId}`);
      console.log(`   Stream: ${data.stream}`);
      console.log(`   Background processing initiated`);
      
      // Optional: Check job status after a few seconds
      console.log(`\n⏳ Checking job status in 3 seconds...`);
      setTimeout(async () => {
        try {
          const statusUrl = `${baseUrl}/debug-clients`;
          const statusResp = await fetch(statusUrl, {
            headers: { 'Authorization': `Bearer ${secret}` }
          });
          const statusData = await statusResp.json();
          
          console.log(`\n📋 Current job status from debug endpoint:`);
          if (statusData.clients && statusData.clients.length > 0) {
            statusData.clients.forEach(client => {
              if (client['Post Harvesting Job Status']) {
                console.log(`   Client ${client.clientId}: ${client['Post Harvesting Job Status']} (${client['Post Harvesting Job ID']})`);
              }
            });
          }
        } catch (statusError) {
          console.log(`⚠️ Could not check status: ${statusError.message}`);
        }
      }, 3000);
      
    } else {
      console.log(`\n❌ FAILED: Expected 202 Accepted, got ${response.status}`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`\n❌ REQUEST FAILED: ${error.message}`);
    process.exit(1);
  }
}

// Run the test
testPostHarvestingV2().catch(console.error);