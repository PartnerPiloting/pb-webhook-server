#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');

async function debugScoringProcess() {
    console.log('🔍 DEBUGGING SCORING PROCESS WITH DETAILED LOGGING');
    console.log('='.repeat(80));
    console.log('Target: recHkqPSMfdQWyqus');
    console.log('Goal: Track JSON through entire scoring pipeline');
    
    try {
        const base = airtableClient;
        
        console.log('\n1. 📊 STEP 1: Fetching lead data...');
        const record = await base('Leads').find('recHkqPSMfdQWyqus');
        
        const name = record.get('Name') || 'Unknown';
        const company = record.get('Company') || 'Unknown';
        const profileJSON = record.get('Profile Full JSON');
        
        console.log(`   ✅ Lead: ${name} (${company})`);
        console.log(`   📏 Original JSON Length: ${profileJSON ? profileJSON.length : 0} characters`);
        
        if (!profileJSON) {
            console.log('   ❌ No Profile Full JSON found!');
            return;
        }
        
        console.log('\n2. 🧬 STEP 2: JSON Validation Check...');
        let parsedProfile;
        try {
            parsedProfile = JSON.parse(profileJSON);
            console.log('   ✅ JSON parses successfully');
            console.log(`   📋 Keys: ${Object.keys(parsedProfile).join(', ')}`);
        } catch (parseError) {
            console.log('   ❌ JSON Parse Error:', parseError.message);
            console.log('   🛠️ Attempting to identify corruption...');
            
            // Show the problematic area
            const errorMatch = parseError.message.match(/position (\d+)/);
            if (errorMatch) {
                const pos = parseInt(errorMatch[1]);
                const context = profileJSON.substring(Math.max(0, pos - 50), pos + 50);
                console.log(`   📄 Error context: "${context}"`);
            }
            return;
        }
        
        console.log('\n3. 🔍 STEP 3: Field Extraction Simulation...');
        
        // Simulate the field extraction that happens in scoring
        const extractedFields = {
            bio: parsedProfile.about || '',
            headline: parsedProfile.headline || '',
            experience: parsedProfile.experience || []
        };
        
        console.log(`   📄 Bio length: ${extractedFields.bio.length} characters`);
        console.log(`   📄 Headline: "${extractedFields.headline}"`);
        console.log(`   📄 Experience entries: ${extractedFields.experience.length}`);
        
        // Check if fields meet minimum requirements
        const bioValid = extractedFields.bio.length >= 40;
        const headlineValid = extractedFields.headline.length > 0;
        const experienceValid = extractedFields.experience.length > 0;
        
        console.log(`   ✅ Bio valid (≥40 chars): ${bioValid}`);
        console.log(`   ✅ Headline valid: ${headlineValid}`);
        console.log(`   ✅ Experience valid: ${experienceValid}`);
        
        if (!bioValid || !headlineValid || !experienceValid) {
            console.log('   🚨 Lead does not meet minimum requirements for scoring!');
            return;
        }
        
        console.log('\n4. 🤖 STEP 4: AI Prompt Preparation...');
        
        // Simulate prompt building (similar to what promptBuilder.js does)
        const promptData = {
            bio: extractedFields.bio.substring(0, 2000), // Truncate if too long
            headline: extractedFields.headline,
            experience: extractedFields.experience.slice(0, 10) // Limit experience entries
        };
        
        // Create a sample prompt like the real system would
        const prompt = `Analyze this LinkedIn profile and provide a score from 1-100:
        
Profile:
- Bio: ${promptData.bio}
- Headline: ${promptData.headline}
- Experience: ${JSON.stringify(promptData.experience)}

Please respond with a JSON object containing:
{
  "score": [number 1-100],
  "reasoning": "[brief explanation]"
}`;
        
        console.log(`   📏 Prompt length: ${prompt.length} characters`);
        console.log(`   📋 Prompt includes ${promptData.experience.length} experience entries`);
        
        console.log('\n5. 🔬 STEP 5: JSON Serialization Test...');
        
        // Test if the data serializes properly (this could be where corruption happens)
        try {
            const serializedData = JSON.stringify(promptData);
            console.log(`   ✅ Data serializes successfully: ${serializedData.length} characters`);
            
            // Test parsing it back
            const reparsedData = JSON.parse(serializedData);
            console.log('   ✅ Serialized data parses back successfully');
            
        } catch (serializationError) {
            console.log('   ❌ Serialization Error:', serializationError.message);
            console.log('   🚨 This could be the source of corruption!');
        }
        
        console.log('\n6. 🎯 STEP 6: Vertex AI Client Simulation...');
        
        // Test the actual Vertex AI client with debugging
        try {
            const { VertexAI } = require('@google-cloud/vertexai');
            
            const vertexAI = new VertexAI({
                project: process.env.GCP_PROJECT_ID,
                location: process.env.GCP_LOCATION
            });
            
            const model = vertexAI.preview.getGenerativeModel({
                model: process.env.GEMINI_MODEL_ID
            });
            
            console.log('   ✅ Vertex AI client initialized');
            console.log(`   🤖 Model: ${process.env.GEMINI_MODEL_ID}`);
            
            // Create a simple test prompt to verify AI is working
            const testPrompt = 'Respond with exactly: {"test": "success"}';
            console.log('   🧪 Testing AI with simple prompt...');
            
            const testResult = await model.generateContent(testPrompt);
            const testResponse = testResult.response;
            const testText = testResponse.candidates[0].content.parts[0].text;
            
            console.log(`   📝 AI Response: "${testText.trim()}"`);
            
            // Test with the actual profile data
            console.log('   🎯 Testing AI with actual profile data...');
            
            const actualResult = await model.generateContent(prompt);
            const actualResponse = actualResult.response;
            const actualText = actualResponse.candidates[0].content.parts[0].text;
            
            console.log(`   📝 AI Profile Response: "${actualText.trim()}"`);
            
            // Try to parse the AI response
            try {
                const aiParsed = JSON.parse(actualText);
                console.log('   ✅ AI response is valid JSON');
                console.log(`   📊 Score: ${aiParsed.score}`);
                console.log(`   💭 Reasoning: ${aiParsed.reasoning}`);
            } catch (aiParseError) {
                console.log('   ❌ AI response is not valid JSON:', aiParseError.message);
                console.log('   📄 Raw response:', actualText);
            }
            
        } catch (aiError) {
            console.log('   ❌ AI Error:', aiError.message);
            
            if (aiError.message.includes('JSON')) {
                console.log('   🚨 JSON-related error in AI processing!');
                console.log('   💡 This could be where the corruption occurs');
            }
        }
        
        console.log('\n7. 📋 STEP 7: Summary & Diagnosis...');
        
        console.log('   🔍 Debug Summary:');
        console.log(`      • Original JSON: ${profileJSON.length} chars - Valid`);
        console.log(`      • Field extraction: Success`);
        console.log(`      • Prompt building: Success`);
        console.log(`      • Data serialization: Success`);
        console.log(`      • AI processing: Test above`);
        
        console.log('\n   💡 Next Debugging Steps:');
        console.log('      1. Add logging to singleScorer.js');
        console.log('      2. Add JSON validation at each step in scoring pipeline');
        console.log('      3. Monitor memory usage during scoring');
        console.log('      4. Add retry logic with corruption detection');
        
    } catch (error) {
        console.error('❌ Error in debugging process:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

debugScoringProcess();
