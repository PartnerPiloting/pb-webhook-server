/**
 * config/index.js
 * Central configuration module for pb-webhook-server
 * 
 * This module centralizes all configuration variables and provides
 * validation for required settings. It loads configuration from
 * environment variables and provides structured access to all
 * application settings.
 */

// Load environment variables
require('dotenv').config();

// Import specific configuration modules
const airtableConfig = require('./airtable');
const aiConfig = require('./ai');
const serverConfig = require('./server');

/**
 * Validates that required configuration is present
 * @returns {Object} Object with validation results
 */
function validateConfig() {
  const validations = {
    airtable: airtableConfig.validate(),
    ai: aiConfig.validate(),
    server: serverConfig.validate()
  };

  const isValid = Object.values(validations).every(v => v.isValid);

  return {
    isValid,
    validations
  };
}

/**
 * Gets all configuration errors as a flattened array
 * @returns {Array} Array of error messages
 */
function getConfigErrors() {
  const { validations } = validateConfig();
  const errors = [];
  
  Object.entries(validations).forEach(([category, validation]) => {
    if (!validation.isValid && validation.errors) {
      validation.errors.forEach(err => errors.push(`[${category}] ${err}`));
    }
  });

  return errors;
}

// The combined configuration object with all settings
const config = {
  airtable: airtableConfig,
  ai: aiConfig,
  server: serverConfig,
  
  // Methods
  validate: validateConfig,
  getErrors: getConfigErrors,
  
  // Global environment
  env: process.env.NODE_ENV || 'development',
  isDevelopment: (process.env.NODE_ENV !== 'production'),
  isProduction: (process.env.NODE_ENV === 'production'),
};

// Log config initialization
console.log(`[Config] Initialized configuration module in ${config.env} environment`);

module.exports = config;