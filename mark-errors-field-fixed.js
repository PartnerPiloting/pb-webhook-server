/**
 * Mark "Unknown field name: Errors" issues as FIXED
 * Uses the general /api/mark-issue-fixed endpoint
 */

const https = require('https');

const API_BASE = 'https://pb-webhook-server-staging.onrender.com';
const DEBUG_API_KEY = process.env.DEBUG_API_KEY || 'Diamond9753!!@@pb';

async function markIssuesFixed() {
    console.log('🔧 Marking "Unknown field name: Errors" issues as FIXED...\n');
    
    const data = JSON.stringify({
        pattern: 'Unknown field name',
        commitHash: 'a843e39',
        fixNotes: 'Removed ERRORS field from postBatchScorer.js and jobTracking.js - Production Issues table already provides comprehensive error tracking'
    });
    
    const options = {
        hostname: 'pb-webhook-server-staging.onrender.com',
        path: '/api/mark-issue-fixed',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            'Authorization': `Bearer ${DEBUG_API_KEY}`
        }
    };
    
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => {
                body += chunk;
            });
            
            res.on('end', () => {
                console.log(`Status: ${res.statusCode}\n`);
                
                try {
                    const result = JSON.parse(body);
                    console.log('✅ Result:');
                    console.log(JSON.stringify(result, null, 2));
                    resolve(result);
                } catch (e) {
                    console.log('Response:', body);
                    resolve(body);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ Error:', error.message);
            reject(error);
        });
        
        req.write(data);
        req.end();
    });
}

markIssuesFixed()
    .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Failed:', err.message);
        process.exit(1);
    });
