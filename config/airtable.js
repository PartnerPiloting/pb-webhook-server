/**
 * config/airtable.js
 * Airtable configuration for pb-webhook-server
 * 
 * This module centralizes all Airtable-specific configuration
 * and validates required settings.
 */

// Environment variables are loaded by the main config module

/**
 * Validates required Airtable configuration
 * @returns {Object} Validation result
 */
function validate() {
  const errors = [];
  
  if (!process.env.AIRTABLE_API_KEY) {
    errors.push("AIRTABLE_API_KEY environment variable is not set");
  }
  
  if (!process.env.AIRTABLE_BASE_ID) {
    errors.push("AIRTABLE_BASE_ID environment variable is not set");
  }
  
  if (!process.env.MASTER_CLIENTS_BASE_ID) {
    errors.push("MASTER_CLIENTS_BASE_ID environment variable is not set");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Export configuration values
module.exports = {
  // API access
  apiKey: process.env.AIRTABLE_API_KEY,
  
  // Base IDs
  defaultBaseId: process.env.AIRTABLE_BASE_ID,
  masterClientsBaseId: process.env.MASTER_CLIENTS_BASE_ID,
  
  // Base names and tables for documentation/reference
  tables: {
    master: {
      clients: "Clients",
      clientRunResults: "Client Run Results"
    },
    client: {
      leads: "Leads",
      posts: "Posts",
      smartResume: "Smart Resume"
      // Add other client-specific tables as needed
    }
  },
  
  // Cache settings
  cacheTimeout: parseInt(process.env.AIRTABLE_CACHE_TIMEOUT || 300000, 10), // Default 5 minutes
  
  // Validation function
  validate
};

// Log initialization
console.log("[Config] Airtable configuration module loaded");