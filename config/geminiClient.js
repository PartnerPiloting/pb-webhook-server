// config/geminiClient.js
// UPDATED to handle base64 encoded credentials string from environment variable

require('dotenv').config(); 

const { VertexAI } = require('@google-cloud/vertexai');

const MODEL_ID_FROM_ENV = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;
const GCP_CREDENTIALS_BASE64_STRING = process.env.GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON; // Expecting base64 string here

let initializedVertexAIClient = null;
let defaultGeminiModelInstance = null; 

try {
    if (!GCP_PROJECT_ID || !GCP_LOCATION) {
        throw new Error("Gemini Client Config: GCP_PROJECT_ID and GCP_LOCATION environment variables are required.");
    }
    if (!GCP_CREDENTIALS_BASE64_STRING) {
        throw new Error("Gemini Client Config: GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON (expected as base64) environment variable is not set.");
    }

    let credentialsJsonString;
    try {
        // Decode the base64 string to get the original JSON string
        credentialsJsonString = Buffer.from(GCP_CREDENTIALS_BASE64_STRING, 'base64').toString('utf8');
    } catch (decodeError) {
        console.error("Gemini Client Config: Failed to decode base64 credentials string. Ensure the env var contains valid base64.", decodeError);
        throw new Error("Gemini Client Config: Error decoding base64 credentials.");
    }

    let credentials;
    try {
        // Parse the decoded JSON string
        credentials = JSON.parse(credentialsJsonString);
    } catch (parseError) {
        console.error("Gemini Client Config: Failed to parse decoded JSON credentials. Ensure the original key was valid JSON before encoding.", parseError);
        console.error("Gemini Client Config: Decoded JSON string (first 200 chars):", credentialsJsonString.substring(0, 200)); // Log a snippet for debugging
        throw new Error("Gemini Client Config: Invalid JSON after base64 decoding.");
    }

    initializedVertexAIClient = new VertexAI({
        project: GCP_PROJECT_ID,
        location: GCP_LOCATION,
        credentials
    });

    defaultGeminiModelInstance = initializedVertexAIClient.getGenerativeModel({ model: MODEL_ID_FROM_ENV });
    
    console.log(`Gemini Client Initialized successfully in config/geminiClient.js (using base64 decoded key). Default Model ID: ${MODEL_ID_FROM_ENV}`);

} catch (error) {
    console.error("CRITICAL ERROR: Failed to initialize Gemini Client in config/geminiClient.js (base64 method):", error.message);
    // initializedVertexAIClient and defaultGeminiModelInstance will remain null
}

module.exports = {
    vertexAIClient: initializedVertexAIClient,
    geminiModel: defaultGeminiModelInstance,
    geminiModelId: MODEL_ID_FROM_ENV
};