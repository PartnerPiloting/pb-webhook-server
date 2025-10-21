// config/openaiClient.js
// OpenAI configuration for attribute editing

require('dotenv').config();
const OpenAI = require('openai');
const { createLogger } = require('../utils/contextLogger');

// Create module-level logger for config initialization
const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'openai-config' 
});

let openaiClient = null;

/**
 * Initialize OpenAI client
 */
function initializeOpenAI() {
    if (openaiClient) return openaiClient;

    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY environment variable is not set");
    }

    openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    logger.info("OpenAI client initialized successfully");
    return openaiClient;
}

/**
 * Get OpenAI client instance
 */
function getOpenAIClient() {
    if (!openaiClient) {
        return initializeOpenAI();
    }
    return openaiClient;
}

module.exports = {
    initializeOpenAI,
    getOpenAIClient
};
