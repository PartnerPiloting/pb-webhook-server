#!/usr/bin/env node

/**
 * Test script for fire-and-forget lead scoring endpoint
 * Tests /run-batch-score-v2 with 202 Accepted response
 */

require('dotenv').config();

async function testLeadScoringV2() {
  const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
  
  const url = `${baseUrl}/run-batch-score-v2?stream=1&limit=100`;
  console.log(`🧪 Testing fire-and-forget lead scoring: ${url}`);

  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
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
      console.log(`\n✅ SUCCESS: Fire-and-forget lead scoring started!`);
      console.log(`   Job ID: ${data.jobId}`);
      console.log(`   Stream: ${data.stream}`);
      console.log(`   Limit: ${data.limit}`);
      console.log(`   Background processing initiated`);
      
      // Optional: Check job status after a few seconds
      console.log(`\n⏳ Checking job status in 3 seconds...`);
      setTimeout(async () => {
        try {
          const secret = process.env.PB_WEBHOOK_SECRET;
          if (!secret) {
            console.log(`⚠️ Cannot check status without PB_WEBHOOK_SECRET`);
            return;
          }
          
          const statusUrl = `${baseUrl}/debug-clients`;
          const statusResp = await fetch(statusUrl, {
            headers: { 'Authorization': `Bearer ${secret}` }
          });
          const statusData = await statusResp.json();
          
          console.log(`\n📋 Current job status from debug endpoint:`);
          if (statusData.clients && statusData.clients.length > 0) {
            statusData.clients.forEach(client => {
              if (client['Lead Scoring Job Status']) {
                console.log(`   Client ${client.clientId}: ${client['Lead Scoring Job Status']} (${client['Lead Scoring Job ID']})`);
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
testLeadScoringV2().catch(console.error);