const { VertexAI } = require('@google-cloud/vertexai');
require('dotenv').config();

/**
 * Quick Vertex AI Authentication Test
 * Run this after setting up authentication to verify it works
 */

async function testVertexAIAuthentication() {
    console.log('🔍 TESTING VERTEX AI AUTHENTICATION');
    console.log('='.repeat(60));
    
    // Check environment variables
    const requiredVars = {
        'GCP_PROJECT_ID': process.env.GCP_PROJECT_ID,
        'GCP_LOCATION': process.env.GCP_LOCATION,
        'GOOGLE_APPLICATION_CREDENTIALS': process.env.GOOGLE_APPLICATION_CREDENTIALS
    };
    
    console.log('\n📋 Environment Variables:');
    let missingVars = [];
    Object.entries(requiredVars).forEach(([key, value]) => {
        if (value) {
            console.log(`   ✅ ${key}: ${value}`);
        } else {
            console.log(`   ❌ ${key}: NOT SET`);
            missingVars.push(key);
        }
    });
    
    if (missingVars.length > 0) {
        console.log(`\n❌ CANNOT TEST: Missing ${missingVars.length} required environment variables`);
        console.log('Please set up authentication first using production-auth-setup.js');
        return;
    }
    
    try {
        console.log('\n🔍 Initializing Vertex AI client...');
        
        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION,
        });
        
        console.log('✅ Vertex AI client initialized successfully');
        
        console.log('\n🔍 Getting generative model...');
        const model = vertex_ai.preview.getGenerativeModel({
            model: 'gemini-1.5-pro-002',
            generationConfig: {
                'maxOutputTokens': 500,
                'temperature': 0.1,
                'topP': 0.8,
            },
        });
        
        console.log('✅ Generative model obtained successfully');
        
        console.log('\n🔍 Testing with a simple prompt...');
        const prompt = 'Test authentication: Please respond with "Authentication successful" if you can see this message.';
        
        const request = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
        };
        
        console.log('📤 Sending test request to Vertex AI...');
        const response = await model.generateContent(request);
        
        if (response && response.response) {
            const responseText = response.response.candidates[0].content.parts[0].text;
            console.log('✅ SUCCESS! Vertex AI response received:');
            console.log(`📝 Response: ${responseText}`);
            
            console.log('\n🎉 VERTEX AI AUTHENTICATION WORKING PERFECTLY!');
            console.log('Your Render deployment should now be able to process all 96 leads successfully.');
            
        } else {
            console.log('⚠️  Received empty response from Vertex AI');
            console.log('Response structure:', JSON.stringify(response, null, 2));
        }
        
    } catch (error) {
        console.log('\n❌ AUTHENTICATION FAILED:');
        console.log(`Error: ${error.message}`);
        
        if (error.message.includes('authentication') || error.message.includes('credentials')) {
            console.log('\n🔧 TROUBLESHOOTING:');
            console.log('1. Verify your service account JSON file is valid');
            console.log('2. Check that GOOGLE_APPLICATION_CREDENTIALS points to the correct file');
            console.log('3. Ensure the service account has Vertex AI permissions');
            console.log('4. Verify the project ID is correct');
        } else if (error.message.includes('permission') || error.message.includes('access')) {
            console.log('\n🔧 TROUBLESHOOTING:');
            console.log('1. Your service account needs "Vertex AI User" role');
            console.log('2. Enable Vertex AI API in your Google Cloud project');
            console.log('3. Check project permissions in Google Cloud Console');
        } else {
            console.log('\n🔧 TROUBLESHOOTING:');
            console.log('1. Check your internet connection');
            console.log('2. Verify Google Cloud project is active');
            console.log('3. Try running: gcloud auth application-default login');
        }
        
        console.log('\nFull error details:');
        console.log(error);
    }
}

// Run the authentication test
testVertexAIAuthentication();
