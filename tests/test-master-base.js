// Test Master Clients base access specifically
require('dotenv').config();
const Airtable = require('airtable');

(async () => {
  console.log('🧪 Testing Master Clients base access...');
  
  try {
    Airtable.configure({
      apiKey: process.env.AIRTABLE_API_KEY
    });
    
    const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    // Test 1: Read Clients table (same as warm pinger)
    console.log('📋 Testing Clients table (warm pinger path)...');
    const clients = await base('Clients').select({ maxRecords: 1 }).firstPage();
    console.log('✅ Clients table works:', clients.length, 'records');
    
    // Test 2: Read Apify Runs table (failing path)
    console.log('📋 Testing Apify Runs table (failing path)...');
    const runs = await base('Apify Runs').select({ maxRecords: 1 }).firstPage();
    console.log('✅ Apify Runs table works:', runs.length, 'records');
    
    // Test 3: Check Apify Runs table structure
    if (runs.length > 0) {
      console.log('🔍 Apify Runs fields:', Object.keys(runs[0].fields));
    }
    
  } catch (error) {
    console.log('❌ Master base access failed:', error.message);
    console.log('   Full error:', error);
  }
})();