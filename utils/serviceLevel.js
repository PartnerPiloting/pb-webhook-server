// utils/serviceLevel.js
// Service level parsing utilities

/**
 * Parse service level from Airtable field (handles strings like "2-Lead Scoring + Post Scoring")
 * @param {string|number} serviceLevelField - Service level from Airtable
 * @returns {number} Numeric service level (1, 2, etc.)
 */
function parseServiceLevel(serviceLevelField) {
    if (typeof serviceLevelField === 'number') {
        return serviceLevelField;
    }
    
    if (typeof serviceLevelField === 'string') {
        // Extract number from strings like "2-Lead Scoring + Post Scoring"
        const match = serviceLevelField.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 1;
    }
    
    return 1; // Default fallback
}

/**
 * Check if user has access to specific service level features
 * @param {Object} client - Client object with serviceLevel
 * @param {number} requiredLevel - Required service level (1, 2, etc.)
 * @returns {boolean} True if user has access to this service level
 */
function hasServiceLevelAccess(client, requiredLevel) {
    if (!client || !client.serviceLevel) {
        return false;
    }
    
    // Parse service level in case it's a string from Airtable
    const clientLevel = parseServiceLevel(client.serviceLevel);
    return clientLevel >= requiredLevel;
}

module.exports = {
    parseServiceLevel,
    hasServiceLevelAccess
};
