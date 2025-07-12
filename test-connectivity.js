// Test basic API connectivity
const axios = require('axios');

async function testBasicConnectivity() {
  try {
    console.log('Testing basic API connectivity...');
    
    const response = await axios.get('https://pb-webhook-server.onrender.com/api/linkedin/debug', {
      timeout: 15000
    });

    console.log('Success! API is reachable:', response.data);
  } catch (error) {
    console.error('Error connecting to API:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Message:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('Connection refused - server may be down');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('Connection timed out - server may be slow or unavailable');
    }
  }
}

testBasicConnectivity();
