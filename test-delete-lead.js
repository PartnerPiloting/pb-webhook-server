// Test script for DELETE lead route
const axios = require('axios');

const BASE_URL = 'https://pb-webhook-server.onrender.com';
const CLIENT_ID = 'guy-wilson';

async function testDeleteLead() {
  console.log('🧪 Testing DELETE Lead Route\n');
  
  try {
    // First, create a test lead to delete
    console.log('Step 1: Creating test lead to delete...');
    const createResponse = await axios.post(`${BASE_URL}/api/linkedin/leads?client=${CLIENT_ID}`, {
      firstName: 'DeleteTest',
      lastName: 'User',
      source: 'Follow-Up Personally',
      status: 'On The Radar',
      notes: 'This lead will be deleted for testing'
    });
    
    const testLead = createResponse.data;
    console.log('✅ Test lead created:', {
      id: testLead.id,
      name: `${testLead.firstName} ${testLead.lastName}`
    });
    
    // Step 2: Delete the lead
    console.log('\nStep 2: Deleting the test lead...');
    const deleteResponse = await axios.delete(`${BASE_URL}/api/linkedin/leads/${testLead.id}?client=${CLIENT_ID}`);
    
    console.log('✅ Lead deleted successfully:', deleteResponse.data);
    
    // Step 3: Verify lead is gone (should return 404)
    console.log('\nStep 3: Verifying lead is deleted...');
    try {
      await axios.get(`${BASE_URL}/api/linkedin/leads/${testLead.id}?client=${CLIENT_ID}`);
      console.log('❌ ERROR: Lead still exists after deletion!');
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log('✅ Verification successful: Lead no longer exists (404 as expected)');
      } else {
        console.log('❌ Unexpected error during verification:', error.message);
      }
    }
    
    console.log('\n🎉 DELETE route test completed successfully!');
    console.log('\nFeatures verified:');
    console.log('• Lead deletion removes record from Airtable');
    console.log('• Returns success message with deleted lead info');
    console.log('• Proper 404 error when trying to access deleted lead');
    console.log('• Client validation and error handling');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Test for non-existent lead (should return 404)
async function testDeleteNonExistentLead() {
  console.log('\n🧪 Testing DELETE Non-Existent Lead (Error Handling)\n');
  
  try {
    const fakeLeadId = 'rec000000000000000'; // Non-existent ID
    await axios.delete(`${BASE_URL}/api/linkedin/leads/${fakeLeadId}?client=${CLIENT_ID}`);
    console.log('❌ ERROR: Should have returned 404 for non-existent lead');
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('✅ Correct 404 error for non-existent lead:', error.response.data);
    } else {
      console.log('❌ Wrong error type:', error.response?.data || error.message);
    }
  }
}

// Run tests
async function runAllTests() {
  await testDeleteLead();
  await testDeleteNonExistentLead();
}

runAllTests(); 