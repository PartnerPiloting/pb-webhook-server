/**
 * Simple WordPress User ID Authentication
 * 
 * Since cross-domain cookies don't work reliably, this endpoint allows
 * authentication via WordPress User ID passed as a parameter.
 * 
 * Usage:
 * https://portal-url.com/?wpUserId=123
 * 
 * The portal will validate this user ID exists and is active in the Client Master table.
 */

const express = require('express');
const router = express.Router();
const clientService = require('../services/clientService');

/**
 * Authenticate user by WordPress User ID
 * This is the most reliable method for cross-domain authentication
 */
router.get('/auth-by-wp-id', async (req, res) => {
  try {
    const wpUserId = req.query.wpUserId || req.query.wpuserid || req.query.id;
    
    if (!wpUserId) {
      console.log('WP ID Auth: No WordPress User ID provided');
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_WP_USER_ID',
        message: 'WordPress User ID is required',
        usage: 'Add ?wpUserId=YOUR_WP_USER_ID to the URL'
      });
    }

    const userId = parseInt(wpUserId, 10);
    if (isNaN(userId) || userId <= 0) {
      console.log(`WP ID Auth: Invalid WordPress User ID: ${wpUserId}`);
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_WP_USER_ID', 
        message: 'WordPress User ID must be a positive number'
      });
    }

    console.log(`WP ID Auth: Looking up client for WordPress User ID: ${userId}`);
    
    // Look up the client by WordPress User ID
    const client = await clientService.getClientByWpUserId(userId);
    
    if (!client) {
      console.log(`WP ID Auth: Client not found for WP User ID: ${userId}`);
      return res.status(403).json({
        status: 'error',
        code: 'CLIENT_NOT_FOUND',
        message: 'Your account does not have access to the LinkedIn portal. Please contact your coach.',
        wpUserId: userId
      });
    }

    if (client.status !== 'Active') {
      console.log(`WP ID Auth: Client found but inactive: ${client.clientName} (${client.status})`);
      return res.status(403).json({
        status: 'error',
        code: 'CLIENT_INACTIVE',
        message: 'Your account is not active. Please check your ASH account status.',
        client: {
          clientId: client.clientId,
          clientName: client.clientName,
          status: client.status
        }
      });
    }

    // Success! Return client profile
    console.log(`WP ID Auth: Authentication successful for ${client.clientName} (WP User ID: ${userId})`);
    return res.json({
      status: 'success',
      message: 'Authentication successful',
      client: {
        clientId: client.clientId,
        clientName: client.clientName,
        status: client.status,
        airtableBaseId: client.airtableBaseId,
        serviceLevel: client.serviceLevel
      },
      authentication: {
        wpUserId: userId,
        method: 'wp-user-id',
        authenticated: true
      },
      features: {
        leadSearch: true,
        leadManagement: true,
        postScoring: client.serviceLevel >= 2,
        topScoringPosts: client.serviceLevel >= 2
      }
    });

  } catch (error) {
    console.error('WP ID Auth: Error during authentication:', error.message);
    
    return res.status(500).json({
      status: 'error',
      code: 'AUTH_ERROR',
      message: 'Authentication system error'
    });
  }
});

module.exports = router;
