/**
 * services/airtable/leadRepository.js
 * 
 * Repository for lead operations in client-specific bases.
 * Handles CRUD operations for lead records.
 */

const { createSystemLogger } = require('../../utils/unifiedLoggerFactory');
const baseManager = require('./baseManager');
const clientRepository = require('./clientRepository');

// Default logger
const logger = createSystemLogger(null, 'lead_repository');

/**
 * Get lead records for a client
 * @param {Object} params - Query parameters
 * @param {string} params.clientId - Client ID
 * @param {Object} [params.filter] - Filter options for the query
 * @param {string} [params.view] - Name of an Airtable view to use
 * @param {number} [params.maxRecords] - Maximum number of records to return
 * @param {string[]} [params.fields] - Specific fields to return
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Array>} Lead records
 */
async function getLeads(params) {
  const { clientId, filter, view, maxRecords, fields, options = {} } = params;
  const logger = options.logger || require('../../utils/unifiedLoggerFactory').createLogger(clientId, null, 'lead_repository');
  
  if (!clientId) {
    logger.error("Client ID is required to get leads");
    throw new Error("Client ID is required to get leads");
  }

  try {
    // Get client information to find base ID
    const client = await clientRepository.getClientById(clientId);
    if (!client) {
      logger.error(`Client not found: ${clientId}`);
      throw new Error(`Client not found: ${clientId}`);
    }

    if (!client.airtableBaseId) {
      logger.error(`No Airtable base ID configured for client: ${clientId}`);
      throw new Error(`No Airtable base ID configured for client: ${clientId}`);
    }
    
    // Connect to client's base
    const clientBase = baseManager.getBaseById(client.airtableBaseId);
    
    // Build the query options
    const queryOptions = {};
    if (view) queryOptions.view = view;
    if (maxRecords) queryOptions.maxRecords = maxRecords;
    if (fields && Array.isArray(fields)) queryOptions.fields = fields;
    
    // Add filter if provided
    if (filter && filter.formula) {
      queryOptions.filterByFormula = filter.formula;
    }

    // Query the Leads table
    const records = await clientBase('Leads').select(queryOptions).all();
    
    // Transform to standard format
    const leads = records.map(record => {
      const lead = {
        id: record.id,
        ...record.fields
      };
      return lead;
    });
    
    logger.debug(`Retrieved ${leads.length} leads for client ${clientId}`);
    return leads;

  } catch (error) {
    logger.error(`Error getting leads for client ${clientId}: ${error.message}`);
    throw error;
  }
}

/**
 * Get a single lead by ID
 * @param {Object} params - Query parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.leadId - Lead record ID
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Lead record
 */
async function getLeadById(params) {
  const { clientId, leadId, options = {} } = params;
  const logger = options.logger || require('../../utils/unifiedLoggerFactory').createLogger(clientId, null, 'lead_repository');
  
  if (!clientId || !leadId) {
    logger.error("Client ID and Lead ID are required");
    throw new Error("Client ID and Lead ID are required");
  }

  try {
    // Get client information to find base ID
    const client = await clientRepository.getClientById(clientId);
    if (!client) {
      logger.error(`Client not found: ${clientId}`);
      throw new Error(`Client not found: ${clientId}`);
    }

    if (!client.airtableBaseId) {
      logger.error(`No Airtable base ID configured for client: ${clientId}`);
      throw new Error(`No Airtable base ID configured for client: ${clientId}`);
    }
    
    // Connect to client's base
    const clientBase = baseManager.getBaseById(client.airtableBaseId);
    
    // Get the lead record
    const record = await clientBase('Leads').find(leadId);
    
    const lead = {
      id: record.id,
      ...record.fields
    };
    
    logger.debug(`Retrieved lead ${leadId} for client ${clientId}`);
    return lead;

  } catch (error) {
    logger.error(`Error getting lead ${leadId} for client ${clientId}: ${error.message}`);
    throw error;
  }
}

/**
 * Update a lead record
 * @param {Object} params - Update parameters
 * @param {string} params.clientId - Client ID
 * @param {string} params.leadId - Lead record ID
 * @param {Object} params.updates - Fields to update
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Updated lead record
 */
