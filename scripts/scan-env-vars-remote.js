#!/usr/bin/env node

/**
 * Remote Environment Variable Scanner
 * 
 * Triggers the env var scan on Render staging server via API endpoint.
 * This way it uses the live staging environment variables without needing local .env file.
 * 
 * Usage:
 *   node scripts/scan-env-vars-remote.js
 */

const https = require('https');

// Render staging URL
const STAGING_URL = 'pb-webhook-server-staging.onrender.com';

// Debug API key (required for this endpoint)
// Using the standard PB webhook secret for admin authentication
const AUTH_SECRET = process.env.DEBUG_API_KEY || process.env.PB_WEBHOOK_SECRET || 'Diamond9753!!@@pb';

/**
 * Make HTTPS request to staging server
 */
function makeRequest(path, method = 'POST', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: STAGING_URL,
            port: 443,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'x-debug-api-key': AUTH_SECRET,
                'x-webhook-secret': AUTH_SECRET
            }
        };

        if (body) {
            const bodyString = JSON.stringify(body);
            options.headers['Content-Length'] = Buffer.byteLength(bodyString);
        }

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (body) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

/**
 * Trigger the environment variable scan on staging
 */
async function triggerRemoteScan() {
    console.log('\n🚀 Remote Environment Variable Scanner');
    console.log('=====================================\n');
    console.log(`📡 Connecting to: https://${STAGING_URL}`);
    console.log('⏳ This will take 5-10 minutes to complete...\n');

    try {
        const response = await makeRequest('/api/scan-env-vars', 'POST', {
            includeAiDescriptions: true
        });

        if (response.statusCode === 200 || response.statusCode === 202) {
            console.log('✅ Scan initiated successfully!\n');
            console.log('📊 Results:');
            console.log(JSON.stringify(response.data, null, 2));
            console.log('\n💡 Next steps:');
            console.log('   1. Check your Airtable Environment Variables table');
            console.log('   2. Fill in Production Values manually');
            console.log('   3. Assign Render Groups for organization');
            console.log('   4. Run: node scripts/document-env-vars.js export\n');
        } else {
            console.error('❌ Scan failed');
            console.error('Status:', response.statusCode);
            console.error('Response:', response.data);
        }
    } catch (error) {
        console.error('❌ Error connecting to staging server:');
        console.error(error.message);
        console.log('\n💡 Troubleshooting:');
        console.log('   - Is the staging server running?');
        console.log('   - Is the DEBUG_API_KEY correct?');
        console.log('   - Check Render logs for errors\n');
    }
}

// Run the scan
triggerRemoteScan();
