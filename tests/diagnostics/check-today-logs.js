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

async function getTodayLogs() {
    const apiKey = process.env.RENDER_API_KEY;
    
    if (!apiKey) {
        console.error('❌ RENDER_API_KEY not found in environment variables');
        return;
    }

    try {
        // First get service details to get ownerId
        const serviceId = 'srv-cvqgq53e5dus73fa45ag';
        
        const detailsOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/services/${serviceId}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        };

        const detailsResponse = await makeRequest(detailsOptions);
        
        if (detailsResponse.statusCode !== 200) {
            console.error('❌ Failed to get service details:', detailsResponse.data);
            return;
        }
        
        const ownerId = detailsResponse.data.ownerId;
        console.log(`✅ Got ownerId: ${ownerId}`);
        
        // Extended date range - include yesterday to capture AEST logs that appear as previous day in UTC
        const now = new Date();
        const yesterdayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
        
        console.log(`🔍 Checking logs for pb-webhook-server from ${yesterdayUTC.toISOString()} to ${now.toISOString()} (including AEST logs from yesterday UTC)`);
        
        const logsOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/logs?ownerId=${encodeURIComponent(ownerId)}&resource=${serviceId}&startTime=${encodeURIComponent(yesterdayUTC.toISOString())}&endTime=${encodeURIComponent(now.toISOString())}&limit=200`,
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
                console.log(`📋 Found ${actualLogs.length} log entries for today\n`);
                
                // Look for batch scoring related logs
                const batchLogs = actualLogs.filter(log => {
                    const message = log.message || log.text || '';
                    return message.includes('batch') || 
                           message.includes('Multi-client') || 
                           message.includes('BATCH_SCORER') ||
                           message.includes('SESSION') ||
                           message.includes('processed') ||
                           message.includes('Successful') ||
                           message.includes('Failed');
                });
                
                if (batchLogs.length > 0) {
                    console.log(`🎯 Found ${batchLogs.length} batch-related log entries:\n`);
                    
                    batchLogs.forEach((log, index) => {
                        const timestamp = new Date(log.timestamp).toLocaleString();
                        const message = log.message || log.text || '';
                        console.log(`${index + 1}. [${timestamp}] ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}\n`);
                    });
                } else {
                    console.log('📊 No batch-related logs found for today');
                }
                
                // Look for any "Total processed" patterns
                const summaryLogs = actualLogs.filter(log => {
                    const message = log.message || log.text || '';
                    return message.includes('Total processed') || 
                           message.includes('Multi-client batch scoring completed');
                });
                
                if (summaryLogs.length > 0) {
                    console.log(`\n📈 SUMMARY LOGS (${summaryLogs.length} found):`);
                    summaryLogs.forEach((log, index) => {
                        const timestamp = new Date(log.timestamp).toLocaleString();
                        const message = log.message || log.text || '';
                        console.log(`\n${index + 1}. [${timestamp}]`);
                        console.log(`${message}`);
                    });
                }
                
            } else {
                console.log('📊 No log entries found for today');
            }
        } else {
            console.error(`❌ Failed to fetch logs: ${logsResponse.statusCode}`);
            console.error('Response:', logsResponse.data);
        }

    } catch (error) {
        console.error('❌ Error fetching logs:', error.message);
    }
}

getTodayLogs();
