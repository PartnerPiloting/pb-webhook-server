require('dotenv').config();
const fs = require('fs');

async function identifyFailingLeads() {
    console.log('🔍 LOCAL BATCH TEST: Identifying the 10 failing leads');
    console.log('='.repeat(80));
    
    try {
        // Create our own leads loading function using the Airtable base
        const base = require('./config/airtableClient.js');
        
        if (!base) {
            throw new Error('Airtable base not available from config/airtableClient.js');
        }
        
        async function loadAllLeads() {
            const records = [];
            console.log('   📡 Fetching leads from Airtable...');
            
            await base("Leads")
                .select({
                    maxRecords: 1000, // Get more leads to find the failing ones
                    // Don't filter by scoring status - get all leads to compare
                })
                .eachPage((pageRecords, next) => {
                    records.push(...pageRecords);
                    next();
                });
                
            console.log(`   📊 Fetched ${records.length} total leads from Airtable`);
            
            // Convert Airtable records to plain objects
            const leads = records.map(record => {
                const fields = record.fields;
                return {
                    id: record.id,
                    ...fields,
                    // Also include the record ID as leadId for consistency
                    leadId: record.id
                };
            });
            
            return leads;
        }
        
        console.log('1. 📊 Loading all leads from Airtable...');
        const allLeads = await loadAllLeads();
        console.log(`   ✅ Loaded ${allLeads.length} total leads`);
        
        // Group leads by client to match production processing
        const leadsByClient = {};
        allLeads.forEach(lead => {
            const clientId = lead.clientId || lead['Client ID'] || 'unknown';
            if (!leadsByClient[clientId]) {
                leadsByClient[clientId] = [];
            }
            leadsByClient[clientId].push(lead);
        });
        
        console.log(`\n2. 📋 Found ${Object.keys(leadsByClient).length} clients:`);
        Object.entries(leadsByClient).forEach(([clientId, leads]) => {
            console.log(`   ${clientId}: ${leads.length} leads`);
        });
        
        // Test each lead individually to identify failures
        console.log('\n3. 🧪 Testing each lead individually...');
        const failedLeads = [];
        const successfulLeads = [];
        const leadErrors = [];
        
        let processedCount = 0;
        const totalLeads = allLeads.length;
        
        for (const lead of allLeads) {
            processedCount++;
            const leadId = lead.id || lead.leadId || lead['Lead ID'] || `lead_${processedCount}`;
            const clientId = lead.clientId || lead['Client ID'] || 'unknown';
            
            // Progress indicator
            if (processedCount % 10 === 0 || processedCount <= 20) {
                console.log(`   Processing ${processedCount}/${totalLeads}: ${leadId} (Client: ${clientId})`);
            }
            
            try {
                // Test individual lead scoring
                const leadData = {
                    id: leadId,
                    clientId: clientId,
                    email: lead.email || lead['Email'],
                    name: lead.name || lead['Full Name'] || lead['Name'],
                    company: lead.company || lead['Company'],
                    phone: lead.phone || lead['Phone'],
                    // Include all other fields
                    ...lead
                };
                
                // Validate required fields
                const requiredFields = ['id', 'clientId', 'email'];
                const missingFields = requiredFields.filter(field => !leadData[field]);
                
                if (missingFields.length > 0) {
                    const error = `Missing required fields: ${missingFields.join(', ')}`;
                    failedLeads.push({
                        leadId: leadId,
                        clientId: clientId,
                        error: error,
                        errorType: 'validation',
                        leadData: leadData
                    });
                    leadErrors.push({
                        leadId: leadId,
                        error: error,
                        type: 'validation'
                    });
                    continue;
                }
                
                // Check for data format issues
                try {
                    JSON.stringify(leadData);
                } catch (jsonError) {
                    const error = `JSON serialization error: ${jsonError.message}`;
                    failedLeads.push({
                        leadId: leadId,
                        clientId: clientId,
                        error: error,
                        errorType: 'json',
                        leadData: leadData
                    });
                    leadErrors.push({
                        leadId: leadId,
                        error: error,
                        type: 'json'
                    });
                    continue;
                }
                
                // Check for email format
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (leadData.email && !emailRegex.test(leadData.email)) {
                    const error = `Invalid email format: ${leadData.email}`;
                    failedLeads.push({
                        leadId: leadId,
                        clientId: clientId,
                        error: error,
                        errorType: 'email_format',
                        leadData: leadData
                    });
                    leadErrors.push({
                        leadId: leadId,
                        error: error,
                        type: 'email_format'
                    });
                    continue;
                }
                
                // Check for client configuration issues
                if (clientId === 'unknown' || !clientId) {
                    const error = 'Missing or invalid client ID';
                    failedLeads.push({
                        leadId: leadId,
                        clientId: clientId,
                        error: error,
                        errorType: 'client_config',
                        leadData: leadData
                    });
                    leadErrors.push({
                        leadId: leadId,
                        error: error,
                        type: 'client_config'
                    });
                    continue;
                }
                
                // Simulate API call validation
                try {
                    // Check if this lead would pass our scoring API validation
                    if (!leadData.email || !leadData.name) {
                        throw new Error('Missing required fields for scoring API');
                    }
                    
                    // Simulate potential API errors
                    if (leadData.email.includes('test@test') || leadData.email.includes('noreply')) {
                        throw new Error('Invalid email domain for scoring');
                    }
                    
                    // Check for data that might cause API timeouts
                    const leadSize = JSON.stringify(leadData).length;
                    if (leadSize > 50000) {
                        throw new Error('Lead data too large, may cause API timeout');
                    }
                    
                    // If we get here, the lead should process successfully
                    successfulLeads.push({
                        leadId: leadId,
                        clientId: clientId,
                        leadData: leadData
                    });
                    
                } catch (apiError) {
                    const error = `API validation error: ${apiError.message}`;
                    failedLeads.push({
                        leadId: leadId,
                        clientId: clientId,
                        error: error,
                        errorType: 'api',
                        leadData: leadData
                    });
                    leadErrors.push({
                        leadId: leadId,
                        error: error,
                        type: 'api'
                    });
                }
                
            } catch (leadError) {
                const error = `Processing error: ${leadError.message}`;
                failedLeads.push({
                    leadId: leadId,
                    clientId: clientId,
                    error: error,
                    errorType: 'processing',
                    leadData: lead
                });
                leadErrors.push({
                    leadId: leadId,
                    error: error,
                    type: 'processing'
                });
            }
        }
        
        // Analysis and results
        console.log('\n' + '='.repeat(80));
        console.log('📊 LOCAL BATCH TEST RESULTS');
        console.log('='.repeat(80));
        
        console.log(`\n📈 SUMMARY:`);
        console.log(`   🔢 Total leads processed: ${allLeads.length}`);
        console.log(`   ✅ Successful: ${successfulLeads.length}`);
        console.log(`   ❌ Failed: ${failedLeads.length}`);
        console.log(`   📊 Success rate: ${((successfulLeads.length / allLeads.length) * 100).toFixed(1)}%`);
        
        if (failedLeads.length > 0) {
            console.log(`\n🚨 DETAILED ANALYSIS OF ${failedLeads.length} FAILED LEADS:`);
            console.log('─'.repeat(80));
            
            // Group failures by error type
            const errorsByType = {};
            failedLeads.forEach(failure => {
                if (!errorsByType[failure.errorType]) {
                    errorsByType[failure.errorType] = [];
                }
                errorsByType[failure.errorType].push(failure);
            });
            
            Object.entries(errorsByType).forEach(([errorType, failures]) => {
                console.log(`\n🔴 ${errorType.toUpperCase()} ERRORS (${failures.length} leads):`);
                failures.slice(0, 10).forEach((failure, index) => {
                    console.log(`   ${index + 1}. Lead: ${failure.leadId} (Client: ${failure.clientId})`);
                    console.log(`      Error: ${failure.error}`);
                    console.log(`      Email: ${failure.leadData.email || 'NOT SET'}`);
                    console.log(`      Name: ${failure.leadData.name || failure.leadData['Full Name'] || 'NOT SET'}`);
                    console.log(`      ────────────────────────────────────────`);
                });
                if (failures.length > 10) {
                    console.log(`   ... and ${failures.length - 10} more ${errorType} errors`);
                }
            });
            
            // Show the first 10 failing leads for immediate action
            console.log(`\n🎯 TOP 10 FAILING LEADS FOR IMMEDIATE INVESTIGATION:`);
            failedLeads.slice(0, 10).forEach((failure, index) => {
                console.log(`\n${index + 1}. LEAD ID: ${failure.leadId}`);
                console.log(`   Client: ${failure.clientId}`);
                console.log(`   Error Type: ${failure.errorType}`);
                console.log(`   Error: ${failure.error}`);
                console.log(`   Test Command: node test-single-lead.js ${failure.leadId}`);
            });
            
            // Client analysis
            const failuresByClient = {};
            failedLeads.forEach(failure => {
                if (!failuresByClient[failure.clientId]) {
                    failuresByClient[failure.clientId] = [];
                }
                failuresByClient[failure.clientId].push(failure);
            });
            
            console.log(`\n📊 FAILURES BY CLIENT:`);
            Object.entries(failuresByClient).forEach(([clientId, failures]) => {
                console.log(`   ${clientId}: ${failures.length} failed leads`);
                const errorTypes = [...new Set(failures.map(f => f.errorType))];
                console.log(`      Error types: ${errorTypes.join(', ')}`);
            });
        }
        
        // Save detailed results to file
        const resultsFile = `failed-leads-analysis-${new Date().toISOString().split('T')[0]}.json`;
        const detailedResults = {
            timestamp: new Date().toISOString(),
            summary: {
                totalLeads: allLeads.length,
                successful: successfulLeads.length,
                failed: failedLeads.length,
                successRate: ((successfulLeads.length / allLeads.length) * 100).toFixed(1)
            },
            failedLeads: failedLeads,
            errorsByType: Object.entries(errorsByType || {}).map(([type, failures]) => ({
                type,
                count: failures.length,
                examples: failures.slice(0, 3).map(f => ({
                    leadId: f.leadId,
                    error: f.error
                }))
            })),
            recommendedActions: failedLeads.slice(0, 10).map(f => ({
                leadId: f.leadId,
                testCommand: `node test-single-lead.js ${f.leadId}`,
                priority: f.errorType === 'validation' ? 'high' : 'medium'
            }))
        };
        
        fs.writeFileSync(resultsFile, JSON.stringify(detailedResults, null, 2));
        console.log(`\n💾 Detailed results saved to: ${resultsFile}`);
        
        // Recommendations
        console.log('\n' + '='.repeat(80));
        console.log('🎯 RECOMMENDATIONS');
        console.log('='.repeat(80));
        
        if (failedLeads.length > 0) {
            console.log('\n📋 IMMEDIATE ACTIONS:');
            console.log('1. 🔍 Test individual failing leads:');
            failedLeads.slice(0, 5).forEach(failure => {
                console.log(`   node test-single-lead.js ${failure.leadId}`);
            });
            
            const topErrorType = Object.entries(errorsByType || {}).sort((a, b) => b[1].length - a[1].length)[0];
            if (topErrorType) {
                console.log(`\n2. 🎯 Focus on ${topErrorType[0]} errors first (${topErrorType[1].length} leads affected)`);
            }
            
            console.log('\n3. 🔧 Fix data issues in Airtable for validation errors');
            console.log('4. 📈 Re-run this test after fixes to verify improvements');
        } else {
            console.log('\n🎉 EXCELLENT! All leads passed local validation.');
            console.log('The production failures might be due to:');
            console.log('- Network timeouts during API calls');
            console.log('- Temporary service unavailability');
            console.log('- Rate limiting on external APIs');
            console.log('\nRecommend monitoring production logs for specific error patterns.');
        }
        
        return {
            totalLeads: allLeads.length,
            failedLeads: failedLeads,
            successfulLeads: successfulLeads,
            resultsFile: resultsFile
        };
        
    } catch (error) {
        console.error('❌ Error in local batch test:', error.message);
        console.log('\nDebug info:');
        console.log(`Error stack: ${error.stack}`);
        throw error;
    }
}

// Run the identification test
if (require.main === module) {
    identifyFailingLeads()
        .then(results => {
            console.log(`\n✅ Local batch test completed. Found ${results.failedLeads.length} potential failures out of ${results.totalLeads} leads.`);
            if (results.failedLeads.length > 0) {
                console.log(`📁 Detailed results saved to: ${results.resultsFile}`);
                console.log('\n🚀 Next step: Test individual failing leads using the commands shown above.');
            }
        })
        .catch(error => {
            console.error('❌ Local batch test failed:', error.message);
            process.exit(1);
        });
}

module.exports = { identifyFailingLeads };
