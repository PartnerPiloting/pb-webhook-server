const https = require('https');

async function testDeanHobinHarvest() {
  try {
    console.log('🧪 Triggering test harvest for Dean Hobin with debug logging...');
    
    const url = 'https://pb-webhook-server-staging.onrender.com/api/apify/process-client';
    const payload = JSON.stringify({
      clientId: 'Dean-Hobin',
      maxBatches: 1,  // Just one batch for testing
      batchSize: 3    // Small batch size
    });
    
    console.log('📤 Sending request to:', url);
    console.log('📤 Payload:', payload);
    
    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PB_WEBHOOK_SECRET || 'your-secret-key'}`
        }
      };
      
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('\n📥 Response Status:', res.statusCode);
          try {
            const result = JSON.parse(data);
            console.log('📥 Response Data:', JSON.stringify(result, null, 2));
            
            if (res.statusCode === 200 && result.runId) {
              console.log('\n✅ Test harvest initiated successfully!');
              console.log(`🔍 Watch for webhook logs containing run ID: ${result.runId}`);
              console.log('🔍 Look for [DEBUG] PBPostsSync entries in staging logs');
            } else {
              console.log('\n❌ Test harvest failed:', result);
            }
            resolve(result);
          } catch (error) {
            console.log('📥 Raw Response:', data);
            resolve({ raw: data });
          }
        });
      });
      
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    
  } catch (error) {
    console.error('❌ Error triggering test harvest:', error.message);
  }
}

testDeanHobinHarvest();