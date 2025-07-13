// config/openaiClient.js
// OpenAI configuration for attribute editing

require('dotenv').config();
const OpenAI = require('openai');

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

    console.log("OpenAI client initialized successfully");
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
