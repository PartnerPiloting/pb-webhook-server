// Test Enhanced BatchScorer Debugging
// This tests the new debugging features we added to batchScorer.js

const dotenv = require('dotenv');
dotenv.config();

// Initialize required clients
const { vertexAIClient, geminiModelId } = require('./config/geminiClient');
const airtableBase = require('./config/airtableClient');
const { run } = require('./batchScorer');

async function testEnhancedBatchScorer() {
    console.log('🧪 Testing Enhanced BatchScorer Debugging...\n');
    
    try {
        // Create mock request/response objects like the route handler (no client validation)
        const mockReq = {
            query: { 
                limit: 1
            }
        };
        
        const mockRes = {
            headersSent: false,
            status: (code) => ({
                json: (data) => console.log(`📡 Mock response ${code}:`, data),
                send: (data) => console.log(`📡 Mock response ${code}:`, data)
            })
        };
        
        // Dependencies like the route handler provides (no client validation needed)
        const dependencies = {
            vertexAIClient,
            geminiModelId,
            airtableBase,
            limit: 1,
            targetRecords: [{ id: 'recHkqPSMfdQWyqus' }] // Our problem lead
        };
        
        console.log('🎯 Testing with problem lead recHkqPSMfdQWyqus...');
        console.log('📊 Looking for debugging output:\n');
        console.log('   🎯 BATCH_SCORER_DEBUG: (batch metadata)');
        console.log('   🔍 RESPONSE_ANALYSIS: (response completeness)');
        console.log('   🚨 JSON_PARSE_FAILED: (if truncation occurs)\n');
        
        const result = await run(mockReq, mockRes, dependencies);
        
        console.log('\n✅ BatchScorer test completed!');
        console.log('📊 Result:', JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.log('\n❌ BatchScorer test failed:');
        console.log('🚨 Error:', error.message);
        
        // Check if this is a controlled failure (which is good for testing)
        if (error.message.includes('JSON') || error.message.includes('parse')) {
            console.log('✅ This might be the truncation error we\'re investigating!');
        }
    }
}

// Check if this is being run directly
if (require.main === module) {
    testEnhancedBatchScorer()
        .then(() => {
            console.log('\n🏁 Enhanced BatchScorer debugging test complete!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testEnhancedBatchScorer };
