#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');
const { VertexAI } = require('@google-cloud/vertexai');

async function debugGeminiError() {
    console.log('🔍 DEBUGGING GEMINI ERROR');
    console.log('='.repeat(80));
    
    try {
        const base = airtableClient;
        
        // Get failing lead
        const failingRecord = await base('Leads').find('recHkqPSMfdQWyqus');
        const profileJSON = failingRecord.get('Profile Full JSON');
        
        console.log(`📏 Profile JSON length: ${profileJSON.length} characters`);
        
        // Initialize Gemini
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
        
        // Test 1: Very small prompt to verify Gemini works
        console.log('\n🧪 TEST 1: Simple test to verify Gemini works...');
        try {
            const simpleTest = await model.generateContent('Hello, please respond with "OK"');
            console.log('✅ Simple test successful');
        } catch (error) {
            console.log('❌ Simple test failed:', error.message);
        }
        
        // Test 2: Test with gradually increasing sizes
        console.log('\n🧪 TEST 2: Progressive size testing...');
        
        const testSizes = [1000, 2000, 4000, 6000, 8000];
        
        for (const size of testSizes) {
            const truncatedProfile = profileJSON.substring(0, size);
            const testPrompt = `Analyze this profile: ${truncatedProfile}`;
            
            console.log(`\n   Testing size: ${size} characters (prompt: ${testPrompt.length})`);
            
            try {
                const result = await model.generateContent(testPrompt);
                
                // Safely access the response
                if (result && result.response && result.response.candidates && result.response.candidates.length > 0) {
                    const candidate = result.response.candidates[0];
                    if (candidate && candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                        const responseText = candidate.content.parts[0].text;
                        console.log(`   ✅ Success - Response: ${responseText.substring(0, 50)}...`);
                    } else {
                        console.log('   ⚠️  Response structure issue - no parts');
                        console.log('   Response structure:', JSON.stringify(result.response, null, 2));
                    }
                } else {
                    console.log('   ⚠️  Response structure issue - no candidates');
                    console.log('   Full response:', JSON.stringify(result, null, 2));
                }
                
            } catch (error) {
                console.log(`   ❌ Failed at size ${size}:`, error.message);
                
                // Check for safety issues
                if (error.message.includes('SAFETY')) {
                    console.log('      🚨 SAFETY FILTER triggered!');
                }
                if (error.message.includes('RECITATION')) {
                    console.log('      🚨 RECITATION issue detected!');
                }
                if (error.message.includes('candidate')) {
                    console.log('      🚨 No candidates returned!');
                }
                
                break; // Stop at first failure
            }
            
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Test 3: Check exact error scenario
        console.log('\n🧪 TEST 3: Reproducing exact error scenario...');
        
        const exactPrompt = `Please analyze this professional profile and return a JSON object with scoring information.

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
        
        console.log(`📏 Exact prompt length: ${exactPrompt.length} characters`);
        
        try {
            const result = await model.generateContent(exactPrompt);
            
            console.log('📊 Result structure analysis:');
            console.log(`   result exists: ${!!result}`);
            console.log(`   response exists: ${!!result?.response}`);
            console.log(`   candidates exists: ${!!result?.response?.candidates}`);
            console.log(`   candidates length: ${result?.response?.candidates?.length || 0}`);
            
            if (result?.response?.candidates?.length > 0) {
                console.log(`   candidate[0] exists: ${!!result.response.candidates[0]}`);
                console.log(`   content exists: ${!!result.response.candidates[0]?.content}`);
                console.log(`   parts exists: ${!!result.response.candidates[0]?.content?.parts}`);
                console.log(`   parts length: ${result.response.candidates[0]?.content?.parts?.length || 0}`);
            }
            
            // Check for blocked content
            if (result?.response?.promptFeedback) {
                console.log('📋 Prompt feedback:', result.response.promptFeedback);
            }
            
            if (result?.response?.candidates?.length === 0) {
                console.log('🚨 NO CANDIDATES RETURNED - Content likely blocked!');
            }
            
        } catch (error) {
            console.log('❌ Exact scenario error:', error.message);
            console.log('🔍 Error details:', error);
        }
        
        // Test 4: Check if it's a content safety issue
        console.log('\n🧪 TEST 4: Testing content safety hypothesis...');
        
        // Try with a generic business profile
        const safeProfile = `{
            "headline": "Software Engineer at Tech Company",
            "about": "Experienced developer with expertise in JavaScript and Python",
            "experience": [
                {
                    "title": "Software Engineer",
                    "company": "Tech Corp",
                    "duration": "2 years"
                }
            ]
        }`;
        
        const safePrompt = `Please analyze this professional profile and return a JSON object with scoring information.

Profile Data:
${safeProfile}

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
        
        try {
            console.log('   Testing with safe/generic profile...');
            const safeResult = await model.generateContent(safePrompt);
            
            if (safeResult?.response?.candidates?.length > 0) {
                const safeResponse = safeResult.response.candidates[0].content.parts[0].text;
                console.log('   ✅ Safe profile works fine');
                console.log(`   📄 Response: ${safeResponse.substring(0, 100)}...`);
            } else {
                console.log('   ❌ Even safe profile fails - API issue');
            }
            
        } catch (error) {
            console.log('   ❌ Safe profile also fails:', error.message);
        }
        
        console.log('\n📋 ANALYSIS COMPLETE');
        console.log('='.repeat(80));
        
        console.log('\n🔍 LIKELY ROOT CAUSES:');
        console.log('1. Content Safety Filter: Profile contains flagged content');
        console.log('2. Size Limit: Input exceeds undocumented limits');
        console.log('3. Rate Limiting: Too many requests too quickly');
        console.log('4. Malformed Response: API returns unexpected structure');
        
    } catch (error) {
        console.error('❌ Debug test error:', error);
    }
}

debugGeminiError();
