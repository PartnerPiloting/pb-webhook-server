// config/geminiClient.js
require('dotenv').config(); 

const { VertexAI } = require('@google-cloud/vertexai');

const MODEL_ID_FROM_ENV = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06"; // Renamed for clarity
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;
const GCP_CREDENTIALS_JSON_STRING = process.env.GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON;

let initializedVertexAIClient = null;
let defaultGeminiModelInstance = null; 

try {
    if (!GCP_PROJECT_ID || !GCP_LOCATION) {
        throw new Error("Gemini Client Config: GCP_PROJECT_ID and GCP_LOCATION environment variables are required.");
    }
    if (!GCP_CREDENTIALS_JSON_STRING) {
        throw new Error("Gemini Client Config: GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON environment variable is not set.");
    }

    let credentials;
    try {
        credentials = JSON.parse(GCP_CREDENTIALS_JSON_STRING);
    } catch (parseError) {
        console.error("Gemini Client Config: Failed to parse GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON. Ensure it's valid JSON string.", parseError);
        throw new Error("Gemini Client Config: Invalid JSON in GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON.");
    }

    initializedVertexAIClient = new VertexAI({ // Assigned to new variable name
        project: GCP_PROJECT_ID,
        location: GCP_LOCATION,
        credentials
    });

    defaultGeminiModelInstance = initializedVertexAIClient.getGenerativeModel({ model: MODEL_ID_FROM_ENV }); // Assigned to new variable name
    
    console.log(`Gemini Client Initialized successfully in config/geminiClient.js. Default Model ID: ${MODEL_ID_FROM_ENV}`);

} catch (error) {
    console.error("CRITICAL ERROR: Failed to initialize Gemini Client in config/geminiClient.js:", error.message);
    // initializedVertexAIClient and defaultGeminiModelInstance will remain null
}

// Export an object containing the client, the default model instance, and the model ID
module.exports = {
    vertexAIClient: initializedVertexAIClient,       // The main VertexAI client instance
    geminiModel: defaultGeminiModelInstance,         // The default pre-initialized Gemini model instance
    geminiModelId: MODEL_ID_FROM_ENV                 // The MODEL_ID string
};