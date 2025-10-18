// services/pmproMembershipService.js
// PMPro Membership Service for checking WordPress user memberships

const axios = require('axios');
const Airtable = require('airtable');
const { createLogger } = require('../utils/contextLogger');
const { MASTER_TABLES } = require('../constants/airtableUnifiedConstants');

const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'pmpro-membership' 
});

// Cache for valid PMPro levels (refresh every 5 minutes)
let validLevelsCache = null;
let validLevelsCacheTimestamp = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get valid PMPro membership levels from Airtable
 * @returns {Promise<Array<number>>} Array of valid PMPro level IDs
 */
async function getValidPMProLevels() {
    try {
        // Return cached data if valid
        if (validLevelsCache && validLevelsCacheTimestamp && 
            (Date.now() - validLevelsCacheTimestamp) < CACHE_DURATION_MS) {
            logger.info(`Using cached valid PMPro levels (${validLevelsCache.length} levels)`);
            return validLevelsCache;
        }

        // Initialize Master Clients base
        if (!process.env.MASTER_CLIENTS_BASE_ID) {
            throw new Error('MASTER_CLIENTS_BASE_ID not configured');
        }
        if (!process.env.AIRTABLE_API_KEY) {
            throw new Error('AIRTABLE_API_KEY not configured');
        }

        Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
        const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);

        logger.info('Fetching valid PMPro levels from Airtable...');
        
        const records = await base(MASTER_TABLES.VALID_PMPRO_LEVELS)
            .select()
            .all();

        // Extract level IDs (assuming field is named "Level ID" or similar)
        // Adjust field name if needed based on your actual Airtable schema
        const levels = records
            .map(record => {
                // Try multiple possible field names
                const levelId = record.get('Level ID') || 
                               record.get('PMPro Level ID') || 
                               record.get('ID') ||
                               record.get('Level');
                
                // Convert to number if it's a string
                return typeof levelId === 'string' ? parseInt(levelId, 10) : levelId;
            })
            .filter(level => !isNaN(level) && level > 0);

        logger.info(`Found ${levels.length} valid PMPro levels: ${levels.join(', ')}`);
        
        // Update cache
        validLevelsCache = levels;
        validLevelsCacheTimestamp = Date.now();

        return levels;

    } catch (error) {
        logger.error('Error fetching valid PMPro levels from Airtable:', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Get WordPress user's PMPro membership level
 * Uses WordPress REST API with admin credentials
 * @param {number} wpUserId - WordPress user ID
 * @returns {Promise<Object>} Membership info { hasValidMembership: boolean, levelId: number|null, levelName: string|null, error: string|null }
 */
async function checkUserMembership(wpUserId) {
    try {
        // Validate environment variables
        const wpBaseUrl = process.env.WP_BASE_URL;
        const wpUsername = process.env.WP_ADMIN_USERNAME;
        const wpPassword = process.env.WP_ADMIN_PASSWORD;

        if (!wpBaseUrl) {
            throw new Error('WP_BASE_URL not configured in environment');
        }
        if (!wpUsername || !wpPassword) {
            throw new Error('WP_ADMIN_USERNAME or WP_ADMIN_PASSWORD not configured');
        }

        // Create Basic Auth header
        const authString = Buffer.from(`${wpUsername}:${wpPassword}`).toString('base64');
        const headers = {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json'
        };

        logger.info(`Checking PMPro membership for WordPress User ID: ${wpUserId}`);

        // First, check if the user exists in WordPress
        const userUrl = `${wpBaseUrl}/wp-json/wp/v2/users/${wpUserId}`;
        
        let wpUser;
        try {
            const userResponse = await axios.get(userUrl, { headers, timeout: 10000 });
            wpUser = userResponse.data;
            logger.info(`WordPress user found: ${wpUser.name} (ID: ${wpUser.id})`);
        } catch (userError) {
            if (userError.response?.status === 404) {
                logger.error(`WordPress User ID ${wpUserId} does not exist in WordPress`);
                return {
                    hasValidMembership: false,
                    levelId: null,
                    levelName: null,
                    error: `WordPress User ID ${wpUserId} not found`
                };
            }
            throw userError;
        }

        // Now check PMPro membership using PMPro REST API
        // PMPro typically adds endpoints like: /wp-json/pmpro/v1/get_membership_level_for_user
        // Or we can use: /wp-json/wp/v2/users/{id} and check meta fields
        
        // Option 1: Try PMPro REST API endpoint (if available)
        let membershipLevel = null;
        try {
            const pmproUrl = `${wpBaseUrl}/wp-json/pmpro/v1/get_membership_level_for_user?user_id=${wpUserId}`;
            const pmproResponse = await axios.get(pmproUrl, { headers, timeout: 10000 });
            
            if (pmproResponse.data && pmproResponse.data.id) {
                membershipLevel = {
                    id: parseInt(pmproResponse.data.id, 10),
                    name: pmproResponse.data.name || 'Unknown'
                };
                logger.info(`PMPro membership found via API: Level ${membershipLevel.id} (${membershipLevel.name})`);
            }
        } catch (pmproError) {
            // PMPro API might not be available, try user meta approach
            logger.info('PMPro REST API not available, trying user meta approach...');
        }

        // Option 2: If PMPro API not available, check user meta fields
        if (!membershipLevel) {
            try {
                // Get user with context=edit to see meta fields
                const userMetaUrl = `${wpBaseUrl}/wp-json/wp/v2/users/${wpUserId}?context=edit`;
                const metaResponse = await axios.get(userMetaUrl, { headers, timeout: 10000 });
                
                // PMPro stores membership level in user meta as 'membership_level' or 'pmpro_membership_level'
                const meta = metaResponse.data.meta || {};
                const levelId = meta.membership_level || meta.pmpro_membership_level;
                
                if (levelId && levelId !== '0' && levelId !== 0) {
                    membershipLevel = {
                        id: parseInt(levelId, 10),
                        name: 'Member' // We can't get the name from meta easily
                    };
                    logger.info(`PMPro membership found via user meta: Level ${membershipLevel.id}`);
                }
            } catch (metaError) {
                logger.warn('Could not retrieve user meta fields:', metaError.message);
            }
        }

        // If still no membership found, user doesn't have an active membership
        if (!membershipLevel) {
            logger.info(`No active PMPro membership found for WordPress User ID ${wpUserId}`);
            return {
                hasValidMembership: false,
                levelId: null,
                levelName: null,
                error: 'No active PMPro membership found'
            };
        }

        // Check if the membership level is in the valid levels list
        const validLevels = await getValidPMProLevels();
        const isValid = validLevels.includes(membershipLevel.id);

        logger.info(`Membership validation: Level ${membershipLevel.id} is ${isValid ? 'VALID' : 'INVALID'}`);

        return {
            hasValidMembership: isValid,
            levelId: membershipLevel.id,
            levelName: membershipLevel.name,
            error: isValid ? null : `Membership level ${membershipLevel.id} is not in valid levels list`
        };

    } catch (error) {
        logger.error(`Error checking PMPro membership for WordPress User ID ${wpUserId}:`, {
            error: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        
        return {
            hasValidMembership: false,
            levelId: null,
            levelName: null,
            error: `API Error: ${error.message}`
        };
    }
}

/**
 * Test WordPress connection and PMPro API availability
 * @returns {Promise<Object>} Test results
 */
async function testWordPressConnection() {
    try {
        const wpBaseUrl = process.env.WP_BASE_URL;
        const wpUsername = process.env.WP_ADMIN_USERNAME;
        const wpPassword = process.env.WP_ADMIN_PASSWORD;

        if (!wpBaseUrl || !wpUsername || !wpPassword) {
            return {
                success: false,
                error: 'WordPress credentials not configured',
                details: {
                    wpBaseUrl: !!wpBaseUrl,
                    wpUsername: !!wpUsername,
                    wpPassword: !!wpPassword
                }
            };
        }

        const authString = Buffer.from(`${wpUsername}:${wpPassword}`).toString('base64');
        const headers = {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json'
        };

        // Test basic WordPress API
        const wpApiUrl = `${wpBaseUrl}/wp-json/wp/v2`;
        const wpResponse = await axios.get(wpApiUrl, { headers, timeout: 5000 });

        // Test PMPro API endpoint
        let pmproAvailable = false;
        try {
            const pmproUrl = `${wpBaseUrl}/wp-json/pmpro/v1`;
            await axios.get(pmproUrl, { headers, timeout: 5000 });
            pmproAvailable = true;
        } catch (e) {
            // PMPro API might not be available
        }

        return {
            success: true,
            wpApiAvailable: wpResponse.status === 200,
            pmproApiAvailable,
            baseUrl: wpBaseUrl
        };

    } catch (error) {
        return {
            success: false,
            error: error.message,
            details: error.response?.data
        };
    }
}

module.exports = {
    getValidPMProLevels,
    checkUserMembership,
    testWordPressConnection
};
