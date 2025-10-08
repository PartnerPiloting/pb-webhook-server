// Test endpoint to debug JSON serialization issue
const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'route' });
// Removed old error logger - now using production issue tracking
const logCriticalError = async () => {};

router.get('/debug-json', async (req, res) => {
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

    logger.info('Debug JSON: Response object:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    logger.error('Debug JSON: Error', error);
    await logCriticalError(error, req).catch(() => {});
    res.status(500).json({
      status: 'error',
      message: 'Debug endpoint error',
      details: error.message
    });
  }
});

module.exports = router;
