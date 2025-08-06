// Test Enhanced BatchScorer Debugging - Direct scoreChunk test
// Tests the new debugging features we added to batchScorer.js scoreChunk function

const dotenv = require('dotenv');
dotenv.config();

// Initialize required clients
const { vertexAIClient, geminiModelId } = require('./config/geminiClient');
const airtableBase = require('./config/airtableClient');
const batchScorer = require('./batchScorer');

async function testScoreChunkDebugging() {
    console.log('🧪 Testing Enhanced scoreChunk Debugging...\n');
    
    try {
        // Get our test lead data
        console.log('📥 Fetching test lead recHkqPSMfdQWyqus...');
        
        const records = await airtableBase("Leads").select({
            filterByFormula: "RECORD_ID() = 'recHkqPSMfdQWyqus'",
            maxRecords: 1
        }).firstPage();
        
        if (records.length === 0) {
            throw new Error('Test lead not found');
        }
        
        const testRecord = records[0];
        console.log('✅ Found test lead');
        
        // Prepare scorable data the same way batchScorer does
        const scorable = [{
            id: testRecord.id,
            rec: testRecord,
            profile: testRecord.get('Profile') || '',
            businessName: testRecord.get('Business Name') || 'Unknown Business',
            leadSource: testRecord.get('Lead Source') || 'Unknown'
        }];
        
        console.log(`📊 Profile length: ${scorable[0].profile.length} characters`);
        console.log('🎯 Starting scoreChunk with enhanced debugging...\n');
        
        // Call scoreChunk directly with our debugging enhancements
        const result = await batchScorer.scoreChunk(
            scorable,
            'TEST_DEBUG_CLIENT',
            airtableBase,
            vertexAIClient,
            geminiModelId
        );
        
        console.log('\n✅ scoreChunk completed successfully!');
        console.log('📊 Result:', JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.log('\n❌ scoreChunk test failed:');
        console.log('🚨 Error:', error.message);
        
        // Check if this is a controlled failure (which is good for testing)
        if (error.message.includes('JSON') || error.message.includes('parse')) {
            console.log('✅ This might be the truncation error we\'re investigating!');
            console.log('🔍 Check the debug output above for clues about token limits');
        }
    }
}

// Check if this is being run directly
if (require.main === module) {
    testScoreChunkDebugging()
        .then(() => {
            console.log('\n🏁 Enhanced scoreChunk debugging test complete!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testScoreChunkDebugging };
