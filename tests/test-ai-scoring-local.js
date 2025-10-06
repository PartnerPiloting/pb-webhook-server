// LOCAL TEST: Try to score one of the failing leads to see the exact error
require('dotenv').config();
const base = require('./config/airtableClient');

async function testLocalAIScoring() {
    console.log('🧪 LOCAL AI SCORING TEST');
    console.log('='.repeat(40));
    console.log('Testing one failing lead locally to see exactly where it breaks\n');
    
    try {
        // Get one of the failing leads (Ella Rustamova - has clean data)
        console.log('1. 📊 Getting failing lead...');
        const lead = await base('Leads').find('recIFIJBMESumyQfW'); // Ella Rustamova
        console.log(`   ✅ Got: ${lead.fields['First Name']} ${lead.fields['Last Name']}`);
        
        // Parse the profile
        console.log('\n2. 🔍 Parsing profile data...');
        const profileJson = lead.fields['Profile Full JSON'];
        const profile = JSON.parse(profileJson);
        console.log(`   ✅ Profile parsed successfully`);
        console.log(`   📊 Bio: ${(profile.about || '').length} chars`);
        console.log(`   📊 Headline: "${profile.headline}"`);
        console.log(`   📊 Experience: ${profile.experience?.length} jobs`);
        
        // Check if we have the required environment variables for AI
        console.log('\n3. 🔑 Checking AI credentials...');
        
        const hasProjectId = !!process.env.GOOGLE_CLOUD_PROJECT_ID;
        const hasCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.GOOGLE_CLOUD_CREDENTIALS;
        const hasModelId = !!process.env.GEMINI_MODEL_ID;
        
        console.log(`   Project ID: ${hasProjectId ? '✅' : '❌'} ${process.env.GOOGLE_CLOUD_PROJECT_ID || 'Missing'}`);
        console.log(`   Credentials: ${hasCredentials ? '✅' : '❌'} ${hasCredentials ? 'Present' : 'Missing GOOGLE_APPLICATION_CREDENTIALS'}`);
        console.log(`   Model ID: ${hasModelId ? '✅' : '❌'} ${process.env.GEMINI_MODEL_ID || 'Missing'}`);
        
        if (!hasProjectId || !hasCredentials || !hasModelId) {
            console.log('\n❌ MISSING AI CREDENTIALS');
            console.log('This explains why the leads fail! The system can\'t connect to the AI service.');
            console.log('\n🔧 TO FIX:');
            console.log('1. Add GOOGLE_CLOUD_PROJECT_ID to .env file');
            console.log('2. Add GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)');
            console.log('3. Add GEMINI_MODEL_ID to .env file');
            console.log('\nWithout these, the AI scoring will always fail.');
            return;
        }
        
        // Try to initialize the AI client
        console.log('\n4. 🤖 Testing AI connection...');
        try {
            const { VertexAI } = require('@google-cloud/vertexai');
            
            const vertexAI = new VertexAI({
                project: process.env.GOOGLE_CLOUD_PROJECT_ID,
                location: 'us-central1'
            });
            
            console.log('   ✅ Vertex AI client created');
            
            // Try to get the model
            const model = vertexAI.getGenerativeModel({
                model: process.env.GEMINI_MODEL_ID
            });
            
            console.log('   ✅ AI model connection established');
            console.log(`   📊 Using model: ${process.env.GEMINI_MODEL_ID}`);
            
            // Build the scoring prompt
            console.log('\n5. 📝 Building scoring prompt...');
            
            // Create a simple prompt for testing
            const testPrompt = `Please analyze this professional profile and provide a score from 1-100:
            
Name: ${lead.fields['First Name']} ${lead.fields['Last Name']}
Company: ${lead.fields['Company Name']}
Bio: ${(profile.about || profile.summary || '').substring(0, 500)}
Headline: ${profile.headline}

Please respond with just a number between 1-100.`;
            
            console.log(`   ✅ Prompt created (${testPrompt.length} characters)`);
            
            // Try to call the AI
            console.log('\n6. 🧠 Calling AI for scoring...');
            console.log('   ⏳ This may take 10-30 seconds...');
            
            const startTime = Date.now();
            
            const result = await model.generateContent(testPrompt);
            const response = result.response;
            const text = response.text();
            
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            
            console.log(`   ✅ AI RESPONDED! (took ${duration} seconds)`);
            console.log(`   📊 Response: "${text.trim()}"`);
            
            console.log('\n🎉 SUCCESS! The AI scoring works fine locally.');
            console.log('\n🤔 This means the issue might be:');
            console.log('   • Network timeouts during batch processing in production');
            console.log('   • AI rate limiting when processing multiple leads at once');
            console.log('   • Memory issues during large batch runs');
            console.log('   • Different environment variables in production vs local');
            
        } catch (aiError) {
            console.log(`   ❌ AI ERROR: ${aiError.message}`);
            console.log('\n🚨 FOUND THE PROBLEM!');
            console.log('This is likely the same error that\'s causing the 10 leads to fail in production.');
            console.log('\nError details:');
            console.log(aiError.stack);
            
            if (aiError.message.includes('quota') || aiError.message.includes('rate')) {
                console.log('\n💡 LIKELY CAUSE: AI API rate limiting or quota exceeded');
            } else if (aiError.message.includes('timeout') || aiError.message.includes('deadline')) {
                console.log('\n💡 LIKELY CAUSE: AI requests timing out');
            } else if (aiError.message.includes('auth') || aiError.message.includes('permission')) {
                console.log('\n💡 LIKELY CAUSE: Authentication/permission issues');
            } else {
                console.log('\n💡 LIKELY CAUSE: Unknown AI processing error');
            }
        }
        
    } catch (error) {
        console.error('\n❌ TEST ERROR:', error.message);
        console.error(error.stack);
    }
}

console.log('🎯 GOAL: Find out exactly why these 10 leads fail during AI processing');
console.log('📍 METHOD: Test one lead locally through the actual AI scoring process');
console.log('🔍 EXPECTATION: We should see the exact error that\'s happening in production\n');

testLocalAIScoring();
