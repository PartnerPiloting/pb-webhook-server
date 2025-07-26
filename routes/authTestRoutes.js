const express = require('express');
const router = express.Router();
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

router.get('/test', authenticateUserWithTestMode, (req, res) => {
  try {
    const response = {
      status: 'success',
      message: 'Authentication successful!',
      client: {
        clientId: req.client.clientId,
        clientName: req.client.clientName,
        status: req.client.status,
        airtableBaseId: req.client.airtableBaseId,
        serviceLevel: req.client.serviceLevel
      },
      authentication: {
        wpUserId: req.wpUserId || 'test mode',
        testMode: req.testMode || false
      },
      features: {
        leadSearch: true,
        leadManagement: true,
        postScoring: req.client.serviceLevel >= 2,
        topScoringPosts: req.client.serviceLevel >= 2
      }
    };

    console.log('Auth Test: Success for', req.client.clientName);
    res.json(response);

  } catch (error) {
    console.error('Auth Test: Error', error);
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
    console.error('WordPress Test: Error', error);
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
router.get('/service-level-test/:level', authenticateUserWithTestMode, (req, res) => {
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
    console.error('Service Level Test: Error', error);
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

module.exports = router;
