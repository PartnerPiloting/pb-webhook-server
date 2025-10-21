const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'route' });
// Removed old error logger - now using production issue tracking
const logCriticalError = async () => {};
const { authenticateUserWithTestMode } = require('../middleware/authMiddleware');
const { testWordPressConnection } = require('../utils/wordpressAuth');

/**
 * Test endpoint to verify authentication is working
 * Usage examples:
 * 
 * Test Mode (for development):
 * GET /api/auth/test?testClient=Guy-Wilson
 * 
 * WordPress User ID Mode (production):
 * GET /api/auth/test
 * Headers: X-WP-User-ID: 1
 * or
 * GET /api/auth/test?wpUserId=1
 * 
 * WordPress Basic Auth Mode:
 * GET /api/auth/test
 * Headers: Authorization: Basic <base64(username:password)>
 */

router.get('/test', authenticateUserWithTestMode, async (req, res) => {
  try {
    logger.info('Auth Test: Building response for client:', req.client.clientName);
    logger.info('Auth Test: Client object:', JSON.stringify(req.client, null, 2));
    
    const response = {
      status: 'success',
      message: 'Authentication successful!',
      client: {
        clientId: req.client.clientId || 'unknown',
        clientName: req.client.clientName || 'unknown',
        status: req.client.status || 'unknown',
        airtableBaseId: req.client.airtableBaseId || null,
        serviceLevel: req.client.serviceLevel || 1
      },
      authentication: {
        wpUserId: req.wpUserId || 'test mode',
        testMode: req.testMode || false
      },
      features: {
        leadSearch: true,
        leadManagement: true,
        postScoring: (req.client.serviceLevel || 1) >= 2,
        topScoringPosts: (req.client.serviceLevel || 1) >= 2
      }
    };

    logger.info('Auth Test: Response object constructed:', JSON.stringify(response, null, 2));
    logger.info('Auth Test: Sending response for', req.client.clientName);
    res.json(response);

  } catch (error) {
    logger.error('Auth Test: Error', error);
    await logCriticalError(error, req).catch(() => {});
    res.status(500).json({
      status: 'error',
      message: 'Test endpoint error',
      details: error.message
    });
  }
});

/**
 * WordPress connection test endpoint
 */
router.get('/wordpress-test', async (req, res) => {
  try {
    const isConnected = await testWordPressConnection();
    
    res.json({
      status: isConnected ? 'success' : 'error',
      connected: isConnected,
      message: isConnected ? 'WordPress connection successful' : 'WordPress connection failed',
      wpBaseUrl: process.env.WP_BASE_URL || process.env.NEXT_PUBLIC_WP_BASE_URL || 'Not configured'
    });

  } catch (error) {
    logger.error('WordPress Test: Error', error);
    await logCriticalError(error, req).catch(() => {});
    res.status(500).json({
      status: 'error',
      connected: false,
      message: 'WordPress test error',
      details: error.message
    });
  }
});

/**
 * Service level test endpoint
 */
router.get('/service-level-test/:level', authenticateUserWithTestMode, async (req, res) => {
  try {
    const requiredLevel = parseInt(req.params.level, 10);
    const hasAccess = req.client.serviceLevel >= requiredLevel;
    
    res.json({
      status: hasAccess ? 'success' : 'error',
      hasAccess: hasAccess,
      message: hasAccess 
        ? `Access granted for service level ${requiredLevel}` 
        : `Access denied. Required: ${requiredLevel}, Current: ${req.client.serviceLevel}`,
      client: {
        clientName: req.client.clientName,
        currentServiceLevel: req.client.serviceLevel,
        requiredServiceLevel: requiredLevel
      }
    });

  } catch (error) {
    logger.error('Service Level Test: Error', error);
    await logCriticalError(error, req).catch(() => {});
    res.status(500).json({
      status: 'error',
      message: 'Service level test error',
      details: error.message
    });
  }
});

/**
 * Health check endpoint that doesn't require authentication
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'Authentication system is running'
  });
});

/**
 * Simple test endpoint to compare with the main test endpoint
 * This will help us identify where the JSON corruption is happening
 */
router.get('/simple', (req, res) => {
  logger.info('Auth Simple Test: Creating simple response');
  const response = {
    status: 'success',
    message: 'Simple test successful!',
    test: true
  };
  logger.info('Auth Simple Test: Response object:', JSON.stringify(response));
  res.json(response);
});

module.exports = router;
