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
        console.log('🎯 COMPREHENSIVE RENDER SERVICES ANALYSIS - LAST 5 DAYS (WITH FULL PAGINATION)');
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

// COMPREHENSIVE PAGINATION FUNCTION - Fetches ALL available logs
async function fetchAllLogsWithPagination(serviceId, ownerId, apiKey) {
    const allLogs = [];
    let pageCount = 0;
    let totalLogsFetched = 0;
    
    console.log(`   🚀 Starting comprehensive log retrieval...`);
    
    // Start from 5 days ago to capture all recent activity (within most retention periods)
    const fiveDaysAgo = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000));
    const now = new Date();
    
    let currentStartTime = fiveDaysAgo.toISOString();
    let currentEndTime = now.toISOString();
    
    // Use smaller time windows for better pagination control
    const timeWindowHours = 6; // 6-hour windows to balance API calls vs completeness
    
    while (new Date(currentStartTime) < now) {
        const windowEnd = new Date(Math.min(
            new Date(currentStartTime).getTime() + (timeWindowHours * 60 * 60 * 1000),
            now.getTime()
        ));
        
        console.log(`   📍 Fetching logs from ${new Date(currentStartTime).toLocaleString()} to ${windowEnd.toLocaleString()}`);
        
        // Fetch logs for this time window with pagination
        const windowLogs = await fetchLogsForTimeWindow(
            serviceId, 
            ownerId, 
            apiKey, 
            currentStartTime, 
            windowEnd.toISOString()
        );
        
        if (windowLogs.length > 0) {
            allLogs.push(...windowLogs);
            totalLogsFetched += windowLogs.length;
            console.log(`      ✅ Retrieved ${windowLogs.length} logs (Total: ${totalLogsFetched})`);
        } else {
            console.log(`      📭 No logs found in this window`);
        }
        
        // Move to next time window
        currentStartTime = windowEnd.toISOString();
        pageCount++;
        
        // Add delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Safety limit to prevent infinite loops
        if (pageCount > 50) {
            console.log(`   ⚠️  Reached safety limit of 50 time windows`);
            break;
        }
    }
    
    console.log(`   🎉 PAGINATION COMPLETE: Retrieved ${totalLogsFetched} total logs across ${pageCount} time windows`);
    
    // Sort all logs by timestamp (oldest first for chronological analysis)
    allLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    return allLogs;
}

