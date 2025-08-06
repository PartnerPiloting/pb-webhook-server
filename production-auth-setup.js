const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Production Authentication Setup Guide for Vertex AI
 * 
 * This script will help you identify what authentication setup you need
 * and provide step-by-step instructions for configuring Render.
 */

async function diagnoseLocalAuthentication() {
    console.log('🔍 DIAGNOSING LOCAL VERTEX AI AUTHENTICATION SETUP');
    console.log('='.repeat(80));
    
    // Check local environment variables
    const localEnvVars = {
        'GOOGLE_APPLICATION_CREDENTIALS': process.env.GOOGLE_APPLICATION_CREDENTIALS,
        'GCP_PROJECT_ID': process.env.GCP_PROJECT_ID,
        'GCP_LOCATION': process.env.GCP_LOCATION,
        'GOOGLE_CLOUD_PROJECT': process.env.GOOGLE_CLOUD_PROJECT
    };
    
    console.log('\n📋 LOCAL ENVIRONMENT VARIABLES:');
    Object.entries(localEnvVars).forEach(([key, value]) => {
        if (value) {
            console.log(`   ✅ ${key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`);
        } else {
            console.log(`   ❌ ${key}: NOT SET`);
        }
    });
    
    // Check if service account file exists locally
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credentialsPath) {
        console.log(`\n🔍 CHECKING SERVICE ACCOUNT FILE:`);
        try {
            if (fs.existsSync(credentialsPath)) {
                const stats = fs.statSync(credentialsPath);
                console.log(`   ✅ File exists: ${credentialsPath}`);
                console.log(`   📊 File size: ${stats.size} bytes`);
                console.log(`   📅 Modified: ${stats.mtime.toLocaleString()}`);
                
                // Try to read and validate the JSON
                try {
                    const credentialsContent = fs.readFileSync(credentialsPath, 'utf8');
                    const credentials = JSON.parse(credentialsContent);
                    
                    console.log(`   ✅ Valid JSON format`);
                    console.log(`   🔑 Service account fields:`);
                    console.log(`      - Type: ${credentials.type || 'NOT SET'}`);
                    console.log(`      - Project ID: ${credentials.project_id || 'NOT SET'}`);
                    console.log(`      - Client Email: ${credentials.client_email || 'NOT SET'}`);
                    console.log(`      - Private Key: ${credentials.private_key ? 'PRESENT' : 'NOT SET'}`);
                    
                    return {
                        hasValidCredentials: true,
                        credentialsPath: credentialsPath,
                        credentials: credentials
                    };
                    
                } catch (parseError) {
                    console.log(`   ❌ Invalid JSON format: ${parseError.message}`);
                    return { hasValidCredentials: false };
                }
                
            } else {
                console.log(`   ❌ File does not exist: ${credentialsPath}`);
                return { hasValidCredentials: false };
            }
        } catch (error) {
            console.log(`   ❌ Error checking file: ${error.message}`);
            return { hasValidCredentials: false };
        }
    } else {
        console.log(`\n❌ GOOGLE_APPLICATION_CREDENTIALS not set locally`);
        return { hasValidCredentials: false };
    }
}

