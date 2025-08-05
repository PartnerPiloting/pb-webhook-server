const https = require('https');
require('dotenv').config();

const RENDER_API_KEY = process.env.RENDER_API_KEY;
const TARGET_SERVICE_NAME = 'pb-webhook-server';

// A simple promisified HTTPS request function
function makeRequest(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    if (res.headers['content-type'] && res.headers['content-type'].includes('application/json')) {
                        resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
                    } else {
                        resolve({ statusCode: res.statusCode, data: data });
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse JSON response: ${e.message}. Raw response: ${data}`));
                }
            });
        });
        req.on('error', (error) => {
            reject(error);
        });
        req.end();
    });
}

async function getServiceDetails() {
    console.log('🔍 Fetching service list to find target service...');
    const options = {
        hostname: 'api.render.com',
        port: 443,
        path: '/v1/services',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${RENDER_API_KEY}`,
            'Accept': 'application/json'
        }
    };

    const response = await makeRequest(options);
    if (response.statusCode !== 200) {
        throw new Error(`Could not fetch services. Status: ${response.statusCode}, Body: ${response.data}`);
    }

    const services = response.data;
    const targetService = services.find(s => s.service.name === TARGET_SERVICE_NAME);

    if (!targetService) {
        throw new Error(`Could not find service with name "${TARGET_SERVICE_NAME}"`);
    }
    
    console.log(`✅ Found service: ${targetService.service.name} (ID: ${targetService.service.id})`);
    return {
        serviceId: targetService.service.id,
        ownerId: targetService.ownerId
    };
}

async function viewRawLogs() {
    if (!RENDER_API_KEY) {
        console.error('❌ RENDER_API_KEY not found in .env file.');
        return;
    }

    try {
        const { serviceId, ownerId } = await getServiceDetails();

        console.log(`🔍 Fetching raw logs for service: ${serviceId}`);
        console.log('='.repeat(80));

        let pageCount = 1;
        let totalLogs = 0;
        let hasMore = true;
        
        // Time window: 2025-08-05 from 8:00 AM to 12:00 PM AEST
        // UTC: 2025-08-04 22:00:00 to 2025-08-05 02:00:00
        let startTime = new Date('2025-08-04T22:00:00Z').toISOString();
        let endTime = new Date('2025-08-05T02:00:00Z').toISOString();

        while (hasMore) {
            console.log(`\n--- FETCHING PAGE ${pageCount} ---`);
            console.log(`Requesting logs from ${startTime} to ${endTime}`);

            const path = `/v1/logs?ownerId=${encodeURIComponent(ownerId)}&resource=${serviceId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&limit=100`;
            const options = {
                hostname: 'api.render.com',
                port: 443,
                path: path,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${RENDER_API_KEY}`,
                    'Accept': 'application/json'
                }
            };

            try {
                const response = await makeRequest(options);

                if (response.statusCode !== 200) {
                    console.error(`❌ API Error: Status Code ${response.statusCode}`);
                    console.error('Response:', response.data);
                    break;
                }

                const logs = response.data.logs || [];
                const logCount = logs.length;
                totalLogs += logCount;

                console.log(`✅ Received ${logCount} log entries in this page.`);

                if (logCount > 0) {
                    console.log('--- RAW LOGS FROM THIS PAGE ---');
                    logs.forEach((log) => {
                        console.log(`[${new Date(log.timestamp).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}] ${log.message}`);
                    });
                    console.log('---------------------------------');
                }

                if (response.data.hasMore && response.data.nextStartTime && response.data.nextEndTime) {
                    hasMore = true;
                    startTime = response.data.nextStartTime;
                    endTime = response.data.nextEndTime;
                    pageCount++;
                    console.log('API indicates more logs are available. Fetching next page...');
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    hasMore = false;
                    console.log('\nAPI indicates no more logs are available in this time window.');
                }
            } catch (requestError) {
                console.error('❌ An error occurred during the API request:', requestError);
                hasMore = false;
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log('🎉 Log fetching complete.');
        console.log(`Total pages fetched: ${pageCount}`);
        console.log(`Total log entries received: ${totalLogs}`);
        console.log('This represents ALL the data the API provides for the specified time window.');

    } catch (setupError) {
        console.error('❌ An error occurred during setup:', setupError);
    }
}

viewRawLogs();
