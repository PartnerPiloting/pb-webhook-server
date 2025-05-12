// config/geminiClient.js
// UPDATED to rely on GOOGLE_APPLICATION_CREDENTIALS environment variable (pointing to a secret file)

require('dotenv').config(); 

const { VertexAI } = require('@google-cloud/vertexai');

const MODEL_ID_FROM_ENV = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;

// The GOOGLE_APPLICATION_CREDENTIALS environment variable (set in Render to /etc/secrets/your-key-file.json)
// will be automatically used by the VertexAI constructor if no 'credentials' object is explicitly passed.

let initializedVertexAIClient = null;
let defaultGeminiModelInstance = null; 

try {
    if (!GCP_PROJECT_ID || !GCP_LOCATION) {
        throw new Error("Gemini Client Config: GCP_PROJECT_ID and GCP_LOCATION environment variables are required.");
    }

    // When GOOGLE_APPLICATION_CREDENTIALS is set in the environment,
    // the VertexAI constructor will automatically use those credentials.
    // We no longer need to manually parse a JSON string or decode base64 here.
    initializedVertexAIClient = new VertexAI({
        project: GCP_PROJECT_ID,
        location: GCP_LOCATION
        // No 'credentials' property is needed here if GOOGLE_APPLICATION_CREDENTIALS is set
    });

    defaultGeminiModelInstance = initializedVertexAIClient.getGenerativeModel({ model: MODEL_ID_FROM_ENV });
    
    console.log(`Gemini Client Initialized successfully in config/geminiClient.js (using GOOGLE_APPLICATION_CREDENTIALS). Default Model ID: ${MODEL_ID_FROM_ENV}`);

} catch (error) {
    console.error("CRITICAL ERROR: Failed to initialize Gemini Client in config/geminiClient.js (GOOGLE_APPLICATION_CREDENTIALS method):", error.message, error.stack);
    // initializedVertexAIClient and defaultGeminiModelInstance will remain null
}

module.exports = {
    vertexAIClient: initializedVertexAIClient,
    geminiModel: defaultGeminiModelInstance,
    geminiModelId: MODEL_ID_FROM_ENV
};