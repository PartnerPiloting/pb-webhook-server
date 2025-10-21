#!/usr/bin/env node

// Test the three operations that smart resume calls to verify authentication works

const baseUrl = 'https://pb-webhook-server-staging.onrender.com';
const secret = 'Diamond9753!!@@pb';

async function testOperation(name, config) {
    console.log(`\n🔍 Testing ${name}...`);
    
    try {
        const fetchOptions = {
            method: config.method,
            headers: {
                'Content-Type': 'application/json',
                ...config.headers
            }
        };
        
        if (config.body) {
            fetchOptions.body = JSON.stringify(config.body);
        }
        
        console.log(`   URL: ${config.method} ${baseUrl}${config.url}`);
        console.log(`   Headers: ${JSON.stringify(config.headers)}`);
        if (config.body) console.log(`   Body: ${JSON.stringify(config.body)}`);
        
        const response = await fetch(`${baseUrl}${config.url}`, fetchOptions);
        const responseData = await response.json();
        
        console.log(`   Response: ${response.status} ${response.statusText}`);
        console.log(`   Data: ${JSON.stringify(responseData).substring(0, 150)}...`);
        
        if (response.status === 202) {
            console.log(`   ✅ SUCCESS: ${name} authenticated correctly`);
            return true;
        } else {
            console.log(`   ❌ FAILED: ${name} authentication failed`);
            return false;
        }
        
    } catch (error) {
        console.log(`   ❌ ERROR: ${name} - ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🚀 Testing Smart Resume Authentication...\n');
    
    const clientId = 'Guy-Wilson';
    const stream = 1;
    const limit = 10;
    
    const operations = {
        'Lead Scoring': {
            url: `/run-batch-score-v2?stream=${stream}&limit=${limit}&clientId=${clientId}`,
            method: 'GET',
            headers: { 'x-webhook-secret': secret }
        },
        'Post Harvesting': {
            url: `/api/apify/process-level2-v2?stream=${stream}&clientId=${clientId}`,
            method: 'POST',
            headers: { 'Authorization': `Bearer ${secret}` }
        },
        'Post Scoring': {
            url: `/run-post-batch-score-v2`,
            method: 'POST',
            headers: { 'x-webhook-secret': secret },
            body: { stream: stream, limit: limit, clientId: clientId }
        }
    };
    
    let successCount = 0;
    
    for (const [name, config] of Object.entries(operations)) {
        const success = await testOperation(name, config);
        if (success) successCount++;
        
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`\n📊 RESULTS: ${successCount}/${Object.keys(operations).length} operations authenticated successfully`);
    
    if (successCount === Object.keys(operations).length) {
        console.log('🎉 All operations working! Smart resume should succeed.');
    } else {
        console.log('❌ Some operations failing. This explains the 0% success rate.');
    }
}

main().catch(console.error);