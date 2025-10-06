// Test individual fire-and-forget endpoints
const https = require('https');

async function testEndpoint(path, description) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'pb-webhook-server-staging.onrender.com',
            port: 443,
            path: path,
            method: 'GET',
            headers: {
                'x-webhook-secret': 'Diamond9753!!@@pb'
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                console.log(`\n=== ${description} ===`);
                console.log(`Status: ${res.statusCode}`);
                try {
                    const parsed = JSON.parse(responseData);
                    console.log('Response:', JSON.stringify(parsed, null, 2));
                } catch (e) {
                    console.log('Raw Response:', responseData);
                }
                resolve({ status: res.statusCode, data: responseData });
            });
        });

        req.on('error', (error) => {
            console.error(`Error testing ${description}:`, error);
            reject(error);
        });

        req.end();
    });
}

async function testAllEndpoints() {
    try {
        // Test lead scoring
        await testEndpoint('/run-batch-score-v2?clientId=Dean-Hobin&stream=1&limit=2', 'Lead Scoring');
        
        // Test post harvesting  
        await testEndpoint('/api/apify/process-level2-v2?clientId=Dean-Hobin&stream=1&limit=2', 'Post Harvesting');
        
        // Test post scoring
        await testEndpoint('/run-post-batch-score-v2?clientId=Dean-Hobin&stream=1&limit=2', 'Post Scoring');
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testAllEndpoints();