async function updateLead(params) {
  const { clientId, leadId, updates, options = {} } = params;
  const logger = options.logger || require('../../utils/unifiedLoggerFactory').createLogger(clientId, null, 'lead_repository');
  
  if (!clientId || !leadId) {
    logger.error("Client ID and Lead ID are required to update lead");
    throw new Error("Client ID and Lead ID are required to update lead");
  }

  try {
    // Get client information to find base ID
    const client = await clientRepository.getClientById(clientId);
    if (!client) {
      logger.error(`Client not found: ${clientId}`);
      throw new Error(`Client not found: ${clientId}`);
    }

    if (!client.airtableBaseId) {
      logger.error(`No Airtable base ID configured for client: ${clientId}`);
      throw new Error(`No Airtable base ID configured for client: ${clientId}`);
    }
    
    // Connect to client's base
    const clientBase = baseManager.getBaseById(client.airtableBaseId);
    
    // Update the lead record
    const record = await clientBase('Leads').update(leadId, updates);
    
    const updatedLead = {
      id: record.id,
      ...record.fields
    };
    
    logger.debug(`Updated lead ${leadId} for client ${clientId}`);
    return updatedLead;

  } catch (error) {
    logger.error(`Error updating lead ${leadId} for client ${clientId}: ${error.message}`);
    throw error;
  }
}

/**
 * Create a lead record
 * @param {Object} params - Create parameters
 * @param {string} params.clientId - Client ID
 * @param {Object} params.leadData - Lead data
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} Created lead record
 */
async function createLead(params) {
  const { clientId, leadData, options = {} } = params;
  const logger = options.logger || require('../../utils/unifiedLoggerFactory').createLogger(clientId, null, 'lead_repository');
  
  if (!clientId || !leadData) {
    logger.error("Client ID and lead data are required to create lead");
    throw new Error("Client ID and lead data are required to create lead");
  }

  try {
    // Get client information to find base ID
    const client = await clientRepository.getClientById(clientId);
    if (!client) {
      logger.error(`Client not found: ${clientId}`);
      throw new Error(`Client not found: ${clientId}`);
    }

    if (!client.airtableBaseId) {
      logger.error(`No Airtable base ID configured for client: ${clientId}`);
      throw new Error(`No Airtable base ID configured for client: ${clientId}`);
    }
    
    // Connect to client's base
    const clientBase = baseManager.getBaseById(client.airtableBaseId);
    
    // Create the lead record
    const record = await clientBase('Leads').create(leadData);
    
    const createdLead = {
      id: record.id,
      ...record.fields
    };
    
    logger.debug(`Created lead for client ${clientId}: ${record.id}`);
    return createdLead;

  } catch (error) {
    logger.error(`Error creating lead for client ${clientId}: ${error.message}`);
    throw error;
  }
}

/**
 * Update multiple leads in batch
 * @param {Object} params - Batch update parameters
 * @param {string} params.clientId - Client ID
 * @param {Array<{id: string, fields: Object}>} params.records - Records to update
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Array>} Array of updated records
 */
async function updateLeadsInBatch(params) {
  const { clientId, records, options = {} } = params;
  const logger = options.logger || require('../../utils/unifiedLoggerFactory').createLogger(clientId, null, 'lead_repository');
  
  if (!clientId || !records || !Array.isArray(records)) {
    logger.error("Client ID and array of records are required to update leads in batch");
    throw new Error("Client ID and array of records are required to update leads in batch");
  }

  try {
    // Get client information to find base ID
    const client = await clientRepository.getClientById(clientId);
    if (!client) {
      logger.error(`Client not found: ${clientId}`);
      throw new Error(`Client not found: ${clientId}`);
    }

    if (!client.airtableBaseId) {
      logger.error(`No Airtable base ID configured for client: ${clientId}`);
      throw new Error(`No Airtable base ID configured for client: ${clientId}`);
    }
    
    // Connect to client's base
    const clientBase = baseManager.getBaseById(client.airtableBaseId);
    
    // Format records for Airtable batch update
    const recordsToUpdate = records.map(record => ({
      id: record.id,
      fields: record.fields
    }));
    
    // Update the records in batches of 10 (Airtable limit)
    const batchSize = 10;
    const updatedRecords = [];
    
    for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
      const batch = recordsToUpdate.slice(i, i + batchSize);
      const batchResults = await clientBase('Leads').update(batch);
      updatedRecords.push(...batchResults);
    }
    
    // Transform to standard format
    const leads = updatedRecords.map(record => ({
      id: record.id,
      ...record.fields
    }));
    
    logger.debug(`Updated ${leads.length} leads for client ${clientId} in batch`);
    return leads;

  } catch (error) {
    logger.error(`Error updating leads in batch for client ${clientId}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  getLeads,
  getLeadById,
  updateLead,
  createLead,
  updateLeadsInBatch
};