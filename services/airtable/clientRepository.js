/**
 * services/airtable/clientRepository.js
 * 
 * Repository for client operations in the Master Clients base.
 * Handles CRUD operations for client records and client run tracking.
 */

const { StructuredLogger } = require('../../utils/structuredLogger');
const baseManager = require('./baseManager');
const { 
  CLIENT_EXECUTION_LOG_FIELDS,
  CLIENT_RUN_FIELDS,
  MASTER_TABLES,
  CLIENT_FIELDS
} = require('../../constants/airtableUnifiedConstants');
// Updated to use unified run ID service
const runIdService = require('../../services/unifiedRunIdService');

// Default logger
const logger = new StructuredLogger('SYSTEM', null, 'client_repository');

// Cache for client data to avoid repeated API calls
let clientsCache = null;
let clientsCacheTimestamp = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

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
      logger.debug(`Returning cached client data (${clientsCache ? clientsCache.length : 0} clients)`);
      return clientsCache;
    }

    logger.debug("Fetching all clients from Clients base...");
    const masterBase = baseManager.getMasterClientsBase();
    const clients = [];

    await masterBase(MASTER_TABLES.CLIENTS).select({
      // No filter - get all clients
    }).eachPage((records, fetchNextPage) => {
      records.forEach(record => {
        const clientId = record.get(CLIENT_FIELDS.CLIENT_ID);
        const clientName = record.get(CLIENT_FIELDS.CLIENT_NAME);
        const status = record.get(CLIENT_FIELDS.STATUS);
        const airtableBaseId = record.get(CLIENT_FIELDS.AIRTABLE_BASE_ID);
        const executionLog = record.get(CLIENT_EXECUTION_LOG_FIELDS.EXECUTION_LOG) || '';
        const wpUserId = record.get(CLIENT_FIELDS.WORDPRESS_USER_ID);
        const serviceLevelRaw = record.get(CLIENT_FIELDS.SERVICE_LEVEL) || 1;
        // Parse service level from string (e.g., "2-Lead Scoring + Post Scoring" → 2)
        const serviceLevel = parseInt(String(serviceLevelRaw).split('-')[0], 10) || 1;
        const comment = record.get(CLIENT_FIELDS.COMMENT) || '';
        const clientFirstName = record.get(CLIENT_FIELDS.CLIENT_FIRST_NAME) || '';
        const clientEmailAddress = record.get(CLIENT_FIELDS.CLIENT_EMAIL_ADDRESS) || '';
        const profileScoringTokenLimit = record.get(CLIENT_FIELDS.PROFILE_SCORING_TOKEN_LIMIT) || 5000;
        const postScoringTokenLimit = record.get(CLIENT_FIELDS.POST_SCORING_TOKEN_LIMIT) || 3000;
        const postsDailyTarget = record.get(CLIENT_FIELDS.POSTS_DAILY_TARGET) || 0;
        const leadsBatchSizeForPostCollection = record.get(CLIENT_FIELDS.LEADS_BATCH_SIZE_FOR_POST_COLLECTION) || 20;
        const maxPostBatchesPerDayGuardrail = record.get(CLIENT_FIELDS.MAX_POST_BATCHES_PER_DAY_GUARDRAIL) || 10;
        const primaryFloor = record.get(CLIENT_FIELDS.PRIMARY_FLOOR) || 70;
        const secondaryFloor = record.get(CLIENT_FIELDS.SECONDARY_FLOOR) || 50;
        const minimumFloor = record.get(CLIENT_FIELDS.MINIMUM_FLOOR) || 30;

        clients.push({
          id: record.id,
          clientId,
          clientName,
          status,
          airtableBaseId,
          executionLog,
          wpUserId,
          serviceLevel,
          comment,
          clientFirstName,
          clientEmailAddress,
          profileScoringTokenLimit,
          postScoringTokenLimit,
          postsDailyTarget,
          leadsBatchSizeForPostCollection,
          maxPostBatchesPerDayGuardrail,
          primaryFloor,
          secondaryFloor,
          minimumFloor
        });
      });

      fetchNextPage();
    });

    // Update cache
    clientsCache = clients;
    clientsCacheTimestamp = Date.now();
    logger.debug(`Updated clients cache with ${clients.length} clients`);

    return clients;
  } catch (error) {
    logger.error(`Error fetching all clients: ${error.message}`);
    throw error;
  }
}

