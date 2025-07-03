// middleware/wordpressAuth.js
// Authentication middleware for LinkedIn extension and web portal
// Handles WordPress Application Password authentication and client mapping

const axios = require('axios');
const clientService = require('../../services/clientService');

/**
 * WordPress Application Password Authentication Middleware
 * Validates WordPress credentials and maps user to client ID
 */
async function authenticateWordPressUser(req, res, next) {
    try {
        // Extract Basic Auth credentials
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ 
                error: 'Authentication required',
                message: 'Please provide WordPress credentials' 
            });
        }

        // Decode credentials
        const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
        const [username, password] = credentials.split(':');

        if (!username || !password) {
            return res.status(401).json({ 
                error: 'Invalid credentials format',
                message: 'Username and password required' 
            });
        }

        // Validate against WordPress
        const wpResponse = await validateWordPressCredentials(username, password);
        if (!wpResponse.valid) {
            return res.status(401).json({ 
                error: 'Invalid credentials',
                message: 'WordPress authentication failed' 
            });
        }

        // Check PMpro subscription
        const subscriptionValid = await validatePMproSubscription(wpResponse.userId);
        if (!subscriptionValid) {
            return res.status(403).json({ 
                error: 'Subscription required',
                message: 'Active subscription required for access',
                renewalUrl: 'https://australiansidehustles.com.au/membership'
            });
        }

        // Map user to client ID
        const clientId = await mapUserToClientId(wpResponse.userId);
        if (!clientId) {
            return res.status(403).json({ 
                error: 'No client mapping',
                message: 'User not associated with any client account' 
            });
        }

        // Validate client exists and is active
        const client = await clientService.getClientById(clientId);
        if (!client || client.status !== 'Active') {
            return res.status(403).json({ 
                error: 'Inactive client',
                message: 'Client account is not active' 
            });
        }

        // Add client info to request for downstream use
        req.auth = {
            userId: wpResponse.userId,
            username: username,
            clientId: clientId,
            clientName: client.clientName,
            airtableBaseId: client.airtableBaseId
        };

        console.log(`Authenticated user ${username} → Client ${clientId} (${client.clientName})`);
        next();

    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ 
            error: 'Authentication system error',
            message: 'Please try again later' 
        });
    }
}

/**
 * Validate WordPress Application Password credentials
 * @param {string} username - WordPress username
 * @param {string} password - Application password
 * @returns {Promise<Object>} Validation result with user ID
 */
async function validateWordPressCredentials(username, password) {
    try {
        // Call WordPress REST API to validate credentials
        const wpApiUrl = process.env.WORDPRESS_API_URL || 'https://australiansidehustles.com.au/wp-json';
        
        const response = await axios.get(`${wpApiUrl}/wp/v2/users/me`, {
            auth: {
                username: username,
                password: password
            },
            timeout: 10000
        });

        if (response.status === 200 && response.data.id) {
            return {
                valid: true,
                userId: response.data.id,
                userEmail: response.data.email,
                userDisplayName: response.data.name
            };
        }

        return { valid: false };

    } catch (error) {
        console.error('WordPress validation error:', error.message);
        return { valid: false };
    }
}

/**
 * Validate PMpro subscription status
 * @param {number} userId - WordPress user ID
 * @returns {Promise<boolean>} True if subscription is active
 */
async function validatePMproSubscription(userId) {
    try {
        // Call custom WordPress endpoint to check PMpro status
        const wpApiUrl = process.env.WORDPRESS_API_URL || 'https://australiansidehustles.com.au/wp-json';
        
        const response = await axios.get(`${wpApiUrl}/linkedin-extension/v1/subscription/${userId}`, {
            headers: {
                'X-API-Secret': process.env.LINKEDIN_EXTENSION_SECRET
            },
            timeout: 5000
        });

        return response.data.active === true;

    } catch (error) {
        console.error('PMpro validation error:', error.message);
        return false;
    }
}

/**
 * Map WordPress user ID to Client ID
 * @param {number} userId - WordPress user ID
 * @returns {Promise<string|null>} Client ID or null
 */
async function mapUserToClientId(userId) {
    try {
        // Call custom WordPress endpoint to get client mapping
        const wpApiUrl = process.env.WORDPRESS_API_URL || 'https://australiansidehustles.com.au/wp-json';
        
        const response = await axios.get(`${wpApiUrl}/linkedin-extension/v1/client-mapping/${userId}`, {
            headers: {
                'X-API-Secret': process.env.LINKEDIN_EXTENSION_SECRET
            },
            timeout: 5000
        });

        return response.data.clientId || null;

    } catch (error) {
        console.error('Client mapping error:', error.message);
        return null;
    }
}

/**
 * Optional: WordPress cookie-based auth for web portal
 * (Alternative to Application Password for browser sessions)
 */
async function authenticateWordPressCookie(req, res, next) {
    try {
        // Check for WordPress authentication cookie
        const wpCookie = req.cookies.wordpress_logged_in || req.cookies.wordpress_sec;
        
        if (!wpCookie) {
            return res.status(401).json({ 
                error: 'Authentication required',
                loginUrl: 'https://australiansidehustles.com.au/wp-login.php'
            });
        }

        // Validate cookie with WordPress
        const validation = await validateWordPressCookie(wpCookie);
        if (!validation.valid) {
            return res.status(401).json({ 
                error: 'Session expired',
                loginUrl: 'https://australiansidehustles.com.au/wp-login.php'
            });
        }

        // Continue with same subscription and client mapping logic
        const subscriptionValid = await validatePMproSubscription(validation.userId);
        if (!subscriptionValid) {
            return res.status(403).json({ 
                error: 'Subscription required',
                message: 'Active subscription required for access',
                renewalUrl: 'https://australiansidehustles.com.au/membership'
            });
        }

        const clientId = await mapUserToClientId(validation.userId);
        if (!clientId) {
            return res.status(403).json({ 
                error: 'No client mapping',
                message: 'User not associated with any client account' 
            });
        }

        const client = await clientService.getClientById(clientId);
        if (!client || client.status !== 'Active') {
            return res.status(403).json({ 
                error: 'Inactive client',
                message: 'Client account is not active' 
            });
        }

        req.auth = {
            userId: validation.userId,
            username: validation.username,
            clientId: clientId,
            clientName: client.clientName,
            airtableBaseId: client.airtableBaseId
        };

        next();

    } catch (error) {
        console.error('Cookie authentication error:', error);
        res.status(500).json({ 
            error: 'Authentication system error',
            message: 'Please try again later' 
        });
    }
}

async function validateWordPressCookie(cookie) {
    // Implementation would depend on WordPress cookie validation
    // This might require a custom WordPress endpoint
    try {
        const wpApiUrl = process.env.WORDPRESS_API_URL || 'https://australiansidehustles.com.au/wp-json';
        
        const response = await axios.post(`${wpApiUrl}/linkedin-extension/v1/validate-session`, {
            cookie: cookie
        }, {
            headers: {
                'X-API-Secret': process.env.LINKEDIN_EXTENSION_SECRET
            },
            timeout: 5000
        });

        return {
            valid: response.data.valid,
            userId: response.data.userId,
            username: response.data.username
        };

    } catch (error) {
        console.error('Cookie validation error:', error.message);
        return { valid: false };
    }
}

module.exports = {
    authenticateWordPressUser,
    authenticateWordPressCookie,
    validateWordPressCredentials,
    validatePMproSubscription,
    mapUserToClientId
};
