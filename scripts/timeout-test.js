#!/usr/bin/env node
// timeout-test.js - Simple script to test Render's cron job timeout limits

console.log(`[TIMEOUT-TEST] Starting at ${new Date().toISOString()}`);
console.log('[TIMEOUT-TEST] This script will run for 6 minutes to test timeout limits');

let elapsed = 0;
const startTime = Date.now();

// Log every 30 seconds to show we're still alive
const interval = setInterval(() => {
    elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    
    console.log(`[TIMEOUT-TEST] Still running... ${minutes}m ${seconds}s elapsed`);
    
    // Stop after 6 minutes (360 seconds)
    if (elapsed >= 360) {
        console.log(`[TIMEOUT-TEST] SUCCESS! Completed full 6 minutes at ${new Date().toISOString()}`);
        console.log('[TIMEOUT-TEST] This proves there is NO 5-minute timeout limit');
        clearInterval(interval);
        process.exit(0);
    }
}, 30000); // Log every 30 seconds

// Also log at the critical 5-minute mark
setTimeout(() => {
    const currentElapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`[TIMEOUT-TEST] 🎯 CRITICAL: Passed 5-minute mark! (${currentElapsed}s elapsed)`);
    console.log('[TIMEOUT-TEST] If you see this, there is NO 5-minute hard limit');
}, 300000); // 5 minutes = 300,000ms

// Handle process termination
process.on('SIGTERM', () => {
    const currentElapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`[TIMEOUT-TEST] ❌ TERMINATED by SIGTERM after ${currentElapsed} seconds`);
    console.log(`[TIMEOUT-TEST] Started: ${new Date(startTime).toISOString()}`);
    console.log(`[TIMEOUT-TEST] Killed: ${new Date().toISOString()}`);
    process.exit(1);
});

process.on('SIGINT', () => {
    const currentElapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`[TIMEOUT-TEST] ❌ INTERRUPTED by SIGINT after ${currentElapsed} seconds`);
    process.exit(1);
});