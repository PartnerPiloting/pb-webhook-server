// config/airtableClient.js
// Ensure environment variables are loaded. index.js should also do this,
// but it's good practice for config files.
require('dotenv').config();

const Airtable = require('airtable');

let airtableBaseInstance = null; // This will hold our initialized Airtable base

// Cache for base instances to avoid repeated initialization
const baseInstanceCache = new Map();

try {
    // Check for essential environment variables
    if (!process.env.AIRTABLE_API_KEY) {
        throw new Error("Airtable Client Config: AIRTABLE_API_KEY environment variable is not set.");
    }
    if (!process.env.AIRTABLE_BASE_ID) {
        throw new Error("Airtable Client Config: AIRTABLE_BASE_ID environment variable is not set.");
    }

    // Configure the Airtable client with your API key
    Airtable.configure({
        // endpointURL: 'https://api.airtable.com', // Usually not needed to specify
        apiKey: process.env.AIRTABLE_API_KEY
    });

    // Get the specific base you want to use with your Base ID
    airtableBaseInstance = Airtable.base(process.env.AIRTABLE_BASE_ID);

    console.log("Airtable Client Initialized successfully in config/airtableClient.js.");

} catch (error) {
    console.error("CRITICAL ERROR: Failed to initialize Airtable Client in config/airtableClient.js:", error.message);
    // airtableBaseInstance will remain null if an error occurs
    // The main application (index.js) will need to handle this possibility.
}

/**
 * Create a base instance for a specific base ID (Multi-tenant function)
 * @param {string} baseId - The Airtable base ID
 * @returns {Object} Airtable base instance
 */
function createBaseInstance(baseId) {
    console.log(`[DEBUG-EXTREME] createBaseInstance CALLED with baseId=${baseId}`);
    
    if (!baseId) {
        console.error(`[DEBUG-EXTREME] ERROR: Base ID is required to create base instance`);
        throw new Error("Base ID is required to create base instance");
    }

    // Check cache first
    if (baseInstanceCache.has(baseId)) {
        console.log(`[DEBUG-EXTREME] Using cached base instance for: ${baseId}`);
        return baseInstanceCache.get(baseId);
    }

    try {
        // Ensure Airtable is configured
        if (!process.env.AIRTABLE_API_KEY) {
            console.error(`[DEBUG-EXTREME] ERROR: AIRTABLE_API_KEY environment variable is not set`);
            throw new Error("AIRTABLE_API_KEY environment variable is not set");
        }

        console.log(`[DEBUG-EXTREME] Configuring Airtable with API key: ${process.env.AIRTABLE_API_KEY.substring(0, 5)}...`);
        // Configure Airtable if not already done (should be safe to call multiple times)
        Airtable.configure({
            apiKey: process.env.AIRTABLE_API_KEY
        });

        // Create new base instance
        console.log(`[DEBUG-EXTREME] Creating new Airtable.base with baseId=${baseId}`);
        const baseInstance = Airtable.base(baseId);
        console.log(`[DEBUG-EXTREME] Base instance created successfully`);
        
        // Cache the instance
        console.log(`[DEBUG-EXTREME] Caching base instance for baseId=${baseId}`);
        baseInstanceCache.set(baseId, baseInstance);
        
        console.log(`[DEBUG-EXTREME] Successfully created new base instance for: ${baseId}`);
        return baseInstance;

    } catch (error) {
        console.error(`Error creating base instance for ${baseId}:`, error.message);
        throw error;
    }
}

/**
 * Get base instance for a specific client (Multi-tenant function)
 * @param {string} clientId - The client ID to get base for
 * @returns {Promise<Object>} Airtable base instance for the client
 */
async function getClientBase(clientId) {
    console.log(`[DEBUG-EXTREME] getClientBase CALLED with clientId=${clientId}`);
    
    try {
        // Import client service here to avoid circular dependencies
        console.log(`[DEBUG-EXTREME] Importing clientService...`);
        const clientService = require('../services/clientService');
        console.log(`[DEBUG-EXTREME] clientService imported successfully`);
        
        // Get client configuration
        console.log(`[DEBUG-EXTREME] Calling clientService.getClientById with ${clientId}`);
        const client = await clientService.getClientById(clientId);
        console.log(`[DEBUG-EXTREME] clientService.getClientById result: ${client ? 'FOUND' : 'NOT FOUND'}`);
        
        if (!client) {
            console.error(`[DEBUG-EXTREME] ERROR: Client not found: ${clientId}`);
            throw new Error(`Client not found: ${clientId}`);
        }

        if (!client.airtableBaseId) {
            console.error(`[DEBUG-EXTREME] ERROR: No Airtable base ID configured for client: ${clientId}`);
            throw new Error(`No Airtable base ID configured for client: ${clientId}`);
        }

        console.log(`[DEBUG-EXTREME] Getting base for client ${clientId}: ${client.airtableBaseId}`);
        const baseInstance = createBaseInstance(client.airtableBaseId);
        console.log(`[DEBUG-EXTREME] Base instance created: ${baseInstance ? 'SUCCESS' : 'FAILED'}`);
        return baseInstance;
    } catch (error) {
        console.error(`Error getting base for client ${clientId}:`, error.message);
        throw error;
    }
}

/**
 * Clear base instance cache (useful for testing or memory management)
 */
function clearBaseCache() {
    baseInstanceCache.clear();
    console.log("Base instance cache cleared");
}

/**
 * Get the default base (backward compatibility)
 * @returns {Object} The default Airtable base instance
 */
function getDefaultBase() {
    return airtableBaseInstance;
}

/**
 * Get the Master Clients base instance
 * @returns {Object} Airtable base instance for Master Clients base
 */
function getMasterClientsBase() {
    if (!process.env.MASTER_CLIENTS_BASE_ID) {
        throw new Error("MASTER_CLIENTS_BASE_ID environment variable is not set");
    }
    return createBaseInstance(process.env.MASTER_CLIENTS_BASE_ID);
}

// Export the initialized base instance (UNCHANGED - maintains backward compatibility)
module.exports = airtableBaseInstance;

// Export new multi-tenant functions
module.exports.createBaseInstance = createBaseInstance;
module.exports.getClientBase = getClientBase;
module.exports.clearBaseCache = clearBaseCache;
module.exports.getDefaultBase = getDefaultBase;
module.exports.getMasterClientsBase = getMasterClientsBase;