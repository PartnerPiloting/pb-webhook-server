/**
 * config/server.js
 * Web server configuration for pb-webhook-server
 * 
 * This module centralizes all web server related configuration
 * including ports, authentication, and API settings.
 */

// Environment variables are loaded by the main config module

/**
 * Validates required server configuration
 * @returns {Object} Validation result
 */
function validate() {
  const errors = [];
  
  // Webhook secret is required
  if (!process.env.PB_WEBHOOK_SECRET) {
    errors.push("PB_WEBHOOK_SECRET environment variable is not set");
  }
  
  // Debug API key is required in production for debug endpoints
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEBUG_ENDPOINTS === 'true' && !process.env.DEBUG_API_KEY) {
    errors.push("DEBUG_API_KEY is required when ENABLE_DEBUG_ENDPOINTS=true in production");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Export configuration values
module.exports = {
  // Server settings
  port: process.env.PORT || 3001,
  apiPublicBaseUrl: process.env.API_PUBLIC_BASE_URL || null,
  
  // Authentication and security
  webhookSecret: process.env.PB_WEBHOOK_SECRET,
  debugApiKey: process.env.DEBUG_API_KEY,
  repairSecret: process.env.REPAIR_SECRET,
  
  // CORS configuration
  cors: {
    enabled: true,
    origins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*']
  },
  
  // Feature flags
  features: {
    enableDebugEndpoints: process.env.ENABLE_DEBUG_ENDPOINTS === 'true',
    enableSmartResume: process.env.ENABLE_SMART_RESUME !== 'false',
    enableRateLimiting: process.env.DISABLE_RATE_LIMIT !== 'true',
    enableLogging: process.env.DISABLE_LOGGING !== 'true',
    enableMetrics: process.env.ENABLE_METRICS === 'true'
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // Default 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '60', 10) // Default 60 requests per minute
  },
  
  // Validation function
  validate
};

// Log initialization
console.log("[Config] Server configuration module loaded");