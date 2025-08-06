#!/usr/bin/env node

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

async function searchFor91() {
    const apiKey = process.env.RENDER_API_KEY;
    
    if (!apiKey) {
        console.error('❌ RENDER_API_KEY not found in environment variables');
        return;
    }

    try {
        console.log('🔍 SEARCHING FOR "91" IN RENDER LOGS');
        console.log('='.repeat(80));
        
        // Get services
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
        const services = servicesResponse.data.services || servicesResponse.data;
        
        // Focus on Daily Batch Lead Scoring
        console.log('📋 Available services:');
        services.forEach(s => console.log(`   - ${s.name} (${s.id})`));
        
        const batchService = services.find(s => 
            s.name && s.name.toLowerCase().includes('batch') && s.name.toLowerCase().includes('lead')
        );
        if (!batchService) {
            console.log('❌ Could not find Daily Batch Lead Scoring service');
            console.log('Available services:', services.map(s => s.name));
            return;
        }

        console.log(`📋 Searching in: ${batchService.name} (${batchService.id})`);
        
        // Search logs with extended time range (7 days back)
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        
        const startTime = sevenDaysAgo.toISOString();
        const endTime = now.toISOString();
        
        console.log(`📅 Time range: ${startTime} to ${endTime}`);
        
        const logsOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/logs?resource=${batchService.id}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&limit=1000`,
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
            
            console.log(`📊 Retrieved ${actualLogs.length} log entries`);
            
            // Search for "91" in all log messages
            const logs91 = actualLogs.filter(log => {
                const message = log.message || log.text || '';
                return message.includes('91');
            });
            
            console.log(`🎯 Found ${logs91.length} log entries containing "91"`);
            
            if (logs91.length > 0) {
                console.log('\n📋 ALL LOGS CONTAINING "91":');
                console.log('='.repeat(80));
                
                logs91.forEach((log, index) => {
                    const timestamp = new Date(log.timestamp).toLocaleString();
                    const message = log.message || log.text || '';
                    
                    console.log(`\n🔍 MATCH #${index + 1}:`);
                    console.log(`   ⏰ Timestamp: ${timestamp}`);
                    console.log(`   📄 Full message:`);
                    console.log(`   ${message}`);
                    console.log('   ' + '─'.repeat(80));
                    
                    // Try to parse as JSON for structured data
                    try {
                        const parsed = JSON.parse(message);
                        if (parsed.clientResults) {
                            console.log(`   📊 CLIENT BREAKDOWN:`);
                            parsed.clientResults.forEach(client => {
                                console.log(`      🔵 ${client.clientId}: ${client.successful} successful, ${client.failed} failed`);
                            });
                        }
                        if (parsed.summary) {
                            console.log(`   📈 SUMMARY: ${parsed.summary.totalSuccessful} successful, ${parsed.summary.totalFailed} failed`);
                        }
                    } catch (e) {
                        // Not JSON, that's fine
                    }
                });
                
                // Look for the specific pattern that might indicate timing
                const batch91Logs = logs91.filter(log => {
                    const message = log.message || log.text || '';
                    return message.includes('Failed: 91') || 
                           message.includes('failed: 91') || 
                           message.includes('successful: 91') ||
                           message.includes('Successful: 91');
                });
                
                if (batch91Logs.length > 0) {
                    console.log('\n🎯 LOGS WITH BATCH "91" PATTERN:');
                    console.log('='.repeat(80));
                    batch91Logs.forEach((log, index) => {
                        const timestamp = new Date(log.timestamp).toLocaleString();
                        const message = log.message || log.text || '';
                        console.log(`\n📍 BATCH 91 LOG #${index + 1}:`);
                        console.log(`   ⏰ ${timestamp}`);
                        console.log(`   📄 ${message}`);
                    });
                }
                
            } else {
                console.log('\n⚠️  No logs containing "91" found in the last 7 days');
                console.log('   This might mean:');
                console.log('   1. The "91" pattern occurred more than 7 days ago');
                console.log('   2. The pattern is in a different service');
                console.log('   3. The pattern uses different formatting');
            }
            
        } else {
            console.error(`❌ Failed to get logs: ${logsResponse.statusCode}`);
            console.error(logsResponse.data);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

searchFor91();
