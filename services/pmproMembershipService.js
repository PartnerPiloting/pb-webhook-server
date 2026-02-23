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

// WordPress/PMPro API: longer timeout for Australia–US latency, retries for transient failures
const WP_API_TIMEOUT_MS = 20000;  // 20 seconds (was 10)
const WP_API_MAX_RETRIES = 3;
const WP_API_RETRY_DELAY_MS = 2000;

/**
 * Axios GET with retries for timeout, network errors, 5xx
 */
async function axiosGetWithRetry(url, headers, label) {
    let lastErr;
    for (let attempt = 1; attempt <= WP_API_MAX_RETRIES; attempt++) {
        try {
            const response = await axios.get(url, { headers, timeout: WP_API_TIMEOUT_MS });
            return response;
        } catch (err) {
            lastErr = err;
            const isRetryable = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ||
                err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' ||
                (err.response && err.response.status >= 500);
            if (!isRetryable || attempt === WP_API_MAX_RETRIES) throw err;
            logger.warn(`PMPro API (${label}) attempt ${attempt} failed: ${err.message}. Retrying in ${WP_API_RETRY_DELAY_MS}ms...`);
            await new Promise(r => setTimeout(r, WP_API_RETRY_DELAY_MS));
        }
    }
    throw lastErr;
}

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
 * Parse PMPro API response into membershipLevel object
 * Handles both 'id' and 'ID' (PHP/JSON serialization can vary)
 */
function parsePmproLevelResponse(data) {
    if (!data) return null;
    const levelId = data.id ?? data.ID ?? data.level_id;
    if (levelId == null || levelId === '' || levelId === 0) return null;
    let expiryDate = data.enddate ?? data.end_date ?? data.expiration_date ?? data.expiration ?? data.expires ?? null;
    if (expiryDate && typeof expiryDate === 'string' && /^\d+$/.test(expiryDate)) {
        const timestamp = parseInt(expiryDate, 10) * 1000;
        expiryDate = new Date(timestamp).toISOString().split('T')[0];
    }
    return {
        id: parseInt(levelId, 10),
        name: data.name || data.level_name || 'Unknown',
        expiryDate
    };
}

/**
 * Get WordPress user's PMPro membership level
 * Uses WordPress REST API with admin credentials
 * @param {number} wpUserId - WordPress user ID
 * @param {Object} options - Optional { clientEmail: string } for fallback lookup when user_id returns nothing
 * @returns {Promise<Object>} Membership info { hasValidMembership: boolean, levelId: number|null, levelName: string|null, error: string|null }
 */
