// Quick test of all three operations with correct authentication
const https = require('https');

async function testOperation(config, description) {
    return new Promise((resolve, reject) => {
        const { path, method, headers, body } = config;
        
        const options = {
            hostname: 'pb-webhook-server-staging.onrender.com',
            port: 443,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                console.log(`\n=== ${description} ===`);
                console.log(`Status: ${res.statusCode}`);
                
                if (res.statusCode === 202) {
                    console.log('✅ SUCCESS - 202 Accepted');
                } else {
                    console.log('❌ FAILED');
                }
                
                try {
                    const parsed = JSON.parse(responseData);
                    console.log('JobId:', parsed.jobId || 'N/A');
                } catch (e) {
                    console.log('Response:', responseData.substring(0, 200));
                }
                
                resolve({ status: res.statusCode, success: res.statusCode === 202 });
            });
        });

        req.on('error', (error) => {
            console.error(`Error testing ${description}:`, error);
            reject(error);
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function testAllOperations() {
    const secret = 'Diamond9753!!@@pb';
    const clientId = 'Dean-Hobin';
    const stream = 1;
    const limit = 2;

    console.log('🧪 Testing all three operations with correct authentication...\n');

    const tests = [
        {
            config: {
                path: `/run-batch-score-v2?stream=${stream}&limit=${limit}&clientId=${clientId}`,
                method: 'GET',
                headers: { 'x-webhook-secret': secret }
            },
            description: 'Lead Scoring (GET + x-webhook-secret)'
        },
        {
            config: {
                path: `/api/apify/process-level2-v2?stream=${stream}&clientId=${clientId}`,
                method: 'POST',
                headers: { 'Authorization': `Bearer ${secret}` }
            },
            description: 'Post Harvesting (POST + Bearer token)'
        },
        {
            config: {
                path: `/run-post-batch-score-v2`,
                method: 'POST',
                headers: { 'x-webhook-secret': secret },
                body: { stream, limit, clientId }
            },
            description: 'Post Scoring (POST + x-webhook-secret + body)'
        }
    ];

    let successCount = 0;
    
    for (const test of tests) {
        try {
            const result = await testOperation(test.config, test.description);
            if (result.success) successCount++;
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 sec delay
        } catch (error) {
            console.error(`Failed to test ${test.description}:`, error.message);
        }
    }

    console.log(`\n📊 SUMMARY: ${successCount}/3 operations working correctly`);
    
    if (successCount === 3) {
        console.log('🎉 All operations are now working! Smart resume should succeed.');
    } else {
        console.log('⚠️ Some operations still failing. Check the errors above.');
    }
}

testAllOperations();