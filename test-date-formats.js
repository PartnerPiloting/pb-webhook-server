// Test to check the exact format Airtable expects for Date fields

require('dotenv').config();
const Airtable = require('airtable');

async function testDateFormat() {
    console.log('🧪 Testing Date field format for Airtable...');
    
    try {
        const airtableApiKey = process.env.AIRTABLE_API_KEY;
        const baseId = process.env.AIRTABLE_BASE_ID;
        
        const base = new Airtable({ apiKey: airtableApiKey }).base(baseId);
        
        // Find the lead
        const records = await base('Leads').select({
            filterByFormula: `RECORD_ID() = 'recHkqPSMfdQWyqus'`,
            maxRecords: 1
        }).firstPage();
        
        const leadRecord = records[0];
        console.log('📋 Current Date Scored value:');
        console.log(`   Raw value: ${JSON.stringify(leadRecord.fields['Date Scored'])}`);
        console.log(`   Type: ${typeof leadRecord.fields['Date Scored']}`);
        
        // Test different date formats
        const formats = [
            new Date().toISOString().split("T")[0],  // "2025-08-04"
            new Date().toISOString(),                 // "2025-08-04T12:34:56.789Z"
            new Date(),                               // Date object
            new Date().toDateString(),                // "Sun Aug 04 2025"
        ];
        
        console.log('\n🧪 Testing different date formats:');
        
        for (let i = 0; i < formats.length; i++) {
            const format = formats[i];
            console.log(`\n--- Test ${i + 1} ---`);
            console.log(`Format: ${JSON.stringify(format)} (${typeof format})`);
            
            try {
                await base('Leads').update([{
                    id: leadRecord.id,
                    fields: {
                        "Date Scored": format
                    }
                }]);
                
                // Check result
                const updatedRecords = await base('Leads').select({
                    filterByFormula: `RECORD_ID() = 'recHkqPSMfdQWyqus'`,
                    maxRecords: 1
                }).firstPage();
                
                const result = updatedRecords[0].fields['Date Scored'];
                console.log(`✅ Success! Stored as: ${JSON.stringify(result)} (${typeof result})`);
                
                // Wait a bit between tests
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.log(`❌ Failed: ${error.message}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run the test
testDateFormat().catch(console.error);
