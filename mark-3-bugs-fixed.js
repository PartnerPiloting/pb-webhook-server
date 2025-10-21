/**
 * Mark the 3 remaining bug patterns as FIXED
 * Uses the general /api/mark-issue-fixed endpoint
 */

const https = require('https');

const API_BASE = 'https://pb-webhook-server-staging.onrender.com';
const DEBUG_API_KEY = process.env.DEBUG_API_KEY || 'Diamond9753!!@@pb';

async function markPattern(pattern, commitHash, fixNotes) {
    console.log(`\n🔧 Marking "${pattern}" issues as FIXED...`);
    
    const data = JSON.stringify({
        pattern,
        commitHash,
        fixNotes
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
                console.log(`Status: ${res.statusCode}`);
                
                try {
                    const result = JSON.parse(body);
                    console.log(`✅ Updated ${result.updated || 0} issues`);
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

async function main() {
    console.log('📋 Marking all 3 bug patterns as FIXED...\n');
    
    // Bug #1: analyzeRecentLogs is not a function (2 errors)
    await markPattern(
        'analyzeRecentLogs is not a function',
        'd2ccab2',
        'Fixed class instantiation - create ProductionIssueService instance before calling method (apiAndJobRoutes.js:1651)'
    );
    
    // Bug #2: Cannot access logger before initialization (2 errors)
    await markPattern(
        'Cannot access \'logger\' before initialization',
        'd2ccab2',
        'Fixed Temporal Dead Zone error - create tempLogger for early validation before proper logger initialization (runRecordAdapterSimple.js:312)'
    );
    
    // Bug #3: Failed to update metrics (1 error)
    await markPattern(
        'Failed to update metrics: Unknown error',
        'd2ccab2',
        'Fixed inconsistent return value - added success: true property to updateClientRun success path (jobTracking.js:785)'
    );
    
    console.log('\n✅ All 3 bug patterns marked as FIXED!');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n❌ Failed:', err.message);
        process.exit(1);
    });
