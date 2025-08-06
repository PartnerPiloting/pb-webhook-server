// Simple test script to verify Date Scored field gets updated on failed scoring attempts
// Using lead recHkqPSMfdQWyqus as requested

require('dotenv').config();
const Airtable = require('airtable');
const { batchScorer } = require('./batchScorer');

async function testDateScoredFixSimple() {
    console.log('🧪 Testing Date Scored field update on failed scoring...');
    
    try {
        // Get environment variables
        const airtableApiKey = process.env.AIRTABLE_API_KEY;
        
        // We'll need to manually specify a base ID for testing
        // Let's check common environment variables first
        console.log('Available Airtable environment variables:');
        console.log(`AIRTABLE_API_KEY: ${airtableApiKey ? '✅ Set' : '❌ Not set'}`);
        console.log(`AIRTABLE_BASE_ID: ${process.env.AIRTABLE_BASE_ID ? '✅ Set' : '❌ Not set'}`);
        console.log(`MASTER_CLIENTS_BASE_ID: ${process.env.MASTER_CLIENTS_BASE_ID ? '✅ Set' : '❌ Not set'}`);
        
        // Try using AIRTABLE_BASE_ID if available
        let baseId = process.env.AIRTABLE_BASE_ID;
        
        if (!baseId) {
            console.log('❌ No AIRTABLE_BASE_ID found. Cannot proceed with test.');
            console.log('To run this test, you need to either:');
            console.log('1. Set AIRTABLE_BASE_ID in your .env file, or');
            console.log('2. Manually specify the base ID where lead recHkqPSMfdQWyqus exists');
            return;
        }
        
        console.log(`Using base ID: ${baseId}`);
        
        const base = new Airtable({ apiKey: airtableApiKey }).base(baseId);
        
        // Try to find the lead
        console.log('🔍 Looking for lead recHkqPSMfdQWyqus...');
        
        const records = await base('Leads').select({
            filterByFormula: `RECORD_ID() = 'recHkqPSMfdQWyqus'`,
            maxRecords: 1
        }).firstPage();
        
        if (records.length === 0) {
            console.log('❌ Lead recHkqPSMfdQWyqus not found in this base');
            return;
        }
        
        const leadRecord = records[0];
        console.log(`✅ Found lead recHkqPSMfdQWyqus`);
        
        // Check current field values before scoring
        console.log('📋 Current field values:');
        console.log(`   Scoring Status: ${leadRecord.fields['Scoring Status'] || 'Not set'}`);
        console.log(`   Date Scored: ${leadRecord.fields['Date Scored'] || 'Not set'}`);
        console.log(`   Profile Full JSON length: ${leadRecord.fields['Profile Full JSON'] ? leadRecord.fields['Profile Full JSON'].length : 'No profile'} characters`);
        
        // Run batch scoring on this single lead
        console.log('🚀 Running batch scoring...');
        const result = await batchScorer([leadRecord], 'test-client', base);
        
        console.log('📊 Scoring result:', result);
        
        // Check the lead again to see if Date Scored was updated
        const updatedRecords = await base('Leads').select({
            filterByFormula: `RECORD_ID() = 'recHkqPSMfdQWyqus'`,
            maxRecords: 1
        }).firstPage();
        
        if (updatedRecords.length > 0) {
            const updatedRecord = updatedRecords[0];
            console.log('📋 Updated field values:');
            console.log(`   Scoring Status: ${updatedRecord.fields['Scoring Status'] || 'Not set'}`);
            console.log(`   Date Scored: ${updatedRecord.fields['Date Scored'] || 'Not set'}`);
            
            // Check if Date Scored was updated
            const dateScoredBefore = leadRecord.fields['Date Scored'];
            const dateScoredAfter = updatedRecord.fields['Date Scored'];
            
            if (dateScoredAfter && dateScoredAfter !== dateScoredBefore) {
                console.log('✅ SUCCESS: Date Scored field was updated!');
                console.log(`   Changed from: ${dateScoredBefore || 'Not set'} → ${dateScoredAfter}`);
            } else if (dateScoredAfter) {
                console.log('ℹ️  Date Scored field has a value (might have been set previously)');
                console.log(`   Current value: ${dateScoredAfter}`);
            } else {
                console.log('❌ ISSUE: Date Scored field was not updated');
            }
            
            // Also check if status shows a failure (which would confirm our fix worked)
            const status = updatedRecord.fields['Scoring Status'];
            if (status && status.includes('Failed')) {
                console.log(`✅ Confirmed: Lead failed scoring with status "${status}"`);
                if (dateScoredAfter) {
                    console.log('✅ Fix verified: Failed scoring attempt updated Date Scored field!');
                } else {
                    console.log('❌ Fix not working: Failed scoring did not update Date Scored field');
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
testDateScoredFixSimple().catch(console.error);
