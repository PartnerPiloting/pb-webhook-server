// Test POST endpoints correctly
const https = require('https');

async function testPostEndpoint(path, data, description) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: 'pb-webhook-server-staging.onrender.com',
            port: 443,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': 'Diamond9753!!@@pb',
                'Content-Length': postData.length
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
                    console.log('Raw Response:', responseData.substring(0, 500));
                }
                resolve({ status: res.statusCode, data: responseData });
            });
        });

        req.on('error', (error) => {
            console.error(`Error testing ${description}:`, error);
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

async function testPostEndpoints() {
    try {
        // Test post harvesting with correct POST method
        await testPostEndpoint('/api/apify/process-level2-v2', {
            stream: 1,
            clientId: 'Dean-Hobin'
        }, 'Post Harvesting (POST)');
        
        // Test post scoring with correct POST method
        await testPostEndpoint('/run-post-batch-score-v2', {
            stream: 1,
            limit: 2,
            clientId: 'Dean-Hobin'
        }, 'Post Scoring (POST)');
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testPostEndpoints();