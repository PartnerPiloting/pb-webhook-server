// Test endpoint to debug JSON serialization issue
const express = require('express');
const router = express.Router();

router.get('/debug-json', (req, res) => {
  try {
    // Create the exact same response structure as authTestRoutes.js
    const response = {
      status: 'success',
      message: 'Authentication successful!',
      client: {
        clientId: 'test-client',
        clientName: 'Test Client',
        status: 'Active',
        airtableBaseId: 'test-base',
        serviceLevel: 2
      },
      authentication: {
        wpUserId: 1,
        testMode: false
      },
      features: {
        leadSearch: true,
        leadManagement: true,
        postScoring: true,
        topScoringPosts: true
      }
    };

    console.log('Debug JSON: Response object:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    console.error('Debug JSON: Error', error);
    res.status(500).json({
      status: 'error',
      message: 'Debug endpoint error',
      details: error.message
    });
  }
});

module.exports = router;
