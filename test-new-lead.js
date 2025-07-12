// Test script for new lead creation
const axios = require('axios');

async function testCreateLead() {
  try {
    const testData = {
      firstName: 'Test',
      lastName: 'User',
      source: 'Follow-Up Personally',
      status: 'On The Radar',
      linkedinProfileUrl: 'https://linkedin.com/in/testuser',
      notes: 'Test lead created via API test'
    };

    console.log('Testing lead creation with data:', testData);

    const response = await axios.post('https://pb-webhook-server.onrender.com/api/linkedin/leads', testData, {
      params: {
        client: 'Guy-Wilson'
      },
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    console.log('Success! Created lead:', response.data);
  } catch (error) {
    console.error('Error creating lead:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Message:', error.message);
  }
}

testCreateLead();
