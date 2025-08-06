#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');

async function investigateLeadsStatus() {
    console.log('🔍 INVESTIGATING LEAD STATUSES');
    console.log('='.repeat(80));
    
    try {
        // Get Guy Wilson's base (the one with failing leads)
        const base = airtableClient(process.env.AIRTABLE_BASE_ID);
        
        console.log('\n1. 📊 Checking ALL lead statuses in Guy Wilson base...');
        
        // Get all leads and group by status
        const allLeads = [];
        await base('Leads').select({
            fields: ['Name', 'Headline', 'Company', 'Scoring Status', 'Lead Score', 'Profile Full JSON'],
            maxRecords: 1000
        }).eachPage((records, fetchNextPage) => {
            allLeads.push(...records);
            fetchNextPage();
        });
        
        console.log(`   📋 Total leads found: ${allLeads.length}`);
        
        // Group by status
        const statusGroups = {};
        allLeads.forEach(record => {
            const status = record.get('Scoring Status') || 'No Status';
            if (!statusGroups[status]) {
                statusGroups[status] = [];
            }
            statusGroups[status].push(record);
        });
        
        console.log('\n2. 📈 Status Distribution:');
        Object.entries(statusGroups).forEach(([status, records]) => {
            console.log(`   ${status}: ${records.length} leads`);
            
            // Show first few examples for each status
            if (records.length > 0) {
                console.log(`      Examples:`);
                records.slice(0, 3).forEach(record => {
                    console.log(`         • ${record.get('Name')} (${record.get('Company')})`);
                });
                if (records.length > 3) {
                    console.log(`         ... and ${records.length - 3} more`);
                }
            }
        });
        
        // Check specifically for the leads that should be failing
        console.log('\n3. 🎯 Looking for specific failing leads...');
        
        const failedLeads = allLeads.filter(record => {
            const status = record.get('Scoring Status');
            return status && (
                status.includes('Failed') || 
                status.includes('Error') ||
                status === 'To Be Scored'
            );
        });
        
        console.log(`   🚨 Found ${failedLeads.length} leads with failed/error/pending status:`);
        
        failedLeads.forEach((record, index) => {
            console.log(`\n   ${index + 1}. ${record.get('Name')} (${record.get('Company')})`);
            console.log(`      Status: "${record.get('Scoring Status')}"`);
            console.log(`      Score: ${record.get('Lead Score') || 'None'}`);
            
            // Check for JSON corruption
            const profileJSON = record.get('Profile Full JSON');
            if (profileJSON) {
                try {
                    JSON.parse(profileJSON);
                    console.log(`      Profile JSON: ✅ Valid (${profileJSON.length} chars)`);
                } catch (parseError) {
                    console.log(`      Profile JSON: ❌ CORRUPTED!`);
                    console.log(`         Error: ${parseError.message}`);
                    
                    // Show the corrupted area around position 2486 if it matches
                    if (parseError.message.includes('2486')) {
                        console.log(`         🎯 This matches the production error!`);
                        const problemArea = profileJSON.substring(2480, 2500);
                        console.log(`         Problem area: "${problemArea}"`);
                    } else {
                        // Show first error area
                        const lines = profileJSON.split('\n');
                        if (lines.length >= 43) {
                            console.log(`         Line 43: "${lines[42]}"`);
                        }
                        const startPos = Math.max(0, profileJSON.indexOf(parseError.message.match(/position (\d+)/)?.[1] || '') - 20);
                        const problemArea = profileJSON.substring(startPos, startPos + 40);
                        console.log(`         Problem area: "${problemArea}"`);
                    }
                }
            } else {
                console.log(`      Profile JSON: ❌ Missing!`);
            }
        });
        
        // Look for the specific leads mentioned in our production test
        console.log('\n4. 🔎 Searching for specific production test leads...');
        const targetNames = [
            'Ella Rustamova',
            'Jessica Martin', 
            'David Wilson',
            'Sarah Johnson',
            'Michael Chen'
        ];
        
        targetNames.forEach(name => {
            const found = allLeads.find(record => 
                record.get('Name') && record.get('Name').toLowerCase().includes(name.toLowerCase())
            );
            
            if (found) {
                console.log(`   ✅ Found: ${found.get('Name')} - Status: "${found.get('Scoring Status')}"`);
                
                // Test JSON corruption for this specific lead
                const profileJSON = found.get('Profile Full JSON');
                if (profileJSON) {
                    try {
                        JSON.parse(profileJSON);
                        console.log(`      JSON: ✅ Valid`);
                    } catch (parseError) {
                        console.log(`      JSON: ❌ CORRUPTED - ${parseError.message}`);
                    }
                }
            } else {
                console.log(`   ❌ Not found: ${name}`);
            }
        });
        
    } catch (error) {
        console.error('❌ Error investigating leads:', error.message);
    }
}

investigateLeadsStatus();
