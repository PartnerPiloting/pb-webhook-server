// utils/clientIdResolver.js
// Centralized client ID resolution with validation and logging

const { getClientBase } = require('../config/airtableClient');

/**
 * Resolves client ID from multiple sources with proper validation
 * @param {Object} req - Express request object
 * @param {Object} options - Configuration options
 * @returns {Promise<{clientId: string, clientBase: Object, source: string}>}
 */
async function resolveClientId(req, options = {}) {
  const { requireValid = true, allowedSources = ['header', 'query', 'body'] } = options;
  
  let clientId = null;
  let source = null;
  
  // Try multiple sources in priority order
  if (allowedSources.includes('header') && req.headers['x-client-id']) {
    clientId = req.headers['x-client-id'];
    source = 'header';
  } else if (allowedSources.includes('query') && req.query.clientId) {
    clientId = req.query.clientId;
    source = 'query';
  } else if (allowedSources.includes('body') && req.body && req.body.clientId) {
    clientId = req.body.clientId;
    source = 'body';
  }
  
  if (!clientId) {
    const error = new Error('Client ID required for this operation');
    error.code = 'MISSING_CLIENT_ID';
    error.suggestions = [
      "Add 'x-client-id' header with your client ID",
      "Add 'clientId' query parameter to the URL",
      "Include 'clientId' in request body (for POST requests)"
    ];
    error.availableSources = allowedSources;
    throw error;
  }
  
  console.log(`Client ID resolved: ${clientId} (source: ${source})`);
  
  if (!requireValid) {
    return { clientId, clientBase: null, source };
  }
  
  // Validate client ID by attempting to get client base
  let clientBase;
  try {
    clientBase = await getClientBase(clientId);
    if (!clientBase) {
      const error = new Error(`Invalid client ID: ${clientId}`);
      error.code = 'INVALID_CLIENT_ID';
      error.clientId = clientId;
      throw error;
    }
  } catch (err) {
    if (err.code === 'INVALID_CLIENT_ID') throw err;
    
    const error = new Error(`Failed to connect to client database: ${err.message}`);
    error.code = 'CLIENT_CONNECTION_ERROR';
    error.clientId = clientId;
    error.originalError = err;
    throw error;
  }
  
  return { clientId, clientBase, source };
}

/**
 * Express middleware to resolve and validate client ID
 * @param {Object} options - Configuration options
 */
function requireClientId(options = {}) {
  return async (req, res, next) => {
    try {
      const result = await resolveClientId(req, options);
      req.clientId = result.clientId;
      req.clientBase = result.clientBase;
      req.clientIdSource = result.source;
      next();
    } catch (error) {
      console.error(`Client ID resolution failed: ${error.message}`);
      
      if (error.code === 'MISSING_CLIENT_ID') {
        return res.status(400).json({
          success: false,
          error: error.message,
          solutions: error.suggestions,
          available_sources: error.availableSources
        });
      }
      
      if (error.code === 'INVALID_CLIENT_ID') {
        return res.status(400).json({
          success: false,
          error: error.message,
          clientId: error.clientId,
          suggestion: "Contact admin for valid client IDs"
        });
      }
      
      if (error.code === 'CLIENT_CONNECTION_ERROR') {
        return res.status(500).json({
          success: false,
          error: error.message,
          clientId: error.clientId
        });
      }
      
      // Generic error fallback
      return res.status(500).json({
        success: false,
        error: "Client ID resolution failed",
        details: error.message
      });
    }
  };
}

module.exports = {
  resolveClientId,
  requireClientId
};
