// Test the enhanced promptBuilder with real problematic lead data
require('dotenv').config();

const { slimLead } = require('./promptBuilder');

async function testEnhancedSlimLead() {
    console.log('🧪 TESTING ENHANCED slimLead WITH REAL PROBLEMATIC DATA');
    console.log('='.repeat(70));
    
    // Fetch the actual problematic lead from Airtable
    const baseId = process.env.AIRTABLE_BASE_ID;
    const apiKey = process.env.AIRTABLE_API_KEY;
    const problematicLeadId = 'recHkqPSMfdQWyqus';
    
    if (!baseId || !apiKey) {
        console.error('❌ Missing AIRTABLE_BASE_ID or AIRTABLE_API_KEY');
        return;
    }

    try {
        console.log(`📥 Fetching lead ${problematicLeadId} from Airtable...`);
        
        const response = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${problematicLeadId}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch lead: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const leadFields = data.fields;

        console.log('✅ Lead data fetched successfully');
        console.log('\n📊 BEFORE PROCESSING:');
        
        let totalOriginalSize = 0;
        Object.entries(leadFields).forEach(([key, value]) => {
            if (typeof value === 'string' && value.length > 1000) {
                console.log(`   ${key}: ${value.length} characters`);
                totalOriginalSize += value.length;
            }
        });
        console.log(`   Total large field size: ${totalOriginalSize} characters`);

        // Test the enhanced slimLead function
        console.log('\n🔧 PROCESSING WITH ENHANCED slimLead...');
        const processedLead = slimLead(leadFields);

        console.log('\n📊 AFTER PROCESSING:');
        let totalProcessedSize = 0;
        Object.entries(processedLead).forEach(([key, value]) => {
            if (typeof value === 'string') {
                console.log(`   ${key}: ${value.length} characters`);
                totalProcessedSize += value.length;
            } else {
                console.log(`   ${key}: ${typeof value}`);
            }
        });
        console.log(`   Total processed size: ${totalProcessedSize} characters`);

        const reduction = totalOriginalSize > 0 ? 
            ((totalOriginalSize - totalProcessedSize) / totalOriginalSize * 100).toFixed(1) : 0;
        
        console.log(`\n📈 SIZE REDUCTION: ${reduction}%`);
        
        if (processedLead._jsonStructureFixed) {
            console.log('✅ JSON structure issues were detected and fixed');
        } else {
            console.log('ℹ️  No JSON structure issues detected');
        }

        // Test JSON serialization (what actually gets sent to Gemini)
        console.log('\n🧪 JSON SERIALIZATION TEST:');
        try {
            const jsonString = JSON.stringify(processedLead, null, 2);
            console.log(`   Serialized JSON size: ${jsonString.length} characters`);
            
            // Check for nested JSON patterns that could confuse Gemini
            const nestedJsonPatterns = (jsonString.match(/\{[^}]*\{/g) || []).length;
            const escapedQuotes = (jsonString.match(/\\"/g) || []).length;
            
            console.log(`   Nested JSON patterns: ${nestedJsonPatterns}`);
            console.log(`   Escaped quotes: ${escapedQuotes}`);
            
            if (nestedJsonPatterns < 5 && escapedQuotes < 50) {
                console.log('✅ JSON structure looks clean for Gemini AI');
            } else {
                console.log('⚠️  JSON structure may still confuse Gemini AI');
            }
        } catch (jsonError) {
            console.error('❌ JSON serialization failed:', jsonError.message);
        }

        // Show processed content preview
        console.log('\n📋 PROCESSED CONTENT PREVIEW:');
        Object.entries(processedLead).forEach(([key, value]) => {
            if (typeof value === 'string' && value.length > 0) {
                const preview = value.substring(0, 100).replace(/\n/g, ' ');
                console.log(`   ${key}: ${preview}${value.length > 100 ? '...' : ''}`);
            }
        });

        console.log('\n' + '='.repeat(70));
        console.log('🎉 ENHANCED slimLead TEST COMPLETED SUCCESSFULLY');
        
        return {
            originalSize: totalOriginalSize,
            processedSize: totalProcessedSize,
            reduction: reduction,
            jsonStructureFixed: processedLead._jsonStructureFixed || false,
            processedData: processedLead
        };

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    }
}

// Run the test
if (require.main === module) {
    testEnhancedSlimLead()
        .then(result => {
            console.log('\n✅ Test Summary:');
            console.log(`   Original size: ${result.originalSize} chars`);
            console.log(`   Processed size: ${result.processedSize} chars`);
            console.log(`   Reduction: ${result.reduction}%`);
            console.log(`   JSON structure fixed: ${result.jsonStructureFixed}`);
        })
        .catch(error => {
            console.error('\n❌ Final test result: FAILED');
            console.error('Error:', error.message);
        });
}

module.exports = { testEnhancedSlimLead };
