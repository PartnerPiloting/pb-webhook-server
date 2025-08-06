const base = require('./config/airtableClient');

async function compareFailingVsSuccessfulLeads() {
    console.log('🔍 COMPARING FAILING VS SUCCESSFUL LEADS');
    console.log('='.repeat(50));
    console.log('Goal: Find what makes the 10 failing leads different from the 86 successful ones\n');
    
    try {
        // Get failing leads
        console.log('1. 📊 Getting failing leads...');
        const failingLeads = await base('Leads').select({
            filterByFormula: `{Scoring Status} = "To Be Scored"`,
            maxRecords: 10
        }).all();
        console.log(`   Found ${failingLeads.length} failing leads`);
        
        // Get some successful leads for comparison
        console.log('\n2. 📊 Getting successful leads for comparison...');
        const successfulLeads = await base('Leads').select({
            filterByFormula: `AND({Scoring Status} != "To Be Scored", {Scoring Status} != "", {Scoring Status} != BLANK())`,
            maxRecords: 10
        }).all();
        console.log(`   Found ${successfulLeads.length} successful leads`);
        
        if (failingLeads.length === 0 || successfulLeads.length === 0) {
            console.log('❌ Not enough leads to compare');
            return;
        }
        
        console.log('\n3. 🔍 ANALYZING DIFFERENCES...');
        
        // Compare profile characteristics
        const analyzeLeads = (leads, type) => {
            console.log(`\n   📊 ${type.toUpperCase()} LEADS ANALYSIS:`);
            
            const stats = {
                avgBioLength: 0,
                avgHeadlineLength: 0,
                avgExperienceCount: 0,
                hasSpecialChars: 0,
                hasUnicodeIssues: 0,
                hasLongText: 0,
                companies: [],
                firstNames: [],
                bioSamples: []
            };
            
            leads.forEach((lead, index) => {
                const profileJson = lead.fields['Profile Full JSON'];
                if (!profileJson) return;
                
                let profile;
                try {
                    profile = JSON.parse(profileJson);
                } catch (e) {
                    console.log(`      ⚠️  Lead ${index + 1}: JSON parse error`);
                    return;
                }
                
                const bio = (profile.about || profile.summary || '').trim();
                const headline = profile.headline || '';
                const experience = profile.experience || [];
                
                // Accumulate stats
                stats.avgBioLength += bio.length;
                stats.avgHeadlineLength += headline.length;
                stats.avgExperienceCount += experience.length;
                
                // Check for issues
                if (bio.match(/[\x00-\x1F\x7F-\x9F]/)) stats.hasSpecialChars++;
                if (bio.match(/[\uD800-\uDFFF]/)) stats.hasUnicodeIssues++;
                if (bio.length > 3000) stats.hasLongText++;
                
                // Collect samples
                stats.companies.push(lead.fields['Company Name'] || 'Unknown');
                stats.firstNames.push(lead.fields['First Name'] || 'Unknown');
                if (bio.length > 0) {
                    stats.bioSamples.push(bio.substring(0, 100) + '...');
                }
                
                console.log(`      ${index + 1}. ${lead.fields['First Name']} ${lead.fields['Last Name']} (${lead.fields['Company Name']})`);
                console.log(`         Bio: ${bio.length} chars, Headline: ${headline.length} chars, Exp: ${experience.length} jobs`);
                if (stats.hasSpecialChars > 0 || stats.hasUnicodeIssues > 0) {
                    console.log(`         ⚠️  Has content issues`);
                }
            });
            
            // Calculate averages
            const count = leads.length;
            stats.avgBioLength = Math.round(stats.avgBioLength / count);
            stats.avgHeadlineLength = Math.round(stats.avgHeadlineLength / count);
            stats.avgExperienceCount = Math.round(stats.avgExperienceCount / count * 10) / 10;
            
            console.log(`\n      📈 SUMMARY:`);
            console.log(`         Average bio length: ${stats.avgBioLength} chars`);
            console.log(`         Average headline length: ${stats.avgHeadlineLength} chars`);
            console.log(`         Average experience count: ${stats.avgExperienceCount} jobs`);
            console.log(`         Leads with special characters: ${stats.hasSpecialChars}/${count}`);
            console.log(`         Leads with unicode issues: ${stats.hasUnicodeIssues}/${count}`);
            console.log(`         Leads with very long text: ${stats.hasLongText}/${count}`);
            
            return stats;
        };
        
        const failingStats = analyzeLeads(failingLeads, 'failing');
        const successfulStats = analyzeLeads(successfulLeads, 'successful');
        
        console.log('\n4. 🎯 KEY DIFFERENCES:');
        
        const bioDiff = failingStats.avgBioLength - successfulStats.avgBioLength;
        const headlineDiff = failingStats.avgHeadlineLength - successfulStats.avgHeadlineLength;
        const expDiff = failingStats.avgExperienceCount - successfulStats.avgExperienceCount;
        
        console.log(`   📊 Bio length difference: ${bioDiff > 0 ? '+' : ''}${bioDiff} chars`);
        console.log(`   📊 Headline length difference: ${headlineDiff > 0 ? '+' : ''}${headlineDiff} chars`);
        console.log(`   📊 Experience count difference: ${expDiff > 0 ? '+' : ''}${expDiff} jobs`);
        
        console.log(`\n   🚨 Content Issues:`);
        console.log(`      Failing leads with special chars: ${failingStats.hasSpecialChars}/${failingLeads.length}`);
        console.log(`      Successful leads with special chars: ${successfulStats.hasSpecialChars}/${successfulLeads.length}`);
        console.log(`      Failing leads with unicode issues: ${failingStats.hasUnicodeIssues}/${failingLeads.length}`);
        console.log(`      Successful leads with unicode issues: ${successfulStats.hasUnicodeIssues}/${successfulLeads.length}`);
        
        console.log('\n5. 💡 HYPOTHESIS:');
        
        if (failingStats.hasSpecialChars > successfulStats.hasSpecialChars) {
            console.log('   🎯 LIKELY CAUSE: Special characters in bio text triggering AI safety filters');
        } else if (failingStats.hasUnicodeIssues > successfulStats.hasUnicodeIssues) {
            console.log('   🎯 LIKELY CAUSE: Unicode encoding issues causing AI processing errors');
        } else if (Math.abs(bioDiff) > 500) {
            console.log('   🎯 LIKELY CAUSE: Bio text length causing AI processing timeouts');
        } else {
            console.log('   🎯 LIKELY CAUSE: These leads may be processed in a different batch that encounters AI rate limits');
            console.log('   💡 The issue may be timing-related rather than content-related');
        }
        
        console.log('\n6. 🔧 RECOMMENDATIONS:');
        console.log('   1. Try manually processing just 1-2 of the failing leads');
        console.log('   2. Check if content cleaning resolves the issues');
        console.log('   3. Process these leads in smaller batches to avoid rate limits');
        
        // Show specific leads that might be problematic
        console.log('\n7. 🎯 SPECIFIC LEADS TO INVESTIGATE:');
        failingLeads.forEach((lead, index) => {
            const profileJson = lead.fields['Profile Full JSON'];
            if (profileJson) {
                const profile = JSON.parse(profileJson);
                const bio = (profile.about || profile.summary || '').trim();
                const hasIssues = bio.match(/[\x00-\x1F\x7F-\x9F]/) || bio.match(/[\uD800-\uDFFF]/) || bio.length > 3000;
                
                if (hasIssues) {
                    console.log(`   🚨 ${lead.fields['First Name']} ${lead.fields['Last Name']} (${lead.id})`);
                    console.log(`      Company: ${lead.fields['Company Name']}`);
                    console.log(`      Issue: ${bio.match(/[\x00-\x1F\x7F-\x9F]/) ? 'Special chars ' : ''}${bio.match(/[\uD800-\uDFFF]/) ? 'Unicode issues ' : ''}${bio.length > 3000 ? 'Very long text' : ''}`);
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error comparing leads:', error.message);
    }
}

compareFailingVsSuccessfulLeads();
