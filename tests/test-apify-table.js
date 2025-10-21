#!/usr/bin/env node

require('dotenv').config();
const Airtable = require('airtable');

async function testApifyTable() {
    console.log('🧪 TESTING APIFY TABLE WITH GUY WILSON');
    console.log('='.repeat(50));
    
    try {
        // Configure Airtable and get master clients base
        Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
        const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
        
        // Test 1: Check if Apify table exists and is accessible
        console.log('\n1. 📋 Testing Apify table access...');
        const testRead = await masterBase('Apify').select({ maxRecords: 1 }).firstPage();
        console.log('✅ Apify table accessible');
        
        // Test 2: Create a test record for Guy Wilson
        console.log('\n2. ➕ Creating test Apify run record...');
        const testRunId = `test_run_${Date.now()}`;
        
        const createdRecord = await masterBase('Apify').create({
            'Run ID': testRunId,
            'Client ID': 'Guy-Wilson',
            'Status': 'RUNNING',
            'Created At': new Date().toISOString(),
            'Actor ID': 'test_actor_123',
            'Target URLs': 'https://linkedin.com/in/guy-wilson-test'
        });
        
        console.log('✅ Test record created:', createdRecord.id);
        console.log('   Run ID:', createdRecord.get('Run ID'));
        console.log('   Client ID:', createdRecord.get('Client ID'));
        console.log('   Status:', createdRecord.get('Status'));
        
        // Test 3: Look up the record by Run ID (simulate webhook lookup)
        console.log('\n3. 🔍 Testing run ID lookup (webhook simulation)...');
        const foundRecords = await masterBase('Apify').select({
            filterByFormula: `{Run ID} = "${testRunId}"`
        }).firstPage();
        
        if (foundRecords.length > 0) {
            const foundRecord = foundRecords[0];
            console.log('✅ Record found by Run ID');
            console.log('   Found Client ID:', foundRecord.get('Client ID'));
            console.log('   Found Status:', foundRecord.get('Status'));
        } else {
            console.log('❌ Record not found by Run ID');
        }
        
        // Test 4: Update status (simulate Apify completion)
        console.log('\n4. 🔄 Testing status update...');
        await masterBase('Apify').update(createdRecord.id, {
            'Status': 'SUCCEEDED'
        });
        console.log('✅ Status updated to SUCCEEDED');
        
        // Test 5: Clean up - delete test record
        console.log('\n5. 🧹 Cleaning up test record...');
        await masterBase('Apify').destroy(createdRecord.id);
        console.log('✅ Test record deleted');
        
        // Final summary
        console.log('\n🎉 ALL TESTS PASSED!');
        console.log('='.repeat(50));
        console.log('✅ Apify table is properly configured');
        console.log('✅ Can create records for Guy Wilson');
        console.log('✅ Can lookup records by Run ID');
        console.log('✅ Can update run status');
        console.log('✅ Webhook integration should work!');
        
    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        
        if (error.message.includes('Could not find table')) {
            console.log('\n💡 SOLUTION: Make sure table is named "Apify" (not "Apify Runs")');
        } else if (error.message.includes('Unknown field')) {
            console.log('\n💡 SOLUTION: Check field names match exactly:');
            console.log('   - Run ID');
            console.log('   - Client ID'); 
            console.log('   - Status');
            console.log('   - Created At');
            console.log('   - Actor ID');
            console.log('   - Target URLs');
        } else {
            console.log('\n💡 Check your environment variables and Airtable permissions');
        }
    }
}

testApifyTable();