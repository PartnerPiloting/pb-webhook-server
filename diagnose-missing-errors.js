// Diagnostic script to check if specific errors are in the logs
require('dotenv').config();
const { filterLogs } = require('./services/logFilterService');
const axios = require('axios');

async function diagnoseErrors(runId) {
    // Fetch logs from Render
    const RENDER_API_KEY = process.env.RENDER_API_KEY;
    const SERVICE_ID = 'srv-csc5d4gph6c739cbl6g';
    
    console.log('\n📡 Fetching logs from Render...');
    
    const url = `https://api.render.com/v1/services/${SERVICE_ID}/logs`;
    const params = {
        direction: 'forward',
        limit: 1000
    };
    
    const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${RENDER_API_KEY}` },
        params
    });
    
    const logs = response.data || [];
    const logText = logs
        .map(log => {
            if (typeof log === 'string') return log;
            if (log.message) return `[${log.timestamp || ''}] ${log.message}`;
            return JSON.stringify(log);
        })
        .join('\n');
    
    console.log(`\n✓ Fetched ${logs.length} logs`);
    console.log('\n🔍 Searching for specific error patterns in logs...\n');
    
    // Search for specific errors
    const searchPatterns = [
        { name: 'Unknown field name', pattern: /Unknown field name:/i },
        { name: 'Failed to update', pattern: /Failed to update/i },
        { name: 'batch failed', pattern: /batch.*failed/i }
    ];
    
    const logLines = logText.split('\n');
    
    searchPatterns.forEach(({ name, pattern }) => {
        console.log(`\n--- Searching for: ${name} ---`);
        const matches = logLines.filter(line => pattern.test(line) && line.includes(runId));
        console.log(`Found ${matches.length} matches:`);
        matches.slice(0, 5).forEach((match, idx) => {
            console.log(`  ${idx + 1}. ${match.substring(0, 150)}...`);
        });
    });
    
    // Now run the filter to see what gets captured
    console.log('\n\n🔍 Running filterLogs with runIdFilter...\n');
    const filteredErrors = filterLogs(logText, {
        deduplicateIssues: true,
        contextSize: 25,
        runIdFilter: runId
    });
    
    console.log(`\n✓ filterLogs returned ${filteredErrors.length} errors`);
    console.log('\nBreakdown by severity:');
    const bySeverity = {};
    filteredErrors.forEach(err => {
        bySeverity[err.severity] = (bySeverity[err.severity] || 0) + 1;
    });
    console.log(bySeverity);
    
    console.log('\nFirst 10 filtered errors:');
    filteredErrors.slice(0, 10).forEach((err, idx) => {
        console.log(`  ${idx + 1}. [${err.severity}] ${err.errorMessage.substring(0, 100)}...`);
    });
    
    // Check if specific patterns are in the filtered results
    console.log('\n\n🎯 Checking if specific patterns made it through filter...\n');
    searchPatterns.forEach(({ name, pattern }) => {
        const found = filteredErrors.filter(err => pattern.test(err.errorMessage));
        console.log(`${name}: ${found.length} found in filtered results`);
        if (found.length > 0) {
            found.forEach((err, idx) => {
                console.log(`  ${idx + 1}. ${err.errorMessage.substring(0, 100)}...`);
            });
        }
    });
}

// Run it
const runId = process.argv[2] || '251009-112417';
diagnoseErrors(runId).then(() => {
    console.log('\n✅ Diagnostic complete\n');
    process.exit(0);
}).catch(err => {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
});
