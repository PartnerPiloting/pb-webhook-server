// MANUAL SINGLE LEAD SCORING TEST
// Let's try to score one of the failing leads to see what happens

require('dotenv').config();
const base = require('./config/airtableClient');

async function scoreOneFailingLead() {
    console.log('🎯 MANUAL SINGLE LEAD SCORING TEST');
    console.log('='.repeat(50));
    console.log('Goal: Score one failing lead to see exactly where/why it fails\n');
    
    try {
        // Pick Ella Rustamova - she has clean data, no special characters
        const leadId = 'recIFIJBMESumyQfW';
        
        console.log('1. 📊 Getting the lead...');
        const lead = await base('Leads').find(leadId);
        const leadName = `${lead.fields['First Name']} ${lead.fields['Last Name']}`;
        console.log(`   ✅ Lead: ${leadName} from ${lead.fields['Company Name']}`);
        console.log(`   📊 Current status: ${lead.fields['Scoring Status']}`);
        
        console.log('\n2. 🔍 Parsing profile data...');
        const profileJson = lead.fields['Profile Full JSON'];
        const profile = JSON.parse(profileJson);
        
        const bio = (profile.about || profile.summary || '').trim();
        console.log(`   ✅ Bio: ${bio.length} characters`);
        console.log(`   ✅ Headline: "${profile.headline}"`);
        console.log(`   ✅ Experience: ${profile.experience?.length} jobs`);
        
        console.log('\n3. 🤖 Setting up AI scoring exactly like production...');
        
        // Use the actual gemini config like production does
        const geminiConfig = require('./config/geminiClient');
        
        if (!geminiConfig.vertexAIClient) {
            console.log('   ❌ Gemini config not properly initialized');
            console.log('   💡 Production would also fail with this configuration');
            return;
        }
        
        console.log(`   ✅ Using production gemini config with model: ${geminiConfig.geminiModelId}`);
        
        // Try using the actual batch scorer
        console.log('\n4. 🔥 ATTEMPTING REAL SCORING WITH PRODUCTION CONFIG...');
        
        try {
            // Import the batch scorer
            const batchScorer = require('./batchScorer');
            
            console.log('   📦 Batch scorer loaded');
            
            // Now try the actual scoring process
            console.log('\n5. 🎯 RUNNING ACTUAL BATCH SCORER...');
            
            // Create a single-lead array
            const singleLeadArray = [lead];
            
            // Set up the dependencies exactly like production does
            const dependencies = {
                vertexAIClient: geminiConfig.vertexAIClient,
                geminiModelId: geminiConfig.geminiModelId,
                airtableBase: base
            };
            
            console.log('   🔍 Dependencies check:');
            console.log(`      vertexAIClient: ${dependencies.vertexAIClient ? '✅ Present' : '❌ Missing'}`);
            console.log(`      geminiModelId: ${dependencies.geminiModelId ? '✅ Present' : '❌ Missing'}`);
            console.log(`      airtableBase: ${dependencies.airtableBase ? '✅ Present' : '❌ Missing'}`);
            console.log(`      Model ID value: "${dependencies.geminiModelId}"`);
            
            console.log('   ⏳ Calling batch scorer correctly like production does...');
            console.log('   📊 This should take 10-30 seconds...');
            
            const startTime = Date.now();
            
            // Create mock req and res objects like Express would provide
            const mockReq = {};
            const mockRes = {
                status: (code) => ({
                    json: (data) => console.log(`   📡 Mock response ${code}:`, data),
                    send: (data) => console.log(`   📡 Mock response ${code}:`, data)
                }),
                headersSent: false
            };
            
            // This is the actual call that production makes
            const result = await batchScorer.run(mockReq, mockRes, dependencies);
            
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            
            console.log(`\n🎉 SUCCESS! Lead scored in ${duration} seconds`);
            console.log('📊 Result:', result);
            
            // Check the lead's updated status
            const updatedLead = await base('Leads').find(leadId);
            console.log(`\n📈 Updated status: ${updatedLead.fields['Scoring Status']}`);
            
            if (updatedLead.fields['AI Score']) {
                console.log(`🎯 AI Score: ${updatedLead.fields['AI Score']}`);
            }
            
            console.log('\n💡 CONCLUSION: The scoring process works fine!');
            console.log('This suggests the issue in production might be:');
            console.log('• Network timeouts during batch processing');
            console.log('• AI rate limiting when processing multiple leads');
            console.log('• Memory issues during large batch operations');
            console.log('• Different environment variables in production');
            
        } catch (aiError) {
            console.log(`\n🚨 AI SCORING FAILED! This is likely the same error happening in production.`);
            console.log(`❌ Error: ${aiError.message}`);
            
            // Analyze the error
            if (aiError.message.includes('credentials') || aiError.message.includes('authentication')) {
                console.log('\n🎯 ROOT CAUSE: Missing or invalid Google Cloud credentials');
                console.log('🔧 SOLUTION: Add proper Google Cloud service account credentials to production environment');
                console.log('📋 Required environment variables:');
                console.log('   • GOOGLE_CLOUD_PROJECT_ID');
                console.log('   • GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)');
                
            } else if (aiError.message.includes('quota') || aiError.message.includes('rate')) {
                console.log('\n🎯 ROOT CAUSE: AI API quota or rate limiting');
                console.log('🔧 SOLUTION: Process leads in smaller batches or add delays between requests');
                
            } else if (aiError.message.includes('timeout') || aiError.message.includes('deadline')) {
                console.log('\n🎯 ROOT CAUSE: AI requests timing out');
                console.log('🔧 SOLUTION: Increase timeout values or reduce prompt complexity');
                
            } else {
                console.log('\n🎯 ROOT CAUSE: Unknown AI processing error');
                console.log('📋 Full error details:');
                console.log(aiError.stack);
            }
            
            console.log('\n📊 IMPACT: This error would cause leads to remain in "To Be Scored" status');
            console.log('🔧 NEXT STEP: Fix the credentials/configuration issue in production environment');
        }
        
    } catch (error) {
        console.error('\n❌ SCRIPT ERROR:', error.message);
        console.error(error.stack);
    }
}

scoreOneFailingLead();
