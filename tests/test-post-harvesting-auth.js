// Test corrected authentication for post harvesting
const https = require('https');

async function testPostHarvestingAuth() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'pb-webhook-server-staging.onrender.com',
            port: 443,
            path: '/api/apify/process-level2-v2?stream=1&clientId=Dean-Hobin',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer Diamond9753!!@@pb'
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
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
            console.error('Error:', error);
            reject(error);
        });

        req.end();
    });
}

testPostHarvestingAuth();