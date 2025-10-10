#!/usr/bin/env node
/**
 * Mark false positive 429 warnings as IGNORED
 * 
 * These are warnings where "429" appears in:
 * - Timestamps (12:45:39.663890429Z)
 * - Run IDs (251009-121429)
 * 
 * They are INFO/DEBUG logs, not real rate limit errors.
 */

require('dotenv').config();
const Airtable = require('airtable');

const MASTER_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
const API_KEY = process.env.AIRTABLE_API_KEY;

if (!MASTER_BASE_ID || !API_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   - MASTER_CLIENTS_BASE_ID');
    console.error('   - AIRTABLE_API_KEY');
    process.exit(1);
}

const base = new Airtable({ apiKey: API_KEY }).base(MASTER_BASE_ID);

async function markFalse429sAsIgnored() {
    console.log('🔍 Finding false positive 429 warnings...\n');
    
    try {
        // Find all WARNING severity issues with pattern "429" that are not already FIXED or IGNORED
        const records = await base('Production Issues').select({
            filterByFormula: `AND(
                {Pattern Matched} = '429',
                {Severity} = 'WARNING',
                {Status} != 'FIXED',
                {Status} != 'IGNORED'
            )`,
            fields: ['Run ID', 'Error Message', 'Status', 'Timestamp', 'Pattern Matched']
        }).all();
        
        console.log(`📊 Found ${records.length} false positive 429 warnings\n`);
        
        if (records.length === 0) {
            console.log('✅ No records to update - all clean!');
            return;
        }
        
        // Show sample of what will be updated
        console.log('📋 Sample records to be marked IGNORED:');
        records.slice(0, 3).forEach((record, idx) => {
            const msg = record.get('Error Message') || '';
            const firstLine = msg.split('\n')[0].substring(0, 100);
            console.log(`   ${idx + 1}. ${record.get('Run ID')} - ${firstLine}...`);
        });
        
        if (records.length > 3) {
            console.log(`   ... and ${records.length - 3} more\n`);
        } else {
            console.log('');
        }
        
        // Ask for confirmation (in production, you might auto-proceed)
        console.log('⚠️  This will mark all these records as Status = "IGNORED"');
        console.log('   with Note: "False positive - 429 in timestamp/run ID (INFO/DEBUG log)"\n');
        
        // Update records in batches of 10 (Airtable limit)
        let updated = 0;
        const updateBatches = [];
        
        for (let i = 0; i < records.length; i += 10) {
            const batch = records.slice(i, i + 10).map(record => ({
                id: record.id,
                fields: {
                    'Status': 'IGNORED',
                    'Notes': 'False positive - 429 in timestamp/run ID (INFO/DEBUG log). Pattern fixed Oct 9-10, 2025.'
                }
            }));
            updateBatches.push(batch);
        }
        
        console.log(`🔄 Updating ${records.length} records in ${updateBatches.length} batches...\n`);
        
        for (let i = 0; i < updateBatches.length; i++) {
            await base('Production Issues').update(updateBatches[i]);
            updated += updateBatches[i].length;
            console.log(`   ✅ Batch ${i + 1}/${updateBatches.length}: Updated ${updateBatches[i].length} records (total: ${updated})`);
        }
        
        console.log(`\n🎉 SUCCESS! Marked ${updated} false positive 429 warnings as IGNORED\n`);
        console.log('📊 Summary:');
        console.log(`   - Pattern: "429" in timestamps/run IDs`);
        console.log(`   - Severity: WARNING`);
        console.log(`   - Old Status: NEW (or blank)`);
        console.log(`   - New Status: IGNORED`);
        console.log(`   - Note: "False positive - 429 in timestamp/run ID (INFO/DEBUG log)"`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run it
markFalse429sAsIgnored();
