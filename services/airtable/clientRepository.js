/**
 * services/airtable/clientRepository.js
 * 
 * Repository for client operations in the Master Clients base.
 * Handles CRUD operations for client records and client run tracking.
 */

const { StructuredLogger } = require('../../utils/structuredLogger');
const baseManager = require('./baseManager');
const runIdService = require('./runIdService');

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

    await masterBase('Clients').select({
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
        // Parse service level from string (e.g., "2-Lead Scoring + Post Scoring" → 2)
        const serviceLevel = parseInt(String(serviceLevelRaw).split('-')[0], 10) || 1;
        const comment = record.get('Comment') || '';
        const clientFirstName = record.get('Client First Name') || '';
        const clientEmailAddress = record.get('Client Email Address') || '';
        const profileScoringTokenLimit = record.get('Profile Scoring Token Limit') || 5000;
        const postScoringTokenLimit = record.get('Post Scoring Token Limit') || 3000;
        const postsDailyTarget = record.get('Posts Daily Target') || 0;
        const leadsBatchSizeForPostCollection = record.get('Leads Batch Size for Post Collection') || 20;
        const maxPostBatchesPerDayGuardrail = record.get('Max Post Batches Per Day Guardrail') || 10;
        const primaryFloor = record.get('Primary Floor') || 70;
        const secondaryFloor = record.get('Secondary Floor') || 50;
        const minimumFloor = record.get('Minimum Floor') || 30;

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
    
    const record = await masterBase('Client Run Results').create({
      'Run ID': standardRunId,
      // 'Base Run ID' field removed - doesn't exist in the Airtable schema
      'Client ID': clientId, // Using 'Client ID' to match the field name in Airtable
      'Client Name': resolvedClientName,
      'Start Time': startTime,
      'Status': 'Running'
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
    const records = await masterBase('Client Run Results').select({
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
    
    // Map update keys to Airtable field names
    if (updates.status) updateFields['Status'] = updates.status;
    if (updates.endTime) updateFields['End Time'] = updates.endTime;
    if (updates.leadsProcessed) updateFields['Leads Processed'] = updates.leadsProcessed;
    if (updates.postsProcessed) updateFields['Posts Processed'] = updates.postsProcessed;
    if (updates.errors) updateFields['Errors'] = updates.errors;
    if (updates.notes) updateFields['System Notes'] = updates.notes; // Changed from 'Notes' to 'System Notes' to match the Airtable schema
    if (updates.tokenUsage) updateFields['Token Usage'] = updates.tokenUsage;
    if (updates.promptTokens) updateFields['Prompt Tokens'] = updates.promptTokens;
    if (updates.completionTokens) updateFields['Completion Tokens'] = updates.completionTokens;
    if (updates.totalTokens) updateFields['Total Tokens'] = updates.totalTokens;
    
    // Update the record
    const record = await masterBase('Client Run Results').update(recordId, updateFields);
    
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