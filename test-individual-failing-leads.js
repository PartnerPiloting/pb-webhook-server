const base = require('./config/airtableClient');
const batchScorer = require('./batchScorer');

async function testIndividualFailingLeads() {
    console.log('🧪 TESTING INDIVIDUAL FAILING LEADS - AI SCORING PROCESS');
    console.log('='.repeat(70));
    
    try {
        // Get the 10 leads that are stuck with "To Be Scored" status
        console.log('1. 📊 Fetching the failing leads...');
        const failingLeads = await base('Leads').select({
            filterByFormula: `{Scoring Status} = "To Be Scored"`,
            maxRecords: 15  // Get a few extra in case there are more
        }).all();
        
        console.log(`   ✅ Found ${failingLeads.length} leads with "To Be Scored" status`);
        
        if (failingLeads.length === 0) {
            console.log('🎉 No failing leads found! All leads have been processed.');
            return;
        }
        
        console.log('\n2. 🔍 Testing each lead individually through the scoring process...');
        
        // Process each lead one by one to isolate failures
        for (let i = 0; i < Math.min(failingLeads.length, 10); i++) {
            const lead = failingLeads[i];
            const leadName = `${lead.fields['First Name'] || 'Unknown'} ${lead.fields['Last Name'] || 'Unknown'}`;
            
            console.log(`\n   📝 TESTING LEAD ${i + 1}/${Math.min(failingLeads.length, 10)}: ${leadName}`);
            console.log(`      Lead ID: ${lead.id}`);
            console.log(`      Company: ${lead.fields['Company Name'] || 'Not specified'}`);
            
            try {
                // Test the profile data parsing
                const profileJson = lead.fields['Profile Full JSON'];
                if (!profileJson) {
                    console.log(`      ❌ ISSUE: Missing "Profile Full JSON" field`);
                    continue;
                }
                
                let profile;
                try {
                    profile = JSON.parse(profileJson);
                    console.log(`      ✅ Profile JSON parses correctly (${profileJson.length} chars)`);
                } catch (parseError) {
                    console.log(`      ❌ ISSUE: Profile JSON parsing failed: ${parseError.message}`);
                    console.log(`      📄 JSON sample: ${profileJson.substring(0, 200)}...`);
                    continue;
                }
                
                // Check if profile has required fields for scoring
                const aboutText = (profile.about || profile.summary || profile.linkedinDescription || "").trim();
                const hasHeadline = !!profile.headline?.trim();
                const hasExperience = Array.isArray(profile.experience) && profile.experience.length > 0;
                
                console.log(`      📋 Profile validation:`);
                console.log(`         About text: ${aboutText.length} chars ${aboutText.length >= 40 ? '✅' : '❌'}`);
                console.log(`         Headline: ${hasHeadline ? '✅' : '❌'} "${profile.headline || 'Missing'}"`);
                console.log(`         Experience: ${hasExperience ? '✅' : '❌'} (${profile.experience?.length || 0} jobs)`);
                
                if (aboutText.length < 40) {
                    console.log(`      ⚠️  POTENTIAL ISSUE: About text too short (${aboutText.length} chars, needs ≥40)`);
                }
                
                if (!hasHeadline) {
                    console.log(`      ⚠️  POTENTIAL ISSUE: Missing headline`);
                }
                
                if (!hasExperience) {
                    console.log(`      ⚠️  POTENTIAL ISSUE: Missing experience data`);
                    
                    // Check for organization fallbacks
                    let hasOrgFallback = false;
                    for (let j = 1; j <= 5; j++) {
                        if (profile[`organization_${j}`] || profile[`organization_title_${j}`]) {
                            hasOrgFallback = true;
                            console.log(`         Found org fallback: organization_${j} = "${profile[`organization_${j}`] || profile[`organization_title_${j}`]}"`);
                            break;
                        }
                    }
                    if (!hasOrgFallback) {
                        console.log(`         ❌ No organization fallback fields found either`);
                    }
                }
                
                // Check for any special characters or content that might cause AI issues
                const suspiciousContent = [];
                if (aboutText.includes('\u0000')) suspiciousContent.push('null characters');
                if (aboutText.match(/[\uD800-\uDFFF]/)) suspiciousContent.push('broken unicode');
                if (aboutText.length > 5000) suspiciousContent.push('extremely long text');
                if (aboutText.match(/[\x00-\x1F\x7F-\x9F]/)) suspiciousContent.push('control characters');
                
                if (suspiciousContent.length > 0) {
                    console.log(`      ⚠️  CONTENT ISSUES: ${suspiciousContent.join(', ')}`);
                }
                
                // Try to process this single lead through the batch scorer
                console.log(`      🤖 Attempting AI scoring...`);
                
                // Create a mock dependencies object
                const mockDependencies = {
                    vertexAIClient: null, // We don't have access to this in test
                    geminiModelId: 'test-model'
                };
                
                // Since we can't actually call the AI without proper setup,
                // let's simulate what would happen and identify likely failure points
                console.log(`      📊 SCORING READINESS CHECK:`);
                
                if (aboutText.length < 40 || !hasHeadline || (!hasExperience && !hasOrgFallback)) {
                    console.log(`      ❌ VERDICT: Would be SKIPPED by batch scorer due to insufficient data`);
                    console.log(`         - About text: ${aboutText.length < 40 ? 'Too short' : 'OK'}`);
                    console.log(`         - Headline: ${!hasHeadline ? 'Missing' : 'OK'}`);
                    console.log(`         - Job history: ${!hasExperience && !hasOrgFallback ? 'Missing' : 'OK'}`);
                } else {
                    console.log(`      ✅ VERDICT: Profile looks ready for AI scoring`);
                    console.log(`      💡 This lead should process successfully - the issue may be:`);
                    console.log(`         • AI API timeouts or rate limits`);
                    console.log(`         • Content triggering AI safety filters`);
                    console.log(`         • Network connectivity issues during processing`);
                    console.log(`         • Batch processing queue issues`);
                }
                
            } catch (leadError) {
                console.log(`      ❌ ERROR testing lead: ${leadError.message}`);
                console.log(`      📄 Error details: ${leadError.stack}`);
            }
            
            // Small delay between leads
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('\n3. 🎯 SUMMARY AND RECOMMENDATIONS');
        console.log('─'.repeat(50));
        
        console.log('\n   📊 Based on individual lead analysis:');
        console.log('   1. Check if leads have sufficient profile data (bio ≥40 chars, headline, job history)');
        console.log('   2. Look for content issues (special characters, very long text, etc.)');
        console.log('   3. If profiles look good, the issue is likely during AI processing:');
        console.log('      • AI API timeouts (leads take too long to process)');
        console.log('      • AI safety filters (content triggers restrictions)');  
        console.log('      • Rate limiting (too many requests to AI service)');
        console.log('      • Network issues during batch processing');
        
        console.log('\n   🔧 NEXT STEPS:');
        console.log('   1. Try processing 1-2 of these leads manually through the API');
        console.log('   2. Check Render logs during the next batch run (2 AM Singapore time)');
        console.log('   3. Look for specific AI API error messages or timeouts');
        console.log('   4. Consider processing these leads in smaller batches');
        
        console.log('\n   💡 COMMANDS TO TRY:');
        console.log('   • node test-single-lead.js [LEAD_ID] - Test one lead manually');
        console.log('   • node check-render-logs.js - Check production logs for errors');
        
    } catch (error) {
        console.error('❌ Error during individual lead testing:', error.message);
    }
}

// Run the test
testIndividualFailingLeads();