/**
 * Get a client by ID
 * @param {string} clientId - Client ID to find
 * @returns {Promise<Object|null>} Client record or null if not found
 */
async function getClientById(clientId) {
  if (!clientId) {
    logger.error("Client ID is required to get client");
    throw new Error("Client ID is required to get client");
  }

  try {
    // Try to get from cache first
    const clients = await getAllClients();
    const client = clients.find(c => c.clientId === clientId);
    
    if (client) {
      logger.debug(`Found client ${clientId} in cache`);
      return client;
    }
    
    logger.warn(`Client ${clientId} not found in cache or database`);
    return null;
  } catch (error) {
    logger.error(`Error getting client ${clientId}: ${error.message}`);
    throw error;
  }
}

/**
 * Create a client run record
 * @param {string} runId - Run ID (with or without client suffix)
 * @param {string} clientId - Client ID
 * @param {string} [clientName] - Optional client name (will be looked up if not provided)
 * @returns {Promise<Object>} Created record
 */
async function createClientRunRecord(runId, clientId, clientName) {
  if (!runId || !clientId) {
    logger.error("Run ID and Client ID are required to create client run record");
    throw new Error("Run ID and Client ID are required to create client run record");
  }

  try {
    // Ensure runId has client suffix
    const standardRunId = runIdService.addClientSuffix(
      runIdService.stripClientSuffix(runId),
      clientId
    );
    
    // Get client info if name not provided
    let resolvedClientName = clientName;
    if (!resolvedClientName) {
      const client = await getClientById(clientId);
      if (client) {
        resolvedClientName = client.clientName;
      } else {
        resolvedClientName = clientId; // Fallback to using ID as name
      }
    }
    
    // Create record in master base
    const masterBase = baseManager.getMasterClientsBase();
    
    const startTime = new Date().toISOString();
    const baseRunId = runIdService.stripClientSuffix(standardRunId);
    
    const record = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).create({
      [CLIENT_RUN_FIELDS.RUN_ID]: standardRunId,
      [CLIENT_RUN_FIELDS.CLIENT_ID]: clientId,
      [CLIENT_RUN_FIELDS.CLIENT_NAME]: resolvedClientName,
      [CLIENT_RUN_FIELDS.START_TIME]: startTime,
      [CLIENT_RUN_FIELDS.STATUS]: 'Running'
    });
    
    logger.debug(`Created client run record for ${clientId}: ${standardRunId}`);
    
    return {
      id: record.id,
      runId: standardRunId,
      baseRunId: baseRunId,
      clientId,
      clientName: resolvedClientName,
      startTime,
      status: 'Running'
    };
  } catch (error) {
    logger.error(`Error creating client run record: ${error.message}`);
    throw error;
  }
}

/**
 * Update a client run record
 * @param {string} runId - Run ID (with or without client suffix)
 * @param {string} clientId - Client ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated record
 */
