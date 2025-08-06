const https = require('https');
require('dotenv').config();

const RENDER_API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = 'srv-cq178k5a73kc73csm7p0'; // pb-webhook-server

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
                    resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    // Handle cases where the response is not JSON
                    resolve({ statusCode: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.end();
    });
}

async function viewRawLogs() {
    if (!RENDER_API_KEY) {
        console.error('❌ RENDER_API_KEY not found in .env file.');
        return;
    }

    console.log(`🔍 Fetching raw logs for service: ${SERVICE_ID}`);
    console.log('='.repeat(80));

    let pageCount = 1;
    let totalLogs = 0;

    // Time window: 2025-08-05 from 8:00 AM to 12:00 PM AEST
    // UTC: 2025-08-04 22:00:00 to 2025-08-05 02:00:00
    let startTime = new Date('2025-08-04T22:00:00Z').toISOString();
    let endTime = new Date('2025-08-05T02:00:00Z').toISOString();
    let hasMore = true;

    while (hasMore) {
        console.log(`\n--- FETCHING PAGE ${pageCount} ---`);
        console.log(`Requesting logs from ${startTime} to ${endTime}`);

        const options = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/services/${SERVICE_ID}/logs?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&limit=100`,
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
                console.log('--- SAMPLE LOGS FROM THIS PAGE ---');
                // Print first 5 logs as samples
                logs.slice(0, 5).forEach((log, index) => {
                    console.log(`  [Sample ${index + 1}] Timestamp: ${log.timestamp}`);
                    console.log(`             Message: ${log.message.substring(0, 150)}...`);
                });
                 if (logCount > 5) {
                    console.log(`  (...and ${logCount - 5} more logs in this page)`);
                }
                console.log('------------------------------------');
            }


            // Check for pagination
            if (response.data.hasMore && response.data.nextStartTime && response.data.nextEndTime) {
                hasMore = true;
                startTime = response.data.nextStartTime;
                endTime = response.data.nextEndTime;
                pageCount++;
                console.log('API indicates more logs are available. Fetching next page...');
                 // Add a small delay to be polite to the API
                await new Promise(resolve => setTimeout(resolve, 500));
            } else {
                hasMore = false;
                console.log('\nAPI indicates no more logs are available in this time window.');
            }

        } catch (error) {
            console.error('❌ An error occurred during the request:', error);
            hasMore = false;
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎉 Log fetching complete.');
    console.log(`Total pages fetched: ${pageCount}`);
    console.log(`Total log entries received: ${totalLogs}`);
    console.log('This represents ALL the data the API provides for the specified time window.');
}

viewRawLogs();
