// config/geminiClient.js
// Ensure environment variables are loaded. index.js should also do this,
// but it's good practice for config files.
require('dotenv').config();

const { VertexAI } = require('@google-cloud/vertexai'); // HarmCategory, HarmBlockThreshold not directly used here but VertexAI is

// Configuration constants from environment variables
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;
const GCP_CREDENTIALS_JSON_STRING = process.env.GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON;

let geminiModelInstance = null; // This will hold our initialized Gemini model

try {
    // Check for essential environment variables
    if (!GCP_PROJECT_ID || !GCP_LOCATION) {
        throw new Error("Gemini Client Config: GCP_PROJECT_ID and GCP_LOCATION environment variables are required.");
    }
    if (!GCP_CREDENTIALS_JSON_STRING) {
        throw new Error("Gemini Client Config: GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON environment variable is not set.");
    }

    let credentials;
    try {
        // Attempt to parse the credentials JSON string
        credentials = JSON.parse(GCP_CREDENTIALS_JSON_STRING);
    } catch (parseError) {
        console.error("Gemini Client Config: Failed to parse GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON. Please ensure it's a valid JSON string in your environment variables.", parseError);
        throw new Error("Gemini Client Config: Invalid JSON in GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON.");
    }

    // Initialize the VertexAI client
    const vertexAIClient = new VertexAI({
        project: GCP_PROJECT_ID,
        location: GCP_LOCATION,
        credentials
    });

    // Get the generative model (the specific Gemini model we want to use)
    geminiModelInstance = vertexAIClient.getGenerativeModel({ model: MODEL_ID });

    console.log(`Gemini Client Initialized successfully in config/geminiClient.js. Default Model: ${MODEL_ID}`);

} catch (error) {
    console.error("CRITICAL ERROR: Failed to initialize Gemini Client in config/geminiClient.js:", error.message);
    // geminiModelInstance will remain null if an error occurs
    // The main application (index.js) will need to handle this possibility.
}

// Export the initialized model instance (it will be null if initialization failed)
module.exports = geminiModelInstance;