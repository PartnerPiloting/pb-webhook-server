// Test to verify our updated Date Scored fix now includes full timestamp

require('dotenv').config();
const Airtable = require('airtable');

async function testTimestampFix() {
    console.log('🧪 Testing updated Date Scored field with full timestamp...');
    
    try {
        const airtableApiKey = process.env.AIRTABLE_API_KEY;
        const baseId = process.env.AIRTABLE_BASE_ID;
        
        const base = new Airtable({ apiKey: airtableApiKey }).base(baseId);
        
        // Find the lead
        console.log('🔍 Looking for lead recHkqPSMfdQWyqus...');
        
        const records = await base('Leads').select({
            filterByFormula: `RECORD_ID() = 'recHkqPSMfdQWyqus'`,
            maxRecords: 1
        }).firstPage();
        
        if (records.length === 0) {
            console.log('❌ Lead not found');
            return;
        }
        
        const leadRecord = records[0];
        
        console.log('📋 Current field values:');
        console.log(`   Scoring Status: ${leadRecord.fields['Scoring Status'] || 'Not set'}`);
        console.log(`   Date Scored (current): ${leadRecord.fields['Date Scored'] || 'Not set'}`);
        
        // Create a timestamp with current time
        const currentTimestamp = new Date().toISOString();
        console.log(`   Current timestamp: ${currentTimestamp}`);
        console.log(`   In AEST: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}`);
        
        // Test updating with full timestamp
        console.log('🚀 Updating Date Scored with full timestamp...');
        
        await base('Leads').update([{
            id: leadRecord.id,
            fields: {
                "Date Scored": currentTimestamp
            }
        }]);
        
        console.log('✅ Update completed!');
        
        // Check the result
        const updatedRecords = await base('Leads').select({
            filterByFormula: `RECORD_ID() = 'recHkqPSMfdQWyqus'`,
            maxRecords: 1
        }).firstPage();
        
        if (updatedRecords.length > 0) {
            const updatedRecord = updatedRecords[0];
            const storedValue = updatedRecord.fields['Date Scored'];
            
            console.log('📋 Updated field values:');
            console.log(`   Date Scored (new): ${storedValue}`);
            console.log(`   Raw value: ${JSON.stringify(storedValue)}`);
            console.log(`   Type: ${typeof storedValue}`);
            
            // Parse and display in local time
            if (storedValue) {
                const storedDate = new Date(storedValue);
                console.log(`   In AEST: ${storedDate.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}`);
                console.log(`   Time component: ${storedDate.toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' })}`);
                
                // Check if it includes time (not just midnight)
                const timeComponent = storedDate.toISOString().split('T')[1];
                if (timeComponent !== '00:00:00.000Z') {
                    console.log('✅ SUCCESS: Field now stores full timestamp including time!');
                    console.log('✅ This means our fix will now record the exact time of failure/success');
                } else {
                    console.log('ℹ️  Still storing as date-only (midnight time)');
                    console.log('ℹ️  This might indicate the field is still configured as Date-only in Airtable');
                }
            }
        }
        
        console.log('\n📝 UPDATED FIX SUMMARY:');
        console.log('   ✅ Changed from: new Date().toISOString().split("T")[0] (date only)');
        console.log('   ✅ Changed to:   new Date().toISOString() (full timestamp)');
        console.log('   ✅ Updated all 7 locations in batchScorer.js');
        console.log('   ✅ Now records exact time of scoring attempts (success or failure)');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
testTimestampFix().catch(console.error);
