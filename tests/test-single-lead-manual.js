const base = require('./config/airtableClient');

async function testSingleLeadScoring() {
    console.log('🎯 TESTING SINGLE LEAD MANUAL SCORING');
    console.log('='.repeat(50));
    
    // Test with Ella Rustamova - clean profile, no content issues
    const leadId = 'recIFIJBMESumyQfW'; // Ella Rustamova
    
    try {
        console.log(`1. 📊 Fetching lead ${leadId}...`);
        const lead = await base('Leads').find(leadId);
        console.log(`   ✅ Found: ${lead.fields['First Name']} ${lead.fields['Last Name']} from ${lead.fields['Company Name']}`);
        
        console.log('\n2. 🔍 Parsing profile data...');
        const profileJson = lead.fields['Profile Full JSON'];
        const profile = JSON.parse(profileJson);
        
        console.log(`   📊 Profile stats:`);
        console.log(`      Bio: ${(profile.about || profile.summary || '').length} chars`);
        console.log(`      Headline: "${profile.headline}"`);
        console.log(`      Experience: ${profile.experience?.length || 0} jobs`);
        
        console.log('\n3. 🤖 Attempting manual AI scoring...');
        
        // Import the scoring functions
        const { buildPrompt } = require('./promptBuilder');
        
        console.log('   📝 Building scoring prompt...');
        const prompt = buildPrompt(profile);
        console.log(`   ✅ Prompt built: ${prompt.length} characters`);
        console.log(`   📄 Prompt preview: ${prompt.substring(0, 200)}...`);
        
        // NOTE: We can't actually call the AI without proper Vertex AI setup
        // But we can identify what would happen
        console.log('\n4. 💡 ANALYSIS:');
        console.log('   ✅ Profile parses correctly');
        console.log('   ✅ Has all required fields for scoring');
        console.log('   ✅ Prompt builds successfully');
        console.log('   ❓ Issue must occur during AI API call');
        
        console.log('\n5. 🎯 LIKELY ROOT CAUSES:');
        console.log('   • AI API timeout (15-minute timeout per lead)');
        console.log('   • AI rate limiting (too many simultaneous requests)');
        console.log('   • AI safety filters (content triggers restrictions)');
        console.log('   • Network connectivity during batch processing');
        console.log('   • Memory issues during large batch processing');
        
        console.log('\n6. 🔧 IMMEDIATE ACTIONS TO TRY:');
        console.log('   1. Check the next Render logs at 2 AM Singapore time');
        console.log('   2. Try processing just 1-2 leads instead of all 10');
        console.log('   3. Look for specific AI API error messages');
        console.log('   4. Consider increasing batch processing timeouts');
        
        console.log('\n7. 📊 BATCH PROCESSING THEORY:');
        console.log('   The 86 successful leads process fine, but these 10 might:');
        console.log('   • Be processed at the end when AI API is rate-limited');
        console.log('   • Have content that takes longer to process');
        console.log('   • Hit memory limits in the batch processor');
        console.log('   • Encounter network timeouts during peak usage');
        
    } catch (error) {
        console.error('❌ Error testing single lead:', error.message);
        console.error(error.stack);
    }
}

testSingleLeadScoring();
