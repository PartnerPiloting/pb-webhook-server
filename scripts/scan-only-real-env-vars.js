#!/usr/bin/env node

/**
 * Scan ONLY Real Environment Variables
 * 
 * Shows only variables that are ACTUALLY SET on Render staging.
 * Filters out dead code references to variables that don't exist.
 * 
 * Usage:
 *   node scripts/scan-only-real-env-vars.js
 */

const https = require('https');

const STAGING_URL = 'pb-webhook-server-staging.onrender.com';
const DEBUG_API_KEY = process.env.DEBUG_API_KEY || 'Diamond9753!!@@pb';

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
                'x-debug-api-key': DEBUG_API_KEY
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
 * Scan for ONLY variables that are actually set on Render
 */
async function scanRealEnvVarsOnly() {
    console.log('\n🎯 Real Environment Variables Scanner');
    console.log('=====================================\n');
    console.log('📡 Connecting to staging to find ONLY variables that are actually set...\n');

    const startTime = Date.now();
    const progressInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        process.stdout.write(`\r⏱️  Elapsed: ${elapsed}s - Filtering real variables...`);
    }, 1000);

    try {
        const response = await makeRequest('/api/scan-env-vars', 'POST', {
            includeAiDescriptions: false,  // Fast mode
            onlySetVariables: true         // NEW: Only include variables with values
        });

        clearInterval(progressInterval);
        const totalTime = Math.floor((Date.now() - startTime) / 1000);
        console.log(`\n\n✅ Scan completed in ${totalTime}s!\n`);

        if (response.statusCode === 200 || response.statusCode === 202) {
            console.log('📊 Results:');
            console.log(JSON.stringify(response.data, null, 2));
            console.log('\n💡 What this shows:');
            console.log('   ✅ ONLY variables that have values on Render staging');
            console.log('   ✅ Filtered out dead code references (like ACTOR_ID)');
            console.log('   ✅ These are the REAL variables you need to manage');
            console.log('\n💡 Next steps:');
            console.log('   1. Check your Airtable Environment Variables table');
            console.log('   2. You should see only variables with "Active" status');
            console.log('   3. Fill in Production Values for each one');
            console.log('   4. Assign Render Groups for organization\n');
        } else {
            console.error('❌ Scan failed');
            console.error('Status:', response.statusCode);
            console.error('Response:', response.data);
        }
    } catch (error) {
        clearInterval(progressInterval);
        console.log('\n');
        console.error('❌ Error connecting to staging server:');
        console.error(error.message);
        console.log('\n💡 Troubleshooting:');
        console.log('   - Is the staging server running?');
        console.log('   - Check Render logs for errors\n');
    }
}

// Run the scan
scanRealEnvVarsOnly();
