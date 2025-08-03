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

async function checkAllServices() {
    const apiKey = process.env.RENDER_API_KEY;
    
    if (!apiKey) {
        console.error('❌ RENDER_API_KEY not found in environment variables');
        return;
    }

    try {
        console.log('🔍 Fetching all Render services...\n');
        
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
        
        if (!Array.isArray(services) && services.services) {
            services = services.services;
        }

        console.log(`Found ${services.length} services:`);
        services.forEach((service, index) => {
            console.log(`  ${index + 1}. ${service.name} (${service.id}) - ${service.type}`);
        });
        console.log();

        // Check each service for issues
        for (const service of services) {
            await checkServiceLogs(service, apiKey);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

async function checkServiceLogs(service, apiKey) {
    const serviceName = service.name;
    const serviceId = service.id;
    
    console.log(`\n🔍 Checking ${serviceName}...`);
    console.log('='.repeat(50));

    try {
        // Try events endpoint first
        const eventsOptions = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/services/${serviceId}/events?limit=50`,
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
            const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
            const recentEvents = events.filter(event => {
                const eventTime = new Date(event.timestamp).getTime();
                return eventTime >= twentyFourHoursAgo;
            });
            
            console.log(`📊 Found ${recentEvents.length} events in last 24 hours`);
            
            if (recentEvents.length > 0) {
                const deployments = recentEvents.filter(e => e.type === 'deploy');
                const builds = recentEvents.filter(e => e.type === 'build');
                const failures = recentEvents.filter(e => e.status === 'failed' || e.type === 'crashed');
                
                if (deployments.length > 0) {
                    console.log(`🚀 Deployments: ${deployments.length}`);
                    deployments.slice(0, 3).forEach(deploy => {
                        const timestamp = new Date(deploy.timestamp).toLocaleString();
                        console.log(`  [${timestamp}] ${deploy.type} - ${deploy.status}`);
                    });
                }
                
                if (builds.length > 0) {
                    console.log(`🔨 Builds: ${builds.length}`);
                    builds.slice(0, 3).forEach(build => {
                        const timestamp = new Date(build.timestamp).toLocaleString();
                        console.log(`  [${timestamp}] ${build.type} - ${build.status}`);
                    });
                }
                
                if (failures.length > 0) {
                    console.log(`❌ FAILURES: ${failures.length}`);
                    failures.forEach(failure => {
                        const timestamp = new Date(failure.timestamp).toLocaleString();
                        console.log(`  [${timestamp}] ${failure.type} - ${failure.status}`);
                    });
                } else {
                    console.log(`✅ No failures detected`);
                }
            } else {
                console.log(`✅ No recent activity (service likely stable)`);
            }
            
        } else {
            console.log(`⚠️  Could not fetch events (Status: ${eventsResponse.statusCode})`);
        }

        // Also check service details for current status
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
        
        if (detailsResponse.statusCode === 200) {
            const details = detailsResponse.data;
            console.log(`📈 Current Status: ${details.status || 'Unknown'}`);
            
            if (details.serviceDetails?.url) {
                console.log(`🌐 URL: ${details.serviceDetails.url}`);
            }
            
            // Quick health check for web services
            if (details.type === 'web_service' && details.serviceDetails?.url) {
                try {
                    const url = new URL(details.serviceDetails.url);
                    const healthOptions = {
                        hostname: url.hostname,
                        port: url.port || 443,
                        path: '/basic-test', // or just '/' for root
                        method: 'GET',
                        timeout: 5000,
                        headers: {
                            'User-Agent': 'Render-Log-Checker'
                        }
                    };
                    
                    const healthResponse = await makeRequest(healthOptions);
                    console.log(`🏥 Health Check: ✅ Responding (${healthResponse.statusCode})`);
                } catch (healthError) {
                    console.log(`🏥 Health Check: ⚠️  ${healthError.message}`);
                }
            }
        }

    } catch (error) {
        console.log(`❌ Error checking ${serviceName}: ${error.message}`);
    }
}

// Run the comprehensive check
checkAllServices();
