// test-inbound-email.js
// Quick test script for inbound email endpoint

const https = require('https');

const data = JSON.stringify({
    senderEmail: 'guyralphwilson@gmail.com',
    recipientEmail: 'Annabelle_Reed@data3.com.au',
    subject: 'Test Email',
    body: 'This is a test'
});

const options = {
    hostname: 'pb-webhook-server-staging.onrender.com',
    port: 443,
    path: '/api/webhooks/inbound-email/test',
    method: 'POST',
    headers: {
        'Authorization': 'Bearer Diamond9753!!@@pb',
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    let responseData = '';
    res.on('data', chunk => responseData += chunk);
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        try {
            console.log(JSON.stringify(JSON.parse(responseData), null, 2));
        } catch (e) {
            console.log(responseData);
        }
    });
});

req.on('error', (e) => {
    console.error('Error:', e.message);
});

req.write(data);
req.end();
