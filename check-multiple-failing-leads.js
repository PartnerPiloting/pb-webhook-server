#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');

async function checkMultipleFailingLeads() {
    console.log('🔍 CHECKING MULTIPLE FAILING LEADS FOR PATTERNS');
    console.log('='.repeat(80));
    console.log('Goal: Find patterns in failed leads vs successful ones');
    
    try {
        const base = airtableClient;
        
        console.log('\n1. 📊 Fetching leads with different statuses...');
        
        // Get all leads and categorize by status
        const allLeads = [];
        await base('Leads').select({
            fields: ['Name', 'Company', 'Scoring Status', 'Profile Full JSON'],
            maxRecords: 100
        }).eachPage((records, fetchNextPage) => {
            allLeads.push(...records);
            fetchNextPage();
        });
        
        console.log(`   📋 Total leads analyzed: ${allLeads.length}`);
        
        // Categorize leads
        const categories = {
            failed: [],
            successful: [],
            pending: [],
            other: []
        };
        
        allLeads.forEach(record => {
            const status = record.get('Scoring Status') || 'No Status';
            const profileJSON = record.get('Profile Full JSON');
            
            const leadInfo = {
                id: record.id,
                name: record.get('Name') || 'Unknown',
                company: record.get('Company') || 'Unknown',
                status: status,
                jsonLength: profileJSON ? profileJSON.length : 0,
                hasJSON: !!profileJSON,
                jsonValid: false
            };
            
            // Test JSON validity
            if (profileJSON) {
                try {
                    JSON.parse(profileJSON);
                    leadInfo.jsonValid = true;
                } catch (e) {
                    leadInfo.jsonValid = false;
                    leadInfo.parseError = e.message;
                }
            }
            
            if (status.includes('Failed') || status.includes('Error')) {
                categories.failed.push(leadInfo);
            } else if (status.includes('Scored') || status.includes('Complete')) {
                categories.successful.push(leadInfo);
            } else if (status.includes('To Be Scored')) {
                categories.pending.push(leadInfo);
            } else {
                categories.other.push(leadInfo);
            }
        });
        
        console.log('\n2. 📈 Status Distribution:');
        console.log(`   ❌ Failed: ${categories.failed.length}`);
        console.log(`   ✅ Successful: ${categories.successful.length}`);
        console.log(`   ⏳ Pending: ${categories.pending.length}`);
        console.log(`   ❓ Other: ${categories.other.length}`);
        
        console.log('\n3. 🔍 Failed Leads Analysis:');
        if (categories.failed.length > 0) {
            console.log('   📋 Failed leads details:');
            categories.failed.forEach((lead, index) => {
                console.log(`   ${index + 1}. ${lead.name} (${lead.company})`);
                console.log(`      ID: ${lead.id}`);
                console.log(`      Status: "${lead.status}"`);
                console.log(`      JSON Length: ${lead.jsonLength} chars`);
                console.log(`      JSON Valid: ${lead.jsonValid ? '✅' : '❌'}`);
                if (!lead.jsonValid && lead.parseError) {
                    console.log(`      Parse Error: ${lead.parseError}`);
                }
                console.log('');
            });
            
            // Test each failed lead against production API
            console.log('\n4. 🌐 Testing Failed Leads Against Production API:');
            
            for (let i = 0; i < Math.min(categories.failed.length, 3); i++) {
                const lead = categories.failed[i];
                console.log(`\n   Testing ${lead.name} (${lead.id})...`);
                
                try {
                    const https = require('https');
                    const options = {
                        hostname: 'pb-webhook-server.onrender.com',
                        port: 443,
                        path: `/score-lead?recordId=${lead.id}`,
                        method: 'GET',
                        headers: { 'Accept': 'application/json' }
                    };
                    
                    const result = await new Promise((resolve, reject) => {
                        const req = https.request(options, (res) => {
                            let data = '';
                            res.on('data', (chunk) => { data += chunk; });
                            res.on('end', () => {
                                resolve({ statusCode: res.statusCode, body: data });
                            });
                        });
                        req.on('error', reject);
                        req.end();
                    });
                    
                    console.log(`      Status: ${result.statusCode}`);
                    
                    if (result.statusCode === 500) {
                        try {
                            const errorData = JSON.parse(result.body);
                            console.log(`      Error: ${errorData.error}`);
                            
                            // Check for JSON position errors
                            const positionMatch = errorData.error.match(/position (\d+)/);
                            if (positionMatch) {
                                console.log(`      Error Position: ${positionMatch[1]}`);
                            }
                        } catch (e) {
                            console.log(`      Raw Error: ${result.body}`);
                        }
                    } else {
                        console.log(`      Response: ${result.body.substring(0, 100)}...`);
                    }
                    
                } catch (apiError) {
                    console.log(`      API Error: ${apiError.message}`);
                }
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } else {
            console.log('   ✅ No failed leads found!');
        }
        
        console.log('\n5. 📊 JSON Length Comparison:');
        
        const failedLengths = categories.failed.map(l => l.jsonLength).filter(l => l > 0);
        const successfulLengths = categories.successful.map(l => l.jsonLength).filter(l => l > 0);
        
        if (failedLengths.length > 0) {
            const avgFailed = failedLengths.reduce((a, b) => a + b, 0) / failedLengths.length;
            const maxFailed = Math.max(...failedLengths);
            const minFailed = Math.min(...failedLengths);
            console.log(`   ❌ Failed leads JSON: avg ${Math.round(avgFailed)}, min ${minFailed}, max ${maxFailed}`);
        }
        
        if (successfulLengths.length > 0) {
            const avgSuccessful = successfulLengths.reduce((a, b) => a + b, 0) / successfulLengths.length;
            const maxSuccessful = Math.max(...successfulLengths);
            const minSuccessful = Math.min(...successfulLengths);
            console.log(`   ✅ Successful leads JSON: avg ${Math.round(avgSuccessful)}, min ${minSuccessful}, max ${maxSuccessful}`);
        }
        
        console.log('\n6. 🎯 Pattern Analysis:');
        
        // Look for patterns
        const failedWithInvalidJSON = categories.failed.filter(l => !l.jsonValid);
        const failedWithValidJSON = categories.failed.filter(l => l.jsonValid);
        
        console.log(`   📊 Failed leads with invalid JSON: ${failedWithInvalidJSON.length}`);
        console.log(`   📊 Failed leads with valid JSON: ${failedWithValidJSON.length}`);
        
        if (failedWithValidJSON.length > 0) {
            console.log('   🚨 CRITICAL: Some failed leads have valid JSON locally!');
            console.log('   💡 This suggests a race condition or data inconsistency');
        }
        
    } catch (error) {
        console.error('❌ Error checking multiple leads:', error.message);
    }
}

checkMultipleFailingLeads();
