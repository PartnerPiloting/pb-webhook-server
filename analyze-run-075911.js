// Analyze specific run 251014-075911
const https = require('https');

const data = JSON.stringify({
    minutes: 60  // Last hour to catch the 5:59pm run
});

const options = {
    hostname: 'pb-webhook-server-staging.onrender.com',
    port: 443,
    path: '/api/analyze-logs/recent',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'x-debug-api-key': process.env.DEBUG_API_KEY || ''
    }
};

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Response:', body);
    });
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
