// Quick API endpoint validation script
// Run with: node test-api-endpoints.js

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const CLIENT_ID = 'Guy-Wilson';

const endpoints = [
    `/api/linkedin/test?client=${CLIENT_ID}`,
    `/api/linkedin/leads/search?client=${CLIENT_ID}&q=test`,
    // Add more endpoints as needed
];

async function testEndpoint(path) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const isJson = res.headers['content-type']?.includes('application/json');
                resolve({
                    path,
                    status: res.statusCode,
                    isJson,
                    contentType: res.headers['content-type'],
                    success: res.statusCode < 400 && isJson
                });
            });
        });

        req.on('error', (err) => {
            resolve({
                path,
                status: 'ERROR',
                error: err.message,
                success: false
            });
        });

        req.setTimeout(5000, () => {
            req.destroy();
            resolve({
                path,
                status: 'TIMEOUT',
                success: false
            });
        });

        req.end();
    });
}

async function runTests() {
    console.log('🧪 Testing API endpoints...\n');
    
    for (const endpoint of endpoints) {
        const result = await testEndpoint(endpoint);
        const status = result.success ? '✅' : '❌';
        console.log(`${status} ${endpoint}`);
        console.log(`   Status: ${result.status}, JSON: ${result.isJson || false}`);
        if (result.error) console.log(`   Error: ${result.error}`);
        console.log('');
    }
    
    console.log('🎯 Test complete! All endpoints should return JSON with status < 400');
}

runTests().catch(console.error);
