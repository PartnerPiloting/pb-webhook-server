// Test script to verify Date Scored field gets updated on failed scoring attempts
// Using lead recHkqPSMfdQWyqus as requested

const { batchScorer } = require('./batchScorer');
const { getMasterClients } = require('./exploreMasterClients');

async function testDateScoredFix() {
    console.log('🧪 Testing Date Scored field update on failed scoring...');
    
    try {
        // Get master clients to find the client for this lead
        const masterClients = await getMasterClients();
        
        // Look for the lead in each client
        let foundClient = null;
        let leadRecord = null;
        
        for (const client of masterClients) {
            try {
                const records = await client.airtableBase('Leads').select({
                    filterByFormula: `RECORD_ID() = 'recHkqPSMfdQWyqus'`,
                    maxRecords: 1
                }).firstPage();
                
                if (records.length > 0) {
                    foundClient = client;
                    leadRecord = records[0];
                    console.log(`✅ Found lead recHkqPSMfdQWyqus in client: ${client.clientId}`);
                    break;
                }
            } catch (err) {
                // Client might not have this lead, continue searching
                continue;
            }
        }
        
        if (!foundClient || !leadRecord) {
            console.log('❌ Lead recHkqPSMfdQWyqus not found in any client');
            return;
        }
        
        // Check current field values before scoring
        console.log('📋 Current field values:');
        console.log(`   Scoring Status: ${leadRecord.fields['Scoring Status'] || 'Not set'}`);
        console.log(`   Date Scored: ${leadRecord.fields['Date Scored'] || 'Not set'}`);
        
        // Run batch scoring on this single lead
        console.log('🚀 Running batch scoring...');
        const result = await batchScorer([leadRecord], foundClient.clientId, foundClient.airtableBase);
        
        console.log('📊 Scoring result:', result);
        
        // Check the lead again to see if Date Scored was updated
        const updatedRecords = await foundClient.airtableBase('Leads').select({
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
            } else if (dateScoredAfter) {
                console.log('ℹ️  Date Scored field has a value (might have been set previously)');
            } else {
                console.log('❌ ISSUE: Date Scored field was not updated');
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run the test
testDateScoredFix().catch(console.error);
