const https = require('https');
require('dotenv').config();

// Function to make HTTPS requests
function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        data: parsedData
                    });
                } catch (parseError) {
                    resolve({
                        statusCode: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (postData) {
            req.write(postData);
        }

        req.end();
    });
}

async function searchForRecIds() {
    const apiKey = process.env.RENDER_API_KEY;
    
    if (!apiKey) {
        console.error('❌ RENDER_API_KEY not found in environment variables');
        return;
    }

    const recIds = [
        'recr2mjW8eXhM2b58', 'rectnUAx5UsikGaw', 'recvT1lcgvk0FtuJP', 
        'recv389NE535UQlbF', 'recyExlCReyve5Qo', 'recw36hJSqXE3qoGV',
        'recajN29zOHz9lrOQ', 'recypzTRJgRKG4VNI', 'reca4HulSFYBQ1YtL',
        'recmhqMZcXY2QlUjv', 'recoVt4WktzG7ffzw', 'reckofue3pX8Wc4MS',
        'reckUATDnH4k4xwr'
    ];

    try {
        // Check both pb-webhook-server AND the cron jobs
        const serviceIds = [
            { id: 'srv-cvqgq53e5dus73fa45ag', name: 'pb-webhook-server' },
            { id: 'crn-d0ltdp15pdvs738mjod0', name: 'Daily Batch Lead Scoring' },
            { id: 'crn-d190rfp5pdvs73dqqafg', name: 'Daily Batch Post Scoring' }
        ];
        
        for (const service of serviceIds) {
            console.log(`\n🔍 Checking ${service.name} (${service.id})...`);
            
            const detailsOptions = {
                hostname: 'api.render.com',
                port: 443,
                path: `/v1/services/${service.id}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json'
                }
            };

            const detailsResponse = await makeRequest(detailsOptions);
            if (detailsResponse.statusCode !== 200) {
                console.log(`❌ Failed to get details for ${service.name}`);
                continue;
            }
            
            const ownerId = detailsResponse.data.ownerId;
        
        // Extended time range - last 6 hours to catch more activity
        const now = new Date();
        const sixHoursAgo = new Date(now.getTime() - (6 * 60 * 60 * 1000));
        
        console.log(`🔍 Searching for Rec IDs in logs from ${sixHoursAgo.toISOString()} to ${now.toISOString()}`);
        
        const logsOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/logs?ownerId=${encodeURIComponent(ownerId)}&resource=${service.id}&startTime=${encodeURIComponent(sixHoursAgo.toISOString())}&endTime=${encodeURIComponent(now.toISOString())}&limit=100`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        };

        const logsResponse = await makeRequest(logsOptions);
        
        if (logsResponse.statusCode === 200) {
            const logs = logsResponse.data;
            const actualLogs = logs.logs || logs;
            
            if (Array.isArray(actualLogs) && actualLogs.length > 0) {
                console.log(`📋 Searching through ${actualLogs.length} log entries for ${service.name}...\n`);
                
                const foundRecIds = [];
                const batchSummaries = [];
                
                actualLogs.forEach(log => {
                    const message = log.message || log.text || '';
                    const timestamp = new Date(log.timestamp).toLocaleString();
                    
                    // Look for any of our target Rec IDs
                    recIds.forEach(recId => {
                        if (message.includes(recId)) {
                            foundRecIds.push({
                                recId,
                                timestamp,
                                service: service.name,
                                message: message.substring(0, 150) + '...'
                            });
                        }
                    });
                    
                    // Look for batch summary patterns
                    if (message.includes('Multi-client batch scoring completed') || 
                        message.includes('Total processed') ||
                        message.includes('SUMMARY') ||
                        message.includes('Failed: 91') ||
                        message.includes('Successful: 43') ||
                        message.includes('processed: 43')) {
                        batchSummaries.push({
                            timestamp,
                            service: service.name,
                            message
                        });
                    }
                });
                
                if (foundRecIds.length > 0) {
                    console.log(`🎯 FOUND ${foundRecIds.length} MATCHING REC IDs IN ${service.name}:`);
                    foundRecIds.forEach((found, index) => {
                        console.log(`\n${index + 1}. Rec ID: ${found.recId}`);
                        console.log(`   Time: ${found.timestamp}`);
                        console.log(`   Context: ${found.message}`);
                    });
                }
                
                if (batchSummaries.length > 0) {
                    console.log(`\n📊 FOUND ${batchSummaries.length} BATCH SUMMARIES IN ${service.name}:`);
                    batchSummaries.forEach((summary, index) => {
                        console.log(`\n${index + 1}. [${summary.timestamp}]`);
                        console.log(`   ${summary.message}`);
                    });
                }
                
                // Look for any large number patterns that might indicate the 43 leads
                const largeNumberLogs = actualLogs.filter(log => {
                    const message = log.message || log.text || '';
                    return message.match(/\b(43|42|41|40|39|38|37|36|35|34|33|32|31|30)\b/) && 
                           (message.includes('processed') || message.includes('successful') || message.includes('batch'));
                });
                
                if (largeNumberLogs.length > 0) {
                    console.log(`\n🔢 FOUND LOGS WITH LARGE NUMBERS IN ${service.name}:`);
                    largeNumberLogs.forEach((log, index) => {
                        const timestamp = new Date(log.timestamp).toLocaleString();
                        const message = log.message || log.text || '';
                        console.log(`\n${index + 1}. [${timestamp}]`);
                        console.log(`   ${message}`);
                    });
                }
                
            } else {
                console.log(`📊 No log entries found for ${service.name}`);
            }
        } else {
            console.log(`❌ Failed to fetch logs for ${service.name}: ${logsResponse.statusCode}`);
        }
    } // End service loop

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

searchForRecIds();
