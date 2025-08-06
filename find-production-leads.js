require('dotenv').config();

async function findProductionLeads() {
    console.log('🎯 FOCUSED ANALYSIS: Finding the specific 96 leads processed in production');
    console.log('='.repeat(80));
    
    try {
        // Use the same Airtable base
        const base = require('./config/airtableClient.js');
        
        if (!base) {
            throw new Error('Airtable base not available');
        }
        
        console.log('1. 📊 Finding leads marked "To Be Scored" (the 96 being processed)...');
        
        const records = [];
        await base("Leads")
            .select({
                filterByFormula: `{Scoring Status} = "To Be Scored"`,
                maxRecords: 200 // Get more than 96 to be safe
            })
            .eachPage((pageRecords, next) => {
                records.push(...pageRecords);
                next();
            });
            
        console.log(`   ✅ Found ${records.length} leads with "To Be Scored" status`);
        
        if (records.length === 0) {
            console.log('❌ No leads found with "To Be Scored" status');
            console.log('   This might mean:');
            console.log('   - The filter formula is wrong');
            console.log('   - The field name is different');
            console.log('   - All leads have been processed since last run');
            return;
        }
        
        // Convert to simple objects for analysis
        const leads = records.map(record => {
            const fields = record.fields;
            return {
                id: record.id,
                ...fields,
                leadId: record.id
            };
        });
        
        console.log('\n2. 🔍 Analyzing the "To Be Scored" leads for potential issues...');
        
        // Check for the same validation issues
        const failedLeads = [];
        const successfulLeads = [];
        
        leads.forEach((lead, index) => {
            const leadId = lead.id;
            const clientId = lead.clientId || lead['Client ID'] || lead['Client'] || 'unknown';
            const email = lead.email || lead['Email'] || lead['Email Address'];
            const name = lead.name || lead['Full Name'] || lead['Name'] || lead['Contact Name'];
            
            console.log(`   Processing ${index + 1}/${leads.length}: ${leadId} (Client: ${clientId})`);
            
            // Check for issues that would cause failures
            const issues = [];
            
            if (!email) {
                issues.push('Missing email');
            }
            
            if (!clientId || clientId === 'unknown') {
                issues.push('Missing client ID');
            }
            
            if (!name) {
                issues.push('Missing name');
            }
            
            // Check email format if present
            if (email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    issues.push('Invalid email format');
                }
            }
            
            if (issues.length > 0) {
                failedLeads.push({
                    leadId: leadId,
                    clientId: clientId,
                    email: email,
                    name: name,
                    issues: issues,
                    errorSummary: issues.join(', ')
                });
            } else {
                successfulLeads.push({
                    leadId: leadId,
                    clientId: clientId,
                    email: email,
                    name: name
                });
            }
        });
        
        console.log('\n' + '='.repeat(80));
        console.log('📊 ANALYSIS OF PRODUCTION "TO BE SCORED" LEADS');
        console.log('='.repeat(80));
        
        console.log(`\n📈 SUMMARY:`);
        console.log(`   🔢 Total "To Be Scored" leads: ${leads.length}`);
        console.log(`   ✅ Leads that should succeed: ${successfulLeads.length}`);
        console.log(`   ❌ Leads that will likely fail: ${failedLeads.length}`);
        
        const expectedSuccessRate = ((successfulLeads.length / leads.length) * 100).toFixed(1);
        console.log(`   📊 Expected success rate: ${expectedSuccessRate}%`);
        
        // Compare with production numbers
        console.log(`\n🎯 PRODUCTION COMPARISON:`);
        console.log(`   Production shows: 86 successful, 10 failed (total 96)`);
        console.log(`   Our analysis: ${successfulLeads.length} should succeed, ${failedLeads.length} should fail (total ${leads.length})`);
        
        if (leads.length !== 96) {
            console.log(`   ⚠️  MISMATCH: We found ${leads.length} "To Be Scored" leads, but production processes 96`);
            console.log(`   This suggests either:`);
            console.log(`   - Some leads were processed since the last production run`);
            console.log(`   - The filter criteria is different in production`);
            console.log(`   - There's a timing issue between when we check and when production runs`);
        }
        
        if (failedLeads.length > 0) {
            console.log(`\n🚨 LEADS THAT WILL LIKELY FAIL IN PRODUCTION:`);
            console.log('─'.repeat(80));
            
            failedLeads.forEach((lead, index) => {
                console.log(`\n${index + 1}. LEAD ID: ${lead.leadId}`);
                console.log(`   Client: ${lead.clientId}`);
                console.log(`   Email: ${lead.email || 'MISSING'}`);
                console.log(`   Name: ${lead.name || 'MISSING'}`);
                console.log(`   Issues: ${lead.errorSummary}`);
                console.log(`   🧪 Test: node test-single-lead.js ${lead.leadId}`);
            });
            
            // Group by issue type
            const issueTypes = {};
            failedLeads.forEach(lead => {
                lead.issues.forEach(issue => {
                    if (!issueTypes[issue]) {
                        issueTypes[issue] = [];
                    }
                    issueTypes[issue].push(lead.leadId);
                });
            });
            
            console.log(`\n📊 ISSUE BREAKDOWN:`);
            Object.entries(issueTypes).forEach(([issue, leadIds]) => {
                console.log(`   ${issue}: ${leadIds.length} leads`);
                console.log(`      Leads: ${leadIds.slice(0, 5).join(', ')}${leadIds.length > 5 ? ' ...' : ''}`);
            });
        }
        
        if (successfulLeads.length > 0 && failedLeads.length === 10) {
            console.log(`\n🎉 PERFECT MATCH!`);
            console.log(`   Our analysis predicts exactly ${failedLeads.length} failures`);
            console.log(`   This matches the production "Failed: 10" pattern`);
            console.log(`\n🎯 THESE ARE LIKELY THE 10 FAILING LEADS:`);
            failedLeads.forEach((lead, index) => {
                console.log(`   ${index + 1}. ${lead.leadId} (${lead.errorSummary})`);
            });
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🎯 NEXT STEPS');
        console.log('='.repeat(80));
        
        if (failedLeads.length > 0) {
            console.log('\n📋 IMMEDIATE ACTIONS:');
            console.log('1. 🔧 Fix the data issues in Airtable:');
            failedLeads.slice(0, 5).forEach(lead => {
                console.log(`   - Lead ${lead.leadId}: Fix ${lead.errorSummary}`);
            });
            
            console.log('\n2. 🧪 Test individual leads:');
            failedLeads.slice(0, 3).forEach(lead => {
                console.log(`   node test-single-lead.js ${lead.leadId}`);
            });
            
            console.log('\n3. 📈 After fixing, re-run this analysis to verify improvements');
        } else {
            console.log('\n✅ All "To Be Scored" leads look good!');
            console.log('The production failures might be due to:');
            console.log('- API timeouts or network issues');
            console.log('- External service unavailability');
            console.log('- Rate limiting');
        }
        
        return {
            totalLeads: leads.length,
            successfulLeads: successfulLeads,
            failedLeads: failedLeads
        };
        
    } catch (error) {
        console.error('❌ Error finding production leads:', error.message);
        console.log('\nDebug info:');
        console.log(`Error stack: ${error.stack}`);
        throw error;
    }
}

// Run the focused analysis
if (require.main === module) {
    findProductionLeads()
        .then(results => {
            console.log(`\n✅ Analysis complete. Found ${results.failedLeads.length} likely failing leads out of ${results.totalLeads} production leads.`);
        })
        .catch(error => {
            console.error('❌ Analysis failed:', error.message);
            process.exit(1);
        });
}

module.exports = { findProductionLeads };
