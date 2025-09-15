// services/clientService.js
// Client management service for multi-tenant operations
// Handles reading from Clients base and managing client configurations

require('dotenv').config();
const Airtable = require('airtable');
const { parseServiceLevel } = require('../utils/serviceLevel');

// Cache for client data to avoid repeated API calls
let clientsCache = null;
let clientsCacheTimestamp = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

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
    console.log("Clients base initialized successfully");
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
    try {
        // Return cached data if valid
        if (isCacheValid()) {
            console.log("Returning cached client data");
            return clientsCache;
        }

        const base = initializeClientsBase();
        const clients = [];

        console.log("Fetching all clients from Clients base...");

        await base('Clients').select({
            // No filter - get all clients
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                const clientId = record.get('Client ID');
                const clientName = record.get('Client Name');
                const status = record.get('Status');
                const airtableBaseId = record.get('Airtable Base ID');
                const executionLog = record.get('Execution Log') || '';
                const wpUserId = record.get('WordPress User ID');
                const serviceLevelRaw = record.get('Service Level') || 1;
                const serviceLevel = parseServiceLevel(serviceLevelRaw); // Parse "2-Lead Scoring + Post Scoring" → 2
                const comment = record.get('Comment') || '';
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
                
                clients.push({
                    id: record.id,
                    clientId: clientId,
                    clientName: clientName,
                    status: status,
                    airtableBaseId: airtableBaseId,
                    executionLog: executionLog,
                    wpUserId: wpUserId,
                    serviceLevel: serviceLevel,
                    comment: comment,
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
                    autoAdjustFloors: autoAdjustFloors
                });
            });
            fetchNextPage();
        });

        // Update cache
        clientsCache = clients;
        clientsCacheTimestamp = Date.now();

        console.log(`Retrieved ${clients.length} clients from Clients base`);
        return clients;

    } catch (error) {
        console.error("Error fetching all clients:", error);
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

        console.log(`Found ${activeClients.length} active clients out of ${allClients.length} total`);
        return activeClients;

    } catch (error) {
        console.error("Error fetching active clients:", error);
        throw error;
    }
}

/**
 * Get a specific client by Client ID
 * @param {string} clientId - The Client ID to search for
 * @returns {Promise<Object|null>} Client record or null if not found
 */
async function getClientById(clientId) {
    try {
        const allClients = await getAllClients();
        const client = allClients.find(c => c.clientId === clientId);
        
        if (client) {
            console.log(`Found client: ${client.clientName} (${clientId})`);
        } else {
            console.log(`Client not found: ${clientId}`);
        }

        return client || null;

    } catch (error) {
        console.error(`Error fetching client ${clientId}:`, error);
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
            console.log(`Found client by WP User ID ${wpUserId}: ${client.clientName} (${client.clientId})`);
        } else {
            console.log(`Client not found for WP User ID: ${wpUserId}`);
        }

        return client || null;

    } catch (error) {
        console.error(`Error fetching client by WP User ID ${wpUserId}:`, error);
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
        
        console.log(`Client validation for ${clientId}: ${isValid ? 'VALID' : 'INVALID'}`);
        return isValid;

    } catch (error) {
        console.error(`Error validating client ${clientId}:`, error);
        return false;
    }
}

/**
 * Update the execution log for a specific client
 * @param {string} clientId - The Client ID to update
 * @param {string} logEntry - The log entry to append
 * @returns {Promise<boolean>} True if update was successful
 */
async function updateExecutionLog(clientId, logEntry) {
    try {
        const base = initializeClientsBase();
        
        // First, get the client's Airtable record ID
        const client = await getClientById(clientId);
        if (!client) {
            throw new Error(`Client ${clientId} not found`);
        }

        // Get current log and append new entry
        const currentLog = client.executionLog || '';
        const updatedLog = currentLog ? `${logEntry}\n\n${currentLog}` : logEntry;

        // Update the record
        await base('Clients').update([
            {
                id: client.id,
                fields: {
                    'Execution Log': updatedLog
                }
            }
        ]);

        console.log(`Execution log updated for client ${clientId}`);
        
        // Invalidate cache to force refresh on next read
        clientsCache = null;
        clientsCacheTimestamp = null;

        return true;

    } catch (error) {
        console.error(`Error updating execution log for client ${clientId}:`, error);
        throw error;
    }
}

/**
 * Create a formatted execution log entry
 * @param {Object} executionData - Data about the execution
 * @returns {string} Formatted log entry
 */
