#!/usr/bin/env node

// Simple log checker without API - just check if we have render logs script
const { execSync } = require('child_process');

const jobId = 'smart_resume_1758453767575_n3rke';

console.log(`🔍 Checking logs for job: ${jobId}`);
console.log('Looking for our enhanced logging markers...\n');

try {
    // Try to use the existing log checker if it works
    const result = execSync('node check-render-logs.js', { 
        encoding: 'utf8',
        timeout: 10000 
    });
    
    const lines = result.split('\n');
    const relevantLines = lines.filter(line => 
        line.includes(jobId) || 
        line.includes(`SMART_RESUME_${jobId}`) ||
        line.includes('AUTH_DEBUG') ||
        line.includes('SCRIPT_START') ||
        line.includes('SCRIPT_END')
    );
    
    if (relevantLines.length > 0) {
        console.log(`📋 Found ${relevantLines.length} relevant log entries:`);
        relevantLines.forEach(line => console.log(line));
    } else {
        console.log('⚠️  No job-specific logs found yet.');
        console.log('Job may still be starting or logs not ready.');
        
        // Show recent general logs
        const recentLines = lines.slice(-20);
        console.log('\n📄 Recent general logs:');
        recentLines.forEach(line => {
            if (line.trim()) console.log(line);
        });
    }
    
} catch (error) {
    console.log('❌ Could not fetch logs directly.');
    console.log('Job is likely still running. Expected completion in 5-10 minutes.');
    console.log('\nAlternatives:');
    console.log('1. Wait for email report');
    console.log('2. Check Render dashboard manually');
    console.log('3. Try again in 2-3 minutes');
}