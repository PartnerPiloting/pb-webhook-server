// utils/wordpressAuth.js
// WordPress authentication utilities

const axios = require('axios');

/**
 * Get current WordPress user from WordPress REST API
 * @param {Object} req - Express request object
 * @returns {Object|null} WordPress user object with ID or null if not authenticated
 */
async function getCurrentWordPressUser(req) {
    try {
        // Extract WordPress credentials from headers
        const wpAuth = extractWordPressAuth(req);
        
        if (!wpAuth) {
            console.log('WordPress Auth: No authentication headers found');
            return null;
        }

        const wpBaseUrl = process.env.WP_BASE_URL || process.env.NEXT_PUBLIC_WP_BASE_URL;
        if (!wpBaseUrl) {
            console.error('WordPress Auth: WP_BASE_URL not configured');
            return null;
        }

        // Call WordPress REST API to get current user
        const wpApiUrl = `${wpBaseUrl}/wp-json/wp/v2/users/me`;
        
        console.log(`WordPress Auth: Calling ${wpApiUrl} to verify user`);
        
        const response = await axios.get(wpApiUrl, {
            headers: wpAuth.headers,
            timeout: 5000 // 5 second timeout
        });

        if (response.status === 200 && response.data) {
            console.log(`WordPress Auth: Successfully authenticated user ${response.data.id} (${response.data.name})`);
            return {
                id: response.data.id,
                name: response.data.name,
                email: response.data.email,
                roles: response.data.roles || [],
                capabilities: response.data.capabilities || {}
            };
        }

        console.log('WordPress Auth: Invalid response from WordPress API');
        return null;

    } catch (error) {
        if (error.response?.status === 401) {
            console.log('WordPress Auth: User not authenticated (401)');
            return null;
        }
        
        console.error('WordPress Auth: Error calling WordPress API:', error.message);
        return null;
    }
}

/**
 * Extract WordPress authentication from request headers
 * @param {Object} req - Express request object
 * @returns {Object|null} Authentication object or null
 */
function extractWordPressAuth(req) {
    // Method 1: Basic Auth (wpUsername + wpAppPassword)
    const basicAuth = req.headers['authorization'];
    if (basicAuth && basicAuth.startsWith('Basic ')) {
        return {
            type: 'basic',
            headers: {
                'Authorization': basicAuth,
                'Content-Type': 'application/json'
            }
        };
    }

    // Method 2: WordPress Nonce
    const wpNonce = req.headers['x-wp-nonce'];
    if (wpNonce) {
        return {
            type: 'nonce',
            headers: {
                'X-WP-Nonce': wpNonce,
                'Content-Type': 'application/json'
            }
        };
    }

    // Method 3: Session Cookie (if configured)
    const sessionCookie = req.headers['cookie'];
    if (sessionCookie && sessionCookie.includes('wordpress_logged_in')) {
        return {
            type: 'cookie',
            headers: {
                'Cookie': sessionCookie,
                'Content-Type': 'application/json'
            }
        };
    }

    return null;
}

/**
 * Test WordPress connection
 * @returns {boolean} True if WordPress is reachable
 */
async function testWordPressConnection() {
    try {
        const wpBaseUrl = process.env.WP_BASE_URL || process.env.NEXT_PUBLIC_WP_BASE_URL;
        if (!wpBaseUrl) {
            console.error('WordPress Test: WP_BASE_URL not configured');
            return false;
        }

        const wpApiUrl = `${wpBaseUrl}/wp-json/wp/v2`;
        
        const response = await axios.get(wpApiUrl, {
            timeout: 5000
        });

        console.log(`WordPress Test: Connection successful to ${wpApiUrl}`);
        return response.status === 200;

    } catch (error) {
        console.error('WordPress Test: Connection failed:', error.message);
        return false;
    }
}

module.exports = {
    getCurrentWordPressUser,
    extractWordPressAuth,
    testWordPressConnection
};
