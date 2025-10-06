#!/usr/bin/env node

require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

async function testFireAndForgetEndpoint() {
    console.log('🧪 TESTING FIRE-AND-FORGET POST SCORING ENDPOINT');
    console.log('='.repeat(50));
    
    try {
        // Test the new v2 endpoint
        const baseUrl = 'https://pb-webhook-server-staging.onrender.com'; // Staging environment
        const endpoint = '/run-post-batch-score-v2';
        
        console.log('\n1. 🚀 Testing fire-and-forget endpoint...');
        console.log(`   URL: ${baseUrl}${endpoint}`);
        console.log(`   Params: clientId=Guy-Wilson, dryRun=true, limit=2, stream=1`);
        
        const startTime = Date.now();
        
        const response = await fetch(`${baseUrl}${endpoint}?clientId=Guy-Wilson&dryRun=true&limit=2&stream=1`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const responseTime = Date.now() - startTime;
        
        console.log(`\n📊 Response received in ${responseTime}ms`);
        console.log(`   Status: ${response.status}`);
        console.log(`   Status Text: ${response.statusText}`);
        
        const result = await response.json();
        console.log('\n📋 Response body:');
        console.log(JSON.stringify(result, null, 2));
        
        // Analyze the response
        if (response.status === 202) {
            console.log('\n✅ FIRE-AND-FORGET SUCCESS!');
            console.log(`   Job ID: ${result.jobId}`);
            console.log(`   Stream: ${result.stream}`);
            console.log(`   Mode: ${result.mode}`);
            console.log(`   Client: ${result.clientId}`);
            console.log(`   Response time: ${responseTime}ms (should be very fast!)`);
            
            if (responseTime < 5000) {
                console.log('✅ Response time is acceptable (< 5 seconds)');
            } else {
                console.log('⚠️ Response time seems slow for fire-and-forget');
            }
            
            console.log('\n📱 Now check Airtable to see job progress:');
            console.log('   1. Go to Master Clients base');
            console.log('   2. Find Guy Wilson record');
            console.log('   3. Check "Post Scoring Job Status" field');
            console.log('   4. Should show RUNNING, then COMPLETED');
            console.log('   5. Check "Post Scoring Job ID" matches:', result.jobId);
            
        } else if (response.status === 501) {
            console.log('\n⚠️ FIRE-AND-FORGET NOT ENABLED');
            console.log('   Make sure FIRE_AND_FORGET=true in environment variables');
            console.log('   Message:', result.message);
            
        } else {
            console.log(`\n❌ UNEXPECTED RESPONSE: ${response.status}`);
            console.log('   Error:', result.message || result);
        }
        
        console.log('\n🔍 Background Processing Notes:');
        console.log('   - Job is running in background (fire-and-forget)');
        console.log('   - Check Render logs for progress messages');
        console.log('   - Look for 🔄 🎯 ✅ ❌ emoji messages');
        console.log('   - Final 🎉 message when complete');
        
    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 SOLUTION: Make sure your development server is running');
            console.log('   Run: npm run dev:api');
            console.log('   Or: npm run dev:simple');
        }
    }
}

// Wait a bit for any previous operations to settle
setTimeout(() => {
    testFireAndForgetEndpoint();
}, 1000);