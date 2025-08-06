const https = require('https');
require('dotenv').config();

// A simple, targeted function to test Render's log API
async function simpleLogTest() {
    console.log("--- Starting Simple, Targeted Render Log Test ---");

    const apiKey = process.env.RENDER_API_KEY;
    if (!apiKey) {
        console.error('❌ RENDER_API_KEY not found in .env file.');
        return;
    }

    const serviceName = 'pb-webhook-server';
    let serviceId;
    let ownerId;

    // 1. Find the service to get its ID and Owner ID
    try {
        console.log(`\n1. Finding service ID for "${serviceName}"...`);
        const servicesOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: '/v1/services',
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
        };
        const servicesResponse = await makeRequest(servicesOptions);
        const services = JSON.parse(servicesResponse.data);
        const targetService = services.find(s => s.service.name === serviceName);

        if (!targetService) {
            console.error(`❌ Could not find a service named "${serviceName}"`);
            return;
        }
        serviceId = targetService.service.id;
        ownerId = targetService.ownerId;
        console.log(`   ✅ Found Service ID: ${serviceId}`);
        console.log(`   ✅ Found Owner ID: ${ownerId}`);
    } catch (error) {
        console.error('   ❌ Error fetching services:', error.message);
        return;
    }

    // 2. Define a narrow time window for the test
    // We are targeting logs from today, August 5, 2025. Let's check a window
    // from 8:00 AM to 12:00 PM AEST on August 5th.
    const startTime = new Date('2025-08-04T22:00:00Z').toISOString();
    const endTime = new Date('2025-08-05T02:00:00Z').toISOString();

    console.log(`\n2. Defined test time window (UTC):`);
    console.log(`   Start: ${startTime}`);
    console.log(`   End:   ${endTime}`);

    // 3. Construct the specific API request URL
    const logPath = `/v1/logs?ownerId=${encodeURIComponent(ownerId)}&resource=${serviceId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&limit=100`;
    const fullUrl = `https://api.render.com${logPath}`;

    console.log('\n3. Constructed the exact API URL to be requested:');
    console.log(`   ${fullUrl}`);

    // 4. Make the API call
    try {
        console.log('\n4. Executing the API request...');
        const logOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: logPath,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
        };
        const logsResponse = await makeRequest(logOptions);
        const responseData = JSON.parse(logsResponse.data);
        const logs = responseData.logs || [];

        console.log('\n5. --- TEST RESULTS ---');
        if (logsResponse.statusCode !== 200) {
            console.log(`   🔴 FAILED: API returned status code ${logsResponse.statusCode}`);
            console.log(`   Response: ${logsResponse.data}`);
            return;
        }

        console.log(`   ✅ SUCCESS: API returned status code 200.`);
        console.log(`   📄 Total logs found in this specific window: ${logs.length}`);

        if (logs.length > 0) {
            console.log('\n   Sample of logs found:');
            logs.slice(0, 5).forEach((log, index) => {
                console.log(`   [${index + 1}] ${new Date(log.timestamp).toISOString()} - ${log.message}`);
            });
        } else {
            console.log('\n   ⚠️  The API returned ZERO logs for this specific time window.');
            console.log('   This strongly suggests that the detailed batch logs visible in the web UI are not available via this API endpoint.');
        }

    } catch (error) {
        console.error('   ❌ An error occurred during the API request:', error.message);
    }
    console.log("\n--- Test Complete ---");
}

// Helper function to make HTTPS requests
function makeRequest(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, data: data });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

simpleLogTest();
