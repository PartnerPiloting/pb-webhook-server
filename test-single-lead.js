require('dotenv').config();

// Simple test script to validate individual leads
async function testSingleLead(leadId) {
    if (!leadId) {
        console.log('Usage: node test-single-lead.js <leadId>');
        console.log('Example: node test-single-lead.js lead_12345');
        return;
    }

    console.log(`🔍 Testing individual lead: ${leadId}`);
    console.log('='.repeat(50));

    try {
        // First, let's check if we can find this lead in our system
        console.log('1. 📋 Checking lead existence...');
        
        // Import our existing modules
        const { loadLeadsFromAirtable } = require('./attributeLoader');
        
        // Load all leads to find this specific one
        console.log('   Loading leads from Airtable...');
        const allLeads = await loadLeadsFromAirtable();
        
        const targetLead = allLeads.find(lead => 
            lead.id === leadId || 
            lead.leadId === leadId ||
            lead['Lead ID'] === leadId ||
            String(lead.id).includes(leadId) ||
            String(lead.leadId).includes(leadId)
        );

        if (!targetLead) {
            console.log(`   ❌ Lead ${leadId} not found in Airtable`);
            console.log(`   📊 Total leads in system: ${allLeads.length}`);
            console.log(`   🔍 Searching for partial matches...`);
            
            const partialMatches = allLeads.filter(lead => 
                String(lead.id || '').includes(leadId) ||
                String(lead.leadId || '').includes(leadId) ||
                String(lead['Lead ID'] || '').includes(leadId)
            );
            
            if (partialMatches.length > 0) {
                console.log(`   📋 Found ${partialMatches.length} partial matches:`);
                partialMatches.slice(0, 5).forEach(match => {
                    console.log(`      • ID: ${match.id || match.leadId || match['Lead ID']}`);
                });
            }
            return;
        }

        console.log(`   ✅ Found lead: ${targetLead.id || targetLead.leadId}`);
        console.log(`   📊 Lead data summary:`);
        console.log(`      Client: ${targetLead.clientId || targetLead['Client ID'] || 'Unknown'}`);
        console.log(`      Name: ${targetLead.name || targetLead['Full Name'] || 'Unknown'}`);
        console.log(`      Email: ${targetLead.email || targetLead['Email'] || 'Unknown'}`);

        // Check for data integrity issues
        console.log('\n2. 🔍 Checking data integrity...');
        
        const requiredFields = ['clientId', 'Client ID'];
        const missingFields = [];
        
        requiredFields.forEach(field => {
            if (!targetLead[field]) {
                missingFields.push(field);
            }
        });

        if (missingFields.length > 0) {
            console.log(`   ❌ Missing required fields: ${missingFields.join(', ')}`);
        } else {
            console.log(`   ✅ All required fields present`);
        }

        // Check JSON structure
        console.log('\n3. 🔍 Checking JSON structure...');
        try {
            const jsonString = JSON.stringify(targetLead);
            JSON.parse(jsonString);
            console.log(`   ✅ Lead data is valid JSON`);
            console.log(`   📊 Data size: ${jsonString.length} characters`);
        } catch (jsonError) {
            console.log(`   ❌ JSON error: ${jsonError.message}`);
        }

        // Test client configuration
        console.log('\n4. 🔍 Testing client configuration...');
        
        const clientId = targetLead.clientId || targetLead['Client ID'];
        if (clientId) {
            try {
                // Try to load client-specific data
                const clientLeads = allLeads.filter(lead => 
                    (lead.clientId || lead['Client ID']) === clientId
                );
                
                console.log(`   📊 Client ${clientId} has ${clientLeads.length} total leads`);
                
                const failedLeads = clientLeads.filter(lead => {
                    // This is a placeholder - in a real scenario, we'd check against 
                    // our known failed leads list
                    return lead.id === leadId || lead.leadId === leadId;
                });
                
                if (failedLeads.length > 0) {
                    console.log(`   ⚠️  This client has failed leads`);
                } else {
                    console.log(`   ✅ Client appears to be processing normally`);
                }
                
            } catch (clientError) {
                console.log(`   ❌ Client configuration error: ${clientError.message}`);
            }
        }

        // Test scoring readiness
        console.log('\n5. 🔍 Testing scoring readiness...');
        
        try {
            // Check if this lead has the necessary data for scoring
            const scoringFields = ['email', 'Email', 'name', 'Full Name', 'company', 'Company'];
            const presentFields = scoringFields.filter(field => targetLead[field]);
            
            console.log(`   📊 Scoring fields present: ${presentFields.length}/${scoringFields.length}`);
            presentFields.forEach(field => {
                console.log(`      ✅ ${field}: ${targetLead[field]}`);
            });
            
            const missingScoring = scoringFields.filter(field => !targetLead[field]);
            if (missingScoring.length > 0) {
                console.log(`   ⚠️  Missing scoring fields: ${missingScoring.join(', ')}`);
            }
            
        } catch (scoringError) {
            console.log(`   ❌ Scoring readiness error: ${scoringError.message}`);
        }

        // Test API call simulation
        console.log('\n6. 🔍 Simulating API processing...');
        
        try {
            // Simulate the processing that would happen in production
            const leadData = {
                id: targetLead.id || targetLead.leadId,
                clientId: targetLead.clientId || targetLead['Client ID'],
                email: targetLead.email || targetLead['Email'],
                name: targetLead.name || targetLead['Full Name'],
                company: targetLead.company || targetLead['Company']
            };

            console.log(`   📋 Processed lead data:`);
            Object.entries(leadData).forEach(([key, value]) => {
                console.log(`      ${key}: ${value || 'NOT SET'}`);
            });

            // Check for common issues that cause failures
            const issues = [];
            
            if (!leadData.clientId) issues.push('Missing client ID');
            if (!leadData.email) issues.push('Missing email');
            if (!leadData.id) issues.push('Missing lead ID');
            
            if (issues.length > 0) {
                console.log(`   ❌ Issues found: ${issues.join(', ')}`);
                console.log(`   🎯 These issues likely cause the scoring failures`);
            } else {
                console.log(`   ✅ No obvious data issues found`);
                console.log(`   🤔 Failure might be due to API/network issues`);
            }

        } catch (apiError) {
            console.log(`   ❌ API simulation error: ${apiError.message}`);
        }

        // Summary and recommendations
        console.log('\n' + '='.repeat(50));
        console.log('🎯 SUMMARY & RECOMMENDATIONS');
        console.log('='.repeat(50));
        
        console.log(`\n📊 Lead ${leadId} Analysis:`);
        console.log(`   🆔 Lead ID: ${targetLead.id || targetLead.leadId}`);
        console.log(`   🏢 Client: ${targetLead.clientId || targetLead['Client ID']}`);
        
        if (missingFields.length > 0) {
            console.log(`\n🚨 CRITICAL ISSUES:`);
            console.log(`   • Missing fields: ${missingFields.join(', ')}`);
            console.log(`   • Recommendation: Fix data in Airtable`);
        }
        
        console.log(`\n📋 Next Steps:`);
        console.log(`   1. Fix any missing required fields`);
        console.log(`   2. Re-run scoring for this specific lead`);
        console.log(`   3. Monitor for continued failures`);

    } catch (error) {
        console.error(`❌ Error testing lead ${leadId}:`, error.message);
        console.log('\nDebug info:');
        console.log(`Error stack: ${error.stack}`);
    }
}

// Get lead ID from command line argument
const leadId = process.argv[2];
testSingleLead(leadId);
