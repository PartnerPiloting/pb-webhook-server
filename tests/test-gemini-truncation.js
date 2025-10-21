#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');
const { VertexAI } = require('@google-cloud/vertexai');

async function testGeminiTruncation() {
    console.log('🧪 TESTING GEMINI INTERNAL TRUNCATION');
    console.log('='.repeat(80));
    console.log('Goal: See if Gemini receives full data but internally corrupts it');
    
    try {
        const base = airtableClient;
        
        // Get the failing lead
        console.log('\n1. 📊 Fetching failing lead data...');
        const record = await base('Leads').find('recHkqPSMfdQWyqus');
        
        const name = record.get('Name') || 'Unknown';
        const profileJSON = record.get('Profile Full JSON');
        
        console.log(`   ✅ Lead: ${name}`);
        console.log(`   📏 Original JSON Length: ${profileJSON ? profileJSON.length : 0} characters`);
        
        if (!profileJSON) {
            console.log('   ❌ No Profile Full JSON found!');
            return;
        }
        
        // Parse and validate JSON locally first
        let parsedProfile;
        try {
            parsedProfile = JSON.parse(profileJSON);
            console.log('   ✅ JSON parses successfully locally');
        } catch (parseError) {
            console.log('   ❌ JSON Parse Error locally:', parseError.message);
            return;
        }
        
        // Initialize Gemini using the same config as production
        console.log('\n2. 🤖 Setting up Gemini client...');
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
        
        console.log('   ✅ Gemini client initialized');
        
        // TEST 1: Echo Test - Ask Gemini to return the exact data back
        console.log('\n3. 🔍 TEST 1: Echo Test (Return exact JSON)');
        
        const echoPrompt = `IMPORTANT: Please return the EXACT JSON data I'm sending you, with no modifications, no formatting, no explanation. Just the raw JSON exactly as received.

Here is the JSON data:
${profileJSON}

Return ONLY the JSON data exactly as provided above, with no additional text or formatting.`;
        
        console.log(`   📤 Sending ${profileJSON.length} characters to Gemini...`);
        
        try {
            const echoResult = await model.generateContent(echoPrompt);
            const echoResponse = echoResult.response.candidates[0].content.parts[0].text;
            
            console.log(`   📥 Received ${echoResponse.length} characters back`);
            console.log(`   📊 Length comparison: Sent ${profileJSON.length} → Received ${echoResponse.length}`);
            
            if (echoResponse.length < profileJSON.length) {
                const lossPercentage = ((profileJSON.length - echoResponse.length) / profileJSON.length * 100).toFixed(1);
                console.log(`   🚨 DATA LOSS DETECTED: ${lossPercentage}% of data missing!`);
                
                // Find where truncation occurred
                let truncationPoint = -1;
                for (let i = 0; i < Math.min(profileJSON.length, echoResponse.length); i++) {
                    if (profileJSON[i] !== echoResponse[i]) {
                        truncationPoint = i;
                        break;
                    }
                }
                
                if (truncationPoint > -1) {
                    console.log(`   📍 First difference at position: ${truncationPoint}`);
                    console.log(`   🔤 Original: "${profileJSON.substring(truncationPoint, truncationPoint + 20)}..."`);
                    console.log(`   🔤 Received: "${echoResponse.substring(truncationPoint, truncationPoint + 20)}..."`);
                } else if (echoResponse.length < profileJSON.length) {
                    console.log(`   📍 Truncation starts at position: ${echoResponse.length}`);
                    console.log(`   🔤 Lost data starts with: "${profileJSON.substring(echoResponse.length, echoResponse.length + 50)}..."`);
                }
                
            } else if (echoResponse.length === profileJSON.length) {
                console.log('   ✅ Lengths match - checking content...');
                if (echoResponse === profileJSON) {
                    console.log('   ✅ PERFECT MATCH: Gemini returned exact data');
                } else {
                    console.log('   ⚠️  Same length but content differs - checking differences...');
                    
                    let differences = 0;
                    for (let i = 0; i < profileJSON.length; i++) {
                        if (profileJSON[i] !== echoResponse[i]) {
                            differences++;
                            if (differences <= 5) { // Show first 5 differences
                                console.log(`   🔤 Diff at ${i}: "${profileJSON[i]}" → "${echoResponse[i]}"`);
                            }
                        }
                    }
                    console.log(`   📊 Total character differences: ${differences}`);
                }
            } else {
                console.log('   ⚠️  Gemini returned MORE data than sent - possible formatting added');
            }
            
            // Try to parse what Gemini returned
            console.log('\n   🧪 Testing if Gemini\'s response is valid JSON...');
            try {
                JSON.parse(echoResponse);
                console.log('   ✅ Gemini\'s response is valid JSON');
            } catch (parseError) {
                console.log('   ❌ Gemini\'s response is NOT valid JSON');
                console.log(`   📄 Parse error: ${parseError.message}`);
                
                // Show the problematic area
                const errorMatch = parseError.message.match(/position (\d+)/);
                if (errorMatch) {
                    const pos = parseInt(errorMatch[1]);
                    const context = echoResponse.substring(Math.max(0, pos - 50), pos + 50);
                    console.log(`   📄 Error context: "${context}"`);
                }
            }
            
        } catch (echoError) {
            console.log('   ❌ Echo test failed:', echoError.message);
        }
        
        // TEST 2: Length Check - Ask Gemini to count characters
        console.log('\n4. 🔍 TEST 2: Length Check (Ask Gemini to count)');
        
        const lengthPrompt = `Please count the exact number of characters in the JSON data I'm sending you and return ONLY the number.

JSON data:
${profileJSON}

Return only the character count as a number.`;
        
        try {
            const lengthResult = await model.generateContent(lengthPrompt);
            const lengthResponse = lengthResult.response.candidates[0].content.parts[0].text.trim();
            const geminiCount = parseInt(lengthResponse);
            
            console.log(`   📏 Actual length: ${profileJSON.length}`);
            console.log(`   📏 Gemini counted: ${geminiCount}`);
            
            if (geminiCount === profileJSON.length) {
                console.log('   ✅ Gemini sees the correct length');
            } else if (geminiCount < profileJSON.length) {
                console.log('   🚨 Gemini sees TRUNCATED data!');
                const missingChars = profileJSON.length - geminiCount;
                console.log(`   📊 Missing characters: ${missingChars} (${(missingChars/profileJSON.length*100).toFixed(1)}%)`);
            } else {
                console.log('   ⚠️  Gemini counted more than expected (possible counting error)');
            }
            
        } catch (lengthError) {
            console.log('   ❌ Length test failed:', lengthError.message);
        }
        
        // TEST 3: End Check - Ask Gemini about the last few characters
        console.log('\n5. 🔍 TEST 3: End Check (Last 50 characters)');
        
        const lastChars = profileJSON.slice(-50);
        const endPrompt = `Please return the LAST 50 characters from the JSON data I'm sending you. Return only those characters, nothing else.

JSON data:
${profileJSON}

Return only the last 50 characters.`;
        
        try {
            const endResult = await model.generateContent(endPrompt);
            const endResponse = endResult.response.candidates[0].content.parts[0].text.trim();
            
            console.log(`   📄 Expected last 50: "${lastChars}"`);
            console.log(`   📄 Gemini returned: "${endResponse}"`);
            
            if (endResponse === lastChars) {
                console.log('   ✅ Gemini sees the complete end of the data');
            } else {
                console.log('   🚨 Gemini does NOT see the correct end!');
                console.log('   🔍 This suggests internal truncation');
            }
            
        } catch (endError) {
            console.log('   ❌ End test failed:', endError.message);
        }
        
        // SUMMARY
        console.log('\n' + '='.repeat(80));
        console.log('📊 TRUNCATION TEST SUMMARY');
        console.log('='.repeat(80));
        console.log('If Gemini is internally truncating:');
        console.log('  - Echo test will return less data than sent');
        console.log('  - Length count will be smaller than actual');
        console.log('  - End check will show wrong characters');
        console.log('');
        console.log('If the issue is elsewhere:');
        console.log('  - All tests should pass perfectly');
        console.log('  - Problem is in your response parsing, not input truncation');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testGeminiTruncation().catch(console.error);
