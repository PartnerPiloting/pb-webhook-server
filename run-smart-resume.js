// run-smart-resume.js
const fetch = require('node-fetch');

async function triggerSmartResume() {
  try {
    console.log('Triggering Smart Resume process...');
    const response = await fetch('https://pb-webhook-server-staging.onrender.com/smart-resume-client-by-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'Diamond9753!!@@pb'
      },
      body: JSON.stringify({
        stream: 1
      })
    });

    const data = await response.json();
    console.log('Response:', JSON.stringify(data, null, 2));
    return data;
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