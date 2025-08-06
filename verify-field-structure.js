const base = require('./config/airtableClient');

async function verifyFieldStructure() {
    console.log('🔍 VERIFYING AIRTABLE FIELD STRUCTURE');
    console.log('='.repeat(60));
    
    try {
        console.log('   🔗 Using default Airtable base instance...');
        
        console.log('\n1. 📋 Checking LEADS table structure...');
        
        // Get a sample of leads to see actual field structure
        const leadsRecords = await base('Leads').select({
            maxRecords: 5
        }).all();
        
        if (leadsRecords.length > 0) {
            console.log(`   ✅ Found ${leadsRecords.length} sample leads`);
            console.log('\n   📋 Available fields in LEADS table:');
            
            const firstRecord = leadsRecords[0];
            const fieldNames = Object.keys(firstRecord.fields);
            
            fieldNames.sort().forEach((field, index) => {
                const value = firstRecord.fields[field];
                const valueType = Array.isArray(value) ? 'array' : typeof value;
                const valuePreview = Array.isArray(value) ? `[${value.length} items]` : 
                                   typeof value === 'string' && value.length > 50 ? `${value.substring(0, 50)}...` : value;
                console.log(`      ${index + 1}. "${field}" (${valueType}): ${valuePreview}`);
            });
            
            // Specifically check for Client ID related fields
            console.log('\n   🔍 Client ID related fields check:');
            const clientFields = fieldNames.filter(field => 
                field.toLowerCase().includes('client') || 
                field.toLowerCase().includes('id')
            );
            
            if (clientFields.length > 0) {
                console.log(`      ✅ Found ${clientFields.length} client/ID related fields:`);
                clientFields.forEach(field => {
                    console.log(`         • "${field}"`);
                });
            } else {
                console.log(`      ❌ No obvious Client ID fields found in Leads table`);
            }
            
            // Check for Email field specifically
            console.log('\n   📧 Email field check:');
            const emailFields = fieldNames.filter(field => 
                field.toLowerCase().includes('email') || 
                field.toLowerCase().includes('mail')
            );
            
            if (emailFields.length > 0) {
                console.log(`      ✅ Found ${emailFields.length} email related fields:`);
                emailFields.forEach(field => {
                    const value = firstRecord.fields[field];
                    console.log(`         • "${field}": ${value || 'EMPTY'}`);
                });
            } else {
                console.log(`      ❌ No email fields found in Leads table`);
            }
        }
        
        console.log('\n2. 📋 Checking MASTER CLIENTS table structure...');
        
        try {
            const clientsRecords = await base('Master Clients').select({
                maxRecords: 3
            }).all();
            
            if (clientsRecords.length > 0) {
                console.log(`   ✅ Found ${clientsRecords.length} sample clients`);
                console.log('\n   📋 Available fields in MASTER CLIENTS table:');
                
                const firstClientRecord = clientsRecords[0];
                const clientFieldNames = Object.keys(firstClientRecord.fields);
                
                clientFieldNames.sort().forEach((field, index) => {
                    const value = firstClientRecord.fields[field];
                    const valueType = Array.isArray(value) ? 'array' : typeof value;
                    const valuePreview = Array.isArray(value) ? `[${value.length} items]` : 
                                       typeof value === 'string' && value.length > 50 ? `${value.substring(0, 50)}...` : value;
                    console.log(`      ${index + 1}. "${field}" (${valueType}): ${valuePreview}`);
                });
            }
        } catch (clientError) {
            console.log(`   ⚠️  Could not access Master Clients table: ${clientError.message}`);
        }
        
        console.log('\n3. 🔍 Re-analyzing the 10 failing leads with correct field understanding...');
        
        // Now let's check the specific failing leads again
        const failingLeads = await base('Leads').select({
            filterByFormula: '{Scoring Status} = "To Be Scored"',
            maxRecords: 10
        }).all();
        
        console.log(`   📊 Found ${failingLeads.length} leads with "To Be Scored" status`);
        
        if (failingLeads.length > 0) {
            console.log('\n   🔍 Detailed analysis of failing leads:');
            
            failingLeads.forEach((lead, index) => {
                console.log(`\n   📝 Lead ${index + 1}: ${lead.fields['Full Name'] || 'Unknown'}`);
                console.log(`      ID: ${lead.id}`);
                
                // Check all fields that might be required
                const requiredChecks = [
                    { field: 'Email', description: 'Email address' },
                    { field: 'Client ID', description: 'Client ID (if exists)' },
                    { field: 'LinkedIn Profile URL', description: 'LinkedIn URL' },
                    { field: 'Profile Full JSON', description: 'Profile data' },
                    { field: 'Full Name', description: 'Full name' }
                ];
                
                requiredChecks.forEach(check => {
                    const value = lead.fields[check.field];
                    if (value && value !== '') {
                        console.log(`      ✅ ${check.description}: Present`);
                    } else {
                        console.log(`      ❌ ${check.description}: MISSING`);
                    }
                });
                
                // Check for any field that might contain client association
                const possibleClientFields = Object.keys(lead.fields).filter(field =>
                    field.toLowerCase().includes('client') ||
                    field.toLowerCase().includes('company') ||
                    field.toLowerCase().includes('organization')
                );
                
                if (possibleClientFields.length > 0) {
                    console.log(`      🔗 Possible client association fields:`);
                    possibleClientFields.forEach(field => {
                        const value = lead.fields[field];
                        console.log(`         • ${field}: ${value || 'EMPTY'}`);
                    });
                }
            });
        }
        
        console.log('\n4. 🎯 CONCLUSION:');
        console.log('   Based on actual field structure analysis:');
        
        // Summary of findings
        const leadsFieldCount = leadsRecords.length > 0 ? Object.keys(leadsRecords[0].fields).length : 0;
        console.log(`   📊 Leads table has ${leadsFieldCount} fields total`);
        
        // Check if Client ID field actually exists in Leads
        const hasClientIdInLeads = leadsRecords.length > 0 && 
                                  Object.keys(leadsRecords[0].fields).includes('Client ID');
        
        if (hasClientIdInLeads) {
            console.log(`   ✅ "Client ID" field EXISTS in Leads table`);
        } else {
            console.log(`   ❌ "Client ID" field does NOT exist in Leads table`);
            console.log(`   💡 This means our initial diagnosis was INCORRECT`);
        }
        
        // Check email situation
        const hasEmailInLeads = leadsRecords.length > 0 && 
                               (Object.keys(leadsRecords[0].fields).includes('Email') ||
                                Object.keys(leadsRecords[0].fields).some(f => f.toLowerCase().includes('email')));
        
        if (hasEmailInLeads) {
            console.log(`   📧 Email field structure confirmed in Leads table`);
        } else {
            console.log(`   ❌ No email fields found in Leads table structure`);
        }
        
    } catch (error) {
        console.error('❌ Error verifying field structure:', error.message);
    }
}

// Run the verification
verifyFieldStructure();