// Fetch logs for a specific time window with internal pagination
async function fetchLogsForTimeWindow(serviceId, ownerId, apiKey, startTime, endTime) {
    const windowLogs = [];
    let hasMore = true;
    let currentStartTime = startTime;
    let currentEndTime = endTime;
    let paginationCount = 0;
    
    while (hasMore && paginationCount < 20) { // Max 20 pages per window
        const logsOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/logs?ownerId=${encodeURIComponent(ownerId)}&resource=${serviceId}&startTime=${encodeURIComponent(currentStartTime)}&endTime=${encodeURIComponent(currentEndTime)}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        };

        try {
            const response = await makeRequest(logsOptions);
            
            if (response.statusCode === 200) {
                const responseData = response.data;
                const logs = responseData.logs || responseData;
                
                if (Array.isArray(logs) && logs.length > 0) {
                    windowLogs.push(...logs);
                    
                    // Check for pagination
                    if (responseData.hasMore && responseData.nextStartTime && responseData.nextEndTime) {
                        currentStartTime = responseData.nextStartTime;
                        currentEndTime = responseData.nextEndTime;
                        hasMore = true;
                        console.log(`         📄 Page ${paginationCount + 1}: ${logs.length} logs, continuing pagination...`);
                    } else {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }
            } else {
                console.log(`         ⚠️  API Error ${response.statusCode}, stopping window pagination`);
                hasMore = false;
            }
        } catch (error) {
            console.log(`         ❌ Error fetching logs: ${error.message}`);
            hasMore = false;
        }
        
        paginationCount++;
        
        // Small delay between pagination requests
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return windowLogs;
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
        // Calculate timestamp for 5 days ago to capture comprehensive recent activity
        const fiveDaysAgo = Math.floor((Date.now() - 5 * 24 * 60 * 60 * 1000) / 1000);
        
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
            
            // Filter events from last 5 days
            const recentEvents = events.filter(event => {
                const eventTime = new Date(event.timestamp).getTime() / 1000;
                return eventTime >= fiveDaysAgo;
            });
            
            console.log(`📊 ${recentEvents.length} events in last 5 days`);
            
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
                                                
                                                // SEARCH FOR "91" PATTERN SPECIFICALLY
                                                const contains91 = output.includes('91');
                                                if (contains91) {
                                                    console.log(`      🎯 FOUND "91" IN OUTPUT - ANALYZING...`);
                                                    const lines = output.split('\n');
                                                    const lines91 = lines.filter(line => line.includes('91'));
                                                    console.log(`      📋 Lines containing "91" (${lines91.length} found):`);
                                                    lines91.forEach((line, index) => {
                                                        console.log(`         ${index + 1}. ${line.trim()}`);
                                                    });
                                                    
                                                    // Look for full context around 91 mentions
                                                    lines91.forEach((line91, index91) => {
                                                        const lineIndex = lines.indexOf(line91);
                                                        console.log(`      🔍 CONTEXT FOR "91" MENTION #${index91 + 1}:`);
                                                        const start = Math.max(0, lineIndex - 5);
                                                        const end = Math.min(lines.length - 1, lineIndex + 5);
                                                        for (let i = start; i <= end; i++) {
                                                            const marker = i === lineIndex ? '>>> ' : '    ';
                                                            console.log(`         ${marker}${i + 1}: ${lines[i].trim()}`);
                                                        }
                                                        console.log('      ' + '─'.repeat(60));
                                                    });
                                                }
                                                
                                                // ENHANCED: Check for multiple failure patterns in cron output
                                                const patterns = [
                                                    { name: 'Failed Count', regex: /failed:\s*(\d+)/i },
                                                    { name: 'Error Count', regex: /error:\s*(\d+)/i },
                                                    { name: 'Timeout Count', regex: /timeout:\s*(\d+)/i },
                                                    { name: 'Failed to Process', regex: /failed to \w+.*?(\d+)/i },
                                                    { name: 'Processing Failed', regex: /processing.*?failed.*?(\d+)/i },
                                                    { name: 'Could Not Process', regex: /could not process.*?(\d+)/i },
                                                    { name: 'Failed 91 Pattern', regex: /failed:\s*91/i },
                                                    { name: '86 Successful Pattern', regex: /(successful|processed):\s*(86|91)/i },
                                                    { name: 'Batch Summary', regex: /(\d+)\s*successful.*?(\d+)\s*failed/i }
                                                ];
                                                
                                                let runFailures = 0;
                                                let found91Pattern = false;
                                                let batchSummaryData = null;
                                                
                                                patterns.forEach(pattern => {
                                                    const match = output.match(pattern.regex);
                                                    if (match) {
                                                        if (pattern.name === 'Failed 91 Pattern') {
                                                            found91Pattern = true;
                                                            console.log(`      🎯 FOUND "FAILED: 91" PATTERN!`);
                                                        } else if (pattern.name === 'Batch Summary') {
                                                            const successful = parseInt(match[1]);
                                                            const failed = parseInt(match[2]);
                                                            batchSummaryData = { successful, failed };
                                                            console.log(`      📊 BATCH SUMMARY: ${successful} successful, ${failed} failed`);
                                                        } else if (pattern.name === '86 Successful Pattern') {
                                                            console.log(`      ✅ FOUND 86/91 SUCCESS PATTERN: ${match[0]}`);
                                                        } else {
                                                            const count = parseInt(match[1]);
                                                            runFailures += count;
                                                            console.log(`      🚨 ${pattern.name}: ${count} failures detected`);
                                                            serviceIssues.errors += count;
                                                        }
                                                    }
                                                });
                                                
                                                // If we found the 91 pattern, do detailed chronological analysis
                                                if (found91Pattern || (batchSummaryData && (batchSummaryData.successful === 86 || batchSummaryData.failed === 10))) {
                                                    console.log(`      🔍 DETAILED CHRONOLOGICAL ANALYSIS OF 86/10 PATTERN:`);
                                                    
                                                    const lines = output.split('\n');
                                                    const relevantLines = [];
                                                    
                                                    lines.forEach((line, index) => {
                                                        if (line.toLowerCase().includes('chunk') || 
                                                            line.toLowerCase().includes('batch') ||
                                                            line.toLowerCase().includes('processing') ||
                                                            line.toLowerCase().includes('failed') ||
                                                            line.toLowerCase().includes('error') ||
                                                            /\d+\s*(successful|failed|processed)/i.test(line)) {
                                                            relevantLines.push({
                                                                lineNumber: index + 1,
                                                                content: line.trim(),
                                                                type: line.toLowerCase().includes('failed') || line.toLowerCase().includes('error') ? 'failure' : 'info'
                                                            });
                                                        }
                                                    });
                                                    
                                                    console.log(`      📋 CHRONOLOGICAL PROCESSING TIMELINE (${relevantLines.length} relevant events):`);
                                                    relevantLines.forEach((event, index) => {
                                                        const marker = event.type === 'failure' ? '🚨' : '📍';
                                                        console.log(`         ${marker} Line ${event.lineNumber}: ${event.content}`);
                                                    });
                                                    
                                                    // Analyze timing distribution of failures
                                                    const failureLines = relevantLines.filter(e => e.type === 'failure');
                                                    const totalRelevantLines = relevantLines.length;
                                                    
                                                    if (failureLines.length > 0) {
                                                        const earlyFailures = failureLines.filter(f => {
                                                            const position = relevantLines.indexOf(f) / totalRelevantLines;
                                                            return position < 0.3;
                                                        });
                                                        const middleFailures = failureLines.filter(f => {
                                                            const position = relevantLines.indexOf(f) / totalRelevantLines;
                                                            return position >= 0.3 && position < 0.7;
                                                        });
                                                        const lateFailures = failureLines.filter(f => {
                                                            const position = relevantLines.indexOf(f) / totalRelevantLines;
                                                            return position >= 0.7;
                                                        });
                                                        
                                                        console.log(`      ⏰ FAILURE TIMING ANALYSIS:`);
                                                        console.log(`         🟥 Early phase (0-30%): ${earlyFailures.length} failures`);
                                                        console.log(`         🟨 Middle phase (30-70%): ${middleFailures.length} failures`);
                                                        console.log(`         🟩 Late phase (70-100%): ${lateFailures.length} failures`);
                                                        
                                                        if (lateFailures.length > earlyFailures.length + middleFailures.length) {
                                                            console.log(`         🎯 PATTERN: Most failures in FINAL PHASE - suggests resource exhaustion`);
                                                        } else if (earlyFailures.length > middleFailures.length + lateFailures.length) {
                                                            console.log(`         🎯 PATTERN: Most failures in INITIAL PHASE - suggests initialization issues`);
                                                        } else {
                                                            console.log(`         🎯 PATTERN: Failures DISTRIBUTED throughout - suggests random response quality issues`);
                                                        }
                                                    }
                                                }
                                                
                                                if (runFailures > 0) {
                                                    console.log(`      💥 TOTAL FAILURES IN THIS RUN: ${runFailures}`);
                                                    console.log(`      📄 Full output analysis:`);
                                                    
                                                    // Split output into lines for better analysis
                                                    const outputLines = output.split('\n');
                                                    
                                                    // Find lines with failure information
                                                    const failureLines = outputLines.filter(line => 
                                                        line.toLowerCase().includes('failed') ||
                                                        line.toLowerCase().includes('error') ||
                                                        line.toLowerCase().includes('exception')
                                                    );
                                                    
                                                    console.log(`      🔍 Found ${failureLines.length} lines with failure/error information:`);
                                                    failureLines.slice(0, 10).forEach((line, index) => {
                                                        console.log(`         ${index + 1}. ${line.trim()}`);
                                                    });
                                                    
                                                    if (failureLines.length > 10) {
                                                        console.log(`         ... and ${failureLines.length - 10} more error lines`);
                                                    }
                                                    
                                                    // Look for specific patterns that might indicate root cause
                                                    const rootCausePatterns = [
                                                        /timeout/i,
                                                        /connection.*refused/i,
                                                        /network.*error/i,
                                                        /invalid.*data/i,
                                                        /missing.*field/i,
                                                        /authentication.*failed/i,
                                                        /rate.*limit/i,
                                                        /quota.*exceeded/i,
                                                        /database.*error/i,
                                                        /api.*error/i
                                                    ];
                                                    
                                                    const rootCauses = [];
                                                    rootCausePatterns.forEach(pattern => {
                                                        const matches = outputLines.filter(line => pattern.test(line));
                                                        if (matches.length > 0) {
                                                            rootCauses.push(...matches.slice(0, 2));
                                                        }
                                                    });
                                                    
                                                    if (rootCauses.length > 0) {
                                                        console.log(`      🎯 Potential root causes identified:`);
                                                        rootCauses.forEach((cause, index) => {
                                                            console.log(`         🚨 ${cause.trim()}`);
                                                        });
                                                    }
                                                    
                                                } else if (output.toLowerCase().includes('error') || output.toLowerCase().includes('failed')) {
                                                    console.log(`      ⚠️  Output contains error keywords`);
                                                    console.log(`      📄 Output sample: ${output.substring(0, 300)}...`);
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
                
                // ENHANCED: Use comprehensive pagination to fetch ALL available logs
                console.log(`   🔄 Fetching ALL available logs with pagination...`);
                const allLogs = await fetchAllLogsWithPagination(serviceId, details?.ownerId || service.ownerId, apiKey);
                
                console.log(`   📊 TOTAL LOGS RETRIEVED: ${allLogs.length} entries across all time periods`);
                
                // Process the comprehensive log data
                const logsResponse = {
                    statusCode: 200,
                    data: { logs: allLogs }
                };
                
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
                                            { name: 'Could Not Process', regex: /could not process.*?(\d+)/i },
                                            { name: 'Failed 91 Pattern', regex: /failed:\s*91/i },
                                            { name: '86 Successful Pattern', regex: /(successful|processed):\s*(86|91)/i },
                                            { name: 'Batch Summary', regex: /(\d+)\s*successful.*?(\d+)\s*failed/i }
                                        ];                        let totalFailures = 0;
                        let failureDetails = [];
                        
                        actualLogs.forEach(log => {
                            const message = log.message || log.text || '';
                            
                            // CHECK FOR "91" SPECIFICALLY
                            if (message.includes('91')) {
                                console.log(`   🎯 FOUND "91" IN LOG MESSAGE:`);
                                console.log(`      ⏰ Timestamp: ${new Date(log.timestamp).toLocaleString()}`);
                                console.log(`      📄 Full message: ${message}`);
                                console.log('   ' + '─'.repeat(80));
                            }
                            
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
                            
                            // ENHANCED: Deep dive into failure reasons
                            failureDetails.slice(0, 5).forEach((failure, index) => {
                                console.log(`\n   🚨 FAILURE ANALYSIS #${index + 1}: ${failure.type} (${failure.count} failures)`);
                                console.log(`      ⏰ Timestamp: ${new Date(failure.timestamp).toLocaleString()}`);
                                
                                // Parse JSON if it's a structured log
                                let parsedData = null;
                                try {
                                    parsedData = JSON.parse(failure.message);
                                } catch (e) {
                                    // Not JSON, treat as plain text
                                }
                                
                                if (parsedData) {
                                    console.log(`      📋 STRUCTURED FAILURE DATA:`);
                                    
                                    // Extract client-specific failure details
                                    if (parsedData.clientResults) {
                                        parsedData.clientResults.forEach(client => {
                                            if (client.failed > 0) {
                                                console.log(`         🔴 CLIENT: ${client.clientId || client.clientName || 'Unknown'}`);
                                                console.log(`            ❌ Failed: ${client.failed}`);
                                                console.log(`            ✅ Successful: ${client.successful || client.processed - client.failed || 0}`);
                                                console.log(`            📊 Status: ${client.status || 'Unknown'}`);
                                                
                                                // Look for error details
                                                if (client.errorDetails && Array.isArray(client.errorDetails)) {
                                                    console.log(`            🚨 ERROR DETAILS (${client.errorDetails.length} errors):`);
                                                    client.errorDetails.slice(0, 5).forEach((error, errorIndex) => {
                                                        console.log(`               ${errorIndex + 1}. ${error.message || error.error || error}`);
                                                        if (error.leadId) console.log(`                  Lead ID: ${error.leadId}`);
                                                        if (error.code) console.log(`                  Error Code: ${error.code}`);
                                                    });
                                                    if (client.errorDetails.length > 5) {
                                                        console.log(`               ... and ${client.errorDetails.length - 5} more errors`);
                                                    }
                                                }
                                            }
                                        });
                                    }
                                    
                                    // Look for summary-level error information
                                    if (parsedData.summary) {
                                        console.log(`         📈 SUMMARY:`);
                                        Object.entries(parsedData.summary).forEach(([key, value]) => {
                                            console.log(`            ${key}: ${value}`);
                                        });
                                    }
                                    
                                    // Look for any error arrays or messages at the root level
                                    if (parsedData.errors && Array.isArray(parsedData.errors)) {
                                        console.log(`         🚨 ROOT LEVEL ERRORS:`);
                                        parsedData.errors.slice(0, 5).forEach((error, errorIndex) => {
                                            console.log(`            ${errorIndex + 1}. ${error.message || error}`);
                                        });
                                    }
                                    
                                } else {
                                    // Plain text log analysis
                                    console.log(`      📄 TEXT LOG ANALYSIS:`);
                                    const lines = failure.message.split('\n').filter(line => line.trim());
                                    
                                    // Look for specific error patterns
                                    const errorPatterns = [
                                        { name: 'API Errors', regex: /api.*error|error.*api/i },
                                        { name: 'Database Errors', regex: /database.*error|sql.*error|connection.*error/i },
                                        { name: 'Validation Errors', regex: /validation.*error|invalid.*data|missing.*field/i },
                                        { name: 'Timeout Errors', regex: /timeout|timed.*out/i },
                                        { name: 'Authentication Errors', regex: /auth.*error|unauthorized|forbidden/i },
                                        { name: 'Rate Limit Errors', regex: /rate.*limit|quota.*exceeded|too.*many/i }
                                    ];
                                    
                                    let foundErrorTypes = [];
                                    errorPatterns.forEach(pattern => {
                                        const matches = lines.filter(line => pattern.regex.test(line));
                                        if (matches.length > 0) {
                                            foundErrorTypes.push({
                                                type: pattern.name,
                                                examples: matches.slice(0, 2)
                                            });
                                        }
                                    });
                                    
                                    if (foundErrorTypes.length > 0) {
                                        console.log(`         🎯 ERROR CATEGORIES DETECTED:`);
                                        foundErrorTypes.forEach(errorType => {
                                            console.log(`            🔴 ${errorType.type}:`);
                                            errorType.examples.forEach(example => {
                                                console.log(`               • ${example.trim()}`);
                                            });
                                        });
                                    }
                                    
                                    // Show raw context for manual inspection
                                    console.log(`         📝 RAW MESSAGE SAMPLE:`);
                                    console.log(`            ${failure.message.substring(0, 500)}${failure.message.length > 500 ? '...' : ''}`);
                                }
                                
                                console.log(`      ${'─'.repeat(80)}`);
                            });
                            
                            if (failureDetails.length > 5) {
                                console.log(`      ... and ${failureDetails.length - 5} more failure patterns (run with detailed logging for full analysis)`);
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
