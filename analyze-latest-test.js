// Analyze logs from the latest test run
const https = require('https');

async function analyzeLatestTest() {
    console.log('🔍 Analyzing recent logs for errors...\n');
    
    const data = JSON.stringify({
        minutes: 30  // Last 30 minutes
    });
    
    const options = {
        hostname: 'pb-webhook-server-staging.onrender.com',
        port: 443,
        path: '/api/analyze-logs/recent',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };
    
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => {
                body += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    console.log('📊 Analysis Results:');
                    console.log(`   Total Issues Found: ${result.totalIssues || 0}`);
                    console.log(`   Status: ${res.statusCode}`);
                    console.log('\n📝 Full Response:');
                    console.log(JSON.stringify(result, null, 2));
                    resolve(result);
                } catch (e) {
                    console.error('Failed to parse response:', e.message);
                    console.log('Raw response:', body);
                    reject(e);
                }
            });
        });
        
        req.on('error', (e) => {
            console.error('Request failed:', e.message);
            reject(e);
        });
        
        req.write(data);
        req.end();
    });
}

analyzeLatestTest().catch(console.error);
