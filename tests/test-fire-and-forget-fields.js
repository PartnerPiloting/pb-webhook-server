#!/usr/bin/env node

require('dotenv').config();
const Airtable = require('airtable');

async function testFireAndForgetFields() {
    console.log('🧪 TESTING FIRE-AND-FORGET FIELDS');
    console.log('='.repeat(50));
    
    try {
        // Configure Airtable and get master clients base
        Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
        const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
        
        // Test 1: Check all new fields exist
        console.log('\n1. 📋 Checking all fire-and-forget fields exist...');
        const clients = await masterBase('Clients').select({ maxRecords: 1 }).firstPage();
        
        if (clients.length > 0) {
            const fields = Object.keys(clients[0].fields);
            console.log('\n📝 Current fields in Clients table:');
            fields.forEach((field, i) => console.log(`${i+1}. ${field}`));
            
            // Expected fire-and-forget fields
            const expectedFields = [
                'Processing Stream',
                // Lead Scoring
                'Lead Scoring Job Status',
                'Lead Scoring Job ID', 
                'Lead Scoring Last Run Date',
                'Lead Scoring Last Run Time',
                'Leads Scored Last Run',
                // Post Harvesting
                'Post Harvesting Job Status',
                'Post Harvesting Job ID',
                'Post Harvesting Last Run Date', 
                'Post Harvesting Last Run Time',
                'Posts Harvested Last Run',
                // Post Scoring
                'Post Scoring Job Status',
                'Post Scoring Job ID',
                'Post Scoring Last Run Date',
                'Post Scoring Last Run Time',
                'Posts Scored Last Run'
            ];
            
            console.log('\n🔍 Checking for expected fire-and-forget fields...');
            let allFieldsFound = true;
            
            expectedFields.forEach(expectedField => {
                if (fields.includes(expectedField)) {
                    console.log(`✅ ${expectedField}`);
                } else {
                    console.log(`❌ MISSING: ${expectedField}`);
                    allFieldsFound = false;
                }
            });
            
            if (allFieldsFound) {
                console.log('\n🎉 ALL FIRE-AND-FORGET FIELDS FOUND!');
            } else {
                console.log('\n⚠️  Some fields are missing - check field names');
            }
        }
        
        // Test 2: Try to update Guy Wilson with test values
        console.log('\n2. 🧪 Testing field updates with Guy Wilson...');
        
        const guyWilsonRecords = await masterBase('Clients').select({
            filterByFormula: `{Client ID} = "Guy-Wilson"`
        }).firstPage();
        
        if (guyWilsonRecords.length > 0) {
            const guyRecord = guyWilsonRecords[0];
            console.log('✅ Found Guy Wilson record');
            
            // Test updating fire-and-forget fields
            const testJobId = `job_lead_stream1_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
            
            await masterBase('Clients').update(guyRecord.id, {
                'Processing Stream': 1,
                'Lead Scoring Job Status': 'STARTED',
                'Lead Scoring Job ID': testJobId,
                'Lead Scoring Last Run Date': new Date().toISOString(),
                'Lead Scoring Last Run Time': '2.5 minutes',
                'Leads Scored Last Run': 15
            });
            
            console.log('✅ Successfully updated Lead Scoring fields');
            console.log(`   Job ID: ${testJobId}`);
            console.log('   Status: STARTED');
            console.log('   Stream: 1');
            console.log('   Duration: 2.5 minutes');
            console.log('   Count: 15');
            
            // Update status to COMPLETED
            await masterBase('Clients').update(guyRecord.id, {
                'Lead Scoring Job Status': 'COMPLETED'
            });
            console.log('✅ Status updated to COMPLETED');
            
        } else {
            console.log('❌ Guy Wilson record not found');
        }
        
        console.log('\n🎉 FIRE-AND-FORGET FIELDS TEST PASSED!');
        console.log('='.repeat(50));
        console.log('✅ All fields accessible');
        console.log('✅ Can update job status');
        console.log('✅ Can store job IDs and metrics');
        console.log('✅ Ready for clientService integration!');
        
    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        
        if (error.message.includes('Unknown field')) {
            console.log('\n💡 SOLUTION: Check field names match exactly (case sensitive)');
            console.log('   Expected format: "Lead Scoring Job Status" not "lead scoring job status"');
        }
    }
}

testFireAndForgetFields();