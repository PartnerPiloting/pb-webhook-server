// middleware/authMiddleware.js
// Simple authentication middleware for WordPress user validation and client lookup

const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'auth' });
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
            logger.debug( `WordPress user authenticated: ${wpUser.name} (ID: ${wpUser.id})`);
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
 * Secure middleware for portal access
 * 
 * Authentication methods (in order of priority):
 * 1. Portal Token (?token=xxx) - Secure client-specific token
 * 2. Dev Key (?client=xxx&devKey=yyy) - Admin/developer access
 * 3. x-client-id header (internal API calls only, requires devKey in production)
 * 4. WordPress authentication (fallback)
 * 
 * Old-style ?client=xxx without devKey shows friendly message to contact coach.
 */
async function authenticateUserWithTestMode(req, res, next) {
    try {
        const devKey = process.env.PORTAL_DEV_KEY || process.env.PB_WEBHOOK_SECRET;
        
        // 1. Check for Portal Token (secure client access) - query param or header
        const portalToken = req.query.token || req.headers['x-portal-token'];
        if (portalToken) {
            logger.info(`AuthMiddleware: Portal token authentication attempt`);
            const client = await clientService.getClientByPortalToken(portalToken);
            
            if (!client) {
                return res.status(401).json({
                    status: 'error',
                    code: 'INVALID_TOKEN',
                    message: 'Invalid or expired access link. Please contact your coach for a new link.'
                });
            }
            
            if (client.status !== 'Active') {
                return res.status(403).json({
                    status: 'error',
                    code: 'CLIENT_INACTIVE',
                    message: 'Your account is not currently active. Please contact your coach.'
                });
            }
            
            req.client = client;
            req.testMode = false;
            req.authMethod = 'portalToken';
            logger.info(`AuthMiddleware: Portal token auth successful for ${client.clientName}`);
            return next();
        }
        
        // 2. Check for Dev Key (admin/developer access)
        const providedDevKey = req.query.devKey || req.headers['x-dev-key'];
        const clientId = req.query.testClient || req.query.client || req.query.clientId || req.headers['x-client-id'];
        
        if (clientId && providedDevKey) {
            // Validate dev key
            if (providedDevKey !== devKey) {
                logger.warn(`AuthMiddleware: Invalid dev key attempted for client: ${clientId}`);
                return res.status(401).json({
                    status: 'error',
                    code: 'INVALID_DEV_KEY',
                    message: 'Invalid developer key.'
                });
            }
            
            logger.info(`AuthMiddleware: Dev key access for client: ${clientId}`);
            const client = await clientService.getClientById(clientId);
            
            if (!client) {
                return res.status(404).json({
                    status: 'error',
                    code: 'CLIENT_NOT_FOUND',
                    message: `Client ${clientId} not found`
                });
            }
            
            req.client = client;
            req.testMode = true;
            req.authMethod = 'devKey';
            logger.info(`AuthMiddleware: Dev key auth successful for ${client.clientName}`);
            return next();
        }
        
        // 3. Check for old-style client ID without token/devKey (show friendly message)
        if (clientId && !providedDevKey && !portalToken) {
            logger.warn(`AuthMiddleware: Old-style client access attempted: ${clientId}`);
            return res.status(401).json({
                status: 'error',
                code: 'LINK_UPDATED',
                message: 'Your portal link has been updated for security. Please contact your coach for your new secure link, or check your email as it may have already been sent to you.',
                friendlyMessage: true
            });
        }
        
        // 4. Fall back to WordPress authentication
        return authenticateUser(req, res, next);
        
    } catch (error) {
        logger.error('AuthMiddleware: Error during authentication:', error);
        // Airtable outage (500 SERVER_ERROR or 503 SERVICE_UNAVAILABLE) - show user-friendly message
        const isAirtableOutage = (error.error === 'SERVER_ERROR' || error.error === 'SERVICE_UNAVAILABLE') ||
            (error.statusCode === 500 || error.statusCode === 503) ||
            (error.message && error.message.includes('Try again. If the problem persists'));
        if (isAirtableOutage) {
            return res.status(503).json({
                status: 'error',
                code: 'SERVICE_UNAVAILABLE',
                message: 'Our database service (Airtable) is experiencing a temporary outage. Please try again later.'
            });
        }
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
