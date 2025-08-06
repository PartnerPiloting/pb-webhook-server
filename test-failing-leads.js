require('dotenv').config();

async function testFailingLeads() {
    console.log('🎯 TESTING THE 10 FAILING LEADS: Status = "To Be Scored"');
    console.log('='.repeat(80));
    
    try {
        const base = require('./config/airtableClient.js');
        
        if (!base) {
            throw new Error('Airtable base not available');
        }
        
        console.log('1. 📊 Loading the 10 leads that are stuck with "To Be Scored" status...');
        
        const records = [];
        await base("Leads")
            .select({
                filterByFormula: `{Scoring Status} = "To Be Scored"`,
                maxRecords: 20 // Get a few extra just in case
            })
            .eachPage((pageRecords, next) => {
                records.push(...pageRecords);
                next();
            });
            
        console.log(`   ✅ Found ${records.length} leads with "To Be Scored" status`);
        
        if (records.length === 0) {
            console.log('✅ Great! No leads are stuck with "To Be Scored" status');
            console.log('   This means the issue may have been resolved');
            return;
        }
        
        console.log('\n2. 🔍 Analyzing each failing lead in detail...');
        console.log('─'.repeat(80));
        
        const problemLeads = [];
        
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const fields = record.fields;
            
            console.log(`\n🔍 LEAD ${i + 1}/${records.length}: ${record.id}`);
            console.log('─'.repeat(50));
            
            // Extract all the key fields we can find
            const leadData = {
                id: record.id,
                // Try multiple possible field names
                clientId: fields['Client ID'] || fields['clientId'] || fields['Client'] || fields['client'],
                email: fields['Email'] || fields['email'] || fields['Email Address'],
                name: fields['Full Name'] || fields['Name'] || fields['name'] || fields['Contact Name'],
                company: fields['Company'] || fields['company'] || fields['Organization'],
                scoringStatus: fields['Scoring Status'],
                profileKey: fields['Profile Key'],
                linkedinUrl: fields['LinkedIn Profile URL'],
                dateCreated: fields['Date Created'],
                // Get all fields for debugging
                allFields: fields
            };
            
            console.log(`   📋 Basic Info:`);
            console.log(`      ID: ${leadData.id}`);
            console.log(`      Client ID: ${leadData.clientId || 'MISSING ❌'}`);
            console.log(`      Email: ${leadData.email || 'MISSING ❌'}`);
            console.log(`      Name: ${leadData.name || 'MISSING ❌'}`);
            console.log(`      Company: ${leadData.company || 'Not set'}`);
            console.log(`      Profile Key: ${leadData.profileKey || 'Not set'}`);
            console.log(`      LinkedIn URL: ${leadData.linkedinUrl || 'Not set'}`);
            console.log(`      Date Created: ${leadData.dateCreated || 'Not set'}`);
            
            // Identify specific issues
            const issues = [];
            
            if (!leadData.clientId) {
                issues.push('❌ Missing Client ID');
            }
            
            if (!leadData.email) {
                issues.push('❌ Missing Email');
            } else {
                // Check email format
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(leadData.email)) {
                    issues.push('❌ Invalid Email Format');
                }
            }
            
            if (!leadData.name) {
                issues.push('❌ Missing Name');
            }
            
            // Check for data that might cause JSON issues
            try {
                JSON.stringify(leadData.allFields);
            } catch (jsonError) {
                issues.push('❌ JSON Serialization Error');
            }
            
            // Check if this lead has profile data that might be causing issues
            if (fields['Profile Full JSON']) {
                try {
                    JSON.parse(fields['Profile Full JSON']);
                    console.log(`      Profile JSON: ✅ Valid (${fields['Profile Full JSON'].length} chars)`);
                } catch (profileError) {
                    issues.push('❌ Invalid Profile JSON');
                    console.log(`      Profile JSON: ❌ Invalid - ${profileError.message}`);
                }
            } else {
                console.log(`      Profile JSON: Not set`);
            }
            
            console.log(`\n   🔍 Issues Found: ${issues.length}`);
            if (issues.length > 0) {
                issues.forEach(issue => console.log(`      ${issue}`));
            } else {
                console.log(`      ✅ No obvious data issues found`);
            }
            
            // Show all available field names for debugging
            console.log(`\n   📋 All Available Fields (${Object.keys(fields).length}):`);
            Object.keys(fields).forEach(fieldName => {
                const value = fields[fieldName];
                const preview = String(value).substring(0, 50);
                console.log(`      "${fieldName}": ${preview}${String(value).length > 50 ? '...' : ''}`);
            });
            
            problemLeads.push({
                id: record.id,
                issues: issues,
                data: leadData,
                allFields: fields
            });
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('📊 SUMMARY OF THE 10 FAILING LEADS');
        console.log('='.repeat(80));
        
        console.log(`\n🔢 Total failing leads: ${problemLeads.length}`);
        
        // Group by issue type
        const issueStats = {};
        problemLeads.forEach(lead => {
            lead.issues.forEach(issue => {
                if (!issueStats[issue]) {
                    issueStats[issue] = [];
                }
                issueStats[issue].push(lead.id);
            });
        });
        
        console.log('\n📊 Issue Breakdown:');
        Object.entries(issueStats).forEach(([issue, leadIds]) => {
            console.log(`   ${issue}: ${leadIds.length} leads`);
            console.log(`      Leads: ${leadIds.join(', ')}`);
        });
        
        // Check if all leads have the same issue
        if (Object.keys(issueStats).length === 1) {
            const singleIssue = Object.keys(issueStats)[0];
            console.log(`\n🎯 ALL LEADS HAVE THE SAME ISSUE: ${singleIssue}`);
            console.log(`   This explains why exactly ${problemLeads.length} leads fail consistently!`);
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🔧 RECOMMENDATIONS');
        console.log('='.repeat(80));
        
        if (problemLeads.length > 0) {
            console.log('\n📋 IMMEDIATE FIXES NEEDED:');
            
            // Specific recommendations based on issues found
            if (issueStats['❌ Missing Client ID']) {
                console.log(`\n1. 🔧 FIX MISSING CLIENT IDs (${issueStats['❌ Missing Client ID'].length} leads):`);
                console.log(`   - Update the Client ID field in Airtable for these leads`);
                console.log(`   - Leads: ${issueStats['❌ Missing Client ID'].join(', ')}`);
            }
            
            if (issueStats['❌ Missing Email']) {
                console.log(`\n2. 📧 FIX MISSING EMAILS (${issueStats['❌ Missing Email'].length} leads):`);
                console.log(`   - Add email addresses for these leads in Airtable`);
                console.log(`   - Leads: ${issueStats['❌ Missing Email'].join(', ')}`);
            }
            
            if (issueStats['❌ Invalid Email Format']) {
                console.log(`\n3. ✉️ FIX EMAIL FORMATS (${issueStats['❌ Invalid Email Format'].length} leads):`);
                console.log(`   - Correct the email format for these leads`);
                console.log(`   - Leads: ${issueStats['❌ Invalid Email Format'].join(', ')}`);
            }
            
            if (issueStats['❌ Missing Name']) {
                console.log(`\n4. 👤 FIX MISSING NAMES (${issueStats['❌ Missing Name'].length} leads):`);
                console.log(`   - Add names for these leads in Airtable`);
                console.log(`   - Leads: ${issueStats['❌ Missing Name'].join(', ')}`);
            }
            
            console.log(`\n📝 TEST COMMANDS:`);
            problemLeads.slice(0, 3).forEach((lead, index) => {
                console.log(`   ${index + 1}. node test-single-lead.js ${lead.id}`);
            });
            
            console.log(`\n🔄 AFTER FIXING IN AIRTABLE:`);
            console.log(`   1. Wait for the next scheduled batch run (daily at 2 AM Singapore time)`);
            console.log(`   2. OR trigger manual batch scoring to test immediately`);
            console.log(`   3. Check that these leads no longer have "To Be Scored" status`);
            
        } else {
            console.log('\n✅ All leads look technically correct');
            console.log('The failures might be due to:');
            console.log('- API timeouts or network issues');
            console.log('- External service rate limiting');
            console.log('- Specific client configuration issues');
        }
        
        return problemLeads;
        
    } catch (error) {
        console.error('❌ Error testing failing leads:', error.message);
        console.log('\nDebug info:');
        console.log(`Error stack: ${error.stack}`);
        throw error;
    }
}

// Run the test
if (require.main === module) {
    testFailingLeads()
        .then(results => {
            console.log(`\n✅ Analysis complete. Found issues with ${results.length} leads that are preventing them from being scored.`);
        })
        .catch(error => {
            console.error('❌ Test failed:', error.message);
            process.exit(1);
        });
}

module.exports = { testFailingLeads };
