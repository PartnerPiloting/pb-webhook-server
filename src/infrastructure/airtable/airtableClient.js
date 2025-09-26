/**
 * airtableClient.js
 * Manages Airtable connections for both master and client-specific bases.
 * Handles connection pooling and caching to improve performance.
 */

require('dotenv').config();
const Airtable = require('airtable');
const { Logger } = require('../logging/logger');

const logger = new Logger('SYSTEM', null, 'airtable');

// Initialize client base connection cache
const baseCache = {};
const clientCache = {};
const CLIENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get master clients base
 * @returns {Object} Airtable base for master clients
 */
function getMasterClientsBase() {
  // Check if we have a cached connection
  if (baseCache.masterClients) {
    return baseCache.masterClients;
  }

  // Validate environment variables
  if (!process.env.MASTER_CLIENTS_BASE_ID) {
    throw new Error("MASTER_CLIENTS_BASE_ID environment variable is not set");
  }
  if (!process.env.AIRTABLE_API_KEY) {
    throw new Error("AIRTABLE_API_KEY environment variable is not set");
  }

  // Configure Airtable
  Airtable.configure({
    apiKey: process.env.AIRTABLE_API_KEY
  });

  // Create the base connection
  baseCache.masterClients = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
  logger.info("Master clients base initialized");
  
  return baseCache.masterClients;
}

/**
 * Get client information by ID
 * @param {string} clientId - The client ID
 * @returns {Promise<Object>} Client information
 */
async function getClient(clientId) {
  // Check if we have a cached client
  const now = Date.now();
  if (
    clientCache[clientId] && 
    clientCache[clientId].data && 
    now - clientCache[clientId].timestamp < CLIENT_CACHE_TTL
  ) {
    logger.debug(`Using cached client data for ${clientId}`);
    return clientCache[clientId].data;
  }

  // Query Airtable for client info
  const base = getMasterClientsBase();
  
  try {
    const clientRecords = await base('Clients').select({
      filterByFormula: `{Client ID} = '${clientId}'`,
      maxRecords: 1
    }).firstPage();
    
    if (!clientRecords || clientRecords.length === 0) {
      logger.warn(`Client not found: ${clientId}`);
      return null;
    }

    const clientRecord = clientRecords[0];
    const client = {
      id: clientRecord.id,
      clientId: clientRecord.get('Client ID'),
      clientName: clientRecord.get('Client Name'),
      status: clientRecord.get('Status'),
      serviceLevel: clientRecord.get('Service Level'),
      stream: clientRecord.get('Stream') || '1',
      postsDailyTarget: clientRecord.get('Posts Daily Target') || 0,
      leadsBatchSizeForPostCollection: clientRecord.get('Leads Batch Size For Post Collection') || 20,
      maxPostBatchesPerDayGuardrail: clientRecord.get('Max Post Batches Per Day Guardrail') || 10,
      icpDescription: clientRecord.get('ICP Description')
    };

    // Cache the client
    clientCache[clientId] = {
      timestamp: now,
      data: client
    };

    return client;
  } catch (error) {
    logger.error(`Error fetching client ${clientId}: ${error.message}`, error.stack);
    throw error;
  }
}

/**
 * Get client-specific Airtable base by client ID
 * @param {string} clientId - The client ID
 * @returns {Promise<Object>} Airtable base for the client
 */
async function getClientBase(clientId) {
  // Check if we have a cached client
  const client = await getClient(clientId);
  
  if (!client) {
    throw new Error(`Client not found: ${clientId}`);
  }
  
  // Check for cached base
  const cacheKey = `client_${clientId}`;
  if (baseCache[cacheKey]) {
    return baseCache[cacheKey];
  }
  
  // Get the base ID for the client
  const masterBase = getMasterClientsBase();
  const baseRecords = await masterBase('Client Airtable Bases').select({
    filterByFormula: `{Client ID} = '${clientId}'`,
    maxRecords: 1
  }).firstPage();
  
  if (!baseRecords || baseRecords.length === 0) {
    throw new Error(`No Airtable base found for client: ${clientId}`);
  }
  
  const baseId = baseRecords[0].get('Base ID');
  if (!baseId) {
    throw new Error(`Base ID not found for client: ${clientId}`);
  }
  
  // Create the base connection
  baseCache[cacheKey] = Airtable.base(baseId);
  logger.info(`Initialized base connection for client ${clientId}`);
  
  return baseCache[cacheKey];
}

/**
 * Clear client cache - useful for testing and after client updates
 * @param {string} [clientId] - Optional client ID to clear specific client
 */
function clearClientCache(clientId = null) {
  if (clientId) {
    delete clientCache[clientId];
    delete baseCache[`client_${clientId}`];
    logger.debug(`Cleared cache for client ${clientId}`);
  } else {
    Object.keys(clientCache).forEach(key => delete clientCache[key]);
    Object.keys(baseCache).forEach(key => {
      if (key.startsWith('client_')) {
        delete baseCache[key];
      }
    });
    logger.debug('Cleared all client caches');
  }
}

module.exports = {
  getMasterClientsBase,
  getClient,
  getClientBase,
  clearClientCache
};