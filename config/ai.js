/**
 * config/ai.js
 * AI service configuration for pb-webhook-server
 * 
 * This module centralizes all AI-related configuration
 * for both Google Gemini and OpenAI services.
 */

// Environment variables are loaded by the main config module

/**
 * Validates required AI service configuration
 * @returns {Object} Validation result
 */
function validate() {
  const errors = [];
  
  // Google Gemini required settings
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    errors.push("GOOGLE_APPLICATION_CREDENTIALS environment variable is not set");
  }
  
  if (!process.env.GCP_PROJECT_ID) {
    errors.push("GCP_PROJECT_ID environment variable is not set");
  }
  
  // OpenAI required settings (if enabled)
  if (process.env.USE_OPENAI_FALLBACK === 'true' && !process.env.OPENAI_API_KEY) {
    errors.push("OPENAI_API_KEY environment variable is required when USE_OPENAI_FALLBACK=true");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Export configuration values
module.exports = {
  // Google Gemini configuration
  gemini: {
    modelId: process.env.GEMINI_MODEL_ID || 'gemini-2.5-pro-preview-05-06',
    projectId: process.env.GCP_PROJECT_ID,
    location: process.env.GCP_LOCATION || 'us-central1',
    timeout: parseInt(process.env.GEMINI_TIMEOUT_MS || '120000', 10),
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS
  },
  
  // OpenAI configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    useFallback: process.env.USE_OPENAI_FALLBACK === 'true',
    timeout: parseInt(process.env.OPENAI_TIMEOUT_MS || '60000', 10)
  },
  
  // AI scoring configuration
  scoring: {
    batchSize: parseInt(process.env.BATCH_CHUNK_SIZE || '5', 10),
    maxTokens: parseInt(process.env.MAX_OUTPUT_TOKENS || '8192', 10),
    temperature: parseFloat(process.env.TEMPERATURE || '0.2'),
    debugMode: process.env.DEBUG_SCORING === 'true'
  },
  
  // Validation function
  validate
};

// Log initialization
console.log("[Config] AI configuration module loaded");