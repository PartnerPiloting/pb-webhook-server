// services/userPermissionsService.js
// Handle user permissions and feature access based on service levels

const clientService = require('./clientService');

/**
 * Get user permissions based on WordPress User ID
 * @param {number} wpUserId - WordPress User ID
 * @returns {Promise<Object>} User permissions and client info
 */
async function getUserPermissions(wpUserId) {
    try {
        // Get client by WordPress User ID
        const client = await clientService.getClientByWpUserId(wpUserId);
        
        if (!client) {
            return {
                authorized: false,
                reason: 'User not found in client list',
                permissions: {},
                client: null
            };
        }

        if (client.status !== 'Active') {
            return {
                authorized: false,
                reason: 'Client account is not active',
                permissions: {},
                client: client
            };
        }

        // Determine permissions based on service level
        const permissions = getPermissionsByServiceLevel(client.serviceLevel);

        return {
            authorized: true,
            permissions: permissions,
            client: client,
            serviceLevel: client.serviceLevel
        };

    } catch (error) {
        console.error('Error getting user permissions:', error);
        return {
            authorized: false,
            reason: 'System error checking permissions',
            permissions: {},
            client: null
        };
    }
}

/**
 * Check if user has access to a specific feature
 * @param {number} wpUserId - WordPress User ID
 * @param {string} feature - Feature name (e.g., 'posts', 'analytics')
 * @returns {Promise<Object>} Access result
 */
async function checkFeatureAccess(wpUserId, feature) {
    try {
        const userPermissions = await getUserPermissions(wpUserId);
        
        if (!userPermissions.authorized) {
            return {
                hasAccess: false,
                reason: userPermissions.reason,
                client: userPermissions.client
            };
        }

        const hasAccess = userPermissions.permissions[feature] === true;
        
        return {
            hasAccess: hasAccess,
            reason: hasAccess ? 'Access granted' : `Feature '${feature}' not included in service level ${userPermissions.serviceLevel}`,
            client: userPermissions.client,
            serviceLevel: userPermissions.serviceLevel
        };

    } catch (error) {
        console.error('Error checking feature access:', error);
        return {
            hasAccess: false,
            reason: 'System error checking feature access',
            client: null
        };
    }
}

/**
 * Get permissions based on service level
 * @param {number} serviceLevel - Service level (1, 2, 3, etc.)
 * @returns {Object} Permissions object
 */
function getPermissionsByServiceLevel(serviceLevel) {
    const permissions = {
        // Base features (available to all levels)
        leadSearch: true,
        followUpManager: true,
        
        // Premium features
        posts: false,
        analytics: false,
        exports: false,
        customReports: false
    };

    // Add features based on service level
    switch (serviceLevel) {
        case 1:
            // Basic: Only base features (already set above)
            break;
            
        case 2:
            // Premium: Add posts management
            permissions.posts = true;
            break;
            
        case 3:
            // Enterprise: Add analytics and exports
            permissions.posts = true;
            permissions.analytics = true;
            permissions.exports = true;
            break;
            
        case 4:
            // Ultimate: All features
            permissions.posts = true;
            permissions.analytics = true;
            permissions.exports = true;
            permissions.customReports = true;
            break;
            
        default:
            // Unknown service level, default to basic
            console.warn(`Unknown service level: ${serviceLevel}, defaulting to basic permissions`);
            break;
    }

    return permissions;
}

/**
 * Middleware to check feature access
 * @param {string} feature - Required feature
 * @returns {Function} Express middleware
 */
function requireFeatureAccess(feature) {
    return async (req, res, next) => {
        try {
            // Get WordPress User ID from auth
            const wpUserId = req.auth?.userId;
            
            if (!wpUserId) {
                return res.status(401).json({
                    error: 'Authentication required',
                    message: 'WordPress User ID not found in request'
                });
            }

            // Check feature access
            const accessResult = await checkFeatureAccess(wpUserId, feature);
            
            if (!accessResult.hasAccess) {
                return res.status(403).json({
                    error: 'Feature access denied',
                    message: accessResult.reason,
                    feature: feature,
                    upgradeUrl: 'https://australiansidehustles.com.au/membership'
                });
            }

            // Add permissions to request for downstream use
            req.userPermissions = await getUserPermissions(wpUserId);
            
            next();

        } catch (error) {
            console.error('Feature access middleware error:', error);
            res.status(500).json({
                error: 'Permission check failed',
                message: 'Unable to verify feature access'
            });
        }
    };
}

module.exports = {
    getUserPermissions,
    checkFeatureAccess,
    getPermissionsByServiceLevel,
    requireFeatureAccess
}; 