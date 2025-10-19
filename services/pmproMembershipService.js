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

        // Extract level IDs (handle a variety of Airtable field formats)
        // Accepts: numeric fields, string numbers, single-selects, arrays, or objects
        const levels = records
            .map(record => {
                // Try multiple possible field names (check "Membership Level" first)
                let raw = record.get('Membership Level') ||
                          record.get('Level ID') ||
                          record.get('PMPro Level ID') ||
                          record.get('ID') ||
                          record.get('Level') ||
                          record.get('Level ID (Number)');

                // If raw is an array (linked records or multi-select), try first element
                if (Array.isArray(raw) && raw.length > 0) {
                    raw = raw[0];
                }

                // If raw is an object (e.g., { id, name } or Airtable linked record), try common properties
                if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                    if (raw.id) raw = raw.id;
                    else if (raw.name) raw = raw.name;
                    else if (raw.fields && raw.fields['Level ID']) raw = raw.fields['Level ID'];
                    else raw = undefined;
                }

                // Normalize strings by trimming
                if (typeof raw === 'string') raw = raw.trim();

                // Convert to integer when possible
                const parsed = raw != null ? parseInt(raw, 10) : NaN;
                return Number.isInteger(parsed) ? parsed : NaN;
            })
            .filter(level => Number.isInteger(level) && level > 0);

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

        // Check PMPro membership directly - don't bother checking if user exists first
        // PMPro REST API will handle that for us
        // PMPro typically adds endpoints like: /wp-json/pmpro/v1/get_membership_level_for_user
        
        // Option 1: Try PMPro REST API endpoint (preferred method)
        let membershipLevel = null;
        try {
            const pmproUrl = `${wpBaseUrl}/wp-json/pmpro/v1/get_membership_level_for_user?user_id=${wpUserId}`;
            logger.info(`Trying PMPro API: ${pmproUrl}`);
            const pmproResponse = await axios.get(pmproUrl, { headers, timeout: 10000 });
            
            logger.info(`PMPro API response:`, JSON.stringify(pmproResponse.data, null, 2));
            
            if (pmproResponse.data && pmproResponse.data.id) {
                // Try multiple possible field names for expiry date
                let expiryDate = pmproResponse.data.enddate || 
                                   pmproResponse.data.end_date || 
                                   pmproResponse.data.expiration_date || 
                                   pmproResponse.data.expiration || 
                                   pmproResponse.data.expires ||
                                   null;
                
                // Convert Unix timestamp to date string if needed
                if (expiryDate && typeof expiryDate === 'string' && /^\d+$/.test(expiryDate)) {
                    // It's a Unix timestamp (string of digits)
                    const timestamp = parseInt(expiryDate, 10) * 1000; // Convert to milliseconds
                    expiryDate = new Date(timestamp).toISOString().split('T')[0]; // Format as YYYY-MM-DD
                }
                
                membershipLevel = {
                    id: parseInt(pmproResponse.data.id, 10),
                    name: pmproResponse.data.name || 'Unknown',
                    expiryDate: expiryDate
                };
                logger.info(`✅ PMPro membership found via API: Level ${membershipLevel.id} (${membershipLevel.name}), Expiry: ${membershipLevel.expiryDate || 'None (lifetime)'}`);
                logger.info(`📋 Full PMPro response fields: ${Object.keys(pmproResponse.data).join(', ')}`);
            } else if (pmproResponse.data === false || pmproResponse.data === null) {
                // PMPro returns false/null when user has no membership
                logger.info(`PMPro API returned no membership for user ${wpUserId}`);
            }
        } catch (pmproError) {
            // Log the error but continue - PMPro API might not be available
            logger.warn(`PMPro API error (will try fallback): ${pmproError.message}`);
            if (pmproError.response?.status === 404) {
                logger.info(`PMPro API endpoint not found - this site may not have PMPro REST API enabled`);
            }
        }

        // Option 2: If PMPro API not available, try WordPress user meta (less reliable)
        if (!membershipLevel) {
            logger.info('Trying fallback method: WordPress user meta...');
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
                    logger.info(`✅ PMPro membership found via user meta: Level ${membershipLevel.id}`);
                } else {
                    logger.info(`User meta checked but no membership level found`);
                }
            } catch (metaError) {
                logger.warn(`User meta fallback failed: ${metaError.message}`);
                // If both methods fail, we'll treat it as no membership
                // Don't throw error - just log it
                if (metaError.response?.status === 401) {
                    logger.error(`401 Unauthorized - WordPress API credentials may lack permission to view user ${wpUserId}`);
                    return {
                        hasValidMembership: false,
                        levelId: null,
                        levelName: null,
                        error: `WordPress API permission error (401) - cannot verify membership for user ${wpUserId}`
                    };
                } else if (metaError.response?.status === 404) {
                    logger.error(`WordPress User ID ${wpUserId} not found (404)`);
                    return {
                        hasValidMembership: false,
                        levelId: null,
                        levelName: null,
                        error: `WordPress User ID ${wpUserId} not found in WordPress`
                    };
                }
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

        logger.info(`Membership validation: Level ${membershipLevel.id} (type: ${typeof membershipLevel.id}) is ${isValid ? 'VALID' : 'INVALID'}`);
        logger.info(`Valid levels: ${JSON.stringify(validLevels)} (types: ${validLevels.map(l => typeof l).join(', ')})`);

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
        let pmproApiAvailable = false;
        try {
            const pmproUrl = `${wpBaseUrl}/wp-json/pmpro/v1`;
            await axios.get(pmproUrl, { headers, timeout: 5000 });
            pmproApiAvailable = true;
        } catch (e) {
            // PMPro API might not be available
        }

        return {
            success: true,
            wpApiAvailable: wpResponse.status === 200,
            pmproApiAvailable: pmproApiAvailable,
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
