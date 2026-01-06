// services/clientService.js
// Client management service for multi-tenant operations
// Handles reading from Clients base and managing client configurations

require('dotenv').config();
const Airtable = require('airtable');
const { createLogger } = require('../utils/contextLogger');

// Create module-level logger for client service
const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'client-service' 
});
// Removed old error logger - now using production issue tracking
const logCriticalError = async () => {};
const { MASTER_TABLES, CLIENT_EXECUTION_LOG_FIELDS, EXECUTION_DATA_KEYS } = require('../constants/airtableUnifiedConstants');
const { parseServiceLevel } = require('../utils/serviceLevel');
const { safeFieldUpdate } = require('../utils/errorHandler');

// Constants for fields - import from unified constants
const { CLIENT_FIELDS } = require('../constants/airtableUnifiedConstants');

// Cache DISABLED - always fetch fresh data for accurate status checks
let clientsCache = null;
let clientsCacheTimestamp = null;
const CACHE_DURATION_MS = 0; // 0 = disabled, always fetch fresh

// In-memory job lock tracking to prevent duplicate jobs
const runningJobs = new Map();
const JOB_LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Clients base connection
let clientsBase = null;

/**
 * Initialize connection to the Clients base
 */
function initializeClientsBase() {
    if (clientsBase) return clientsBase;

    if (!process.env.MASTER_CLIENTS_BASE_ID) {
        throw new Error("MASTER_CLIENTS_BASE_ID environment variable is not set");
    }
    if (!process.env.AIRTABLE_API_KEY) {
        throw new Error("AIRTABLE_API_KEY environment variable is not set");
    }

    // Configure Airtable if not already done
    Airtable.configure({
        apiKey: process.env.AIRTABLE_API_KEY
    });

    clientsBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    logger.info("Clients base initialized successfully");
    return clientsBase;
}

/**
 * Check if cache is still valid
 */
function isCacheValid() {
    if (!clientsCache || !clientsCacheTimestamp) return false;
    return (Date.now() - clientsCacheTimestamp) < CACHE_DURATION_MS;
}

/**
 * Get all clients from the Clients table
 * @returns {Promise<Array>} Array of client records
 */
