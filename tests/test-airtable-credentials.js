// Test Airtable connectivity: Local vs Staging
require('dotenv').config();
const Airtable = require('airtable');

(async () => {
  console.log('🧪 Testing Airtable credentials...');
  
  // Test 1: Direct Airtable connection (same as staging uses)
  try {
    if (!process.env.AIRTABLE_API_KEY) {
      console.log('❌ AIRTABLE_API_KEY not found locally');
      return;
    }
    
    if (!process.env.MASTER_CLIENTS_BASE_ID) {
      console.log('❌ MASTER_CLIENTS_BASE_ID not found locally');
      return;
    }
    
    console.log('🔑 Using AIRTABLE_API_KEY:', process.env.AIRTABLE_API_KEY.substring(0, 10) + '...');
    console.log('🗄️  Using MASTER_CLIENTS_BASE_ID:', process.env.MASTER_CLIENTS_BASE_ID);
    
    Airtable.configure({
      apiKey: process.env.AIRTABLE_API_KEY
    });
    
    const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    // Try to read Apify Runs table (same as staging)
    console.log('📋 Testing Apify Runs table access...');
    const records = await base('Apify Runs').select({
      maxRecords: 1
    }).firstPage();
    
    console.log('✅ LOCAL: Airtable connection works! Found', records.length, 'records');
    
    // If we get here, local works but staging doesn't = token mismatch
    console.log('\n🎯 DIAGNOSIS: Local Airtable works, but staging fails');
    console.log('   → Staging server has different/expired AIRTABLE_API_KEY');
    console.log('   → Need to update environment variables on Render');
    
  } catch (error) {
    console.log('❌ LOCAL: Airtable connection failed:', error.message);
    
    if (error.message.includes('not authorized')) {
      console.log('   → Same error as staging - token is globally invalid');
    } else {
      console.log('   → Different error - staging might have different token');
    }
  }
})();