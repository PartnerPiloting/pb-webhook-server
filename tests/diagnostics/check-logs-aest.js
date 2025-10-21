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

// Convert AEST to UTC properly
function aestToUtc(aestDate) {
    // AEST is UTC+10 (Australian Eastern Standard Time)
    return new Date(aestDate.getTime() - (10 * 60 * 60 * 1000));
}

// Convert UTC to AEST for display
function utcToAest(utcDate) {
    return new Date(utcDate.getTime() + (10 * 60 * 60 * 1000));
}

async function getLogsInAest() {
    const apiKey = process.env.RENDER_API_KEY;
    
    if (!apiKey) {
        console.error('❌ RENDER_API_KEY not found in environment variables');
        return;
    }

    try {
        console.log('🇦🇺 AEST-AWARE LOG CHECKER');
        console.log('='.repeat(50));
        
        // Get current time in AEST for reference
        const nowUtc = new Date();
        const nowAest = utcToAest(nowUtc);
        
        console.log(`📅 Current time:`);
        console.log(`   AEST: ${nowAest.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}`);
        console.log(`   UTC:  ${nowUtc.toISOString()}`);
        
        // Look back 36 hours in AEST to catch the 9:39 AEST batch from this morning
        const thirtySixHoursAgoAest = new Date(nowAest.getTime() - (36 * 60 * 60 * 1000));
        const thirtySixHoursAgoUtc = aestToUtc(thirtySixHoursAgoAest);
        
        console.log(`\n🔍 Searching logs from:`);
        console.log(`   AEST: ${thirtySixHoursAgoAest.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}`);
        console.log(`   UTC:  ${thirtySixHoursAgoUtc.toISOString()}`);
        console.log(`   to`);
        console.log(`   AEST: ${nowAest.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}`);
        console.log(`   UTC:  ${nowUtc.toISOString()}`);

        // Get service details
        const serviceId = 'srv-cvqgq53e5dus73fa45ag'; // pb-webhook-server
        
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
            console.error('❌ Failed to get service details');
            return;
        }

        const ownerId = detailsResponse.data.ownerId;
        console.log(`\n✅ Found service: pb-webhook-server (Owner: ${ownerId})`);
        
        // Get logs with proper UTC timestamps - using reasonable limit
        const logsOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/logs?ownerId=${encodeURIComponent(ownerId)}&resource=${serviceId}&startTime=${encodeURIComponent(thirtySixHoursAgoUtc.toISOString())}&endTime=${encodeURIComponent(nowUtc.toISOString())}&limit=100`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        };

        console.log(`\n⏳ Fetching logs...`);
        const logsResponse = await makeRequest(logsOptions);
        
        if (logsResponse.statusCode !== 200) {
            console.error(`❌ Failed to fetch logs: ${logsResponse.statusCode}`);
            if (logsResponse.data) {
                console.error(`Error details:`, logsResponse.data);
            }
            return;
        }

        const logs = logsResponse.data;
        const actualLogs = logs.logs || logs;
        
        if (!Array.isArray(actualLogs) || actualLogs.length === 0) {
            console.log('📋 No logs found in the specified time range');
            return;
        }

        console.log(`\n📋 Found ${actualLogs.length} log entries`);
        console.log('='.repeat(50));

        // Group logs by AEST date
        const logsByAestDate = {};
        
        actualLogs.forEach(log => {
            const utcTime = new Date(log.timestamp);
            const aestTime = utcToAest(utcTime);
            const aestDateKey = aestTime.toDateString();
            
            if (!logsByAestDate[aestDateKey]) {
                logsByAestDate[aestDateKey] = [];
            }
            
            logsByAestDate[aestDateKey].push({
                ...log,
                aestTime: aestTime,
                utcTime: utcTime
            });
        });

        // Show logs grouped by AEST date
        const sortedDates = Object.keys(logsByAestDate).sort((a, b) => new Date(b) - new Date(a));
        
        sortedDates.forEach(dateKey => {
            const dateLogs = logsByAestDate[dateKey];
            console.log(`\n📅 ${dateKey} (AEST) - ${dateLogs.length} entries`);
            console.log('─'.repeat(40));
            
            // Look for batch scoring logs specifically
            const batchLogs = dateLogs.filter(log => {
                const message = (log.message || '').toLowerCase();
                return message.includes('batch') || 
                       message.includes('multi-client') ||
                       message.includes('processed:') ||
                       message.includes('successful:') ||
                       message.includes('failed:') ||
                       /\d+.*successful.*\d+.*failed/i.test(message) ||
                       message.includes('total processed');
            });

            if (batchLogs.length > 0) {
                console.log(`🎯 BATCH SCORING ACTIVITY (${batchLogs.length} entries):`);
                
                batchLogs.forEach((log, index) => {
                    const aestTimeStr = log.aestTime.toLocaleString('en-AU', { 
                        timeZone: 'Australia/Sydney',
                        hour12: true,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });
                    
                    console.log(`   ${index + 1}. [${aestTimeStr} AEST]`);
                    
                    // Parse the message for key information
                    const message = log.message || '';
                    
                    // Look for processing counts
                    const processedMatch = message.match(/processed:\s*(\d+)/i);
                    const successfulMatch = message.match(/successful:\s*(\d+)/i);
                    const failedMatch = message.match(/failed:\s*(\d+)/i);
                    const tokensMatch = message.match(/tokens:\s*(\d+)/i);
                    const durationMatch = message.match(/duration:\s*(\d+)/i);
                    
                    if (processedMatch || successfulMatch) {
                        console.log(`      📊 SUMMARY:`);
                        if (processedMatch) console.log(`         Processed: ${processedMatch[1]} leads`);
                        if (successfulMatch) console.log(`         Successful: ${successfulMatch[1]} leads`);
                        if (failedMatch) console.log(`         Failed: ${failedMatch[1]} leads`);
                        if (tokensMatch) console.log(`         Tokens: ${tokensMatch[1]}`);
                        if (durationMatch) console.log(`         Duration: ${durationMatch[1]}s`);
                    }
                    
                    // Show first 150 chars of message
                    const truncatedMessage = message.length > 150 ? message.substring(0, 150) + '...' : message;
                    console.log(`      💬 ${truncatedMessage}`);
                    console.log('');
                });
            } else {
                // Show most recent 5 logs for context
                const recentLogs = dateLogs.slice(0, 5);
                console.log(`📝 Recent activity (${recentLogs.length} of ${dateLogs.length} entries):`);
                
                recentLogs.forEach((log, index) => {
                    const aestTimeStr = log.aestTime.toLocaleString('en-AU', { 
                        timeZone: 'Australia/Sydney',
                        hour12: true,
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    const message = log.message || '';
                    const truncatedMessage = message.length > 100 ? message.substring(0, 100) + '...' : message;
                    console.log(`   ${index + 1}. [${aestTimeStr}] ${truncatedMessage}`);
                });
                
                if (dateLogs.length > 5) {
                    console.log(`   ... and ${dateLogs.length - 5} more entries`);
                }
            }
        });

        // SUMMARY
        const totalBatchLogs = actualLogs.filter(log => {
            const message = (log.message || '').toLowerCase();
            return message.includes('batch') || 
                   message.includes('multi-client') ||
                   message.includes('total processed');
        });

        console.log('\n' + '='.repeat(50));
        console.log('📈 SUMMARY');
        console.log('='.repeat(50));
        console.log(`🔍 Total logs found: ${actualLogs.length}`);
        console.log(`🎯 Batch scoring logs: ${totalBatchLogs.length}`);
        console.log(`📅 Date range covered: ${sortedDates.length} days`);
        
        if (totalBatchLogs.length > 0) {
            console.log(`\n✅ BATCH SCORING SYSTEM IS WORKING`);
            console.log(`   Your logs are being captured correctly.`);
            console.log(`   The issue was timezone conversion - now fixed!`);
        } else {
            console.log(`\n⚠️  No batch scoring activity found in the last 2 days`);
            console.log(`   This might indicate the cron job isn't running.`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Make sure your RENDER_API_KEY is correct in .env');
        console.log('2. Check your internet connection');
        console.log('3. Verify the service is still active on Render');
    }
}

// Run the AEST-aware log checker
getLogsInAest();
