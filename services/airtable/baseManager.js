/**
 * services/airtable/baseManager.js
 * 
 * Manages Airtable base connections for the multi-tenant system.
 * Provides methods to connect to the master clients base and client-specific bases.
 */

require('dotenv').config();
const Airtable = require('airtable');
const { StructuredLogger } = require('../../utils/structuredLogger');

// Default logger
const logger = new StructuredLogger('SYSTEM', null, 'airtable_base_manager');

// Cache for base instances to avoid repeated initialization
const baseInstanceCache = new Map();
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map();

/**
 * Configure the Airtable API with credentials
 * @returns {boolean} Whether configuration was successful
 * @throws {Error} If required environment variables are missing
 */
function configureAirtable() {
  try {
    // Check for essential environment variables and throw detailed errors
    if (!process.env.AIRTABLE_API_KEY) {
      const error = new Error("AIRTABLE_API_KEY environment variable is not set.");
      logger.error(error.message);
      throw error;
    }

    // Configure the Airtable client with API key
    Airtable.configure({
      apiKey: process.env.AIRTABLE_API_KEY
    });
    
    logger.debug("Airtable API configured successfully.");
    return true;
  } catch (error) {
    logger.error(`Error configuring Airtable: ${error.message}`);
    // Re-throw to ensure calling functions know something went wrong
    throw new Error(`Failed to configure Airtable: ${error.message}`);
  }
}

/**
 * Get the master clients base
 * @returns {Object} Airtable base instance for the master clients base
 * @throws {Error} If master clients base can't be accessed
 */
function getMasterClientsBase() {
  try {
    // Check for essential environment variables with detailed error
    if (!process.env.MASTER_CLIENTS_BASE_ID) {
      const error = new Error("MASTER_CLIENTS_BASE_ID environment variable is not set. Cannot connect to master clients base.");
      logger.error(error.message);
      throw error;
    }

    // Ensure Airtable is configured - this will throw if there's a problem
    configureAirtable();

    // Check cache first
    const baseId = process.env.MASTER_CLIENTS_BASE_ID;
    if (isCacheValid(baseId)) {
      logger.debug(`Using cached master clients base instance for: ${baseId}`);
      return baseInstanceCache.get(baseId);
    }

    // Create new base instance
    let baseInstance;
    try {
      baseInstance = Airtable.base(baseId);
    } catch (err) {
      throw new Error(`Failed to create base instance for master clients: ${err.message}`);
    }
    
    // Cache the instance
    cacheBase(baseId, baseInstance);
    
    logger.debug(`Successfully connected to master clients base: ${baseId}`);
    return baseInstance;

  } catch (error) {
    logger.error(`Error getting master clients base: ${error.message}`);
    // Rethrow with context to help with debugging
    throw new Error(`Failed to get master clients base: ${error.message}`);
  }
}

/**
 * Get base instance for a specific base ID
 * @param {string} baseId - The Airtable base ID
 * @returns {Object} Airtable base instance
 * @throws {Error} If base ID is invalid or connection fails
 */
function getBaseById(baseId) {
  try {
    if (!baseId) {
      const error = new Error("Base ID is required to create base instance");
      logger.error(error.message);
      throw error;
    }

    // Validate base ID format (pattern: app...)
    if (typeof baseId !== 'string' || !baseId.startsWith('app')) {
      const error = new Error(`Invalid Airtable base ID format: ${baseId}`);
      logger.error(error.message);
      throw error;
    }

    // Ensure Airtable is configured
    configureAirtable();

    // Check cache first
    if (isCacheValid(baseId)) {
      logger.debug(`Using cached base instance for: ${baseId}`);
      return baseInstanceCache.get(baseId);
    }

    // Create new base instance
    let baseInstance;
    try {
      baseInstance = Airtable.base(baseId);
    } catch (err) {
      throw new Error(`Failed to create base instance: ${err.message}`);
    }
    
    // Cache the instance
    cacheBase(baseId, baseInstance);
    
    logger.debug(`Successfully connected to base: ${baseId}`);
    return baseInstance;

  } catch (error) {
    logger.error(`Error creating base instance for ${baseId}: ${error.message}`);
    throw new Error(`Failed to get base for ID ${baseId}: ${error.message}`);
  }
}

/**
 * Check if cache is still valid for a base ID
 * @param {string} baseId - The base ID to check
 * @returns {boolean} Whether the cache is valid
 */
function isCacheValid(baseId) {
  if (!baseInstanceCache.has(baseId) || !cacheTimestamps.has(baseId)) {
    return false;
  }
  
  const timestamp = cacheTimestamps.get(baseId);
  return (Date.now() - timestamp) < CACHE_DURATION_MS;
}

/**
 * Cache a base instance
 * @param {string} baseId - The base ID
 * @param {Object} baseInstance - The Airtable base instance
 */
function cacheBase(baseId, baseInstance) {
  baseInstanceCache.set(baseId, baseInstance);
  cacheTimestamps.set(baseId, Date.now());
  logger.debug(`Cached base instance for: ${baseId}`);
}

/**
 * Clear the base cache
 */
function clearBaseCache() {
  baseInstanceCache.clear();
  cacheTimestamps.clear();
  logger.debug("Base cache cleared");
}

module.exports = {
  configureAirtable,
  getMasterClientsBase,
  getBaseById,
  clearBaseCache
};