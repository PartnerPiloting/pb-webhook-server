// services/clientService.js
// Client management service for multi-tenant operations
// Handles reading from Clients base and managing client configurations

require('dotenv').config();
const Airtable = require('airtable');

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
                clients.push({
                    id: record.id,
                    clientId: record.get('Client ID'),
                    clientName: record.get('Client Name'),
                    status: record.get('Status'),
                    airtableBaseId: record.get('Airtable Base ID'),
                    executionLog: record.get('Execution Log') || ''
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
 * Clear the clients cache (useful for testing or forced refresh)
 */
function clearCache() {
    clientsCache = null;
    clientsCacheTimestamp = null;
    console.log("Clients cache cleared");
}

module.exports = {
    getAllClients,
    getAllActiveClients,
    getClientById,
    validateClient,
    updateExecutionLog,
    formatExecutionLog,
    clearCache
};
