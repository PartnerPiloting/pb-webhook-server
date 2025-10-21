// Test the createLead API service function
// Note: This would normally run in a browser environment with the API service

import { createLead } from './linkedin-messaging-followup-next/services/api.js';

// Test data
const testLeadData = {
  firstName: 'API Test',
  lastName: 'User',
  source: 'Follow-Up Personally',
  status: 'On The Radar',
  email: 'apitest@example.com',
  notes: 'Created via API service test'
};

// Test the createLead function
async function testCreateLeadAPI() {
  try {
    console.log('🧪 Testing createLead API service function...');
    console.log('📤 Test data:', testLeadData);
    
    const result = await createLead(testLeadData);
    
    console.log('✅ SUCCESS: Lead created via API service!');
    console.log('📋 Response:', result);
    console.log('🔍 Field mapping check:');
    console.log(`   • ID: ${result.id}`);
    console.log(`   • Spaced format - First Name: ${result['First Name']}`);
    console.log(`   • CamelCase format - firstName: ${result.firstName}`);
    console.log(`   • LinkedIn URL: ${result.linkedinProfileUrl || result['LinkedIn Profile URL']}`);
    
  } catch (error) {
    console.log('❌ FAILED:', error.message);
  }
}

// Run test
testCreateLeadAPI(); 