async function getAllClients() {
    logger.info(`[DEBUG-EXTREME] getAllClients CALLED`);
    
    try {
        // Return cached data if valid
        if (isCacheValid()) {
            logger.info(`[DEBUG-EXTREME] Returning cached client data (${clientsCache ? clientsCache.length : 0} clients)`);
            return clientsCache;
        }

        logger.info(`[DEBUG-EXTREME] Initializing clients base...`);
        const base = initializeClientsBase();
        logger.info(`[DEBUG-EXTREME] Clients base initialized: ${base ? 'SUCCESS' : 'FAILED'}`);
        const clients = [];

        logger.info("Fetching all clients from Clients base...");

        await base(MASTER_TABLES.CLIENTS).select({
            // No filter - get all clients
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                const clientId = record.get(CLIENT_FIELDS.CLIENT_ID);
                const clientName = record.get('Client Name'); 
                const status = record.get(CLIENT_FIELDS.STATUS);
                const airtableBaseId = record.get('Airtable Base ID');
                const executionLog = record.get(CLIENT_EXECUTION_LOG_FIELDS.EXECUTION_LOG) || '';
                const wpUserId = record.get('WordPress User ID');
                const statusManagement = record.get(CLIENT_FIELDS.STATUS_MANAGEMENT) || 'Automatic';
                const expiryDate = record.get(CLIENT_FIELDS.EXPIRY_DATE) || null;
                const serviceLevelRaw = record.get(CLIENT_FIELDS.SERVICE_LEVEL) || 1;
                const serviceLevel = parseServiceLevel(serviceLevelRaw); // Parse "2-Lead Scoring + Post Scoring" → 2
                const comment = record.get('Comment') || '';
                // Post Access control - only "Yes" enables Apify post scraping
                const postAccessEnabled = record.get(CLIENT_FIELDS.POST_ACCESS_ENABLED) === 'Yes';
                // Email notification fields
                const clientFirstName = record.get('Client First Name') || '';
                const clientEmailAddress = record.get('Client Email Address') || '';
                const profileScoringTokenLimit = record.get('Profile Scoring Token Limit') || 5000;
                const postScoringTokenLimit = record.get('Post Scoring Token Limit') || 3000;
                // Post harvesting scheduler fields (optional)
                const postsDailyTarget = record.get('Posts Daily Target') || 0;
                const leadsBatchSizeForPostCollection = record.get('Leads Batch Size for Post Collection') || 20;
                const maxPostBatchesPerDayGuardrail = record.get('Max Post Batches Per Day Guardrail') || 10;
                
                // Floor configuration fields
                const primaryFloor = record.get('Primary Floor') || 70;
                const secondaryFloor = record.get('Secondary Floor') || 50;
                const minimumFloor = record.get('Minimum Floor') || 30;
                const floorStrategy = record.get('Floor Strategy') || 'Progressive';
                const autoAdjustFloors = record.get('Auto Adjust Floors') || false;
                
                // Calendar/timezone configuration
                const timezone = record.get(CLIENT_FIELDS.TIMEZONE) || null;
                const googleCalendarEmail = record.get(CLIENT_FIELDS.GOOGLE_CALENDAR_EMAIL) || null;
                
                // Coaching configuration
                const coach = record.get('Coach') || null;
                const notionProgressUrl = record.get('Notion Progress URL') || null;
                const coachingStatus = record.get('Coaching Status') || null;
                
                clients.push({
                    id: record.id,
                    clientId: clientId,
                    clientName: clientName,
                    status: status,
                    statusManagement: statusManagement,
                    expiryDate: expiryDate,
                    airtableBaseId: airtableBaseId,
                    executionLog: executionLog,
                    wpUserId: wpUserId,
                    serviceLevel: serviceLevel,
                    comment: comment,
                    // Post Access control
                    postAccessEnabled: postAccessEnabled,
                    // Email notification fields
                    clientFirstName: clientFirstName,
                    clientEmailAddress: clientEmailAddress,
                    profileScoringTokenLimit: profileScoringTokenLimit,
                    postScoringTokenLimit: postScoringTokenLimit,
                    // Post harvesting settings
                    postsDailyTarget,
                    leadsBatchSizeForPostCollection,
                    maxPostBatchesPerDayGuardrail,
                    // Floor configuration
                    primaryFloor: primaryFloor,
                    secondaryFloor: secondaryFloor,
                    minimumFloor: minimumFloor,
                    floorStrategy: floorStrategy,
                    autoAdjustFloors: autoAdjustFloors,
                    // Calendar/timezone configuration
                    timezone: timezone,
                    googleCalendarEmail: googleCalendarEmail,
                    // Coaching configuration
                    coach: coach,
                    notionProgressUrl: notionProgressUrl,
                    coachingStatus: coachingStatus,
                    // Store raw record for fire-and-forget field access
                    rawRecord: record
                });
            });
            fetchNextPage();
        });

        // Update cache
        clientsCache = clients;
        clientsCacheTimestamp = Date.now();

        logger.info(`Retrieved ${clients.length} clients from Clients base`);
        return clients;

    } catch (error) {
        logger.error("Error fetching all clients:", error);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'clientService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Get only active clients
 * @returns {Promise<Array>} Array of active client records
 */
async function getAllActiveClients() {
    try {
        const allClients = await getAllClients();
        const activeClients = allClients.filter(client => 
            client.status === 'Active'
        );

        logger.info(`Found ${activeClients.length} active clients out of ${allClients.length} total`);
        return activeClients;

    } catch (error) {
        logger.error("Error fetching active clients:", error);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'clientService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Get a specific client by Client ID
 * @param {string} clientId - The Client ID to search for
 * @returns {Promise<Object|null>} Client record or null if not found
 */
async function getClientById(clientId) {
    logger.info(`[DEBUG-EXTREME] getClientById CALLED with clientId=${clientId}`);
    
    try {
        logger.info(`[DEBUG-EXTREME] Getting all clients...`);
        const allClients = await getAllClients();
        logger.info(`[DEBUG-EXTREME] Got ${allClients.length} clients, looking for clientId=${clientId}`);
        
        const client = allClients.find(c => c.clientId === clientId);
        
        if (client) {
            logger.info(`[DEBUG-EXTREME] SUCCESS: Found client: ${client.clientName} (${clientId}), baseId=${client.airtableBaseId}`);
        } else {
            logger.error(`[DEBUG-EXTREME] ERROR: Client not found: ${clientId}`);
        }

        return client || null;

    } catch (error) {
        logger.error(`Error fetching client ${clientId}:`, error);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'clientService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Get a specific client by WordPress User ID
 * @param {number} wpUserId - The WordPress User ID to search for
 * @returns {Promise<Object|null>} Client record or null if not found
 */
async function getClientByWpUserId(wpUserId) {
    try {
        const allClients = await getAllClients();
        const client = allClients.find(c => c.wpUserId === wpUserId);
        
        if (client) {
            logger.info(`Found client by WP User ID ${wpUserId}: ${client.clientName} (${client.clientId})`);
        } else {
            logger.info(`Client not found for WP User ID: ${wpUserId}`);
        }

        return client || null;

    } catch (error) {
        logger.error(`Error fetching client by WP User ID ${wpUserId}:`, error);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'clientService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Validate if a client exists and is active
 * @param {string} clientId - The Client ID to validate
 * @returns {Promise<boolean>} True if client exists and is active
 */
async function validateClient(clientId) {
    try {
        const client = await getClientById(clientId);
        const isValid = client && client.status === 'Active';
        
        logger.info(`Client validation for ${clientId}: ${isValid ? 'VALID' : 'INVALID'}`);
        return isValid;

    } catch (error) {
        logger.error(`Error validating client ${clientId}:`, error);
        await logCriticalError(error, { context: 'Service error (swallowed)', service: 'clientService.js' }).catch(() => {});
        return false;
    }
}

/**
 * Update the execution log for a specific client
 * @param {string} clientId - The Client ID to update
 * @param {string} logEntry - The log entry to append
 * @returns {Promise<boolean>} True if update was successful
 */
// CRR REDESIGN: updateExecutionLog function removed (replaced by Progress Log in jobTracking.js)
// Old function logged to "Execution Log" field in Clients table (deprecated)
// New system uses "Progress Log" field in Client Run Results table for honest completion reporting

/**
 * Create a formatted execution log entry
 * @param {Object} executionData - Data about the execution
 * @returns {string} Formatted log entry
 */
function formatExecutionLog(executionData) {
    // Validate input
    if (!executionData || typeof executionData !== 'object') {
        logger.warn('formatExecutionLog called with invalid executionData:', typeof executionData);
        return `=== EXECUTION: ${new Date().toISOString()} ===\nStatus: Error - Invalid execution data\n`;
    }
    
    // Destructure using constants for property keys
    const {
        [EXECUTION_DATA_KEYS.STATUS]: status = 'Unknown',
        [EXECUTION_DATA_KEYS.LEADS_PROCESSED]: leadsProcessed = { successful: 0, failed: 0, total: 0 },
        [EXECUTION_DATA_KEYS.POST_SCORING]: postScoring = { successful: 0, failed: 0, total: 0 },
        [EXECUTION_DATA_KEYS.DURATION]: duration = 'Unknown',
        [EXECUTION_DATA_KEYS.TOKENS_USED]: tokensUsed = 0,
        [EXECUTION_DATA_KEYS.ERRORS]: errors = [],
        [EXECUTION_DATA_KEYS.PERFORMANCE]: performance = {},
        [EXECUTION_DATA_KEYS.NEXT_ACTION]: nextAction = ''
    } = executionData;

    const timestamp = new Date().toISOString();
    
    let logEntry = `=== EXECUTION: ${timestamp} ===\n`;
    logEntry += `Status: ${status}\n`;
    logEntry += `Leads Processed: ${leadsProcessed.successful}/${leadsProcessed.total} successful\n`;
    
    if (postScoring.total > 0) {
        logEntry += `Posts Scored: ${postScoring.successful}/${postScoring.total} successful\n`;
    }
    
    logEntry += `Duration: ${duration}\n`;
    logEntry += `Tokens Used: ${tokensUsed}\n`;

    if (errors.length > 0) {
        logEntry += `\nErrors:\n`;
        errors.forEach(error => {
            logEntry += `- ${error}\n`;
        });
    }

    if (Object.keys(performance).length > 0) {
        logEntry += `\nPerformance:\n`;
        Object.entries(performance).forEach(([key, value]) => {
            logEntry += `- ${key}: ${value}\n`;
        });
    }

    if (nextAction) {
        logEntry += `\nNext Action: ${nextAction}`;
    }

    return logEntry;
}

/**
 * Log execution results for a client
 * @param {string} clientId - The Client ID to log for
 * @param {Object} executionData - Execution data object
 * @returns {Promise<boolean>} True if logging was successful
 */
async function logExecution(clientId, executionData) {
    try {
        // DEBUG: Log input parameters to diagnose undefined logEntry bug
        logger.info(`[EXEC-LOG-DEBUG] logExecution called for client ${clientId}`);
        logger.info(`[EXEC-LOG-DEBUG] executionData type: ${typeof executionData}, value: ${JSON.stringify(executionData)?.substring(0, 200)}`);
        
        let logEntry;
        
        if (executionData.type === 'POST_SCORING') {
            // For post scoring, format the log appropriately
            const formattedData = {
                [EXECUTION_DATA_KEYS.STATUS]: executionData.status || 'Unknown',
                [EXECUTION_DATA_KEYS.LEADS_PROCESSED]: { successful: 0, failed: 0, total: 0 }, // No leads processed in post scoring
                [EXECUTION_DATA_KEYS.POST_SCORING]: { 
                    successful: executionData.postsScored || 0, 
                    failed: (executionData.postsProcessed || 0) - (executionData.postsScored || 0),
                    total: executionData.postsProcessed || 0
                },
                [EXECUTION_DATA_KEYS.DURATION]: `${executionData.duration || 0}s`,
                [EXECUTION_DATA_KEYS.TOKENS_USED]: 0, // We don't track tokens in post scoring yet
                [EXECUTION_DATA_KEYS.ERRORS]: executionData.errorDetails || []
            };
            logger.info(`[EXEC-LOG-DEBUG] POST_SCORING path - formatted data created`);
            logEntry = formatExecutionLog(formattedData);
            logger.info(`[EXEC-LOG-DEBUG] POST_SCORING logEntry type: ${typeof logEntry}, length: ${logEntry?.length}, preview: ${logEntry?.substring(0, 100)}`);
        } else {
            // For lead scoring or other types, use the existing format
            logger.info(`[EXEC-LOG-DEBUG] Non-POST_SCORING path (type: ${executionData.type})`);
            logEntry = formatExecutionLog(executionData);
            logger.info(`[EXEC-LOG-DEBUG] Default logEntry type: ${typeof logEntry}, length: ${logEntry?.length}, preview: ${logEntry?.substring(0, 100)}`);
        }
        
        // CRITICAL DEBUG: Check logEntry value before passing to updateExecutionLog
        if (logEntry === undefined) {
            logger.error(`[EXEC-LOG-DEBUG] 🔴 CRITICAL: logEntry is UNDEFINED! This will cause Airtable error!`);
            logger.error(`[EXEC-LOG-DEBUG] Stack trace:`, new Error().stack);
        } else if (logEntry === null) {
            logger.error(`[EXEC-LOG-DEBUG] 🔴 CRITICAL: logEntry is NULL! This will cause Airtable error!`);
            logger.error(`[EXEC-LOG-DEBUG] Stack trace:`, new Error().stack);
        } else if (typeof logEntry !== 'string') {
            logger.error(`[EXEC-LOG-DEBUG] 🔴 CRITICAL: logEntry is not a string! Type: ${typeof logEntry}`);
            logger.error(`[EXEC-LOG-DEBUG] Stack trace:`, new Error().stack);
        } else {
            logger.info(`[EXEC-LOG-DEBUG] ✅ logEntry is valid string (${logEntry.length} chars)`);
        }
        
        try {
            // CRR REDESIGN: updateExecutionLog removed (replaced by Progress Log)
            // Operations now log directly to Progress Log field in Client Run Results table
            // This provides honest completion timestamps instead of premature "Completed" status
            
            logger.info(`[EXEC-LOG-DEBUG] logExecution called but updateExecutionLog deprecated - operations log to Progress Log instead`);
            return true; // Return success without updating Execution Log
        } catch (innerError) {
            logger.error(`Airtable Service ERROR: Failed to update client run: ${innerError.message}`);
            logger.error(`[EXEC-LOG-DEBUG] 🔴 Inner error caught! logEntry was: ${typeof logEntry}, ${logEntry?.substring(0, 100)}`);
            logger.error(`[EXEC-LOG-DEBUG] Full error stack:`, innerError.stack);
            await logCriticalError(innerError, { context: 'Service error (swallowed)', service: 'clientService.js' }).catch(() => {});
            return false;
        }
    } catch (error) {
        logger.error(`Error logging execution for client ${clientId}:`, error);
        await logCriticalError(error, { context: 'Service error (swallowed)', service: 'clientService.js' }).catch(() => {});
        return false;
    }
}

/**
 * Get active clients - supports both all clients and specific client
 * @param {string|null} clientId - Optional specific client ID to get
 * @returns {Promise<Array>} Array of active client records
 */
async function getActiveClients(clientId = null) {
    try {
        if (clientId) {
            // Get specific client
            const client = await getClientById(clientId);
            if (!client) {
                logger.info(`Client ${clientId} not found`);
                return [];
            }
            if (client.status !== 'Active') {
                logger.info(`Client ${clientId} is not active (status: ${client.status})`);
                return [];
            }
            return [client];
        } else {
            // Get all active clients
            return await getAllActiveClients();
        }
    } catch (error) {
        logger.error("Error in getActiveClients:", error);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'clientService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Get active clients filtered by processing stream
 * @param {number} stream - Processing stream number (1, 2, 3, etc.)
 * @param {string} clientId - Optional specific client ID to get
 * @returns {Array} Array of client objects that match the stream and are active
 */
async function getActiveClientsByStream(stream, clientId = null) {
    try {
        // Clear cache to ensure fresh data
        clearCache();
        
        const activeClients = await getActiveClients(clientId);
        
        // Enhanced logging for stream debugging
        logger.info(`📊 Active clients before stream filtering: ${activeClients.map(c => c.clientId).join(', ')}`);
        
        // Filter by processing stream with detailed logging
        const streamClients = activeClients.filter(client => {
            const clientStream = client.rawRecord?.get('Processing Stream');
            const isMatch = clientStream === stream;
            
            // Log each client's stream assignment for debugging
            logger.info(`📊 Client ${client.clientId} has stream '${clientStream}' (match for stream ${stream}: ${isMatch})`);
            
            return isMatch;
        });
        
        logger.info(`📊 Found ${streamClients.length} active clients on stream ${stream}: ${streamClients.map(c => c.clientId).join(', ')}`);
        return streamClients;
    } catch (error) {
        logger.error(`Error getting active clients for stream ${stream}:`, error);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'clientService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Clear the clients cache (useful for testing or forced refresh)
 */
function clearCache() {
    clientsCache = null;
    clientsCacheTimestamp = null;
    logger.info("Clients cache cleared");
}

/**
 * Get token limits for a specific client
 * @param {string} clientId - The Client ID to get limits for
 * @returns {Promise<Object|null>} Token limits object or null if not found
 */
async function getClientTokenLimits(clientId) {
    try {
        const client = await getClientById(clientId);
        if (!client) {
            logger.info(`Client not found for token limits: ${clientId}`);
            return null;
        }

        return {
            profileLimit: client.profileScoringTokenLimit,
            postLimit: client.postScoringTokenLimit,
            clientName: client.clientName
        };

    } catch (error) {
        logger.error(`Error getting token limits for client ${clientId}:`, error);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'clientService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Get floor configuration for a specific client
 * @param {string} clientId - The Client ID to get floor config for
 * @returns {Promise<Object|null>} Floor configuration object or null if not found
 */
async function getClientFloorConfig(clientId) {
    try {
        const client = await getClientById(clientId);
        if (!client) {
            logger.info(`Client not found for floor config: ${clientId}`);
            return null;
        }

        return {
            clientId: client.clientId,
            clientName: client.clientName,
            primaryFloor: client.primaryFloor,
            secondaryFloor: client.secondaryFloor,
            minimumFloor: client.minimumFloor,
            floorStrategy: client.floorStrategy,
            autoAdjustFloors: client.autoAdjustFloors
        };

    } catch (error) {
        logger.error(`Error getting floor config for client ${clientId}:`, error);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'clientService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Update floor configuration for a specific client
 * @param {string} clientId - The Client ID to update
 * @param {Object} floorConfig - Floor configuration object
 * @returns {Promise<boolean>} True if update was successful
 */
async function updateClientFloorConfig(clientId, floorConfig) {
    try {
        const base = initializeClientsBase();
        
        // First, get the client's Airtable record ID
        const client = await getClientById(clientId);
        if (!client) {
            throw new Error(`Client ${clientId} not found`);
        }

        // Prepare update fields
        const updateFields = {};
        if (floorConfig.primaryFloor !== undefined) updateFields['Primary Floor'] = floorConfig.primaryFloor;
        if (floorConfig.secondaryFloor !== undefined) updateFields['Secondary Floor'] = floorConfig.secondaryFloor;
        if (floorConfig.minimumFloor !== undefined) updateFields['Minimum Floor'] = floorConfig.minimumFloor;
        if (floorConfig.floorStrategy !== undefined) updateFields['Floor Strategy'] = floorConfig.floorStrategy;
        if (floorConfig.autoAdjustFloors !== undefined) updateFields['Auto Adjust Floors'] = floorConfig.autoAdjustFloors;

        // Update the record
        await base('Clients').update([
            {
                id: client.id,
                fields: updateFields
            }
        ]);

        logger.info(`Floor configuration updated for client ${clientId}:`, updateFields);
        
        // Invalidate cache to force refresh on next read
        clientsCache = null;
        clientsCacheTimestamp = null;

        return true;

    } catch (error) {
        logger.error(`Error updating floor config for client ${clientId}:`, error);
        await logCriticalError(error, { context: 'Service error (before throw)', service: 'clientService.js' }).catch(() => {});
        throw error;
    }
}

/**
 * Validate if a lead meets the floor requirements for a specific strategy
 * @param {number} leadScore - The lead's AI score (0-100)
 * @param {Object} floorConfig - Floor configuration object
 * @param {string} contactLevel - 'primary', 'secondary', or 'minimum'
 * @returns {Object} Validation result with pass/fail and recommended action
 */
function validateLeadAgainstFloor(leadScore, floorConfig, contactLevel = 'primary') {
    const floors = {
        primary: floorConfig.primaryFloor,
        secondary: floorConfig.secondaryFloor,
        minimum: floorConfig.minimumFloor
    };

    const requiredFloor = floors[contactLevel];
    const meetsFloor = leadScore >= requiredFloor;

    let recommendedAction = 'reject';
    let nextFloorOption = null;

    if (meetsFloor) {
        recommendedAction = contactLevel === 'primary' ? 'contact_primary' : 
                           contactLevel === 'secondary' ? 'contact_secondary' : 'contact_minimum';
    } else {
        // Check if lead qualifies for a lower tier
        if (contactLevel === 'primary' && leadScore >= floors.secondary) {
            recommendedAction = 'consider_secondary';
            nextFloorOption = 'secondary';
        } else if ((contactLevel === 'primary' || contactLevel === 'secondary') && leadScore >= floors.minimum) {
            recommendedAction = 'consider_minimum';
            nextFloorOption = 'minimum';
        }
    }

    return {
        passes: meetsFloor,
        leadScore: leadScore,
        requiredFloor: requiredFloor,
        contactLevel: contactLevel,
        recommendedAction: recommendedAction,
        nextFloorOption: nextFloorOption,
        floorStrategy: floorConfig.floorStrategy,
        margin: leadScore - requiredFloor
    };
}

/**
 * Get floor validation results for all floor levels
 * @param {number} leadScore - The lead's AI score (0-100)
 * @param {Object} floorConfig - Floor configuration object
 * @returns {Object} Comprehensive floor validation results
 */
function getFloorValidationSummary(leadScore, floorConfig) {
    const primary = validateLeadAgainstFloor(leadScore, floorConfig, 'primary');
    const secondary = validateLeadAgainstFloor(leadScore, floorConfig, 'secondary');
    const minimum = validateLeadAgainstFloor(leadScore, floorConfig, 'minimum');

    const highestQualifyingLevel = primary.passes ? 'primary' : 
                                   secondary.passes ? 'secondary' : 
                                   minimum.passes ? 'minimum' : 'none';

    return {
        leadScore: leadScore,
        floorResults: { primary, secondary, minimum },
        highestQualifyingLevel: highestQualifyingLevel,
        qualifiesForContact: highestQualifyingLevel !== 'none',
        recommendedContactLevel: highestQualifyingLevel !== 'none' ? highestQualifyingLevel : null,
        floorStrategy: floorConfig.floorStrategy
    };
}

/**
 * Get Airtable base connection for a specific client
 * @param {string} airtableBaseId - The Airtable Base ID for the client
 * @returns {Object} Airtable base instance
 */
function getClientBase(airtableBaseId) {
    if (!airtableBaseId) {
        throw new Error("Airtable Base ID is required");
    }
    
    if (!process.env.AIRTABLE_API_KEY) {
        throw new Error("AIRTABLE_API_KEY environment variable is not set");
    }

    // Configure Airtable if not already done
    const Airtable = require('airtable');
    Airtable.configure({
        apiKey: process.env.AIRTABLE_API_KEY
    });

    const base = Airtable.base(airtableBaseId);
    logger.info(`Created Airtable base connection for: ${airtableBaseId}`);
    return base;
}

// ============================================================================
// FIRE-AND-FORGET JOB TRACKING FUNCTIONS
// ============================================================================

/**
 * Generate a unique job ID for fire-and-forget operations
 * @param {string} operation - Operation type: 'lead_scoring', 'post_harvesting', 'post_scoring'
 * @param {number} stream - Processing stream number (1, 2, 3, etc.)
 * @returns {string} Unique job ID
 */
function generateJobId(operation, stream) {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return `job_${operation}_stream${stream}_${timestamp}`;
}

/**
 * Set job status for a specific operation and client
 * @param {string} clientId - The Client ID
 * @param {string} operation - Operation type: 'lead_scoring', 'post_harvesting', 'post_scoring'
 * @param {string} status - Job status: STARTED, RUNNING, COMPLETED, CLIENT_TIMEOUT_KILLED, JOB_TIMEOUT_KILLED, FAILED
 * @param {string} jobId - Unique job ID
 * @param {Object} metrics - Optional metrics: { count, duration, errors }
 * @returns {Promise<boolean>} True if update was successful
 */
async function setJobStatus(clientId, operation, status, jobId, metrics = {}) {
    try {
        logger.info(`🔄 Setting ${operation} status for ${clientId || 'global'}: ${status}`);
        
        // Handle global operations (when clientId is null)
        if (!clientId) {
            // Log status for tracking but don't update any specific client
            logger.info(`ℹ️ Global ${operation} status: ${status}, jobId: ${jobId}`);
            return true;
        }
        
        // Update in-memory lock tracking
        const lockKey = `${clientId}:${operation}`;
        
        if (status === "RUNNING") {
            // Add or refresh the lock
            runningJobs.set(lockKey, { 
                timestamp: Date.now(),
                jobId: jobId || `job_${operation}_${Date.now()}`
            });
            logger.info(`[INFO] Set memory lock for ${clientId}:${operation} with jobId: ${jobId}`);
        } else if (status === "COMPLETED" || status === "FAILED") {
            // Remove the lock when job completes or fails
            if (runningJobs.has(lockKey)) {
                logger.info(`[INFO] Releasing memory lock for ${clientId}:${operation} (status: ${status})`);
                runningJobs.delete(lockKey);
            }
        }
        
        const base = initializeClientsBase();
        const client = await getClientById(clientId);
        
        if (!client) {
            throw new Error(`Client ${clientId} not found`);
        }

        // Map operation to field names
        const fieldMappings = {
            'lead_scoring': {
                status: 'Lead Scoring Job Status',
                jobId: 'Lead Scoring Job ID',
                lastRunDate: 'Lead Scoring Last Run Date',
                lastRunTime: 'Lead Scoring Last Run Time',
                lastRunCount: 'Leads Scored Last Run'
            },
            'post_harvesting': {
                status: 'Post Harvesting Job Status',
                jobId: 'Post Harvesting Job ID',
                lastRunDate: 'Post Harvesting Last Run Date',
                lastRunTime: 'Post Harvesting Last Run Time',
                lastRunCount: 'Posts Harvested Last Run'
            },
            'post_scoring': {
                status: 'Post Scoring Job Status',
                jobId: 'Post Scoring Job ID',
                lastRunDate: 'Post Scoring Last Run Date',
                lastRunTime: 'Post Scoring Last Run Time',
                lastRunCount: 'Posts Scored Last Run'
            }
        };

        const fields = fieldMappings[operation];
        if (!fields) {
            throw new Error(`Invalid operation: ${operation}`);
        }

        // Build update object
        const updateFields = {
            [fields.status]: status,
            [fields.jobId]: jobId,
            [fields.lastRunDate]: new Date().toISOString()
        };

        // Add metrics if provided
        if (metrics.duration) {
            updateFields[fields.lastRunTime] = metrics.duration;
        }
        if (metrics.count !== undefined) {
            updateFields[fields.lastRunCount] = metrics.count;
        }

        // Use safeFieldUpdate to avoid errors with missing or invalid fields
        const updateResult = await safeFieldUpdate(
            base,
            'Clients',
            client.id,
            updateFields,
            {
                clientId,
                logger: console,
                skipMissing: true,  // Skip fields that don't exist
                source: `${operation}_status`
            }
        );

        if (updateResult.updated) {
            logger.info(`✅ ${operation} status updated for ${clientId}: ${status}`);
        } else {
            logger.warn(`⚠️ ${operation} status update for ${clientId} had issues: ${updateResult.reason || updateResult.error || 'Unknown issue'}`);
            if (updateResult.skippedFields && updateResult.skippedFields.length > 0) {
                logger.warn(`⚠️ Skipped fields: ${updateResult.skippedFields.join(', ')}`);
            }
        }
        
        // Invalidate cache
        clientsCache = null;
        clientsCacheTimestamp = null;

        return updateResult.updated;

    } catch (error) {
        logger.error(`❌ Error setting ${operation} status for ${clientId}:`, error.message);
        await logCriticalError(error, { context: 'Service error (swallowed)', service: 'clientService.js' }).catch(() => {});
        return false;
    }
}

/**
 * Get job status for a specific operation and client
 * @param {string} clientId - The Client ID
 * @param {string} operation - Operation type: 'lead_scoring', 'post_harvesting', 'post_scoring'
 * @returns {Promise<Object|null>} Job status object or null if not found
 */
async function getJobStatus(clientId, operation) {
    try {
        const client = await getClientById(clientId);
        if (!client) return null;

        const fieldMappings = {
            'lead_scoring': {
                status: 'Lead Scoring Job Status',
                jobId: 'Lead Scoring Job ID',
                lastRunDate: 'Lead Scoring Last Run Date',
                lastRunTime: 'Lead Scoring Last Run Time',
                lastRunCount: 'Leads Scored Last Run'
            },
            'post_harvesting': {
                status: 'Post Harvesting Job Status',
                jobId: 'Post Harvesting Job ID', 
                lastRunDate: 'Post Harvesting Last Run Date',
                lastRunTime: 'Post Harvesting Last Run Time',
                lastRunCount: 'Posts Harvested Last Run'
            },
            'post_scoring': {
                status: 'Post Scoring Job Status',
                jobId: 'Post Scoring Job ID',
                lastRunDate: 'Post Scoring Last Run Date',
                lastRunTime: 'Post Scoring Last Run Time',
                lastRunCount: 'Posts Scored Last Run'
            }
        };

        const fields = fieldMappings[operation];
        if (!fields) return null;

        return {
            status: client.rawRecord?.get(fields.status) || null,
            jobId: client.rawRecord?.get(fields.jobId) || null,
            lastRunDate: client.rawRecord?.get(fields.lastRunDate) || null,
            lastRunTime: client.rawRecord?.get(fields.lastRunTime) || null,
            lastRunCount: client.rawRecord?.get(fields.lastRunCount) || null
        };

    } catch (error) {
        logger.error(`Error getting ${operation} status for ${clientId}:`, error.message);
        await logCriticalError(error, { context: 'Service error (swallowed)', service: 'clientService.js' }).catch(() => {});
        return null;
    }
}

/**
 * Check if a specific job is currently running for a client
 * @param {string} clientId - The Client ID
 * @param {string} operation - The operation type ('lead_scoring', 'post_harvesting', 'post_scoring')
 * @returns {Promise<boolean>} True if job is currently running
 */
async function isJobRunning(clientId, operation) {
    try {
        // RECOVERY PATH FOR TESTING - Check for "stuck" jobs on specific clients
        if ((clientId === 'Guy-Wilson' || clientId === 'Dean-Hobin') && operation === 'post_scoring') {
            logger.info(`[JOB_DEBUG] � Checking for stuck job status on ${clientId} for ${operation}`);
            
            // Get the current job status
            const jobStatus = await getJobStatus(clientId, operation);
            
            // If there's a running job, check when it was started
            if (jobStatus && jobStatus.status === "RUNNING" && jobStatus.jobId) {
                logger.info(`[JOB_DEBUG] 🕰️ Found RUNNING job for ${clientId}:${operation}, ID: ${jobStatus.jobId}`);
                
                // Extract timestamp from jobId (assuming format job_post_scoring_TIMESTAMP)
                const timestampMatch = jobStatus.jobId.match(/\d+$/);
                if (timestampMatch) {
                    const jobTimestamp = parseInt(timestampMatch[0], 10);
                    const now = Date.now();
                    const jobAgeMinutes = Math.round((now - jobTimestamp) / (60 * 1000));
                    
                    logger.info(`[JOB_DEBUG] ⏱️ Job age: ${jobAgeMinutes} minutes`);
                    
                    // If job has been running for more than 30 minutes, consider it stuck
                    if (jobAgeMinutes > 30) {
                        logger.info(`[JOB_DEBUG] 🚨 Detected stuck job for ${clientId}:${operation}, running for ${jobAgeMinutes} minutes. Auto-resetting.`);
                        
                        // Reset the job status
                        await setJobStatus(clientId, operation, 'COMPLETED', jobStatus.jobId, { 
                            resetReason: 'AUTO_RESET_STUCK_JOB',
                            originalStartTime: new Date(jobTimestamp).toISOString()
                        });
                        
                        logger.info(`[JOB_DEBUG] ✅ Successfully reset stuck job for ${clientId}:${operation}`);
                        return false; // Allow the job to run now
                    }
                }
            }
        }
        
        // First check the in-memory lock (faster than Airtable)
        const lockKey = `${clientId}:${operation}`;
        const lock = runningJobs.get(lockKey);
        
        if (lock) {
            const now = Date.now();
            // If the lock is recent (within JOB_LOCK_TIMEOUT_MS)
            if (now - lock.timestamp < JOB_LOCK_TIMEOUT_MS) {
                logger.info(`[JOB_DEBUG] Memory lock found for ${clientId}:${operation}, created ${(now - lock.timestamp)/1000}s ago`);
                return true;
            } else {
                // Lock is expired, remove it
                logger.info(`[JOB_DEBUG] Memory lock for ${clientId}:${operation} has expired (${(now - lock.timestamp)/1000}s old), releasing`);
                runningJobs.delete(lockKey);
            }
        }
        
        // If no memory lock or it's expired, check Airtable
        const jobStatus = await getJobStatus(clientId, operation);
        // Job is running if status is "RUNNING"
        const isRunning = jobStatus && jobStatus.status === "RUNNING";
        
        // If running in Airtable but not in memory, add to memory
        if (isRunning && !lock) {
            logger.info(`[INFO] Job ${operation} for ${clientId} is running in Airtable but not in memory, adding memory lock`);
            runningJobs.set(lockKey, { 
                timestamp: Date.now(),
                jobId: jobStatus.jobId || `unknown_${Date.now()}`
            });
        }
        
        return isRunning;
    } catch (error) {
        logger.error(`Error checking if ${operation} is running for ${clientId}:`, error.message);
        await logCriticalError(error, { context: 'Service error (swallowed)', service: 'clientService.js' }).catch(() => {});
        return false; // Default to false (not running) on error
    }
}

/**
 * Set processing stream for a client
 * @param {string} clientId - The Client ID
 * @param {number} stream - Stream number (1, 2, 3, etc.)
 * @returns {Promise<boolean>} True if update was successful
 */
async function setProcessingStream(clientId, stream) {
    try {
        logger.info(`🔄 Setting processing stream for ${clientId}: ${stream}`);
        
        const base = initializeClientsBase();
        const client = await getClientById(clientId);
        
        if (!client) {
            throw new Error(`Client ${clientId} not found`);
        }

        await base('Clients').update([{
            id: client.id,
            fields: {
                'Processing Stream': stream
            }
        }]);

        logger.info(`✅ Processing stream set for ${clientId}: ${stream}`);
        
        // Invalidate cache
        clientsCache = null;
        clientsCacheTimestamp = null;

        return true;

    } catch (error) {
        logger.error(`❌ Error setting processing stream for ${clientId}:`, error.message);
        await logCriticalError(error, { context: 'Service error (swallowed)', service: 'clientService.js' }).catch(() => {});
        return false;
    }
}

/**
 * Get processing stream for a client
 * @param {string} clientId - The Client ID
 * @returns {Promise<number|null>} Stream number or null if not set
 */
async function getProcessingStream(clientId) {
    try {
        const client = await getClientById(clientId);
        if (!client) return null;

        return client.rawRecord?.get('Processing Stream') || null;

    } catch (error) {
        logger.error(`Error getting processing stream for ${clientId}:`, error.message);
        await logCriticalError(error, { context: 'Service error (swallowed)', service: 'clientService.js' }).catch(() => {});
        return null;
    }
}

/**
 * Format duration from milliseconds to human-readable string
 * @param {number} durationMs - Duration in milliseconds
 * @returns {string} Human-readable duration
 */
function formatDuration(durationMs) {
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        const remainingMinutes = minutes % 60;
        return `${hours}.${Math.floor(remainingMinutes / 6)} hours`;
    } else if (minutes > 0) {
        const remainingSeconds = seconds % 60;
        return `${minutes}.${Math.floor(remainingSeconds / 6)} minutes`;
    } else {
        return `${seconds} seconds`;
    }
}

/**
 * Get a specific client by ID with fresh data (bypasses cache)
 * Use this for security-sensitive operations like membership verification
 * @param {string} clientId - The client ID to search for
 * @returns {Promise<Object|null>} Client record or null if not found
 */
async function getClientByIdFresh(clientId) {
    try {
        logger.info(`Fetching fresh client data for ${clientId} (bypassing cache)`);
        
        // Force cache refresh by clearing it first
        const originalTimestamp = clientsCacheTimestamp;
        clientsCacheTimestamp = 0; // Force refresh
        
        const allClients = await getAllClients();
        
        // Restore original timestamp if fetch failed
        if (!allClients || allClients.length === 0) {
            clientsCacheTimestamp = originalTimestamp;
        }
        
        const client = allClients.find(c => c.clientId === clientId);
        
        if (client) {
            logger.info(`Found fresh client data: ${client.clientName}, Status: ${client.status}`);
        } else {
            logger.info(`Client not found (fresh fetch): ${clientId}`);
        }

        return client || null;

    } catch (error) {
        logger.error(`Error fetching fresh client ${clientId}:`, error);
        throw error;
    }
}

/**
 * Get all clients coached by a specific coach
 * @param {string} coachClientId - The client ID of the coach (e.g., "Guy-Wilson")
 * @returns {Array} - Array of clients being coached by this coach
 */
async function getClientsByCoach(coachClientId) {
    try {
        const allClients = await getAllClients();
        
        // Filter clients where Coach field matches the coachClientId
        const coachedClients = allClients.filter(c => 
            c.coach === coachClientId && 
            c.status === 'Active'  // Only return active clients
        );
        
        logger.info(`Found ${coachedClients.length} clients coached by ${coachClientId}`);
        
        // Return simplified data for coached clients (no sensitive fields)
        // Include record ID for task progress lookup
        return coachedClients.map(c => ({
            recordId: c.id,  // Airtable record ID for task lookup
            clientId: c.clientId,
            clientName: c.clientName,
            notionProgressUrl: c.notionProgressUrl,
            coachingStatus: c.coachingStatus,
            coachNotes: c.rawRecord?.get('Coach Notes') || null,
            status: c.status
        }));
        
    } catch (error) {
        logger.error(`Error fetching coached clients for ${coachClientId}:`, error);
        throw error;
    }
}

// ============================================
// COACHING SYSTEM FUNCTIONS
// ============================================

// Table names for coaching system
const COACHING_TABLES = {
    SYSTEM_SETTINGS: 'System Settings',
    TASK_TEMPLATES: 'Task Templates',
    CLIENT_TASKS: 'Client Tasks'
};

// Cache for system settings (refresh every 5 minutes)
let systemSettingsCache = null;
let systemSettingsCacheTimestamp = null;
const SETTINGS_CACHE_DURATION_MS = 5 * 60 * 1000;

/**
 * Get system settings (cached)
 * @returns {Promise<Object>} System settings object
 */
async function getSystemSettings() {
    try {
        // Return cached if valid
        if (systemSettingsCache && systemSettingsCacheTimestamp && 
            (Date.now() - systemSettingsCacheTimestamp) < SETTINGS_CACHE_DURATION_MS) {
            return systemSettingsCache;
        }

        const base = initializeClientsBase();
        const records = await base(COACHING_TABLES.SYSTEM_SETTINGS).select({
            maxRecords: 1
        }).firstPage();

        if (records.length === 0) {
            logger.warn('No system settings record found');
            return {};
        }

        const record = records[0];
        systemSettingsCache = {
            name: record.get('Name') || 'Production',
            coachingResourcesUrl: record.get('Coaching Resources URL') || null
        };
        systemSettingsCacheTimestamp = Date.now();

        logger.info('System settings loaded:', systemSettingsCache.name);
        return systemSettingsCache;

    } catch (error) {
        logger.error('Error fetching system settings:', error.message);
        throw error;
    }
}

/**
 * Get all active task templates
 * @returns {Promise<Array>} Array of task template objects
 */
async function getTaskTemplates() {
    try {
        const base = initializeClientsBase();
        const templates = [];

        await base(COACHING_TABLES.TASK_TEMPLATES).select({
            filterByFormula: `{Is Active} = "Yes"`,
            sort: [
                { field: 'Phase Order', direction: 'asc' },
                { field: 'Task Order', direction: 'asc' }
            ]
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                templates.push({
                    id: record.id,
                    taskName: record.get('Task Name') || '',
                    phase: record.get('Phase') || '',
                    phaseOrder: record.get('Phase Order') || 0,
                    taskOrder: record.get('Task Order') || 0,
                    instructionsUrl: record.get('Instructions URL') || null
                });
            });
            fetchNextPage();
        });

        logger.info(`Loaded ${templates.length} active task templates`);
        return templates;

    } catch (error) {
        logger.error('Error fetching task templates:', error.message);
        throw error;
    }
}

/**
 * Create client tasks from templates for a new client
 * @param {string} clientRecordId - Airtable record ID of the client
 * @param {string} clientName - Client name for logging
 * @returns {Promise<{success: boolean, tasksCreated: number}>}
 */
async function createClientTasksFromTemplates(clientRecordId, clientName) {
    try {
        const base = initializeClientsBase();
        
        // Get existing tasks for this client
        const existingTasks = [];
        await base(COACHING_TABLES.CLIENT_TASKS).select({
            filterByFormula: `FIND("${clientRecordId}", ARRAYJOIN({Client})) > 0`
        }).eachPage((records, fetchNextPage) => {
            existingTasks.push(...records);
            fetchNextPage();
        });

        // Get existing task names
        const existingTaskNames = new Set(existingTasks.map(t => t.get('Task')));

        // Get all active templates
        const templates = await getTaskTemplates();
        
        if (templates.length === 0) {
            logger.warn('No active task templates found');
            return { success: true, tasksCreated: 0, existingCount: existingTasks.length };
        }

        // Filter to only templates not yet assigned to this client
        const newTemplates = templates.filter(t => !existingTaskNames.has(t.taskName));

        if (newTemplates.length === 0) {
            logger.info(`Client ${clientName} already has all ${templates.length} tasks`);
            return { success: true, tasksCreated: 0, existingCount: existingTasks.length, alreadySynced: true };
        }

        // Create tasks in batches of 10 (Airtable limit)
        const tasksToCreate = newTemplates.map(template => ({
            fields: {
                'Task': template.taskName,
                'Client': [clientRecordId],
                'Phase': template.phase,
                'Phase Order': template.phaseOrder,
                'Task Order': template.taskOrder,
                'Instructions URL': template.instructionsUrl,
                'Status': 'Todo'
            }
        }));

        let tasksCreated = 0;
        const batchSize = 10;

        for (let i = 0; i < tasksToCreate.length; i += batchSize) {
            const batch = tasksToCreate.slice(i, i + batchSize);
            await base(COACHING_TABLES.CLIENT_TASKS).create(batch);
            tasksCreated += batch.length;
        }

        logger.info(`Synced ${tasksCreated} new tasks for client ${clientName} (had ${existingTasks.length} existing)`);
        return { success: true, tasksCreated, existingCount: existingTasks.length };

    } catch (error) {
        logger.error(`Error creating tasks for client ${clientName}:`, error.message);
        throw error;
    }
}

/**
 * Get client tasks for a specific client
 * @param {string} clientId - Client ID (name like "Keith-Sinclair")
 * @returns {Promise<Array>} Array of client task objects
 */
async function getClientTasks(clientId) {
    try {
        const base = initializeClientsBase();
        const tasks = [];

        // Filter by client name - ARRAYJOIN on linked records returns display names
        await base(COACHING_TABLES.CLIENT_TASKS).select({
            filterByFormula: `FIND("${clientId}", ARRAYJOIN({Client})) > 0`,
            sort: [
                { field: 'Phase Order', direction: 'asc' },
                { field: 'Task Order', direction: 'asc' }
            ]
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                tasks.push({
                    id: record.id,
                    task: record.get('Task') || '',
                    phase: record.get('Phase') || '',
                    phaseOrder: record.get('Phase Order') || 0,
                    taskOrder: record.get('Task Order') || 0,
                    status: record.get('Status') || 'Todo',
                    instructionsUrl: record.get('Instructions URL') || null,
                    notes: record.get('Notes') || ''
                });
            });
            fetchNextPage();
        });

        return tasks;

    } catch (error) {
        logger.error('Error fetching client tasks:', error.message);
        throw error;
    }
}

/**
 * Get task progress summary for a client
 * @param {string} clientId - Client ID (name like "Keith-Sinclair")
 * @returns {Promise<{total: number, completed: number, percentage: number}>}
 */
async function getClientTaskProgress(clientId) {
    try {
        const tasks = await getClientTasks(clientId);
        const total = tasks.length;
        const completed = tasks.filter(t => t.status === 'Done').length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

        return { total, completed, percentage };

    } catch (error) {
        logger.error('Error calculating task progress:', error.message);
        return { total: 0, completed: 0, percentage: 0 };
    }
}

/**
 * Update a task's status
 * @param {string} taskId - Airtable record ID of the task
 * @param {string} status - New status: "Todo", "In progress", or "Done"
 */
async function updateTaskStatus(taskId, status) {
    try {
        const base = initializeClientsBase();
        
        await base(COACHING_TABLES.CLIENT_TASKS).update(taskId, {
            'Status': status
        });
        
        logger.info(`Updated task ${taskId} status to ${status}`);
        return { success: true };
        
    } catch (error) {
        logger.error('Error updating task status:', error.message);
        throw error;
    }
}

/**
 * Update a task's notes
 * @param {string} taskId - Airtable record ID of the task
 * @param {string} notes - The new notes
 */
async function updateTaskNotes(taskId, notes) {
    try {
        const base = initializeClientsBase();
        
        await base(COACHING_TABLES.CLIENT_TASKS).update(taskId, {
            'Notes': notes || ''
        });
        
        logger.info(`Updated task ${taskId} notes`);
        return { success: true };
        
    } catch (error) {
        logger.error('Error updating task notes:', error.message);
        throw error;
    }
}

/**
 * Update coach notes for a client
 * @param {string} clientRecordId - Airtable record ID of the client
 * @param {string} notes - The new coach notes
 */
async function updateCoachNotes(clientRecordId, notes) {
    try {
        const base = initializeClientsBase();
        
        await base('Clients').update(clientRecordId, {
            'Coach Notes': notes || ''
        });
        
        // Clear cache so the updated notes are reflected
        clearCache();
        
        logger.info(`Updated coach notes for client ${clientRecordId}`);
        return { success: true };
        
    } catch (error) {
        logger.error('Error updating coach notes:', error.message);
        throw error;
    }
}

/**
 * Clear system settings cache (for testing)
 */
function clearSystemSettingsCache() {
    systemSettingsCache = null;
    systemSettingsCacheTimestamp = null;
}

module.exports = {
    getAllClients,
    getAllActiveClients,
    getActiveClients,  // Add the new function
    getActiveClientsByStream,  // Add stream filtering function
    getClientById,
    getClientByIdFresh, // Add fresh fetch function for security checks
    getClientByWpUserId, // Add the new WP User ID lookup function
    getClientsByCoach,  // Get clients coached by a specific coach
    validateClient,
    // CRR REDESIGN: updateExecutionLog removed (replaced by Progress Log in jobTracking.js)
    logExecution,     // Add the new logging function
    formatExecutionLog,
    clearCache,
    getClientTokenLimits,  // Add the new token limits function
    getClientBase,     // Add the new base connection function
    initializeClientsBase,  // Export the base initialization function
    // Floor system functions
    getClientFloorConfig,
    updateClientFloorConfig,
    validateLeadAgainstFloor,
    getFloorValidationSummary,
    // Fire-and-forget tracking functions
    generateJobId,
    setJobStatus,
    getJobStatus,
    isJobRunning,  // Add the new job status checker
    setProcessingStream,
    getProcessingStream,
    formatDuration,
    // Coaching system functions
    getSystemSettings,
    getTaskTemplates,
    createClientTasksFromTemplates,
    getClientTasks,
    getClientTaskProgress,
    updateTaskStatus,
    updateTaskNotes,
    updateCoachNotes,
    clearSystemSettingsCache
};
