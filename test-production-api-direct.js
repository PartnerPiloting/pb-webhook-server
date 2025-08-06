#!/usr/bin/env node

require('dotenv').config();

async function testProductionAPIDirectly() {
    console.log('🔍 TESTING PRODUCTION API DIRECTLY');
    console.log('='.repeat(80));
    console.log('Target: recHkqPSMfdQWyqus');
    
    try {
        const https = require('https');
        
        // Make request to production API
        const options = {
            hostname: 'pb-webhook-server.onrender.com',
            port: 443,
            path: '/score-lead?recordId=recHkqPSMfdQWyqus',
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        };
        
        console.log('\n1. 🌐 Calling production API...');
        console.log(`   URL: https://${options.hostname}${options.path}`);
        
        const result = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                });
            });
            
            req.on('error', (error) => {
                reject(error);
            });
            
            req.end();
        });
        
        console.log(`\n2. 📊 Response Analysis:`);
        console.log(`   Status Code: ${result.statusCode}`);
        console.log(`   Content-Type: ${result.headers['content-type']}`);
        console.log(`   Content-Length: ${result.body.length} characters`);
        
        if (result.statusCode === 200) {
            console.log('   ✅ API call successful!');
            
            // Try to parse as JSON
            try {
                const jsonResponse = JSON.parse(result.body);
                console.log('\n3. 📋 Parsed Response:');
                console.log(`   Type: ${typeof jsonResponse}`);
                
                if (jsonResponse.error) {
                    console.log(`   🚨 Error in response: ${jsonResponse.error}`);
                    console.log(`   📄 Full error details:`, jsonResponse);
                } else if (jsonResponse.success !== undefined) {
                    console.log(`   📈 Success: ${jsonResponse.success}`);
                    console.log(`   📄 Response details:`, jsonResponse);
                } else {
                    console.log(`   📄 Full response:`, jsonResponse);
                }
                
            } catch (parseError) {
                console.log('\n3. ❌ JSON Parse Error:');
                console.log(`   Error: ${parseError.message}`);
                console.log(`   Raw response (first 500 chars):`);
                console.log(`   "${result.body.substring(0, 500)}"`);
                
                // Check if it's HTML error page
                if (result.body.includes('<html>') || result.body.includes('<!DOCTYPE')) {
                    console.log('   🌐 Response appears to be HTML (error page)');
                } else {
                    console.log('   📄 Response is not HTML - raw text response');
                }
            }
            
        } else {
            console.log('   ❌ API call failed!');
            console.log(`   📄 Error response: ${result.body}`);
        }
        
        console.log('\n4. 🎯 Conclusion:');
        if (result.statusCode === 200) {
            console.log('   ✅ API is reachable and responding');
            console.log('   💡 This suggests the issue might be intermittent or fixed');
        } else {
            console.log('   ❌ API returned an error');
            console.log('   💡 This confirms there is an active issue');
        }
        
    } catch (error) {
        console.error('❌ Error testing production API:', error.message);
    }
}

testProductionAPIDirectly();