async function checkUserMembership(wpUserId, options = {}) {
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
        const tryPmproApi = async (url, label) => {
            try {
                const response = await axiosGetWithRetry(url, headers, label);
                const data = response.data;
                logger.info(`PMPro API (${label}) response:`, JSON.stringify(data, null, 2));
                if (Array.isArray(data) && data.length > 0) {
                    return parsePmproLevelResponse(data[0]);
                }
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    return parsePmproLevelResponse(data);
                }
                if (data === false || data === null) {
                    logger.info(`PMPro API returned no membership (${label})`);
                    return null;
                }
                return null;
            } catch (err) {
                logger.warn(`PMPro API error (${label}): ${err.message}`);
                if (err.response?.status === 404) {
                    logger.info(`PMPro API endpoint not found - REST API may not be enabled`);
                    return null; // Try next endpoint
                }
                // Timeout, network errors, 5xx: propagate so sync skips instead of incorrectly pausing
                const isVerificationFailure = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ||
                    err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' ||
                    (err.response && err.response.status >= 500);
                if (isVerificationFailure) {
                    throw err;
                }
                return null;
            }
        };

        membershipLevel = await tryPmproApi(
            `${wpBaseUrl}/wp-json/pmpro/v1/get_membership_level_for_user?user_id=${wpUserId}`,
            'get_membership_level_for_user'
        );

        // Fallback: try plural endpoint (returns array) - some PMPro versions differ
        if (!membershipLevel) {
            membershipLevel = await tryPmproApi(
                `${wpBaseUrl}/wp-json/pmpro/v1/get_membership_levels_for_user?user_id=${wpUserId}`,
                'get_membership_levels_for_user'
            );
        }

        // Fallback: try by email if user_id returned nothing (handles wrong/stale WP User IDs in Master Clients)
        if (!membershipLevel && options.clientEmail) {
            logger.info(`Trying PMPro lookup by email: ${options.clientEmail}`);
            membershipLevel = await tryPmproApi(
                `${wpBaseUrl}/wp-json/pmpro/v1/get_membership_level_for_user?email=${encodeURIComponent(options.clientEmail)}`,
                'get_membership_level_for_user (email)'
            );
            if (!membershipLevel) {
                membershipLevel = await tryPmproApi(
                    `${wpBaseUrl}/wp-json/pmpro/v1/get_membership_levels_for_user?email=${encodeURIComponent(options.clientEmail)}`,
                    'get_membership_levels_for_user (email)'
                );
            }
            if (membershipLevel) {
                logger.info(`✅ Found membership via email lookup - WP User ID in Master Clients may be wrong for this client`);
            }
        }

        if (membershipLevel) {
            logger.info(`✅ PMPro membership found: Level ${membershipLevel.id} (${membershipLevel.name}), Expiry: ${membershipLevel.expiryDate || 'None (lifetime)'}`);
        }

        // Option 2: If PMPro API not available, try WordPress user meta (less reliable)
        if (!membershipLevel) {
            logger.info('Trying fallback method: WordPress user meta...');
            try {
                // Get user with context=edit to see meta fields
                const userMetaUrl = `${wpBaseUrl}/wp-json/wp/v2/users/${wpUserId}?context=edit`;
                const metaResponse = await axiosGetWithRetry(userMetaUrl, headers, 'user_meta');
                
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
                // Timeout, network errors, 5xx: propagate so sync skips instead of incorrectly pausing
                const isVerificationFailure = metaError.code === 'ECONNABORTED' || metaError.code === 'ETIMEDOUT' ||
                    metaError.code === 'ECONNREFUSED' || metaError.code === 'ENOTFOUND' ||
                    (metaError.response && metaError.response.status >= 500);
                if (isVerificationFailure) {
                    throw metaError;
                }
            }
        }

        // If still no membership found, user doesn't have an active membership
        // This is a SUCCESSFUL verification (we confirmed no membership) - error stays null
        if (!membershipLevel) {
            logger.info(`No active PMPro membership found for WordPress User ID ${wpUserId}`);
            return {
                hasValidMembership: false,
                levelId: null,
                levelName: null,
                error: null  // Successfully verified - no membership. Sync will pause client.
            };
        }

        // Check if the membership level is in the valid levels list
        const validLevels = await getValidPMProLevels();
        const isValid = validLevels.includes(membershipLevel.id);

        logger.info(`Membership validation: Level ${membershipLevel.id} (type: ${typeof membershipLevel.id}) is ${isValid ? 'VALID' : 'INVALID'}`);
        logger.info(`Valid levels: ${JSON.stringify(validLevels)} (types: ${validLevels.map(l => typeof l).join(', ')})`);

        // Both valid and invalid membership are successful verifications - error stays null
        return {
            hasValidMembership: isValid,
            levelId: membershipLevel.id,
            levelName: membershipLevel.name,
            expiryDate: membershipLevel.expiryDate, // Include expiry date for Airtable sync
            error: null  // Successfully verified. Sync will activate or pause based on hasValidMembership.
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

        // Test basic WordPress API (15s timeout - WordPress can be slow, Render cold start)
        const wpApiUrl = `${wpBaseUrl}/wp-json/wp/v2`;
        const wpResponse = await axios.get(wpApiUrl, { headers, timeout: 15000 });

        // Test PMPro API endpoint
        let pmproApiAvailable = false;
        try {
            const pmproUrl = `${wpBaseUrl}/wp-json/pmpro/v1`;
            await axios.get(pmproUrl, { headers, timeout: 15000 });
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

/**
 * Diagnostic: Call PMPro API directly and return raw response
 * Use this to check if authentication (Application Password) is the problem
 * @param {number} userId - WordPress user ID to check (e.g. 70 for Paul-Faix)
 * @returns {Promise<Object>} Raw response: statusCode, authIssue, body, error
 */
async function testPmproMembershipApi(userId) {
    const result = { userId, url: null, statusCode: null, authIssue: false, body: null, error: null };
    try {
        const wpBaseUrl = process.env.WP_BASE_URL;
        const wpUsername = process.env.WP_ADMIN_USERNAME;
        const wpPassword = process.env.WP_ADMIN_PASSWORD;

        if (!wpBaseUrl || !wpUsername || !wpPassword) {
            result.error = 'WordPress credentials not configured';
            return result;
        }

        const authString = Buffer.from(`${wpUsername}:${wpPassword}`).toString('base64');
        const url = `${wpBaseUrl}/wp-json/pmpro/v1/get_membership_level_for_user?user_id=${userId}`;
        result.url = url;

        const headers = {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json'
        };

        const response = await axios.get(url, { headers, timeout: 10000 });
        result.statusCode = response.status;
        result.body = response.data;
        result.authIssue = false;
        return result;
    } catch (err) {
        result.statusCode = err.response?.status ?? null;
        result.body = err.response?.data ?? null;
        result.error = err.message;
        result.authIssue = (err.response?.status === 401 || err.response?.status === 403);
        return result;
    }
}

module.exports = {
    getValidPMProLevels,
    checkUserMembership,
    testWordPressConnection,
    testPmproMembershipApi
};
