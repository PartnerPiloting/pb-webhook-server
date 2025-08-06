#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');
const { VertexAI } = require('@google-cloud/vertexai');

async function testProductionIdentical() {
    console.log('🎯 TESTING PRODUCTION-IDENTICAL CONDITIONS');
    console.log('='.repeat(80));
    console.log('Goal: Replicate exact same prompt/response flow as production scoring');
    
    try {
        const base = airtableClient;
        
        // Get both a successful and failing lead
        console.log('\n1. 📊 Fetching test leads...');
        const failingRecord = await base('Leads').find('recHkqPSMfdQWyqus');
        
        console.log(`   ❌ Failing Lead: ${failingRecord.get('Name') || 'Unknown'}`);
        console.log(`   📏 JSON Length: ${failingRecord.get('Profile Full JSON')?.length || 0} characters`);
        
        // Find a successful lead for comparison
        const successfulLeads = await base('Leads').select({
            filterByFormula: "AND({AI Score} != '', {AI Score} != 'Failed')",
            maxRecords: 1
        }).firstPage();
        
        if (successfulLeads.length > 0) {
            const successfulRecord = successfulLeads[0];
            console.log(`   ✅ Successful Lead: ${successfulRecord.get('Name') || 'Unknown'}`);
            console.log(`   📏 JSON Length: ${successfulRecord.get('Profile Full JSON')?.length || 0} characters`);
        }
        
        // Initialize Gemini using EXACT production config
        console.log('\n2. 🤖 Setting up EXACT production Gemini config...');
        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION
        });
        
        const model = vertex_ai.getGenerativeModel({
            model: process.env.GEMINI_MODEL_ID || 'gemini-2.5-pro-preview-05-06',
            generationConfig: {
                maxOutputTokens: 1000,
                temperature: 0.1,
            },
        });
        
        // Load the EXACT prompt builder used in production
        console.log('\n3. 📋 Loading production prompt builder...');
        const promptBuilder = require('./promptBuilder');
        
        // Test the failing lead with EXACT production flow
        console.log('\n4. 🔍 TESTING FAILING LEAD WITH PRODUCTION FLOW');
        console.log('-'.repeat(60));
        
        const failingProfileJSON = failingRecord.get('Profile Full JSON');
        let failingParsedProfile;
        
        try {
            failingParsedProfile = JSON.parse(failingProfileJSON);
            console.log('   ✅ Failing lead JSON parses successfully');
        } catch (parseError) {
            console.log('   ❌ JSON Parse Error:', parseError.message);
            return;
        }
        
        // Build EXACT production prompt
        const productionPrompt = promptBuilder.buildPrompt(failingParsedProfile);
        console.log(`   📏 Production prompt length: ${productionPrompt.length} characters`);
        console.log(`   📋 Prompt preview: ${productionPrompt.substring(0, 200)}...`);
        
        // Send to Gemini with EXACT production flow
        console.log('\n   🚀 Sending to Gemini with production config...');
        try {
            const startTime = Date.now();
            const result = await model.generateContent(productionPrompt);
            const endTime = Date.now();
            
            console.log(`   ⏱️  Response time: ${endTime - startTime}ms`);
            
            // Extract response using EXACT production method
            const rawResponse = result.response.candidates[0].content.parts[0].text;
            console.log(`   📥 Raw response length: ${rawResponse.length} characters`);
            console.log(`   📄 Raw response preview: ${rawResponse.substring(0, 300)}...`);
            
            // Apply EXACT production response cleaning
            console.log('\n   🧹 Applying production response cleaning...');
            
            // Check if response has markdown formatting
            const hasMarkdown = rawResponse.includes('```json') || rawResponse.includes('```');
            console.log(`   📝 Has markdown formatting: ${hasMarkdown ? 'YES' : 'NO'}`);
            
            // Apply production cleanAIResponse function
            function cleanAIResponse(response) {
                if (!response || typeof response !== 'string') {
                    return response;
                }
                
                // Remove markdown formatting
                let cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '');
                
                // Trim whitespace
                cleaned = cleaned.trim();
                
                return cleaned;
            }
            
            const cleanedResponse = cleanAIResponse(rawResponse);
            console.log(`   📥 Cleaned response length: ${cleanedResponse.length} characters`);
            console.log(`   📄 Cleaned response preview: ${cleanedResponse.substring(0, 300)}...`);
            
            // Test JSON parsing like production
            console.log('\n   🔍 Testing JSON parsing (production method)...');
            try {
                const parsedAIResponse = JSON.parse(cleanedResponse);
                console.log('   ✅ SUCCESS: JSON parses correctly!');
                console.log(`   📊 Parsed structure keys: ${Object.keys(parsedAIResponse)}`);
                
                // Check for expected score field
                if (parsedAIResponse.overallScore !== undefined) {
                    console.log(`   ⭐ Score found: ${parsedAIResponse.overallScore}`);
                } else {
                    console.log('   ⚠️  No overallScore field found in response');
                }
                
            } catch (jsonError) {
                console.log('   ❌ JSON PARSE ERROR (this is the production failure!)');
                console.log(`   🚨 Error: ${jsonError.message}`);
                console.log(`   📄 Problematic response: ${cleanedResponse.substring(0, 500)}`);
                
                // Analyze the specific JSON error
                console.log('\n   🔍 JSON ERROR ANALYSIS:');
                
                // Check for common JSON issues
                if (cleanedResponse.includes('```')) {
                    console.log('      🚨 ISSUE: Response still contains markdown formatting');
                }
                
                if (!cleanedResponse.startsWith('{') || !cleanedResponse.endsWith('}')) {
                    console.log('      🚨 ISSUE: Response doesn\'t start/end with proper JSON braces');
                    console.log(`      Start: "${cleanedResponse.substring(0, 10)}"`);
                    console.log(`      End: "${cleanedResponse.substring(cleanedResponse.length - 10)}"`);
                }
                
                // Check for truncation indicators
                if (cleanedResponse.length < 100) {
                    console.log('      🚨 ISSUE: Response seems unusually short');
                } else if (!cleanedResponse.includes('overallScore')) {
                    console.log('      🚨 ISSUE: Response missing expected fields');
                }
                
                // Look for incomplete JSON structure
                const openBraces = (cleanedResponse.match(/{/g) || []).length;
                const closeBraces = (cleanedResponse.match(/}/g) || []).length;
                console.log(`      📊 Brace balance: ${openBraces} open, ${closeBraces} close`);
                
                if (openBraces !== closeBraces) {
                    console.log('      🚨 ISSUE: Unbalanced braces - JSON structure incomplete');
                }
            }
            
        } catch (geminiError) {
            console.log('   ❌ GEMINI ERROR:', geminiError.message);
            
            // Check for specific error types
            if (geminiError.message.includes('quota')) {
                console.log('      🚨 ISSUE: Quota/rate limiting error');
            } else if (geminiError.message.includes('timeout')) {
                console.log('      🚨 ISSUE: Timeout error');
            } else if (geminiError.message.includes('token')) {
                console.log('      🚨 ISSUE: Token limit error');
            }
        }
        
        // Test successful lead for comparison (if available)
        if (successfulLeads.length > 0) {
            console.log('\n5. 🔍 TESTING SUCCESSFUL LEAD FOR COMPARISON');
            console.log('-'.repeat(60));
            
            const successfulRecord = successfulLeads[0];
            const successfulProfileJSON = successfulRecord.get('Profile Full JSON');
            
            if (successfulProfileJSON) {
                try {
                    const successfulParsedProfile = JSON.parse(successfulProfileJSON);
                    const successfulPrompt = promptBuilder.buildPrompt(successfulParsedProfile);
                    
                    console.log(`   📏 Successful lead prompt length: ${successfulPrompt.length} characters`);
                    console.log(`   📊 Length comparison: Failing ${productionPrompt.length} vs Successful ${successfulPrompt.length}`);
                    
                    const lengthDifference = Math.abs(productionPrompt.length - successfulPrompt.length);
                    const percentDifference = (lengthDifference / Math.max(productionPrompt.length, successfulPrompt.length) * 100).toFixed(1);
                    
                    console.log(`   📊 Length difference: ${lengthDifference} characters (${percentDifference}%)`);
                    
                    if (lengthDifference > 1000) {
                        console.log('   ⚠️  Significant length difference detected!');
                    }
                    
                } catch (error) {
                    console.log('   ❌ Error processing successful lead:', error.message);
                }
            }
        }
        
        // CONCLUSION
        console.log('\n6. 📋 ANALYSIS CONCLUSION');
        console.log('='.repeat(80));
        
        console.log('\n🎯 KEY FINDINGS:');
        console.log('   • This test replicates EXACT production conditions');
        console.log('   • Uses same prompt builder, model config, and response cleaning');
        console.log('   • Any failures here mirror production failures');
        console.log('   • Shows whether issue is in AI response or our parsing');
        
        console.log('\n🔍 NEXT STEPS BASED ON RESULTS:');
        console.log('   1. If JSON parsing fails: Focus on response cleaning logic');
        console.log('   2. If AI response is malformed: Investigate prompt or model issues');
        console.log('   3. If length differences significant: Investigate input size limits');
        console.log('   4. If Gemini errors occur: Focus on API/quota issues');
        
    } catch (error) {
        console.error('❌ Test error:', error);
    }
}

// Run the production-identical test
testProductionIdentical();