function formatExecutionLog(executionData) {
    const {
        status = 'Unknown',
        leadsProcessed = { successful: 0, failed: 0, total: 0 },
        postScoring = { successful: 0, failed: 0, total: 0 },
        duration = 'Unknown',
        tokensUsed = 0,
        errors = [],
        performance = {},
        nextAction = ''
    } = executionData;

    const timestamp = new Date().toISOString();
    
    let logEntry = `=== EXECUTION: ${timestamp} ===\n`;
    logEntry += `STATUS: ${status}\n`;
    logEntry += `LEADS PROCESSED: ${leadsProcessed.successful}/${leadsProcessed.total} successful\n`;
    
    if (postScoring.total > 0) {
        logEntry += `POST SCORING: ${postScoring.successful}/${postScoring.total} successful\n`;
    }
    
    logEntry += `DURATION: ${duration}\n`;
    logEntry += `TOKENS USED: ${tokensUsed}\n`;

    if (errors.length > 0) {
        logEntry += `\nERRORS:\n`;
        errors.forEach(error => {
            logEntry += `- ${error}\n`;
        });
    }

    if (Object.keys(performance).length > 0) {
        logEntry += `\nPERFORMANCE:\n`;
        Object.entries(performance).forEach(([key, value]) => {
            logEntry += `- ${key}: ${value}\n`;
        });
    }

    if (nextAction) {
        logEntry += `\nNEXT ACTION: ${nextAction}`;
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
        let logEntry;
        
        if (executionData.type === 'POST_SCORING') {
            // For post scoring, format the log appropriately
            const formattedData = {
                status: executionData.status || 'Unknown',
                leadsProcessed: { successful: 0, failed: 0, total: 0 }, // No leads processed in post scoring
                postScoring: { 
                    successful: executionData.postsScored || 0, 
                    failed: (executionData.postsProcessed || 0) - (executionData.postsScored || 0),
                    total: executionData.postsProcessed || 0
                },
                duration: `${executionData.duration || 0}s`,
                tokensUsed: 0, // We don't track tokens in post scoring yet
                errors: executionData.errorDetails || []
            };
            logEntry = formatExecutionLog(formattedData);
        } else {
            // For lead scoring or other types, use the existing format
            logEntry = formatExecutionLog(executionData);
        }

        return await updateExecutionLog(clientId, logEntry);

    } catch (error) {
        console.error(`Error logging execution for client ${clientId}:`, error);
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
                console.log(`Client ${clientId} not found`);
                return [];
            }
            if (client.status !== 'Active') {
                console.log(`Client ${clientId} is not active (status: ${client.status})`);
                return [];
            }
            return [client];
        } else {
            // Get all active clients
            return await getAllActiveClients();
        }
    } catch (error) {
        console.error("Error in getActiveClients:", error);
        throw error;
    }
}

/**
 * Clear the clients cache (useful for testing or forced refresh)
 */
function clearCache() {
    clientsCache = null;
    clientsCacheTimestamp = null;
    console.log("Clients cache cleared");
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
            console.log(`Client not found for token limits: ${clientId}`);
            return null;
        }

        return {
            profileLimit: client.profileScoringTokenLimit,
            postLimit: client.postScoringTokenLimit,
            clientName: client.clientName
        };

    } catch (error) {
        console.error(`Error getting token limits for client ${clientId}:`, error);
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
            console.log(`Client not found for floor config: ${clientId}`);
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
        console.error(`Error getting floor config for client ${clientId}:`, error);
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

        console.log(`Floor configuration updated for client ${clientId}:`, updateFields);
        
        // Invalidate cache to force refresh on next read
        clientsCache = null;
        clientsCacheTimestamp = null;

        return true;

    } catch (error) {
        console.error(`Error updating floor config for client ${clientId}:`, error);
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
 * Clear the clients cache (useful for testing or forced refresh)
 */
function clearCache() {
    clientsCache = null;
    clientsCacheTimestamp = null;
    console.log("Client cache cleared");
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
    console.log(`Created Airtable base connection for: ${airtableBaseId}`);
    return base;
}

module.exports = {
    getAllClients,
    getAllActiveClients,
    getActiveClients,  // Add the new function
    getClientById,
    getClientByWpUserId, // Add the new WP User ID lookup function
    validateClient,
    updateExecutionLog,
    logExecution,     // Add the new logging function
    formatExecutionLog,
    clearCache,
    getClientTokenLimits,  // Add the new token limits function
    getClientBase,     // Add the new base connection function
    // Floor system functions
    getClientFloorConfig,
    updateClientFloorConfig,
    validateLeadAgainstFloor,
    getFloorValidationSummary
};
