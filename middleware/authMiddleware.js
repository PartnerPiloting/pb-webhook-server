// middleware/authMiddleware.js
// Simple authentication middleware for WordPress user validation and client lookup

const { createLogger } = require('../utils/contextLogger');
const clientService = require('../services/clientService');
const { getCurrentWordPressUser } = require('../utils/wordpressAuth');
const { parseServiceLevel, hasServiceLevelAccess } = require('../utils/serviceLevel');

/**
 * WordPress User Authentication & Client Validation Middleware
 * 
 * Flow:
 * 1. Check if user is logged into WordPress
 * 2. If not logged in → "Please login to ASH"
 * 3. If logged in → Get WordPress User ID and lookup in Master Clients table
 * 4. If user found but Status = "Inactive" → "Hey you may need to check if your ASH account is Active"
 * 5. If user not found in table → "It looks like you may not have access to the ASH LinkedIn portal - can you check with the person who is coaching you"
 * 6. If user found and Status = "Active" → Allow access and set req.client
 */

/**
 * Extract WordPress User ID from request
 * @param {Object} req - Express request object
 * @returns {Promise<number|null>} WordPress User ID or null if not logged in
 */
async function getWordPressUserId(req) {
    const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'auth' });
    
    try {
        // For testing - check for test header or query parameter first
        // Handle case-insensitive wpUserId parameter (wpUserId, wpuserid, etc.)
        const testWpUserId = req.headers['x-wp-user-id'] || 
                           req.query.wpUserId || 
                           req.query.wpuserid || 
                           req.query.wpUserId;
        if (testWpUserId) {
            logger.debug('getWordPressUserId', `Using test WordPress User ID: ${testWpUserId}`);
            return parseInt(testWpUserId, 10);
        }

        // Real WordPress authentication - call WordPress API
        const wpUser = await getCurrentWordPressUser(req);
        
        if (wpUser && wpUser.id) {
            logger.process('getWordPressUserId', `WordPress user authenticated: ${wpUser.name} (ID: ${wpUser.id})`);
            return wpUser.id;
        }

        return null;

    } catch (error) {
        logger.error('getWordPressUserId', `Error getting WordPress User ID: ${error.message}`);
        return null;
    }
}

/**
 * Batch API Authentication Middleware
 * Secures batch processing endpoints with API key authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function authenticateBatchRequest(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    
    if (!apiKey) {
        logger.warn('Batch API: Missing API key', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            endpoint: req.path
        });
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'API key required for batch operations',
            code: 'BATCH_API_KEY_MISSING'
        });
    }
    
    if (apiKey !== process.env.BATCH_API_SECRET) {
        logger.warn('Batch API: Invalid API key', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            endpoint: req.path,
            providedKey: apiKey.substring(0, 4) + '...' // Log first 4 chars only
        });
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid API key for batch operations',
            code: 'BATCH_API_KEY_INVALID'
        });
    }
    
    logger.info('Batch API: Authorized batch request', { 
        endpoint: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });
    
    next();
}

/**
 * Main authentication middleware
 */
