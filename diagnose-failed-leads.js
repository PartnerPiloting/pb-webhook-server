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

async function extractFailedLeadDetails() {
    const apiKey = process.env.RENDER_API_KEY;
    
    if (!apiKey) {
        console.error('❌ RENDER_API_KEY not found in environment variables');
        return;
    }

    try {
        console.log('🔍 DIAGNOSTIC: Extracting Failed Lead Details from Render Logs');
        console.log('='.repeat(80));
        
        // Get Daily Batch Lead Scoring service
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
        let services = servicesResponse.data;
        
        // Extract actual service objects from the response
        if (Array.isArray(services)) {
            services = services.map(item => item.service || item);
        } else if (services && services.services) {
            services = services.services;
        }

        // Find the lead scoring service - try multiple patterns
        console.log('\n🔍 Available services:');
        services.forEach(service => {
            console.log(`   - ${service.name} (${service.type})`);
        });

        let leadScoringService = services.find(service => 
            (service.name || '').toLowerCase().includes('lead') && 
            (service.name || '').toLowerCase().includes('scoring')
        );

        // Try alternative patterns
        if (!leadScoringService) {
            leadScoringService = services.find(service => 
                (service.name || '').toLowerCase().includes('batch') && 
                (service.name || '').toLowerCase().includes('lead')
            );
        }

        if (!leadScoringService) {
            leadScoringService = services.find(service => 
                (service.name || '').toLowerCase().includes('daily')
            );
        }

        if (!leadScoringService) {
            console.error('❌ Could not find Daily Batch Lead Scoring service');
            console.log('Available services:');
            services.forEach(service => {
                console.log(`   ${service.name} (${service.type})`);
            });
            return;
        }

        console.log(`📋 Found service: ${leadScoringService.name}`);
        console.log(`🆔 Service ID: ${leadScoringService.id}`);

        // Get recent events to find cron runs
        const eventsOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/services/${leadScoringService.id}/events?limit=50`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        };

        const eventsResponse = await makeRequest(eventsOptions);
        const events = eventsResponse.data;

        // Find recent cron job runs
        const cronRuns = events.filter(event => 
            event.event && event.event.type === 'cron_job_run_ended'
        );

        console.log(`\n📊 Found ${cronRuns.length} recent cron runs`);

        let failedLeadDetails = [];
        let successfulLeadIds = [];
        let allProcessingData = [];

        // Check the most recent runs for detailed output
        for (const cronRun of cronRuns.slice(0, 3)) {
            const runDetails = cronRun.event.details;
            const timestamp = new Date(cronRun.event.timestamp).toLocaleString();
            
            console.log(`\n🔍 Analyzing run from ${timestamp}`);
            
            if (runDetails && runDetails.cronJobRunId) {
                // Try to get the detailed output from this run
                const runEndpoints = [
                    `/v1/services/${leadScoringService.id}/jobs/${runDetails.cronJobRunId}`,
                    `/v1/services/${leadScoringService.id}/jobs/${runDetails.cronJobRunId}/logs`,
                    `/v1/jobs/${runDetails.cronJobRunId}`,
                    `/v1/jobs/${runDetails.cronJobRunId}/logs`
                ];

                for (const endpoint of runEndpoints) {
                    try {
                        const runOptions = {
                            hostname: 'api.render.com',
                            port: 443,
                            path: endpoint,
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Accept': 'application/json'
                            }
                        };

                        const runResponse = await makeRequest(runOptions);
                        if (runResponse.statusCode === 200) {
                            let output = '';
                            let runData = runResponse.data;
                            
                            // Extract output from different response formats
                            if (typeof runData === 'string') {
                                output = runData;
                            } else if (runData && runData.output) {
                                output = runData.output;
                            } else if (runData && runData.logs) {
                                output = Array.isArray(runData.logs) ? runData.logs.map(l => l.message || l.text || l).join('\n') : runData.logs;
                            } else if (Array.isArray(runData)) {
                                output = runData.map(item => item.message || item.text || item).join('\n');
                            }
                            
                            if (output && output.length > 0) {
                                console.log(`   ✅ Found output from ${endpoint}`);
                                
                                // Parse the output for structured data
                                const outputLines = output.split('\n');
                                
                                // Look for JSON logs that contain lead processing details
                                outputLines.forEach(line => {
                                    try {
                                        const logData = JSON.parse(line);
                                        
                                        // Check if this is a client results log
                                        if (logData.clientResults && Array.isArray(logData.clientResults)) {
                                            allProcessingData.push({
                                                timestamp: timestamp,
                                                runId: runDetails.cronJobRunId,
                                                data: logData
                                            });
                                            
                                            logData.clientResults.forEach(client => {
                                                if (client.errorDetails && Array.isArray(client.errorDetails)) {
                                                    client.errorDetails.forEach(error => {
                                                        failedLeadDetails.push({
                                                            timestamp: timestamp,
                                                            runId: runDetails.cronJobRunId,
                                                            clientId: client.clientId || client.clientName,
                                                            leadId: error.leadId,
                                                            error: error.message || error.error || error,
                                                            errorCode: error.code,
                                                            rawError: error
                                                        });
                                                    });
                                                }
                                                
                                                // Also collect successful lead IDs for comparison
                                                if (client.successfulLeads && Array.isArray(client.successfulLeads)) {
                                                    successfulLeadIds.push(...client.successfulLeads.map(lead => ({
                                                        clientId: client.clientId || client.clientName,
                                                        leadId: lead.leadId || lead.id || lead,
                                                        timestamp: timestamp
                                                    })));
                                                }
                                            });
                                        }
                                        
                                        // Check for other types of lead processing data
                                        if (logData.failedLeads && Array.isArray(logData.failedLeads)) {
                                            logData.failedLeads.forEach(lead => {
                                                failedLeadDetails.push({
                                                    timestamp: timestamp,
                                                    runId: runDetails.cronJobRunId,
                                                    leadId: lead.id || lead.leadId,
                                                    error: lead.error || lead.message,
                                                    rawError: lead
                                                });
                                            });
                                        }
                                        
                                        if (logData.processedLeads && Array.isArray(logData.processedLeads)) {
                                            logData.processedLeads.forEach(lead => {
                                                if (lead.status === 'failed' || lead.error) {
                                                    failedLeadDetails.push({
                                                        timestamp: timestamp,
                                                        runId: runDetails.cronJobRunId,
                                                        leadId: lead.id || lead.leadId,
                                                        error: lead.error || lead.message,
                                                        status: lead.status,
                                                        rawError: lead
                                                    });
                                                }
                                            });
                                        }
                                        
                                    } catch (parseError) {
                                        // Not JSON, continue
                                    }
                                });
                                
                                // Also look for plain text failure patterns
                                const failurePatterns = [
                                    /Lead ID: (\w+).*?failed.*?error: (.+)/gi,
                                    /Processing lead (\w+).*?error: (.+)/gi,
                                    /Failed to process lead (\w+): (.+)/gi,
                                    /Error processing (\w+): (.+)/gi
                                ];
                                
                                failurePatterns.forEach(pattern => {
                                    let match;
                                    while ((match = pattern.exec(output)) !== null) {
                                        failedLeadDetails.push({
                                            timestamp: timestamp,
                                            runId: runDetails.cronJobRunId,
                                            leadId: match[1],
                                            error: match[2],
                                            source: 'text_pattern'
                                        });
                                    }
                                });
                                
                                break; // Found output, no need to try other endpoints
                            }
                        }
                    } catch (runError) {
                        continue;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Analyze the collected data
        console.log('\n' + '='.repeat(80));
        console.log('📊 FAILED LEADS ANALYSIS');
        console.log('='.repeat(80));

        if (failedLeadDetails.length === 0) {
            console.log('❌ No specific failed lead details found in the logs');
            console.log('This suggests the logs might contain only summary information');
            
            // Show what we did find
            if (allProcessingData.length > 0) {
                console.log('\n📋 Found general processing data:');
                allProcessingData.forEach((data, index) => {
                    console.log(`\n   📊 Processing Run #${index + 1} (${data.timestamp}):`);
                    if (data.data.summary) {
                        Object.entries(data.data.summary).forEach(([key, value]) => {
                            console.log(`      ${key}: ${value}`);
                        });
                    }
                    if (data.data.clientResults) {
                        data.data.clientResults.forEach(client => {
                            console.log(`      Client ${client.clientId || 'Unknown'}: ${client.failed || 0} failed, ${client.successful || 0} successful`);
                        });
                    }
                });
            }
            
            return;
        }

        console.log(`🚨 Found ${failedLeadDetails.length} failed lead instances`);

        // Group by lead ID to find consistently failing leads
        const leadFailureMap = {};
        failedLeadDetails.forEach(failure => {
            if (!leadFailureMap[failure.leadId]) {
                leadFailureMap[failure.leadId] = [];
            }
            leadFailureMap[failure.leadId].push(failure);
        });

        console.log(`📋 Unique leads that failed: ${Object.keys(leadFailureMap).length}`);

        // Analyze each failing lead
        console.log('\n🔍 DETAILED ANALYSIS OF EACH FAILING LEAD:');
        console.log('─'.repeat(80));

        Object.entries(leadFailureMap).forEach(([leadId, failures], index) => {
            console.log(`\n${index + 1}. LEAD ID: ${leadId}`);
            console.log(`   🔄 Failed ${failures.length} times across different runs`);
            
            // Show the most recent failure details
            const recentFailure = failures[0];
            console.log(`   📅 Most recent failure: ${recentFailure.timestamp}`);
            console.log(`   🏷️  Client: ${recentFailure.clientId || 'Unknown'}`);
            console.log(`   ❌ Error: ${recentFailure.error}`);
            if (recentFailure.errorCode) {
                console.log(`   🔢 Error Code: ${recentFailure.errorCode}`);
            }
            
            // Analyze error patterns for this lead
            const errorTypes = [...new Set(failures.map(f => f.error))];
            if (errorTypes.length > 1) {
                console.log(`   🔄 Multiple error types seen:`);
                errorTypes.forEach(error => {
                    const count = failures.filter(f => f.error === error).length;
                    console.log(`      • ${error} (${count} times)`);
                });
            } else {
                console.log(`   🎯 Consistent error: ${errorTypes[0]}`);
            }
            
            // Show raw error data for debugging
            if (recentFailure.rawError && typeof recentFailure.rawError === 'object') {
                console.log(`   📋 Raw error data:`);
                Object.entries(recentFailure.rawError).forEach(([key, value]) => {
                    if (key !== 'message' && key !== 'error') {
                        console.log(`      ${key}: ${value}`);
                    }
                });
            }
        });

        // Error categorization
        console.log('\n' + '='.repeat(80));
        console.log('📊 ERROR CATEGORIZATION');
        console.log('='.repeat(80));

        const errorCategories = {};
        failedLeadDetails.forEach(failure => {
            const error = failure.error.toLowerCase();
            let category = 'Other';
            
            if (error.includes('auth') || error.includes('unauthorized') || error.includes('forbidden')) {
                category = 'Authentication';
            } else if (error.includes('timeout') || error.includes('timed out')) {
                category = 'Timeout';
            } else if (error.includes('network') || error.includes('connection')) {
                category = 'Network';
            } else if (error.includes('validation') || error.includes('invalid') || error.includes('missing')) {
                category = 'Validation';
            } else if (error.includes('api') || error.includes('endpoint')) {
                category = 'API';
            } else if (error.includes('json') || error.includes('parse')) {
                category = 'Data Format';
            } else if (error.includes('rate limit') || error.includes('quota')) {
                category = 'Rate Limiting';
            }
            
            if (!errorCategories[category]) {
                errorCategories[category] = [];
            }
            errorCategories[category].push(failure);
        });

        Object.entries(errorCategories).forEach(([category, failures]) => {
            console.log(`\n🔴 ${category}: ${failures.length} failures`);
            const uniqueErrors = [...new Set(failures.map(f => f.error))];
            uniqueErrors.slice(0, 3).forEach(error => {
                const count = failures.filter(f => f.error === error).length;
                console.log(`   • ${error} (${count} leads)`);
            });
            if (uniqueErrors.length > 3) {
                console.log(`   ... and ${uniqueErrors.length - 3} more error types`);
            }
        });

        // Recommendations
        console.log('\n' + '='.repeat(80));
        console.log('🎯 RECOMMENDATIONS');
        console.log('='.repeat(80));

        console.log('\n📋 Next Steps:');
        
        if (Object.keys(leadFailureMap).length <= 10) {
            console.log('1. 🔍 Test each failing lead individually:');
            Object.keys(leadFailureMap).slice(0, 5).forEach(leadId => {
                console.log(`   node test-single-lead.js ${leadId}`);
            });
        }
        
        const topErrorCategory = Object.entries(errorCategories).sort((a, b) => b[1].length - a[1].length)[0];
        if (topErrorCategory) {
            console.log(`\n2. 🎯 Focus on ${topErrorCategory[0]} errors first (${topErrorCategory[1].length} failures)`);
        }
        
        console.log('\n3. 📊 Create individual lead test script to validate fixes');
        console.log('4. 🔧 Implement targeted fixes based on error categories');
        console.log('5. 📈 Monitor failure rate after fixes');

    } catch (error) {
        console.error('❌ Error extracting failed lead details:', error.message);
    }
}

// Run the diagnostic
extractFailedLeadDetails();
