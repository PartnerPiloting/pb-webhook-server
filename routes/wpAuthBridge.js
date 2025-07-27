const express = require('express');
const router = express.Router();
const axios = require('axios');
const clientService = require('../services/clientService');

/**
 * WordPress Authentication Bridge
 * This endpoint accepts requests from the portal and validates the user
 * against WordPress, then returns appropriate authentication data
 */

/**
 * Check if user is authenticated with WordPress and get their profile
 * This endpoint is called by the frontend to automatically authenticate users
 */
router.get('/check-wp-auth', async (req, res) => {
  try {
    console.log('WP Auth Bridge: Checking WordPress authentication...');
    
    // Method 1: Check for authentication token (from ASH redirect)
    const authToken = req.query.token || req.headers['x-auth-token'];
    if (authToken) {
      console.log('WP Auth Bridge: Found authentication token, validating...');
      // TODO: Implement token validation with ASH
      // For now, we'll implement the cookie-based method and add token support later
    }
    
    // Method 2: Extract cookies from the request
    const cookies = req.headers.cookie;
    if (!cookies) {
      console.log('WP Auth Bridge: No cookies provided');
      return res.status(401).json({
        status: 'error',
        code: 'NO_COOKIES',
        message: 'No authentication cookies found',
        suggestion: 'Please access this portal through the ASH member dashboard'
      });
    }

    // Check if WordPress session cookies are present
    const hasWpCookies = cookies.includes('wordpress_logged_in') || 
                        cookies.includes('wp-settings') || 
                        cookies.includes('wordpress_sec');
    
    if (!hasWpCookies) {
      console.log('WP Auth Bridge: No WordPress cookies found');
      return res.status(401).json({
        status: 'error',
        code: 'NOT_LOGGED_IN_WP',
        message: 'Not logged into WordPress',
        suggestion: 'Please log into Australian Side Hustles first'
      });
    }

    const wpBaseUrl = process.env.WP_BASE_URL || 'https://australiansidehustles.com.au';
    const wpApiUrl = `${wpBaseUrl}/wp-json/wp/v2/users/me`;
    
    console.log(`WP Auth Bridge: Validating user with ${wpApiUrl}`);
    
    // Call WordPress API with the user's cookies
    const wpResponse = await axios.get(wpApiUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'LinkedIn-Portal-Auth-Bridge/1.0'
      },
      timeout: 10000
    });

    if (wpResponse.status === 200 && wpResponse.data) {
      const wpUser = wpResponse.data;
      console.log(`WP Auth Bridge: WordPress user validated: ${wpUser.name} (ID: ${wpUser.id})`);
      
      // Look up the client by WordPress User ID
      const client = await clientService.getClientByWpUserId(wpUser.id);
      
      if (!client) {
        console.log(`WP Auth Bridge: Client not found for WP User ID: ${wpUser.id}`);
        return res.status(403).json({
          status: 'error',
          code: 'CLIENT_NOT_FOUND',
          message: 'Your account does not have access to the LinkedIn portal. Please contact your coach.',
          wpUser: {
            id: wpUser.id,
            name: wpUser.name
          }
        });
      }

      if (client.status !== 'Active') {
        console.log(`WP Auth Bridge: Client found but inactive: ${client.clientName} (${client.status})`);
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
      console.log(`WP Auth Bridge: Authentication successful for ${client.clientName}`);
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
          wpUserId: wpUser.id,
          wpUserName: wpUser.name,
          authenticated: true
        },
        features: {
          leadSearch: true,
          leadManagement: true,
          postScoring: client.serviceLevel >= 2,
          topScoringPosts: client.serviceLevel >= 2
        }
      });
    }

    console.log('WP Auth Bridge: WordPress API returned invalid response');
    return res.status(401).json({
      status: 'error',
      code: 'WP_AUTH_FAILED',
      message: 'WordPress authentication failed'
    });

  } catch (error) {
    console.error('WP Auth Bridge: Error during authentication:', error.message);
    
    if (error.response?.status === 401) {
      return res.status(401).json({
        status: 'error',
        code: 'NOT_LOGGED_IN',
        message: 'Please log in to Australian Side Hustles to access this portal'
      });
    }

    return res.status(500).json({
      status: 'error',
      code: 'AUTH_ERROR',
      message: 'Authentication system error'
    });
  }
});

module.exports = router;