function generateRenderSetupInstructions(localAuth) {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 RENDER PRODUCTION SETUP INSTRUCTIONS');
    console.log('='.repeat(80));
    
    if (localAuth.hasValidCredentials) {
        console.log('\n✅ GOOD NEWS: You have valid local credentials!');
        console.log('Here\'s how to deploy them to Render:\n');
        
        console.log('📋 STEP 1: UPLOAD SERVICE ACCOUNT FILE TO RENDER');
        console.log('─'.repeat(50));
        console.log('1. Go to your Render dashboard');
        console.log('2. Select your "Daily Batch Lead Scoring" cron job service');
        console.log('3. Go to the "Environment" tab');
        console.log('4. Upload your service account JSON file:');
        console.log(`   - Local file: ${localAuth.credentialsPath}`);
        console.log('   - Render path: /etc/secrets/google-credentials.json');
        console.log('5. Or copy the JSON content and create a file in your project root');
        
        console.log('\n📋 STEP 2: SET ENVIRONMENT VARIABLES');
        console.log('─'.repeat(50));
        console.log('Add these environment variables to your Render service:');
        console.log('');
        console.log('GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google-credentials.json');
        console.log(`GCP_PROJECT_ID=${localAuth.credentials.project_id || 'YOUR_PROJECT_ID'}`);
        console.log('GCP_LOCATION=us-central1');
        
        if (localAuth.credentials.project_id) {
            console.log(`\n✅ Detected project ID: ${localAuth.credentials.project_id}`);
        } else {
            console.log('\n⚠️  Could not detect project ID from credentials file');
        }
        
    } else {
        console.log('\n❌ NO VALID LOCAL CREDENTIALS FOUND');
        console.log('You need to set up Google Cloud authentication first:\n');
        
        console.log('📋 STEP 1: CREATE GOOGLE CLOUD SERVICE ACCOUNT');
        console.log('─'.repeat(50));
        console.log('1. Go to Google Cloud Console: https://console.cloud.google.com');
        console.log('2. Select your project (or create one)');
        console.log('3. Go to IAM & Admin > Service Accounts');
        console.log('4. Click "Create Service Account"');
        console.log('5. Give it a name like "vertex-ai-scorer"');
        console.log('6. Grant these roles:');
        console.log('   - Vertex AI User');
        console.log('   - AI Platform Developer (if needed)');
        console.log('7. Click "Create Key" and download JSON file');
        
        console.log('\n📋 STEP 2: CONFIGURE LOCAL ENVIRONMENT');
        console.log('─'.repeat(50));
        console.log('1. Save the JSON file in your project directory');
        console.log('2. Add to your .env file:');
        console.log('   GOOGLE_APPLICATION_CREDENTIALS=path/to/your-service-account.json');
        console.log('   GCP_PROJECT_ID=your-project-id');
        console.log('   GCP_LOCATION=us-central1');
        console.log('3. Test locally first');
        console.log('4. Then follow Render setup steps above');
    }
    
    console.log('\n📋 STEP 3: DEPLOY TO RENDER');
    console.log('─'.repeat(50));
    console.log('1. Upload the service account JSON file to Render');
    console.log('2. Set the environment variables in Render dashboard');
    console.log('3. Redeploy your cron job service');
    console.log('4. Test with a manual run to verify authentication works');
    
    console.log('\n📋 STEP 4: VERIFY AUTHENTICATION');
    console.log('─'.repeat(50));
    console.log('1. Trigger a manual run of your batch scoring job');
    console.log('2. Check the logs for authentication errors');
    console.log('3. Should see "Vertex AI authentication successful" messages');
    console.log('4. Run our diagnostic script again to confirm all 96 leads process');
    
    console.log('\n⚠️  IMPORTANT NOTES:');
    console.log('─'.repeat(50));
    console.log('• The authentication failure affects only SOME leads (10 out of 96)');
    console.log('• This suggests intermittent authentication or rate limiting');
    console.log('• Proper service account setup should resolve this completely');
    console.log('• Make sure to restart the Render service after adding variables');
    
    console.log('\n🎯 EXPECTED RESULT AFTER FIX:');
    console.log('─'.repeat(50));
    console.log('• All 96 leads should process successfully (instead of 86)');
    console.log('• No more "VertexAI.GoogleAuthError" messages');
    console.log('• Guy-Wilson batch job should show 96/96 successful');
}

async function main() {
    try {
        const localAuth = await diagnoseLocalAuthentication();
        generateRenderSetupInstructions(localAuth);
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ AUTHENTICATION DIAGNOSIS COMPLETE');
        console.log('='.repeat(80));
        console.log('\nNext steps:');
        console.log('1. Follow the setup instructions above');
        console.log('2. Test the authentication fix');
        console.log('3. Run our failed leads diagnostic again to verify');
        
    } catch (error) {
        console.error('❌ Error during authentication diagnosis:', error.message);
    }
}

// Run the authentication diagnosis
main();
