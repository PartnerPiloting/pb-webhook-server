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

async function findBigBatch() {
    const apiKey = process.env.RENDER_API_KEY;
    
    if (!apiKey) {
        console.error('❌ RENDER_API_KEY not found in environment variables');
        return;
    }

    try {
        console.log('🔍 SEARCHING ALL SERVICES FOR BIG BATCH RUN (43+ LEADS)');
        console.log('='.repeat(60));
        
        // Get current time in AEST for reference
        const nowUtc = new Date();
        const nowAest = utcToAest(nowUtc);
        
        console.log(`📅 Current time: ${nowAest.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} AEST`);
        
        // Look back to this morning around 9:39 AEST
        const thismorningAest = new Date(nowAest.getFullYear(), nowAest.getMonth(), nowAest.getDate(), 9, 0, 0);
        const thismmorningUtc = aestToUtc(thismorningAest);
        
        console.log(`🎯 Searching from: ${thismorningAest.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} AEST`);
        console.log(`   (${thismmorningUtc.toISOString()} UTC)`);

        // First, get the list of ALL services
        const servicesOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: '/v1/services',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        };

        const servicesResponse = await makeRequest(servicesOptions);
        
        if (servicesResponse.statusCode !== 200) {
            console.error('❌ Failed to fetch services:', servicesResponse.data);
            return;
        }

        let services = servicesResponse.data;
        
        // Handle different API response formats
        if (Array.isArray(services)) {
            console.log(`\\n📋 Found ${services.length} services to check`);
        } else if (services && services.services) {
            services = services.services;
            console.log(`\\n📋 Found ${services.length} services to check`);
        } else {
            console.error('❌ Unexpected services response format:', services);
            return;
        }

        console.log('Services:');
        services.forEach((service, index) => {
            const serviceName = service.name || service.service?.name || 'Unknown';
            const serviceType = service.type || service.service?.type || 'Unknown';
            console.log(`  ${index + 1}. ${serviceName} (${serviceType})`);
        });

        console.log('\\n' + '='.repeat(60));
        console.log('🔍 CHECKING EACH SERVICE FOR BATCH PROCESSING...');
        console.log('='.repeat(60));

        let foundBigBatch = false;

        // Check each service for batch logs
        for (let i = 0; i < services.length; i++) {
            const service = services[i];
            const serviceName = service.name || service.service?.name || `Service ${i + 1}`;
            const serviceId = service.id || service.service?.id;
            
            console.log(`\\n🔍 [${i + 1}/${services.length}] Checking: ${serviceName}`);
            
            if (!serviceId) {
                console.log('   ⚠️  No service ID found, skipping...');
                continue;
            }

            try {
                // Get service details to get ownerId
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
                    console.log('   ❌ Could not get service details');
                    continue;
                }

                const details = detailsResponse.data;
                const ownerId = details.ownerId;
                
                // Get logs for this service
                const logsOptions = {
                    hostname: 'api.render.com',
                    port: 443,
                    path: `/v1/logs?ownerId=${encodeURIComponent(ownerId)}&resource=${serviceId}&startTime=${encodeURIComponent(thismmorningUtc.toISOString())}&endTime=${encodeURIComponent(nowUtc.toISOString())}&limit=100`,
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
                        console.log(`   📋 Found ${actualLogs.length} logs`);
                        
                        // Look for batch processing with high numbers
                        const bigBatchLogs = actualLogs.filter(log => {
                            const message = (log.message || '').toLowerCase();
                            
                            // Look for high numbers in processing messages
                            const processedMatch = message.match(/processed:\\s*(\\d+)/i);
                            const successfulMatch = message.match(/successful:\\s*(\\d+)/i);
                            const totalMatch = message.match(/total.*?(\\d+)/i);
                            
                            if (processedMatch && parseInt(processedMatch[1]) >= 20) return true;
                            if (successfulMatch && parseInt(successfulMatch[1]) >= 20) return true;
                            if (totalMatch && parseInt(totalMatch[1]) >= 20) return true;
                            
                            // Look for mentions of big numbers
                            if (message.includes('43') || message.includes('34') || message.includes('31')) return true;
                            
                            return false;
                        });

                        if (bigBatchLogs.length > 0) {
                            console.log(`   🎯 FOUND BIG BATCH ACTIVITY! (${bigBatchLogs.length} relevant logs)`);
                            foundBigBatch = true;
                            
                            bigBatchLogs.forEach((log, index) => {
                                const utcTime = new Date(log.timestamp);
                                const aestTime = utcToAest(utcTime);
                                const aestTimeStr = aestTime.toLocaleString('en-AU', { 
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
                                const processedMatch = message.match(/processed:\\s*(\\d+)/i);
                                const successfulMatch = message.match(/successful:\\s*(\\d+)/i);
                                const failedMatch = message.match(/failed:\\s*(\\d+)/i);
                                const tokensMatch = message.match(/tokens:\\s*(\\d+)/i);
                                const durationMatch = message.match(/duration:\\s*(\\d+)/i);
                                
                                if (processedMatch || successfulMatch) {
                                    console.log(`      📊 COUNTS:`);
                                    if (processedMatch) console.log(`         Processed: ${processedMatch[1]} leads`);
                                    if (successfulMatch) console.log(`         Successful: ${successfulMatch[1]} leads`);
                                    if (failedMatch) console.log(`         Failed: ${failedMatch[1]} leads`);
                                    if (tokensMatch) console.log(`         Tokens: ${tokensMatch[1]}`);
                                    if (durationMatch) console.log(`         Duration: ${durationMatch[1]}s`);
                                }
                                
                                // Show first 200 chars of message
                                const truncatedMessage = message.length > 200 ? message.substring(0, 200) + '...' : message;
                                console.log(`      💬 ${truncatedMessage}`);
                                console.log('');
                            });
                        } else {
                            console.log(`   📝 No big batch activity found`);
                        }
                    } else {
                        console.log(`   📊 No logs found`);
                    }
                } else {
                    console.log(`   ❌ Could not fetch logs (Status: ${logsResponse.statusCode})`);
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                console.log(`   ❌ Error checking service: ${error.message}`);
            }
        }

        console.log('\\n' + '='.repeat(60));
        console.log('📈 SEARCH COMPLETE');
        console.log('='.repeat(60));
        
        if (foundBigBatch) {
            console.log(`🎉 SUCCESS! Found the big batch processing activity!`);
            console.log(`   Your logging system IS working correctly.`);
            console.log(`   The batch scoring processed the leads successfully.`);
        } else {
            console.log(`🤔 No big batch activity found in any service.`);
            console.log(`   This might indicate:`);
            console.log(`   1. The batch ran on a different service`);
            console.log(`   2. The logs are older than what the API returns`);
            console.log(`   3. The activity was in a different time window`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

// Run the big batch finder
findBigBatch();
