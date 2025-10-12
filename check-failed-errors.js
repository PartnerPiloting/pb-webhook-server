/**
 * Check stack traces for "Failed to update/analyze" errors
 */

const https = require('https');

async function checkFailedErrors() {
    console.log('🔍 Fetching "Failed" error details with stack traces...\n');
    
    const options = {
        hostname: 'pb-webhook-server-staging.onrender.com',
        path: '/api/production-issues?status=unfixed&limit=100',
        method: 'GET',
        headers: {
            'Authorization': 'Bearer Diamond9753!!@@pb'
        }
    };
    
    return new Promise((resolve, reject) => {
        https.get(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => {
                body += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    const issues = result.issues || [];
                    
                    const failedIssues = issues.filter(issue => {
                        const msg = issue['Error Message'] || issue.message || '';
                        return msg.includes('Cannot access') || 
                               msg.includes('analyzeRecentLogs') ||
                               msg.includes('Unknown error');
                    });
                    
                    console.log(`Found ${failedIssues.length} "Failed" errors:\n`);
                    
                    failedIssues.forEach((issue, idx) => {
                        console.log('='.repeat(80));
                        console.log(`Error #${idx + 1}:`);
                        console.log('Issue ID:', issue['Issue ID'] || issue.issueId);
                        console.log('Run ID:', issue['Run ID'] || issue.runId);
                        console.log('Message:', (issue['Error Message'] || issue.message || '').substring(0, 200));
                        console.log('Stack Trace:', issue['Stack Trace'] || 'None');
                        console.log('');
                    });
                    
                    resolve(failedIssues);
                } catch (e) {
                    console.error('Parse error:', e.message);
                    console.log('Raw response:', body.substring(0, 500));
                    reject(e);
                }
            });
        }).on('error', (error) => {
            console.error('❌ Error:', error.message);
            reject(error);
        });
    });
}

checkFailedErrors()
    .then(() => {
        console.log('✅ Done!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Failed:', err.message);
        process.exit(1);
    });
