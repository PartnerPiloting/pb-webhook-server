#!/usr/bin/env node
/**
 * Check Phase 2 logs from Render staging
 * This script calls the auto-analyze endpoint and searches for Phase 2 messages
 */

const fetch = require('node-fetch');

async function checkPhase2Logs() {
    try {
        console.log('🔍 Fetching latest run logs from Render staging...\n');
        
        const response = await fetch('https://pb-webhook-server-staging.onrender.com/api/auto-analyze-latest-run', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!data.ok) {
            console.error('❌ Error:', data.error);
            return;
        }
        
        console.log(`📊 Latest Run: ${data.runId}`);
        console.log(`⏰ Time: ${data.startTime} to ${data.endTime || 'ongoing'}`);
        console.log(`📝 Status: ${data.status}\n`);
        
        // Search for Phase 2 messages in the log text
        const logLines = data.logText.split('\n');
        const phase2Lines = logLines.filter(line => 
            line.includes('PHASE 2') || 
            line.includes('back-fill') || 
            line.includes('catch-up') ||
            line.includes('previous run')
        );
        
        if (phase2Lines.length > 0) {
            console.log('🔄 ===== PHASE 2 MESSAGES FOUND =====\n');
            phase2Lines.forEach(line => {
                console.log(line);
            });
            console.log('\n✅ Phase 2 is executing!\n');
        } else {
            console.log('⚠️  No Phase 2 messages found in latest run logs');
            console.log('This could mean:');
            console.log('  - This was the first run (no previous run to check)');
            console.log('  - Phase 2 logic not yet deployed');
            console.log('  - Check an earlier run\n');
        }
        
        // Also show Phase 1 messages
        const phase1Lines = logLines.filter(line => 
            line.includes('PHASE 1') || 
            line.includes('AUTO_ANALYZER_DELAY')
        );
        
        if (phase1Lines.length > 0) {
            console.log('📊 ===== PHASE 1 MESSAGES =====\n');
            phase1Lines.forEach(line => {
                console.log(line);
            });
        }
        
    } catch (error) {
        console.error('❌ Failed to check logs:', error.message);
    }
}

checkPhase2Logs();
