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

async function getRenderLogs() {
    const apiKey = process.env.RENDER_API_KEY;
    
    if (!apiKey) {
        console.error('❌ RENDER_API_KEY not found in environment variables');
        console.log('Please add your Render API key to your .env file');
        return;
    }

    try {
        console.log('🔍 Fetching ALL Render services...\n');
        
        // First, get the list of services
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
            console.log(`Found ${services.length} services`);
        } else if (services && services.services) {
            services = services.services;
            console.log(`Found ${services.length} services`);
        } else {
            console.error('❌ Unexpected services response format:', services);
            return;
        }

        console.log('📋 Services to analyze:');
        services.forEach((service, index) => {
            const serviceName = service.name || service.service?.name || 'Unknown';
            const serviceType = service.type || service.service?.type || 'Unknown';
            const serviceId = service.id || service.service?.id || 'No ID';
            console.log(`  ${index + 1}. ${serviceName} (${serviceType}) - ${serviceId}`);
        });
        console.log('\n' + '='.repeat(80));

        // Check each service for issues
        const allIssues = {
            totalErrors: 0,
            totalWarnings: 0,
            totalCrashes: 0,
            totalTimeouts: 0,
            servicesWithIssues: [],
            healthyServices: []
        };

        for (let i = 0; i < services.length; i++) {
            const service = services[i];
            const serviceName = service.name || service.service?.name || `Service ${i + 1}`;
            console.log(`\n🔍 [${i + 1}/${services.length}] Analyzing: ${serviceName}`);
            console.log('─'.repeat(60));
            
            const serviceIssues = await checkSingleService(service, apiKey);
            
            // Aggregate issues
            allIssues.totalErrors += serviceIssues.errors;
            allIssues.totalWarnings += serviceIssues.warnings;
            allIssues.totalCrashes += serviceIssues.crashes;
            allIssues.totalTimeouts += serviceIssues.timeouts;
            
            if (serviceIssues.errors > 0 || serviceIssues.crashes > 0 || serviceIssues.timeouts > 0) {
                allIssues.servicesWithIssues.push({
                    name: serviceName,
                    issues: serviceIssues
                });
            } else {
                allIssues.healthyServices.push(serviceName);
            }
        }

        // Summary report
        console.log('\n' + '='.repeat(80));
        console.log('🎯 COMPREHENSIVE RENDER SERVICES ANALYSIS - LAST 24 HOURS');
        console.log('='.repeat(80));
        
        console.log(`\n📊 OVERALL SUMMARY:`);
        console.log(`   🚨 Total Errors: ${allIssues.totalErrors}`);
        console.log(`   💥 Total Crashes: ${allIssues.totalCrashes}`);
        console.log(`   ⏰ Total Timeouts: ${allIssues.totalTimeouts}`);
        console.log(`   ⚠️  Total Warnings: ${allIssues.totalWarnings}`);
        
        if (allIssues.servicesWithIssues.length > 0) {
            console.log(`\n🚨 SERVICES WITH ISSUES (${allIssues.servicesWithIssues.length}):`);
            allIssues.servicesWithIssues.forEach(service => {
                console.log(`   ❌ ${service.name}: ${service.issues.errors} errors, ${service.issues.crashes} crashes, ${service.issues.timeouts} timeouts`);
            });
        }
        
        if (allIssues.healthyServices.length > 0) {
            console.log(`\n✅ HEALTHY SERVICES (${allIssues.healthyServices.length}):`);
            allIssues.healthyServices.forEach(serviceName => {
                console.log(`   ✅ ${serviceName}`);
            });
        }
        
        const totalCriticalIssues = allIssues.totalErrors + allIssues.totalCrashes + allIssues.totalTimeouts;
        if (totalCriticalIssues === 0) {
            console.log(`\n🎉 EXCELLENT! All ${services.length} services are running smoothly with no critical issues!`);
        } else {
            console.log(`\n⚠️  ATTENTION NEEDED: Found ${totalCriticalIssues} critical issues across ${allIssues.servicesWithIssues.length} services.`);
        }

    } catch (error) {
        console.error('❌ Error fetching Render logs:', error.message);
        console.log('\nTroubleshooting:');
        console.log('1. Make sure your RENDER_API_KEY is correct');
        console.log('2. Check that the API key has the right permissions');
        console.log('3. Verify your service name in the Render dashboard');
    }
}

