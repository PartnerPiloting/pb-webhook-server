#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');

async function checkProductionData() {
    console.log('🔍 CHECKING ACTUAL PRODUCTION DATA');
    console.log('='.repeat(80));
    
    try {
        const base = airtableClient;
        
        console.log('\n1. 📊 Looking for leads with "Failed" text in AI Score field...');
        
        const failedScoreLeads = await base('Leads').select({
            filterByFormula: "SEARCH('Failed', {AI Score}) > 0",
            maxRecords: 20,
            fields: ['Name', 'AI Score', 'Scoring Status', 'Date Scored', 'LinkedIn URL']
        }).firstPage();
        
        console.log(`Found ${failedScoreLeads.length} leads with "Failed" in AI Score field`);
        
        if (failedScoreLeads.length > 0) {
            console.log('\n   📋 SAMPLE FAILED AI SCORES:');
            failedScoreLeads.slice(0, 10).forEach((lead, index) => {
                const name = lead.get('Name') || 'Unknown';
                const aiScore = lead.get('AI Score');
                const status = lead.get('Scoring Status');
                const dateScored = lead.get('Date Scored');
                
                console.log(`   ${index + 1}. ${name}`);
                console.log(`      🎯 AI Score: "${aiScore}"`);
                console.log(`      📊 Status: "${status}"`);
                console.log(`      📅 Date: ${dateScored}`);
                console.log('');
            });
        } else {
            console.log('   ✅ No leads found with "Failed" text in AI Score field');
        }
        
        // Check for numeric failures
        console.log('\n2. 📊 Looking for leads with numeric scores but Failed status...');
        
        const numericFailures = await base('Leads').select({
            filterByFormula: "AND(IS_NUMBER({AI Score}), SEARCH('Failed', {Scoring Status}) > 0)",
            maxRecords: 20,
            fields: ['Name', 'AI Score', 'Scoring Status', 'Date Scored', 'LinkedIn URL']
        }).firstPage();
        
        console.log(`Found ${numericFailures.length} leads with numeric AI Score but Failed status`);
        
        if (numericFailures.length > 0) {
            console.log('\n   📋 SAMPLE NUMERIC SCORES WITH FAILED STATUS:');
            numericFailures.slice(0, 10).forEach((lead, index) => {
                const name = lead.get('Name') || 'Unknown';
                const aiScore = lead.get('AI Score');
                const status = lead.get('Scoring Status');
                const dateScored = lead.get('Date Scored');
                
                console.log(`   ${index + 1}. ${name}`);
                console.log(`      🎯 AI Score: ${aiScore} (${typeof aiScore})`);
                console.log(`      📊 Status: "${status}"`);
                console.log(`      📅 Date: ${dateScored}`);
                console.log('');
            });
        }
        
        // Check recent scoring activity
        console.log('\n3. 📊 Looking at recent scoring activity...');
        
        const recentScoring = await base('Leads').select({
            filterByFormula: "AND({Date Scored} != '', {Date Scored} >= '2025-01-01')",
            sort: [{ field: 'Date Scored', direction: 'desc' }],
            maxRecords: 30,
            fields: ['Name', 'AI Score', 'Scoring Status', 'Date Scored', 'LinkedIn URL']
        }).firstPage();
        
        console.log(`Found ${recentScoring.length} leads scored since 2025-01-01`);
        
        // Categorize recent results
        const categories = {
            successful: [],
            failed: [],
            error: [],
            other: []
        };
        
        recentScoring.forEach(lead => {
            const aiScore = lead.get('AI Score');
            const status = lead.get('Scoring Status');
            
            if (typeof aiScore === 'number' && status === 'Scored') {
                categories.successful.push(lead);
            } else if (status && status.includes('Failed')) {
                categories.failed.push(lead);
            } else if (status && status.includes('Error')) {
                categories.error.push(lead);
            } else {
                categories.other.push(lead);
            }
        });
        
        console.log('\n   📊 RECENT SCORING BREAKDOWN:');
        console.log(`      ✅ Successful: ${categories.successful.length}`);
        console.log(`      ❌ Failed: ${categories.failed.length}`);
        console.log(`      🚨 Error: ${categories.error.length}`);
        console.log(`      ❓ Other: ${categories.other.length}`);
        
        if (categories.failed.length > 0) {
            console.log('\n   📋 RECENT FAILED LEADS:');
            categories.failed.slice(0, 5).forEach((lead, index) => {
                const name = lead.get('Name') || 'Unknown';
                const aiScore = lead.get('AI Score');
                const status = lead.get('Scoring Status');
                const dateScored = lead.get('Date Scored');
                
                console.log(`   ${index + 1}. ${name}`);
                console.log(`      🎯 AI Score: "${aiScore}" (${typeof aiScore})`);
                console.log(`      📊 Status: "${status}"`);
                console.log(`      📅 Date: ${dateScored}`);
                console.log('');
            });
        }
        
        // Look for the "Failed: 91" pattern specifically
        console.log('\n4. 🔍 Looking specifically for "Failed: 91" pattern...');
        
        const failed91 = await base('Leads').select({
            filterByFormula: "SEARCH('Failed: 91', CONCATENATE({AI Score}, {Scoring Status})) > 0",
            maxRecords: 10,
            fields: ['Name', 'AI Score', 'Scoring Status', 'Date Scored', 'LinkedIn URL', 'AI Profile Assessment']
        }).firstPage();
        
        console.log(`Found ${failed91.length} leads matching "Failed: 91" pattern`);
        
        if (failed91.length > 0) {
            console.log('\n   🎯 FOUND "FAILED: 91" MATCHES:');
            failed91.forEach((lead, index) => {
                const name = lead.get('Name') || 'Unknown';
                const aiScore = lead.get('AI Score');
                const status = lead.get('Scoring Status');
                const assessment = lead.get('AI Profile Assessment');
                
                console.log(`   ${index + 1}. ${name}`);
                console.log(`      🎯 AI Score: "${aiScore}"`);
                console.log(`      📊 Status: "${status}"`);
                console.log(`      📝 Assessment: ${assessment?.substring(0, 100)}...`);
                console.log('');
            });
        } else {
            console.log('   ✅ No exact "Failed: 91" pattern found');
        }
        
        // Summary analysis
        console.log('\n📋 ANALYSIS SUMMARY');
        console.log('='.repeat(80));
        
        console.log('\n🔍 FINDINGS:');
        if (failedScoreLeads.length > 0) {
            console.log(`   • Found ${failedScoreLeads.length} leads with "Failed" text in AI Score field`);
            console.log('   • This suggests errors are being written to AI Score field');
        }
        
        if (numericFailures.length > 0) {
            console.log(`   • Found ${numericFailures.length} leads with numeric scores but Failed status`);
            console.log('   • This suggests scoring succeeded but status marked as failed');
        }
        
        const successRate = categories.successful.length / (categories.successful.length + categories.failed.length + categories.error.length) * 100;
        
        console.log(`   • Recent success rate: ${successRate.toFixed(1)}%`);
        console.log(`   • Total recent activity: ${recentScoring.length} leads`);
        
        console.log('\n💡 LIKELY EXPLANATION FOR "FAILED: 91":');
        if (failed91.length > 0) {
            console.log('   • Found exact "Failed: 91" pattern in data');
            console.log('   • This is likely error text written to AI Score field');
        } else if (numericFailures.length > 0) {
            console.log('   • "Failed: 91" likely means score of 91 but status marked as Failed');
        } else {
            console.log('   • Pattern not found in current data - may be historical issue');
        }
        
    } catch (error) {
        console.error('❌ Error checking production data:', error);
    }
}

checkProductionData();
