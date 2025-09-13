// test-multitenant-apify.js
// Test script for the new multi-tenant Apify integration
// Run with: node test-multitenant-apify.js

require('dotenv').config();
const { getFetch } = require('./utils/safeFetch');
const fetch = getFetch();

const BASE_URL = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const SECRET = process.env.PB_WEBHOOK_SECRET;
const CLIENT_ID = 'Guy-Wilson'; // Test client

async function testMultiTenantApify() {
    console.log('🧪 Testing Multi-Tenant Apify Integration');
    console.log(`📍 Base URL: ${BASE_URL}`);
    console.log(`👤 Client ID: ${CLIENT_ID}`);
    
    if (!SECRET) {
        console.error('❌ Missing PB_WEBHOOK_SECRET environment variable');
        return;
    }

    try {
        // Test 1: Start a run with client ID
        console.log('\n📤 Test 1: Starting Apify run...');
        
        const runResponse = await fetch(`${BASE_URL}/api/apify/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SECRET}`,
                'x-client-id': CLIENT_ID,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                targetUrls: ['https://linkedin.com/in/annabelle-reed'],
                options: {
                    maxPosts: 1,
                    postedLimit: 'any'
                },
                mode: 'webhook'
            })
        });

        const runData = await runResponse.json();
        console.log(`📊 Run Response:`, runData);

        if (!runData.ok || !runData.runId) {
            console.error('❌ Failed to start run');
            return;
        }

        const runId = runData.runId;
        console.log(`✅ Run started successfully: ${runId}`);

        // Test 2: Check run details
        console.log('\n🔍 Test 2: Checking run details...');
        
        // Wait a moment for the record to be created
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const runDetailsResponse = await fetch(`${BASE_URL}/api/apify/runs/${runId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${SECRET}`
            }
        });

        const runDetails = await runDetailsResponse.json();
        console.log(`📊 Run Details:`, runDetails);

        if (runDetails.ok && runDetails.run) {
            console.log(`✅ Run tracking working: ${runDetails.run.clientId} -> ${runDetails.run.status}`);
        } else {
            console.error('❌ Run tracking failed');
        }

        // Test 3: Check client runs
        console.log('\n📋 Test 3: Checking client runs...');
        
        const clientRunsResponse = await fetch(`${BASE_URL}/api/apify/runs/client/${CLIENT_ID}?limit=5`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${SECRET}`
            }
        });

        const clientRuns = await clientRunsResponse.json();
        console.log(`📊 Client Runs:`, clientRuns);

        if (clientRuns.ok && Array.isArray(clientRuns.runs)) {
            console.log(`✅ Found ${clientRuns.runs.length} runs for client ${CLIENT_ID}`);
            clientRuns.runs.forEach(run => {
                console.log(`   - ${run.runId}: ${run.status} (${run.createdAt})`);
            });
        } else {
            console.error('❌ Failed to fetch client runs');
        }

        // Test 4: Simulate webhook (development only)
        if (process.env.NODE_ENV === 'development') {
            console.log('\n🪝 Test 4: Testing webhook with fake payload...');
            
            const webhookPayload = {
                resource: {
                    id: runId,
                    defaultDatasetId: 'fake-dataset-123',
                    status: 'SUCCEEDED'
                },
                eventType: 'ACTOR.RUN.SUCCEEDED',
                createdAt: new Date().toISOString()
            };

            const webhookResponse = await fetch(`${BASE_URL}/api/apify-webhook`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.APIFY_WEBHOOK_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(webhookPayload)
            });

            const webhookResult = await webhookResponse.json();
            console.log(`📊 Webhook Response:`, webhookResult);

            if (webhookResult.ok) {
                console.log(`✅ Webhook processed successfully for client: ${webhookResult.clientId}`);
            } else {
                console.error('❌ Webhook processing failed');
            }
        }

        console.log('\n🎉 Multi-tenant test completed!');

    } catch (error) {
        console.error('💥 Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Additional test functions
async function testMissingClientId() {
    console.log('\n🚫 Testing missing client ID...');
    
    try {
        const response = await fetch(`${BASE_URL}/api/apify/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SECRET}`,
                'Content-Type': 'application/json'
                // Missing x-client-id header
            },
            body: JSON.stringify({
                targetUrls: ['https://linkedin.com/in/test'],
                options: { maxPosts: 1 }
            })
        });

        const result = await response.json();
        console.log(`📊 Response:`, result);

        if (!result.ok && result.error.includes('x-client-id')) {
            console.log('✅ Correctly rejected request without client ID');
        } else {
            console.error('❌ Should have rejected request without client ID');
        }
    } catch (error) {
        console.error('💥 Test error:', error.message);
    }
}

async function testInvalidClientId() {
    console.log('\n🚫 Testing invalid client ID...');
    
    try {
        const response = await fetch(`${BASE_URL}/api/apify/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SECRET}`,
                'x-client-id': 'NonExistentClient',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                targetUrls: ['https://linkedin.com/in/test'],
                options: { maxPosts: 1 }
            })
        });

        const result = await response.json();
        console.log(`📊 Response:`, result);

        // Note: The run will start but webhook may fail client lookup
        console.log('ℹ️  Run may start but webhook will fail client lookup');
    } catch (error) {
        console.error('💥 Test error:', error.message);
    }
}

// Run all tests
async function runAllTests() {
    await testMultiTenantApify();
    await testMissingClientId();
    await testInvalidClientId();
}

// Execute if run directly
if (require.main === module) {
    runAllTests();
}

module.exports = {
    testMultiTenantApify,
    testMissingClientId,
    testInvalidClientId,
    runAllTests
};
