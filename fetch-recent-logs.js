#!/usr/bin/env node
/**
 * Quick utility to fetch recent Render logs
 * Usage: node fetch-recent-logs.js [minutes]
 */

require('dotenv').config();
const RenderLogService = require('./services/renderLogService');

async function fetchRecentLogs() {
    const minutes = parseInt(process.argv[2]) || 30; // Default to last 30 minutes
    const serviceId = process.env.RENDER_SERVICE_ID;
    
    console.log(`\n📥 Fetching logs from last ${minutes} minutes...`);
    console.log(`Service ID: ${serviceId}\n`);
    
    const logService = new RenderLogService();
    
    // Calculate time range
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    
    console.log(`Time range: ${startTime} to ${endTime}\n`);
    
    try {
        const result = await logService.getServiceLogs(serviceId, {
            startTime,
            endTime,
            limit: 5000
        });
        
        console.log(`\n✅ Retrieved ${result.logs.length} log lines\n`);
        console.log('=' .repeat(80));
        
        // Print logs
        result.logs.forEach(log => {
            if (typeof log === 'string') {
                console.log(log);
            } else if (log.message) {
                console.log(`[${log.timestamp || ''}] ${log.message}`);
            } else {
                console.log(JSON.stringify(log));
            }
        });
        
        console.log('=' .repeat(80));
        console.log(`\n✅ Done! ${result.logs.length} lines fetched\n`);
        
    } catch (error) {
        console.error(`\n❌ Error fetching logs: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

fetchRecentLogs();