async function authenticateUser(req, res, next) {
    try {
        logger.info('AuthMiddleware: Starting user authentication');
        
        // Step 1: Check if user is logged into WordPress
        const wpUserId = await getWordPressUserId(req);
        
        if (!wpUserId) {
            logger.info('AuthMiddleware: User not logged in');
            return res.status(401).json({
                status: 'error',
                code: 'NOT_LOGGED_IN',
                message: 'Please log into australiansidehustles.com.au to proceed.',
                action: 'redirect_to_login',
                loginUrl: 'https://australiansidehustles.com.au/wp-login.php'
            });
        }
        
        logger.info(`AuthMiddleware: Found WordPress User ID: ${wpUserId}`);
        
        // Step 2: Lookup client by WordPress User ID
        const client = await clientService.getClientByWpUserId(wpUserId);
        
        if (!client) {
            logger.info(`AuthMiddleware: Client not found for WP User ID: ${wpUserId}`);
            return res.status(403).json({
                status: 'error',
                code: 'ACCESS_DENIED',
                message: 'Check with your coach to gain access.',
                details: 'Your Australian Side Hustles account was found, but you don\'t have access to the LinkedIn Portal yet.',
                supportContact: 'Please contact Australian Side Hustles Support for assistance.',
                wpUserId: wpUserId
            });
        }
        
        logger.info(`AuthMiddleware: Found client: ${client.clientName} (${client.clientId})`);
        
        // Step 3: Check if client is active
        if (client.status !== 'Active') {
            logger.info(`AuthMiddleware: Client ${client.clientId} is inactive (status: ${client.status})`);
            return res.status(403).json({
                status: 'error',
                code: 'ACCOUNT_INACTIVE',
                message: 'Looks like your membership may have expired - check with your coach.',
                details: 'Your LinkedIn Portal access is currently inactive.',
                supportContact: 'Please contact Australian Side Hustles Support to reactivate your access.',
                clientId: client.clientId,
                status: client.status
            });
        }
        
        // Step 4: Success - attach client to request and continue
        req.client = client;
        req.wpUserId = wpUserId;
        
        logger.info(`AuthMiddleware: Authentication successful for ${client.clientName}`);
        next();
        
    } catch (error) {
        logger.error('AuthMiddleware: Error during authentication:', error);
        
        // Handle different types of database/system errors
        if (error.message && error.message.includes('timeout')) {
            return res.status(503).json({
                status: 'error',
                code: 'SERVICE_TIMEOUT',
                message: 'System temporarily unavailable. Please try again in a moment.',
                supportContact: 'If this persists, contact Australian Side Hustles Support.',
                retryAfter: 30
            });
        }
        
        if (error.message && error.message.includes('connection')) {
            return res.status(503).json({
                status: 'error',
                code: 'SERVICE_UNAVAILABLE',
                message: 'Unable to verify access at this time. Please try again.',
                supportContact: 'If this continues, contact Australian Side Hustles Support.',
                retryAfter: 60
            });
        }
        
        // Generic error for unexpected issues
        return res.status(500).json({
            status: 'error',
            code: 'AUTH_ERROR',
            message: 'Authentication system error. Please try again.',
            supportContact: 'If this continues, contact Australian Side Hustles Support.',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal error'
        });
    }
}

/**
 * Service level middleware factory
 * @param {number} requiredLevel - Required service level
 * @returns {Function} Express middleware
 */
function requireServiceLevel(requiredLevel) {
    return (req, res, next) => {
        if (!req.client) {
            return res.status(401).json({
                status: 'error',
                code: 'NOT_AUTHENTICATED',
                message: 'Authentication required'
            });
        }

        if (!hasServiceLevelAccess(req.client, requiredLevel)) {
            return res.status(403).json({
                status: 'error',
                code: 'SERVICE_LEVEL_REQUIRED',
                message: `This feature requires service level ${requiredLevel} or higher. Your current level is ${req.client.serviceLevel}.`,
                currentLevel: req.client.serviceLevel,
                requiredLevel: requiredLevel
            });
        }

        next();
    };
}

/**
 * Optional middleware that allows bypassing auth for testing
 * Looks for a test client ID in query params
 */
async function authenticateUserWithTestMode(req, res, next) {
    try {
        // Check for test mode
        const testClientId = req.query.testClient;
        if (testClientId) {
            logger.info(`AuthMiddleware: Test mode activated for client: ${testClientId}`);
            const client = await clientService.getClientById(testClientId);
            
            if (!client) {
                return res.status(404).json({
                    status: 'error',
                    code: 'TEST_CLIENT_NOT_FOUND',
                    message: `Test client ${testClientId} not found`
                });
            }
            
            if (client.status !== 'Active') {
                return res.status(403).json({
                    status: 'error',
                    code: 'TEST_CLIENT_INACTIVE',
                    message: `Test client ${testClientId} is not active`
                });
            }
            
            req.client = client;
            req.testMode = true;
            logger.info(`AuthMiddleware: Test mode successful for ${client.clientName}`);
            return next();
        }
        
        // Fall back to normal authentication
        return authenticateUser(req, res, next);
        
    } catch (error) {
        logger.error('AuthMiddleware: Error during test authentication:', error);
        return res.status(500).json({
            status: 'error',
            code: 'AUTH_ERROR',
            message: 'Authentication system error. Please try again.',
            details: error.message
        });
    }
}

module.exports = {
    authenticateUser,
    authenticateUserWithTestMode,
    requireServiceLevel,
    getWordPressUserId,
    authenticateBatchRequest
};
