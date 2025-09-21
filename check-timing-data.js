#!/usr/bin/env node

require('dotenv').config();
const Airtable = require('airtable');

async function checkExecutionTiming() {
    console.log('⏱️ CHECKING EXECUTION TIMING FROM AIRTABLE LOGS');
    console.log('='.repeat(60));
    
    try {
        // Configure Airtable and get master clients base
        Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
        const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
        
        // Get recent execution logs - let's see what fields exist first
        const executions = await masterBase('Clients').select({
            maxRecords: 3
        }).firstPage();
        
        console.log('\n🔍 Available fields in first record:');
        if (executions.length > 0) {
            const firstRecord = executions[0];
            const fields = firstRecord.fields;
            Object.keys(fields).forEach(field => {
                console.log(`   📄 ${field}: ${JSON.stringify(fields[field]).substring(0, 100)}...`);
            });
        }
        
        // Now get execution logs with correct field names
        const allExecutions = await masterBase('Clients').select({
            fields: ['Client Name', 'Execution Log'],
            filterByFormula: 'NOT({Execution Log} = "")',
            maxRecords: 20
        }).firstPage();
        
        console.log(`\n📊 Found ${allExecutions.length} recent executions with timing data:\n`);
        
        allExecutions.forEach((record, index) => {
            const clientName = record.get('Client Name') || 'Unknown';
            const executionLog = record.get('Execution Log');
            
            console.log(`${index + 1}. 🏢 ${clientName}`);
            
            if (executionLog) {
                // Parse text-based execution log format
                console.log(`   📄 Execution Log Preview: ${executionLog.substring(0, 150)}...`);
                
                // Extract timing info from text log
                const durationMatch = executionLog.match(/DURATION:\s*(\d+(\.\d+)?)\s*seconds?/i);
                const statusMatch = executionLog.match(/STATUS:\s*(\w+)/i);
                const leadsMatch = executionLog.match(/LEADS PROCESSED:\s*(\d+)\/(\d+)/i);
                const postsMatch = executionLog.match(/POST SCORING:\s*(\d+)\/(\d+)/i);
                
                if (durationMatch) {
                    const seconds = parseFloat(durationMatch[1]);
                    console.log(`   ⏱️ Duration: ${seconds}s`);
                    
                    if (seconds > 300) { // 5 minutes
                        console.log(`   🚨 LONG EXECUTION: ${seconds}s (${Math.round(seconds/60)}m)`);
                    } else if (seconds > 180) { // 3 minutes
                        console.log(`   ⚠️ Getting long: ${seconds}s`);
                    } else {
                        console.log(`   ✅ Good timing: ${seconds}s`);
                    }
                } else {
                    console.log(`   ❓ No duration found in log`);
                }
                
                if (statusMatch) {
                    console.log(`   � Status: ${statusMatch[1]}`);
                }
                
                if (leadsMatch) {
                    console.log(`   👥 Leads: ${leadsMatch[1]}/${leadsMatch[2]} processed`);
                }
                
                if (postsMatch) {
                    console.log(`   � Posts: ${postsMatch[1]}/${postsMatch[2]} scored`);
                }
                
                // Look for error indicators
                if (executionLog.toLowerCase().includes('error') || executionLog.toLowerCase().includes('failed')) {
                    console.log(`   ❌ Errors detected in log`);
                }
                
            }
            
            console.log(''); // Empty line between records
        });
        
        // Summary analysis
        console.log('\n📈 TIMING ANALYSIS SUMMARY:');
        console.log('='.repeat(40));
        
        const longExecutions = allExecutions.filter(record => {
            const log = record.get('Execution Log');
            if (!log) return false;
            
            const durationMatch = log.match(/DURATION:\s*(\d+(\.\d+)?)\s*seconds?/i);
            return durationMatch && parseFloat(durationMatch[1]) > 300; // > 5 minutes
        });
        
        console.log(`🚨 Executions over 5 minutes: ${longExecutions.length}/${allExecutions.length}`);
        console.log(`⚠️ This suggests ${longExecutions.length > 0 ? 'TIMEOUT RISK' : 'timing looks OK'}`);
        
        if (longExecutions.length > 0) {
            console.log('\n💡 RECOMMENDATION: Implement fire-and-forget pattern immediately!');
        }
        
    } catch (error) {
        console.error('❌ Error checking timing data:', error.message);
    }
}

checkExecutionTiming();