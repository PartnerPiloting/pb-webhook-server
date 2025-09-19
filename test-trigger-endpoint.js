// Add this to routes/apiAndJobRoutes.js as a simple test trigger

// GET /api/test/trigger-dean-harvest
// Simple endpoint to trigger Dean Hobin harvest for testing
router.get('/api/test/trigger-dean-harvest', async (req, res) => {
  try {
    // Only allow in staging/development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Not available in production' });
    }
    
    const { getAllActiveClients } = require('../services/clientService');
    const activeClients = await getAllActiveClients();
    const deanClient = activeClients.find(c => c.clientId === 'Dean-Hobin' && Number(c.serviceLevel) >= 2);
    
    if (!deanClient) {
      return res.json({ error: 'Dean Hobin not found or not level >=2' });
    }
    
    // Trigger small harvest for Dean Hobin only
    const baseUrl = process.env.API_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const processUrl = `${baseUrl}/api/apify/process-client`;
    
    const payload = {
      clientId: 'Dean-Hobin',
      maxBatches: 1,
      batchSize: 3
    };
    
    console.log(`[test-trigger] Calling ${processUrl} for Dean-Hobin`);
    
    const fetch = require('node-fetch');
    const response = await fetch(processUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    res.json({
      status: 'triggered',
      client: 'Dean-Hobin', 
      processResult: result,
      instructions: 'Watch staging logs for [DEBUG] PBPostsSync entries'
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});