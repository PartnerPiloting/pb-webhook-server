#!/usr/bin/env node

require('dotenv').config();
const { VertexAI } = require('@google-cloud/vertexai');

async function testGeminiAuth() {
    console.log('🔍 Testing Gemini AI Authentication...');
    console.log('─'.repeat(60));

    // Check environment variables
    console.log('📋 Environment Configuration:');
    console.log(`   GCP_PROJECT_ID: ${process.env.GCP_PROJECT_ID}`);
    console.log(`   GCP_LOCATION: ${process.env.GCP_LOCATION}`);
    console.log(`   GEMINI_MODEL_ID: ${process.env.GEMINI_MODEL_ID}`);
    console.log(`   GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
    
    // Check if service account file exists
    const fs = require('fs');
    const path = require('path');
    const serviceAccountPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    
    if (!fs.existsSync(serviceAccountPath)) {
        console.error('❌ Service account file not found:', serviceAccountPath);
        return false;
    }
    
    console.log(`   ✅ Service account file found: ${serviceAccountPath}`);
    
    try {
        // Read and validate service account JSON
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        console.log(`   ✅ Service account loaded for: ${serviceAccount.client_email}`);
        console.log(`   ✅ Project ID matches: ${serviceAccount.project_id === process.env.GCP_PROJECT_ID}`);
        
        // Initialize Vertex AI
        console.log('\n🤖 Testing Vertex AI Connection...');
        
        // Test Vertex AI with a simple prompt
        console.log('   🧪 Testing Vertex AI Gemini model...');
        
        const vertexAI = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION
        });
        
        const model = vertexAI.preview.getGenerativeModel({
            model: process.env.GEMINI_MODEL_ID
        });
        
        const prompt = "Respond with exactly: 'Authentication test successful'";
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.candidates[0].content.parts[0].text;
        
        console.log(`   📝 Gemini Response: "${text.trim()}"`);
        
        if (text.toLowerCase().includes('authentication test successful')) {
            console.log('   ✅ Gemini AI responding correctly!');
            return true;
        } else {
            console.log('   ⚠️  Gemini AI responded but with unexpected content');
            return false;
        }
        
    } catch (error) {
        console.error('❌ Authentication test failed:', error.message);
        
        if (error.message.includes('PERMISSION_DENIED')) {
            console.log('\n🔧 Troubleshooting:');
            console.log('   • Check that the service account has Generative AI permissions');
            console.log('   • Verify the project ID is correct');
            console.log('   • Ensure the service account key is valid');
        } else if (error.message.includes('API_KEY_INVALID')) {
            console.log('\n🔧 Troubleshooting:');
            console.log('   • The API key format might be incorrect');
            console.log('   • Try regenerating the service account key');
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
            console.log('\n🔧 Troubleshooting:');
            console.log('   • API quota has been exceeded');
            console.log('   • Check your Google Cloud billing and quotas');
        }
        
        return false;
    }
}

// Test authentication and provide results
testGeminiAuth().then(success => {
    console.log('\n' + '='.repeat(60));
    if (success) {
        console.log('🎉 SUCCESS: Local authentication now matches production!');
        console.log('💡 You can now test the failing leads locally with:');
        console.log('   node test-score-one-lead.js');
        console.log('   node test-failing-leads.js');
    } else {
        console.log('❌ FAILED: Authentication setup needs attention');
        console.log('💡 Check the troubleshooting steps above');
    }
    console.log('='.repeat(60));
}).catch(error => {
    console.error('❌ Unexpected error:', error);
});
