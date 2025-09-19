// Quick test of Airtable connectivity on staging
require('dotenv').config();

const { getFetch } = require('./utils/safeFetch');
const fetch = getFetch();

const BASE_URL = 'https://pb-webhook-server-staging.onrender.com';
const SECRET = process.env.PB_WEBHOOK_SECRET;

(async () => {
  console.log('🔍 Testing Airtable connectivity on staging...');
  
  // Test 1: Try to get a run (this is what's failing)
  try {
    const response = await fetch(`${BASE_URL}/api/apify/runs/TdIquJ9dKwAQkoDbP`, {
      headers: { 'Authorization': `Bearer ${SECRET}` }
    });
    const result = await response.json();
    console.log('✅ Run lookup result:', result);
  } catch (error) {
    console.log('❌ Run lookup failed:', error.message);
  }
  
  // Test 2: Try to get client runs (also failing)
  try {
    const response = await fetch(`${BASE_URL}/api/apify/runs/client/dean-test?limit=1`, {
      headers: { 'Authorization': `Bearer ${SECRET}` }
    });
    const result = await response.json();
    console.log('✅ Client runs result:', result);
  } catch (error) {
    console.log('❌ Client runs failed:', error.message);
  }
})();