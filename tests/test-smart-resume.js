// test-smart-resume.js
const fetch = require('node-fetch');

async function triggerSmartResume() {
  try {
    const url = 'https://pb-webhook-server-staging.onrender.com/smart-resume-client-by-client';
    console.log('Triggering Smart Resume process for Guy-Wilson...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'Diamond9753!!@@pb'
      },
      body: JSON.stringify({
        stream: 1,
        clientFilter: 'Guy-Wilson'
      })
    });
    
    const responseText = await response.text();
    try {
      const data = JSON.parse(responseText);
      console.log('Response:', JSON.stringify(data, null, 2));
      return data;
    } catch (e) {
      console.log('Raw response text:', responseText);
      return { raw: responseText };
    }
  } catch (error) {
    console.error('Error triggering Smart Resume:', error.message);
    throw error;
  }
}

triggerSmartResume()
  .then(result => {
    console.log('Smart Resume triggered successfully!');
  })
  .catch(error => {
    console.error('Failed to trigger Smart Resume:', error);
    process.exit(1);
  });