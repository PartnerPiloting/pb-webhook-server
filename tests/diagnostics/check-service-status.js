const https = require('https');
require('dotenv').config();

function makeRequest(options) {
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

        req.end();
    });
}

async function getServiceDetails() {
    const apiKey = process.env.RENDER_API_KEY;
    const serviceId = 'srv-cvqgq53e5dus73fa45ag'; // pb-webhook-server ID
    
    try {
        console.log('📊 Getting detailed service information...\n');
        
        const options = {
            hostname: 'api.render.com',
            port: 443,
            path: `/v1/services/${serviceId}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        };

        const response = await makeRequest(options);
        
        if (response.statusCode === 200) {
            const service = response.data;
            
            console.log('🌐 SERVICE STATUS REPORT');
            console.log('========================\n');
            
            console.log(`📝 Name: ${service.name}`);
            console.log(`🔗 Service ID: ${service.id}`);
            console.log(`📈 Status: ${service.status || 'Unknown'}`);
            console.log(`🖥️  Type: ${service.type || 'Unknown'}`);
            console.log(`🌍 Region: ${service.region || 'Unknown'}`);
            
            if (service.serviceDetails) {
                const details = service.serviceDetails;
                console.log(`🌐 URL: ${details.url || 'Not available'}`);
                console.log(`🐳 Environment: ${details.env || 'Unknown'}`);
                console.log(`📦 Runtime: ${details.runtime || 'Unknown'}`);
                console.log(`🔨 Build Command: ${details.buildCommand || 'Not specified'}`);
                console.log(`▶️  Start Command: ${details.startCommand || 'Not specified'}`);
                console.log(`💾 Disk Size: ${details.disk?.sizeGB || 'Unknown'}GB`);
                console.log(`🧠 Plan: ${details.plan || 'Unknown'}`);
                
                if (details.autoDeploy !== undefined) {
                    console.log(`🚀 Auto Deploy: ${details.autoDeploy ? 'Enabled' : 'Disabled'}`);
                }
            }
            
            if (service.repo) {
                console.log(`\n📚 REPOSITORY INFO:`);
                console.log(`🔗 Repo: ${service.repo.name || 'Unknown'}`);
                console.log(`🌿 Branch: ${service.repo.branch || 'Unknown'}`);
            }
            
            console.log(`\n⏰ Created: ${service.createdAt ? new Date(service.createdAt).toLocaleString() : 'Unknown'}`);
            console.log(`🔄 Updated: ${service.updatedAt ? new Date(service.updatedAt).toLocaleString() : 'Unknown'}`);
            
            // Health check
            if (service.serviceDetails?.url) {
                console.log('\n🏥 HEALTH CHECK');
                console.log('===============');
                console.log('Testing service connectivity...');
                
                try {
                    const healthOptions = {
                        hostname: service.serviceDetails.url.replace('https://', '').replace('http://', ''),
                        port: 443,
                        path: '/basic-test',
                        method: 'GET',
                        timeout: 10000
                    };
                    
                    const healthResponse = await makeRequest(healthOptions);
                    console.log(`✅ Service is responding (Status: ${healthResponse.statusCode})`);
                } catch (error) {
                    console.log(`⚠️  Could not reach service: ${error.message}`);
                }
            }
            
        } else {
            console.error('❌ Failed to get service details:', response.data);
        }
        
    } catch (error) {
        console.error('❌ Error getting service details:', error.message);
    }
}

getServiceDetails();
