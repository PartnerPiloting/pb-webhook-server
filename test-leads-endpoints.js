// Test leads endpoints specifically
const axios = require('axios');

async function testLeadsEndpoints() {
  try {
    console.log('Testing GET /leads/search endpoint...');
    
    const response = await axios.get('https://pb-webhook-server.onrender.com/api/linkedin/leads/search', {
      params: {
        client: 'Guy-Wilson',
        q: 'test'
      },
      timeout: 15000
    });

    console.log('Success! Search endpoint working, found', response.data.length, 'leads');
  } catch (error) {
    console.error('Error with search endpoint:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Message:', error.message);
  }

  try {
    console.log('\nTesting POST /leads endpoint...');
    
    const testData = {
      firstName: 'Test',
      lastName: 'User',
      source: 'Follow-Up Personally',
      status: 'On The Radar',
      notes: 'Test lead'
    };

    const response = await axios.post('https://pb-webhook-server.onrender.com/api/linkedin/leads', testData, {
      params: {
        client: 'Guy-Wilson'
      },
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    console.log('Success! Created lead:', response.data);
  } catch (error) {
    console.error('Error with create endpoint:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Message:', error.message);
  }
}

testLeadsEndpoints();