async function updateClientRunRecord(runId, clientId, updates) {
  if (!runId || !clientId) {
    logger.error("Run ID and Client ID are required to update client run record");
    throw new Error("Run ID and Client ID are required to update client run record");
  }

  try {
    // Ensure runId has client suffix
    const standardRunId = runIdService.addClientSuffix(
      runIdService.stripClientSuffix(runId),
      clientId
    );
    
    // Find record in master base
    const masterBase = baseManager.getMasterClientsBase();
    
    // Find the record by Run ID and Client
    let recordId = null;
    const records = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).select({
      filterByFormula: `AND({Run ID} = '${standardRunId}', {Client ID} = '${clientId}')` // Fixed from 'Client' to 'Client ID' to match Airtable schema
    }).firstPage();
    
    if (records.length > 0) {
      recordId = records[0].id;
    } else {
      // Record not found, create it
      logger.warn(`Run record for ${standardRunId} not found, creating it...`);
      const newRecord = await createClientRunRecord(standardRunId, clientId);
      recordId = newRecord.id;
    }
    
    // Prepare update fields
    const updateFields = {};
    
    // Map update keys to Airtable field names using constants
    // Check if properties exist (not undefined) rather than if they're truthy

    if ('status' in updates || CLIENT_RUN_FIELDS.STATUS in updates) updateFields[CLIENT_RUN_FIELDS.STATUS] = 'status' in updates ? updates.status : updates[CLIENT_RUN_FIELDS.STATUS];
    if ('endTime' in updates || CLIENT_RUN_FIELDS.END_TIME in updates) updateFields[CLIENT_RUN_FIELDS.END_TIME] = 'endTime' in updates ? updates.endTime : updates[CLIENT_RUN_FIELDS.END_TIME];
    if ('leadsProcessed' in updates || CLIENT_RUN_FIELDS.PROFILES_EXAMINED in updates) updateFields[CLIENT_RUN_FIELDS.PROFILES_EXAMINED] = 'leadsProcessed' in updates ? updates.leadsProcessed : updates[CLIENT_RUN_FIELDS.PROFILES_EXAMINED];
    if ('postsProcessed' in updates || CLIENT_RUN_FIELDS.POSTS_EXAMINED in updates) updateFields[CLIENT_RUN_FIELDS.POSTS_EXAMINED] = 'postsProcessed' in updates ? updates.postsProcessed : updates[CLIENT_RUN_FIELDS.POSTS_EXAMINED];
    if ('errors' in updates || CLIENT_RUN_FIELDS.ERRORS in updates) updateFields[CLIENT_RUN_FIELDS.ERRORS] = 'errors' in updates ? updates.errors : updates[CLIENT_RUN_FIELDS.ERRORS];
    if ('notes' in updates || CLIENT_RUN_FIELDS.SYSTEM_NOTES in updates) updateFields[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = 'notes' in updates ? updates.notes : updates[CLIENT_RUN_FIELDS.SYSTEM_NOTES];
    if ('tokenUsage' in updates || CLIENT_RUN_FIELDS.TOTAL_TOKENS_USED in updates) updateFields[CLIENT_RUN_FIELDS.TOTAL_TOKENS_USED] = 'tokenUsage' in updates ? updates.tokenUsage : updates[CLIENT_RUN_FIELDS.TOTAL_TOKENS_USED];
    if ('promptTokens' in updates || CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS in updates) updateFields[CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS] = 'promptTokens' in updates ? updates.promptTokens : updates[CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS]; // Using the same field for now
    if (updates.completionTokens) updateFields['Completion Tokens'] = updates.completionTokens;
    if (updates.totalTokens) updateFields['Total Tokens'] = updates.totalTokens;
    
    // Update the record
    const record = await masterBase(MASTER_TABLES.CLIENT_RUN_RESULTS).update(recordId, updateFields);
    
    logger.debug(`Updated client run record for ${clientId}: ${standardRunId}`);
    
    return {
      id: record.id,
      runId: standardRunId,
      clientId,
      ...updates
    };
  } catch (error) {
    logger.error(`Error updating client run record: ${error.message}`);
    throw error;
  }
}

/**
 * Complete a client run record
 * @param {string} runId - Run ID (with or without client suffix)
 * @param {string} clientId - Client ID
 * @param {Object} metrics - Completion metrics
 * @returns {Promise<Object>} Updated record
 */
async function completeClientRunRecord(runId, clientId, metrics = {}) {
  if (!runId || !clientId) {
    logger.error("Run ID and Client ID are required to complete client run record");
    throw new Error("Run ID and Client ID are required to complete client run record");
  }

  try {
    const endTime = new Date().toISOString();
    
    // Update with completion status and metrics
    return await updateClientRunRecord(runId, clientId, {
      status: 'Completed',
      endTime,
      ...metrics
    });
  } catch (error) {
    logger.error(`Error completing client run record: ${error.message}`);
    throw error;
  }
}

/**
 * Clear the clients cache
 */
function clearClientsCache() {
  clientsCache = null;
  clientsCacheTimestamp = null;
  logger.debug("Clients cache cleared");
}

module.exports = {
  getAllClients,
  getClientById,
  createClientRunRecord,
  updateClientRunRecord,
  completeClientRunRecord,
  clearClientsCache
};