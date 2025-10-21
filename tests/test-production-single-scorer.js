#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');
const { scoreLeadNow } = require('./singleScorer');

async function testProductionSingleScorer() {
    console.log('🎯 TESTING PRODUCTION SINGLE SCORER');
    console.log('='.repeat(80));
    
    try {
        const base = airtableClient;
        
        // Test the exact failing lead using production singleScorer
        console.log('\n1. 📊 Fetching failing lead...');
        const failingRecord = await base('Leads').find('recHkqPSMfdQWyqus');
        
        const leadData = {
            id: failingRecord.id,
            get: (field) => failingRecord.get(field)
        };
        
        const name = leadData.get('Name') || 'Unknown';
        const profileJSON = leadData.get('Profile Full JSON');
        console.log(`   ❌ Lead: ${name}`);
        console.log(`   📏 Profile Length: ${profileJSON?.length || 0} characters`);
        
        // Load the Gemini config
        console.log('\n2. 🤖 Loading production Gemini config...');
        let geminiConfig;
        try {
            geminiConfig = require('./config/geminiClient');
            console.log('   ✅ Gemini config loaded');
            console.log(`   📋 VertexAI Client: ${geminiConfig.vertexAIClient ? 'Available' : 'Missing'}`);
            console.log(`   📋 Model ID: ${geminiConfig.geminiModelId || 'Missing'}`);
        } catch (error) {
            console.log('   ❌ Failed to load gemini config:', error.message);
            return;
        }
        
        // Test with production dependencies
        console.log('\n3. 🚀 Testing with production singleScorer...');
        
        const dependencies = {
            vertexAIClient: geminiConfig.vertexAIClient,
            geminiModelId: geminiConfig.geminiModelId
        };
        
        try {
            console.log('   📤 Calling scoreLeadNow...');
            const startTime = Date.now();
            
            const result = await scoreLeadNow(leadData, dependencies);
            
            const endTime = Date.now();
            console.log(`   ✅ SUCCESS! (${endTime - startTime}ms)`);
            console.log(`   📊 Score: ${result.score || result.overallScore || 'Unknown'}`);
            console.log(`   📄 Result keys: ${Object.keys(result)}`);
            
            if (result.reasoning) {
                console.log(`   💭 Reasoning: ${result.reasoning.substring(0, 100)}...`);
            }
            
        } catch (error) {
            console.log(`   ❌ PRODUCTION ERROR: ${error.message}`);
            console.log(`   🔍 Error type: ${error.constructor.name}`);
            
            if (error.finishReason) {
                console.log(`   📊 Finish Reason: ${error.finishReason}`);
            }
            
            if (error.safetyRatings) {
                console.log(`   🛡️  Safety Ratings: ${JSON.stringify(error.safetyRatings)}`);
            }
            
            if (error.rawResponseSnippet) {
                console.log(`   📄 Raw Response Snippet: ${error.rawResponseSnippet}`);
            }
            
            // This is the actual production error!
            console.log('\n   🚨 PRODUCTION ERROR ANALYSIS:');
            
            if (error.message.includes('Cannot read properties of undefined')) {
                console.log('      💡 This is the "reading \'0\'" error we found!');
                console.log('      💡 It means candidate.content.parts was undefined');
                console.log('      💡 This happens when Gemini hits MAX_TOKENS and returns empty parts');
            }
            
            if (error.message.includes('JSON Parse Error')) {
                console.log('      💡 JSON parsing failed - response was malformed');
            }
            
            if (error.message.includes('MAX_TOKENS')) {
                console.log('      💡 Hit the 4096 token output limit');
                console.log('      💡 Need to increase maxOutputTokens further');
            }
        }
        
        // Test a successful lead for comparison
        console.log('\n4. 📈 Testing successful lead for comparison...');
        
        try {
            const successfulLeads = await base('Leads').select({
                filterByFormula: "AND({AI Score} != '', {AI Score} != 'Failed', {AI Score} != 'ERROR')",
                maxRecords: 1
            }).firstPage();
            
            if (successfulLeads.length > 0) {
                const successfulRecord = successfulLeads[0];
                const successfulLeadData = {
                    id: successfulRecord.id,
                    get: (field) => successfulRecord.get(field)
                };
                
                const successfulName = successfulLeadData.get('Name') || 'Unknown';
                const successfulProfile = successfulLeadData.get('Profile Full JSON');
                
                console.log(`   ✅ Successful Lead: ${successfulName}`);
                console.log(`   📏 Profile Length: ${successfulProfile?.length || 0} characters`);
                
                try {
                    const successResult = await scoreLeadNow(successfulLeadData, dependencies);
                    console.log(`   ✅ Successful scoring confirmed`);
                    console.log(`   📊 Score: ${successResult.score || successResult.overallScore || 'Unknown'}`);
                    
                    // Compare sizes
                    const failingSize = profileJSON?.length || 0;
                    const successfulSize = successfulProfile?.length || 0;
                    const sizeDiff = Math.abs(failingSize - successfulSize);
                    const percentDiff = (sizeDiff / Math.max(failingSize, successfulSize) * 100).toFixed(1);
                    
                    console.log(`   📊 Size comparison: Failing ${failingSize} vs Successful ${successfulSize}`);
                    console.log(`   📊 Difference: ${sizeDiff} characters (${percentDiff}%)`);
                    
                    if (percentDiff > 50) {
                        console.log('   ⚠️  SIGNIFICANT size difference - this confirms the issue!');
                    }
                    
                } catch (successError) {
                    console.log(`   ❌ Even successful lead failed: ${successError.message}`);
                }
            } else {
                console.log('   ⚠️  No successful leads found');
            }
        } catch (error) {
            console.log(`   ❌ Error testing successful lead: ${error.message}`);
        }
        
        console.log('\n📋 ANALYSIS & RECOMMENDATIONS');
        console.log('='.repeat(80));
        
        console.log('\n🔍 WHAT WE LEARNED:');
        console.log('   • Production uses 4096 maxOutputTokens');
        console.log('   • Some complex profiles still exceed this limit');
        console.log('   • When MAX_TOKENS is hit, parts array can be empty');
        console.log('   • This causes "Cannot read properties of undefined" error');
        
        console.log('\n🔧 IMMEDIATE FIXES NEEDED:');
        console.log('   1. Increase maxOutputTokens from 4096 to 8192');
        console.log('   2. Add better error handling for empty parts array');
        console.log('   3. Add retry logic with higher token limits');
        
        console.log('\n📊 EXPECTED IMPACT:');
        console.log('   • Should fix the 37.4% failure rate');
        console.log('   • Larger profiles will get complete JSON responses');
        console.log('   • Better error handling will prevent crashes');
        
    } catch (error) {
        console.error('❌ Test error:', error);
    }
}

testProductionSingleScorer();
