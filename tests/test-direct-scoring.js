#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');
const { VertexAI } = require('@google-cloud/vertexai');

async function testDirectScoringFlow() {
    console.log('🎯 DIRECT SCORING FLOW TEST');
    console.log('='.repeat(80));
    console.log('Goal: Test Gemini directly with failing lead data to identify issue');
    
    try {
        const base = airtableClient;
        
        // Get the failing lead
        console.log('\n1. 📊 Fetching failing lead data...');
        const failingRecord = await base('Leads').find('recHkqPSMfdQWyqus');
        
        const name = failingRecord.get('Name') || 'Unknown';
        const profileJSON = failingRecord.get('Profile Full JSON');
        
        console.log(`   ❌ Failing Lead: ${name}`);
        console.log(`   📏 JSON Length: ${profileJSON ? profileJSON.length : 0} characters`);
        
        if (!profileJSON) {
            console.log('   ❌ No Profile Full JSON found!');
            return;
        }
        
        // Parse JSON locally first
        let parsedProfile;
        try {
            parsedProfile = JSON.parse(profileJSON);
            console.log('   ✅ JSON parses successfully locally');
        } catch (parseError) {
            console.log('   ❌ JSON Parse Error locally:', parseError.message);
            return;
        }
        
        // Initialize Gemini using production config
        console.log('\n2. 🤖 Setting up Gemini client...');
        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION
        });
        
        const model = vertex_ai.getGenerativeModel({
            model: process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash',
            generationConfig: {
                maxOutputTokens: 1000,
                temperature: 0.1,
            },
        });
        
        console.log('   ✅ Gemini client initialized');
        
        // Create a simple test prompt similar to production
        console.log('\n3. 🔍 TESTING WITH SIMPLIFIED PRODUCTION PROMPT');
        console.log('-'.repeat(60));
        
        const simplePrompt = `Please analyze this professional profile and return a JSON object with scoring information.

Profile Data:
${profileJSON}

Return ONLY a valid JSON object with this structure:
{
  "overallScore": <number between 1-100>,
  "reasoning": "<brief explanation>",
  "categories": {
    "technical": <score>,
    "experience": <score>,
    "leadership": <score>
  }
}

Important: Return ONLY the JSON object with no additional text, formatting, or markdown.`;
        
        console.log(`   📏 Prompt length: ${simplePrompt.length} characters`);
        console.log(`   📋 Prompt preview: ${simplePrompt.substring(0, 200)}...`);
        
        // Send to Gemini
        console.log('\n   🚀 Sending to Gemini...');
        try {
            const startTime = Date.now();
            const result = await model.generateContent(simplePrompt);
            const endTime = Date.now();
            
            console.log(`   ⏱️  Response time: ${endTime - startTime}ms`);
            
            // Extract raw response
            const rawResponse = result.response.candidates[0].content.parts[0].text;
            console.log(`   📥 Raw response length: ${rawResponse.length} characters`);
            console.log(`   📄 Raw response preview: ${rawResponse.substring(0, 300)}...`);
            
            // Check for markdown formatting
            const hasMarkdown = rawResponse.includes('```json') || rawResponse.includes('```');
            console.log(`   📝 Has markdown formatting: ${hasMarkdown ? 'YES' : 'NO'}`);
            
            if (hasMarkdown) {
                console.log('   🚨 ISSUE FOUND: Response contains markdown formatting!');
                console.log(`   📄 Full raw response:\n${rawResponse}`);
            }
            
            // Test production-style cleaning
            console.log('\n   🧹 Testing response cleaning...');
            
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
            
            // Test JSON parsing
            console.log('\n   🔍 Testing JSON parsing...');
            try {
                const parsedAIResponse = JSON.parse(cleanedResponse);
                console.log('   ✅ SUCCESS: JSON parses correctly!');
                console.log(`   📊 Parsed structure keys: ${Object.keys(parsedAIResponse)}`);
                
                if (parsedAIResponse.overallScore !== undefined) {
                    console.log(`   ⭐ Score found: ${parsedAIResponse.overallScore}`);
                    console.log(`   📝 Reasoning: ${parsedAIResponse.reasoning?.substring(0, 100)}...`);
                } else {
                    console.log('   ⚠️  No overallScore field found in response');
                }
                
            } catch (jsonError) {
                console.log('   ❌ JSON PARSE ERROR - THIS IS THE PRODUCTION FAILURE!');
                console.log(`   🚨 Error: ${jsonError.message}`);
                console.log(`   📄 Problematic response: ${cleanedResponse.substring(0, 500)}`);
                
                // Detailed error analysis
                console.log('\n   🔍 DETAILED JSON ERROR ANALYSIS:');
                
                if (cleanedResponse.includes('```')) {
                    console.log('      🚨 ISSUE: Response still contains markdown after cleaning');
                }
                
                if (!cleanedResponse.startsWith('{') || !cleanedResponse.endsWith('}')) {
                    console.log('      🚨 ISSUE: Response doesn\'t start/end with proper JSON braces');
                    console.log(`      📍 Start: "${cleanedResponse.substring(0, 20)}"`);
                    console.log(`      📍 End: "${cleanedResponse.substring(cleanedResponse.length - 20)}"`);
                }
                
                const openBraces = (cleanedResponse.match(/{/g) || []).length;
                const closeBraces = (cleanedResponse.match(/}/g) || []).length;
                console.log(`      📊 Brace balance: ${openBraces} open, ${closeBraces} close`);
                
                if (openBraces !== closeBraces) {
                    console.log('      🚨 ISSUE: Unbalanced braces - JSON structure incomplete');
                }
                
                // Check for common JSON syntax issues
                const commonIssues = [
                    { name: 'Trailing comma', pattern: /,\s*}/ },
                    { name: 'Unquoted keys', pattern: /{\s*[a-zA-Z]/ },
                    { name: 'Single quotes', pattern: /'[^']*'/ },
                    { name: 'Newlines in strings', pattern: /"\s*\n\s*"/ }
                ];
                
                commonIssues.forEach(issue => {
                    if (issue.pattern.test(cleanedResponse)) {
                        console.log(`      🚨 ISSUE: ${issue.name} detected`);
                    }
                });
            }
            
        } catch (geminiError) {
            console.log('   ❌ GEMINI ERROR:', geminiError.message);
            
            if (geminiError.message.includes('quota')) {
                console.log('      🚨 ISSUE: Quota/rate limiting error');
            } else if (geminiError.message.includes('timeout')) {
                console.log('      🚨 ISSUE: Timeout error');
            } else if (geminiError.message.includes('token')) {
                console.log('      🚨 ISSUE: Token limit error');
            }
        }
        
        // Test with a successful lead for comparison
        console.log('\n4. 🔍 TESTING SUCCESSFUL LEAD FOR COMPARISON');
        console.log('-'.repeat(60));
        
        try {
            const successfulLeads = await base('Leads').select({
                filterByFormula: "AND({AI Score} != '', {AI Score} != 'Failed')",
                maxRecords: 1
            }).firstPage();
            
            if (successfulLeads.length > 0) {
                const successfulRecord = successfulLeads[0];
                const successfulProfileJSON = successfulRecord.get('Profile Full JSON');
                const successfulName = successfulRecord.get('Name') || 'Unknown';
                
                console.log(`   ✅ Successful Lead: ${successfulName}`);
                console.log(`   📏 JSON Length: ${successfulProfileJSON?.length || 0} characters`);
                
                if (successfulProfileJSON) {
                    const successfulPrompt = `Please analyze this professional profile and return a JSON object with scoring information.

Profile Data:
${successfulProfileJSON}

Return ONLY a valid JSON object with this structure:
{
  "overallScore": <number between 1-100>,
  "reasoning": "<brief explanation>",
  "categories": {
    "technical": <score>,
    "experience": <score>,
    "leadership": <score>
  }
}

Important: Return ONLY the JSON object with no additional text, formatting, or markdown.`;
                    
                    console.log(`   📏 Successful prompt length: ${successfulPrompt.length} characters`);
                    console.log(`   📊 Length comparison: Failing ${simplePrompt.length} vs Successful ${successfulPrompt.length}`);
                    
                    const lengthDiff = Math.abs(simplePrompt.length - successfulPrompt.length);
                    const percentDiff = (lengthDiff / Math.max(simplePrompt.length, successfulPrompt.length) * 100).toFixed(1);
                    
                    console.log(`   📊 Difference: ${lengthDiff} characters (${percentDiff}%)`);
                    
                    if (lengthDiff > 2000) {
                        console.log('   ⚠️  SIGNIFICANT length difference - this could be the issue!');
                    }
                }
            } else {
                console.log('   ⚠️  No successful leads found for comparison');
            }
        } catch (error) {
            console.log('   ❌ Error fetching successful lead:', error.message);
        }
        
        // CONCLUSION
        console.log('\n5. 📋 TEST CONCLUSION');
        console.log('='.repeat(80));
        
        console.log('\n🎯 THIS TEST REVEALS:');
        console.log('   • Whether Gemini responds successfully or errors');
        console.log('   • If responses have markdown formatting issues');
        console.log('   • If JSON parsing fails due to malformed output');
        console.log('   • If there are significant size differences vs successful leads');
        
        console.log('\n🔍 NEXT STEPS BASED ON RESULTS:');
        console.log('   • If JSON parsing fails: Fix cleanAIResponse function');
        console.log('   • If markdown found: Improve response cleaning');
        console.log('   • If Gemini errors: Investigate API issues');
        console.log('   • If size differences: Investigate input limits');
        
    } catch (error) {
        console.error('❌ Test error:', error);
    }
}

// Run the direct scoring test
testDirectScoringFlow();