async function checkSingleService(service, apiKey) {
    const serviceName = service.name || service.service?.name || 'Unknown Service';
    const serviceId = service.id || service.service?.id;
    
    const serviceIssues = {
        errors: 0,
        warnings: 0,
        crashes: 0,
        timeouts: 0,
        highLatency: 0,
        deploymentIssues: 0
    };

    if (!serviceId) {
        console.log('⚠️  No service ID found, skipping...');
        return serviceIssues;
    }

    try {
        // Calculate timestamp for 24 hours ago
        const twentyFourHoursAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
        
        // Get service details first
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
        const details = detailsResponse.statusCode === 200 ? detailsResponse.data : null;
        
        // Try events endpoint
        const eventsOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/services/${serviceId}/events?limit=100`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        };

        const eventsResponse = await makeRequest(eventsOptions);
        
        if (eventsResponse.statusCode === 200) {
            const events = eventsResponse.data;
            
            // Filter events from last 24 hours
            const recentEvents = events.filter(event => {
                const eventTime = new Date(event.timestamp).getTime() / 1000;
                return eventTime >= twentyFourHoursAgo;
            });
            
            console.log(`📊 ${recentEvents.length} events in last 24h`);
            
            // Analyze events
            const deployments = recentEvents.filter(e => e.type === 'deploy');
            const builds = recentEvents.filter(e => e.type === 'build');
            const failures = recentEvents.filter(e => e.status === 'failed' || e.type === 'crashed');
            const restarts = recentEvents.filter(e => e.type === 'restart' || e.type === 'restarted');
            const cronRuns = recentEvents.filter(e => e.type === 'run' || e.type === 'execution');
            
            serviceIssues.crashes = failures.length + restarts.length;
            serviceIssues.deploymentIssues = deployments.filter(d => d.status === 'failed').length;
            
            if (recentEvents.length > 0) {
                if (failures.length > 0) {
                    console.log(`   💥 ${failures.length} failures/crashes`);
                    failures.slice(0, 2).forEach(failure => {
                        const timestamp = new Date(failure.timestamp).toLocaleString();
                        console.log(`      [${timestamp}] ${failure.type} - ${failure.status}`);
                    });
                }
                
                if (cronRuns.length > 0) {
                    console.log(`   ⏰ ${cronRuns.length} cron executions`);
                    const failedRuns = cronRuns.filter(run => run.status === 'failed');
                    if (failedRuns.length > 0) {
                        console.log(`   🚨 ${failedRuns.length} failed cron runs`);
                        serviceIssues.errors += failedRuns.length;
                    }
                }
                
                if (deployments.length > 0) {
                    const failedDeploys = deployments.filter(d => d.status === 'failed');
                    if (failedDeploys.length > 0) {
                        console.log(`   🚨 ${failedDeploys.length} failed deployments`);
                    } else {
                        console.log(`   🚀 ${deployments.length} successful deployments`);
                    }
                }
                
                if (failures.length === 0 && serviceIssues.deploymentIssues === 0 && cronRuns.filter(r => r.status === 'failed').length === 0) {
                    console.log(`   ✅ No critical issues detected`);
                }
            } else {
                console.log(`   📊 No recent activity (likely stable)`);
            }
            
        } else {
            console.log(`   ⚠️  Could not fetch events (Status: ${eventsResponse.statusCode})`);
        }

        // Enhanced log analysis for cron jobs AND web services
        if (details && (details.type === 'cron_job' || details.type === 'web_service')) {
            try {
                // For cron jobs, check individual runs for detailed status
                if (details.type === 'cron_job') {
                    console.log(`   🔍 Checking cron job runs for detailed status...`);
                    
                    // Get recent cron job runs from events
                    const cronEvents = eventsResponse.statusCode === 200 ? eventsResponse.data : [];
                    const cronRuns = cronEvents.filter(event => 
                        event.event && event.event.type === 'cron_job_run_ended'
                    );
                    
                    if (cronRuns.length > 0) {
                        console.log(`   📊 Found ${cronRuns.length} recent cron runs`);
                        
                        // Check each cron run for detailed status
                        for (const cronRun of cronRuns.slice(0, 5)) { // Check last 5 runs
                            const runDetails = cronRun.event.details;
                            const timestamp = new Date(cronRun.event.timestamp).toLocaleString();
                            
                            if (runDetails && runDetails.cronJobRunId) {
                                // Try multiple endpoints for run details
                                const runEndpoints = [
                                    `/v1/services/${serviceId}/jobs/${runDetails.cronJobRunId}`,
                                    `/v1/services/${serviceId}/jobs/${runDetails.cronJobRunId}/logs`,
                                    `/v1/jobs/${runDetails.cronJobRunId}`,
                                    `/v1/jobs/${runDetails.cronJobRunId}/logs`
                                ];

                                let foundOutput = false;
                                
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
                                            
                                            // Handle different response formats
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
                                                foundOutput = true;
                                                console.log(`   [${timestamp}] Run ${runDetails.cronJobRunId}: ${runDetails.status}`);
                                                
                                                // ENHANCED: Check for multiple failure patterns in cron output
                                                const patterns = [
                                                    { name: 'Failed Count', regex: /failed:\s*(\d+)/i },
                                                    { name: 'Error Count', regex: /error:\s*(\d+)/i },
                                                    { name: 'Timeout Count', regex: /timeout:\s*(\d+)/i },
                                                    { name: 'Failed to Process', regex: /failed to \w+.*?(\d+)/i },
                                                    { name: 'Processing Failed', regex: /processing.*?failed.*?(\d+)/i },
                                                    { name: 'Could Not Process', regex: /could not process.*?(\d+)/i }
                                                ];
                                                
                                                let runFailures = 0;
                                                patterns.forEach(pattern => {
                                                    const match = output.match(pattern.regex);
                                                    if (match) {
                                                        const count = parseInt(match[1]);
                                                        runFailures += count;
                                                        console.log(`      🚨 ${pattern.name}: ${count} failures detected`);
                                                        serviceIssues.errors += count;
                                                    }
                                                });
                                                
                                                if (runFailures > 0) {
                                                    console.log(`      💥 TOTAL FAILURES IN THIS RUN: ${runFailures}`);
                                                    console.log(`      📄 Output sample: ${output.substring(0, 200)}...`);
                                                } else if (output.toLowerCase().includes('error') || output.toLowerCase().includes('failed')) {
                                                    console.log(`      ⚠️  Output contains error keywords`);
                                                    console.log(`      📄 Output sample: ${output.substring(0, 200)}...`);
                                                    serviceIssues.errors++;
                                                } else {
                                                    console.log(`      ✅ Run completed successfully`);
                                                }
                                                break; // Found output, no need to try other endpoints
                                            }
                                        }
                                    } catch (runError) {
                                        // Continue to next endpoint
                                        continue;
                                    }
                                    
                                    // Add small delay between endpoint attempts
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                }
                                
                                if (!foundOutput) {
                                    console.log(`   [${timestamp}] Run ${runDetails.cronJobRunId}: ${runDetails.status} (no detailed logs available)`);
                                }
                                
                                // Add small delay to avoid rate limiting
                                await new Promise(resolve => setTimeout(resolve, 200));
                            }
                        }
                    }
                }
                
                // Use the correct Render logs API endpoint with proper timestamp format
                const now = new Date();
                const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
                
                // Format timestamps as ISO 8601 strings
                const endTime = now.toISOString();
                const startTime = oneHourAgo.toISOString();
                
                const logsOptions = {
                    hostname: 'api.render.com',
                    port: 443,
                    path: `/v1/logs?ownerId=${encodeURIComponent(details?.ownerId || service.ownerId)}&resource=${serviceId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&limit=100`,
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Accept': 'application/json'
                    }
                };

                const logsResponse = await makeRequest(logsOptions);
                
                console.log(`   🔍 Logs API Status: ${logsResponse.statusCode}`);
                
                if (logsResponse.statusCode === 200) {
                    const logs = logsResponse.data;
                    console.log(`   📊 Raw logs response type: ${typeof logs}, isArray: ${Array.isArray(logs)}`);
                    if (logs && logs.logs) {
                        console.log(`   📊 Found ${logs.logs.length} log entries in logs.logs`);
                        const actualLogs = logs.logs;
                    } else if (Array.isArray(logs)) {
                        console.log(`   📊 Found ${logs.length} log entries directly`);
                        const actualLogs = logs;
                    } else {
                        console.log(`   📊 Unexpected logs structure:`, Object.keys(logs || {}));
                        return serviceIssues;
                    }
                    
                    const actualLogs = logs.logs || logs;
                    if (Array.isArray(actualLogs) && actualLogs.length > 0) {
                        console.log(`   📋 Found ${actualLogs.length} recent log entries`);
                        
                        // Check for errors in logs
                        const errorLogs = actualLogs.filter(log => {
                            const message = (log.message || log.text || '').toLowerCase();
                            return message.includes('error') || message.includes('failed') || message.includes('exception');
                        });
                        
                        // ENHANCED: Check for multiple failure patterns
                        const patterns = [
                            { name: 'Failed Count', regex: /failed:\s*(\d+)/i },
                            { name: 'Error Count', regex: /error:\s*(\d+)/i },
                            { name: 'Timeout Count', regex: /timeout:\s*(\d+)/i },
                            { name: 'Failed to Process', regex: /failed to \w+.*?(\d+)/i },
                            { name: 'Processing Failed', regex: /processing.*?failed.*?(\d+)/i },
                            { name: 'Could Not Process', regex: /could not process.*?(\d+)/i }
                        ];
                        
                        let totalFailures = 0;
                        let failureDetails = [];
                        
                        actualLogs.forEach(log => {
                            const message = log.message || log.text || '';
                            
                            patterns.forEach(pattern => {
                                const match = message.match(pattern.regex);
                                if (match) {
                                    const count = parseInt(match[1]);
                                    totalFailures += count;
                                    failureDetails.push({
                                        type: pattern.name,
                                        count: count,
                                        timestamp: log.timestamp,
                                        message: message
                                    });
                                }
                            });
                        });
                        
                        if (totalFailures > 0) {
                            console.log(`   💥 TOTAL FAILURES DETECTED: ${totalFailures}`);
                            serviceIssues.errors += Math.min(totalFailures, 50); // Cap at 50 to avoid overflow
                            
                            // Show top failure details
                            failureDetails.slice(0, 3).forEach(failure => {
                                console.log(`   🚨 ${failure.type}: ${failure.count} failures`);
                                console.log(`      [${new Date(failure.timestamp).toLocaleString()}] ${failure.message.substring(0, 150)}...`);
                            });
                            
                            if (failureDetails.length > 3) {
                                console.log(`      ... and ${failureDetails.length - 3} more failure patterns`);
                            }
                        }
                        
                        if (errorLogs.length > 0) {
                            console.log(`   🚨 ${errorLogs.length} error logs found`);
                            serviceIssues.errors += errorLogs.length;
                            errorLogs.slice(0, 2).forEach(errorLog => {
                                const timestamp = new Date(errorLog.timestamp).toLocaleString();
                                console.log(`      [${timestamp}] ${errorLog.message || errorLog.text}`);
                            });
                        } else if (totalFailures === 0) {
                            console.log(`   ✅ No errors in recent logs`);
                        }
                    } else {
                        console.log(`   📊 No log entries found in the last hour`);
                    }
                } else {
                    console.log(`   ⚠️  Could not fetch logs (Status: ${logsResponse.statusCode})`);
                    if (logsResponse.data) {
                        console.log(`   📊 Error details: ${JSON.stringify(logsResponse.data).substring(0, 200)}`);
                    }
                }
            } catch (logError) {
                console.log(`   ⚠️  Could not fetch logs: ${logError.message}`);
            }
        }

        // Check service status
        if (details) {
            const status = details.status || 'unknown';
            console.log(`   📈 Status: ${status}`);
            
            // Check for concerning status
            if (status.toLowerCase().includes('fail') || status.toLowerCase().includes('error')) {
                serviceIssues.errors++;
                console.log(`   ⚠️  Service status indicates issues!`);
            }
            
            // Quick health check for web services
            if (details.type === 'web_service' && details.serviceDetails?.url) {
                try {
                    const url = new URL(details.serviceDetails.url);
                    const healthOptions = {
                        hostname: url.hostname,
                        port: url.port || (url.protocol === 'https:' ? 443 : 80),
                        path: '/',
                        method: 'GET',
                        timeout: 5000
                    };
                    
                    const healthResponse = await makeRequest(healthOptions);
                    if (healthResponse.statusCode >= 200 && healthResponse.statusCode < 400) {
                        console.log(`   🏥 Health: ✅ Responding (${healthResponse.statusCode})`);
                    } else if (healthResponse.statusCode >= 400 && healthResponse.statusCode < 500) {
                        // 4xx errors are often normal for API endpoints without specific paths
                        console.log(`   🏥 Health: ⚠️  HTTP ${healthResponse.statusCode} (may be normal for API)`);
                    } else {
                        console.log(`   🏥 Health: ❌ HTTP ${healthResponse.statusCode}`);
                        serviceIssues.errors++;
                    }
                } catch (healthError) {
                    // Don't count JSON parse errors as critical issues for health checks
                    if (healthError.message.includes('JSON') || healthError.message.includes('Unexpected token')) {
                        console.log(`   🏥 Health: ✅ Service responding (HTML response)`);
                    } else {
                        console.log(`   🏥 Health: ❌ ${healthError.message}`);
                        serviceIssues.errors++;
                    }
                }
            }
        }

    } catch (error) {
        console.log(`   ❌ Error checking service: ${error.message}`);
        serviceIssues.errors++;
    }

    return serviceIssues;
}

// Run the comprehensive log check for all services
getRenderLogs();
