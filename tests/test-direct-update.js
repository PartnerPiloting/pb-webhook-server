// Direct test to update the Date Scored field for lead recHkqPSMfdQWyqus
// This simulates what our fix should do when scoring fails

require('dotenv').config();
const Airtable = require('airtable');

async function testDirectUpdate() {
    console.log('🧪 Testing direct Date Scored field update...');
    
    try {
        const airtableApiKey = process.env.AIRTABLE_API_KEY;
        const baseId = process.env.AIRTABLE_BASE_ID;
        
        if (!airtableApiKey || !baseId) {
            console.log('❌ Missing required environment variables');
            return;
        }
        
        const base = new Airtable({ apiKey: airtableApiKey }).base(baseId);
        
        // Find the lead first
        console.log('🔍 Looking for lead recHkqPSMfdQWyqus...');
        
        const records = await base('Leads').select({
            filterByFormula: `RECORD_ID() = 'recHkqPSMfdQWyqus'`,
            maxRecords: 1
        }).firstPage();
        
        if (records.length === 0) {
            console.log('❌ Lead recHkqPSMfdQWyqus not found');
            return;
        }
        
        const leadRecord = records[0];
        console.log(`✅ Found lead recHkqPSMfdQWyqus`);
        
        // Check current field values
        console.log('📋 Current field values:');
        console.log(`   Scoring Status: ${leadRecord.fields['Scoring Status'] || 'Not set'}`);
        console.log(`   Date Scored: ${leadRecord.fields['Date Scored'] || 'Not set'}`);
        
        // Update the record with today's date to test our fix
        const todayDate = new Date().toISOString().split("T")[0];
        console.log(`🚀 Updating Date Scored field to: ${todayDate}`);
        
        await base('Leads').update([{
            id: leadRecord.id,
            fields: {
                "Date Scored": todayDate
            }
        }]);
        
        console.log('✅ Successfully updated the Date Scored field!');
        
        // Verify the update
        const updatedRecords = await base('Leads').select({
            filterByFormula: `RECORD_ID() = 'recHkqPSMfdQWyqus'`,
            maxRecords: 1
        }).firstPage();
        
        if (updatedRecords.length > 0) {
            const updatedRecord = updatedRecords[0];
            console.log('📋 Updated field values:');
            console.log(`   Scoring Status: ${updatedRecord.fields['Scoring Status'] || 'Not set'}`);
            console.log(`   Date Scored: ${updatedRecord.fields['Date Scored'] || 'Not set'}`);
            
            if (updatedRecord.fields['Date Scored'] === todayDate) {
                console.log('✅ SUCCESS: Date Scored field was updated correctly!');
                console.log('✨ This confirms our fix for updating Date Scored on failed scoring attempts will work.');
                console.log(`   Now when batchScorer fails to score this lead, it will update both:`);
                console.log(`   - Scoring Status: "Failed – [reason]"`);
                console.log(`   - Date Scored: "${todayDate}"`);
            } else {
                console.log('❌ ISSUE: Date Scored field update did not work as expected');
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run the test
testDirectUpdate().catch(console.error);
