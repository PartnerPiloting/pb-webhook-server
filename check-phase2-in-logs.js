#!/usr/bin/env node
/**
 * Check for Phase 2 messages in recent Render logs
 */

const fetch = require('node-fetch');

async function checkPhase2Messages() {
    try {
        console.log('🔍 Fetching recent logs from Render staging...\n');
        
        // Fetch from auto-analyze endpoint
        const response = await fetch('https://pb-webhook-server-staging.onrender.com/api/auto-analyze-latest-run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            console.error('❌ API returned status:', response.status);
            const text = await response.text();
            console.error('Response:', text.substring(0, 500));
            return;
        }
        
        const data = await response.json();
        
        if (!data.logText) {
            console.error('❌ No logText in response');
            console.log('Response keys:', Object.keys(data));
            return;
        }
        
        const logLines = data.logText.split('\n');
        
        console.log(`📊 Run ID: ${data.runId}`);
        console.log(`⏰ Time: ${data.startTime}\n`);
        
        // Search for Phase 2 messages
        console.log('🔍 Searching for PHASE 2 messages...\n');
        
        const phase2Lines = logLines.filter(line => 
            line.toLowerCase().includes('phase 2') ||
            line.toLowerCase().includes('phase 1') ||
            line.toLowerCase().includes('previous run') ||
            line.toLowerCase().includes('back-fill') ||
            line.toLowerCase().includes('catch-up') ||
            line.toLowerCase().includes('last analyzed')
        );
        
        if (phase2Lines.length > 0) {
            console.log(`✅ Found ${phase2Lines.length} relevant messages:\n`);
            phase2Lines.forEach((line, i) => {
                console.log(`${i + 1}. ${line.substring(0, 200)}`);
            });
        } else {
            console.log('❌ No Phase 1/Phase 2 messages found');
            console.log('\nShowing last 20 log lines instead:\n');
            logLines.slice(-20).forEach(line => {
                console.log(line.substring(0, 150));
            });
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
}

checkPhase2Messages();
