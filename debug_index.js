// debug_index.js - Testing queueDispatcher with global initializations - Version H
console.log("<<<<< STARTING debug_index.js - Version H - Adding Airtable & Gemini Init >>>>>");

require("dotenv").config(); // For environment variables

// Standard requires for Express app and fetch (used by queueDispatcher or other modules)
const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// --- Additional requires from index.js for global initializations ---
const Airtable = require("airtable");
const { VertexAI } = require('@google-cloud/vertexai'); // HarmCategory, HarmBlockThreshold not directly used in init block

const app = express();
const port = process.env.PORT || 3001; // Use a different port for debug server

console.log("Express app created in debug_index.js (Version H).");

/* ---------- ENV CONFIGURATION (Copied from index.js, relevant for Gemini Init) ----------- */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;
const GCP_CREDENTIALS_JSON_STRING = process.env.GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON;

/* ---------- GOOGLE GENERATIVE AI CLIENT INITIALIZATION (Copied from index.js) ----------- */
console.log("Attempting to initialize Global Google Vertex AI Client...");
let globalVertexAIClient; // Declared for clarity, though not explicitly passed to queueDispatcher in this setup
let globalGeminiModel;    // This is the one that might be relevant if queueDispatcher or its children expect it

try {
    if (!GCP_PROJECT_ID || !GCP_LOCATION) {
        throw new Error("GCP_PROJECT_ID and GCP_LOCATION environment variables are required.");
    }
    if (!GCP_CREDENTIALS_JSON_STRING) {
        throw new Error("GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON environment variable is not set.");
    }
    // Ensure that GCP_CREDENTIALS_JSON_STRING is valid JSON
    let credentials;
    try {
        credentials = JSON.parse(GCP_CREDENTIALS_JSON_STRING);
    } catch (parseError) {
        console.error("Failed to parse GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON. Ensure it's valid JSON string.", parseError);
        throw new Error("Invalid JSON in GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON.");
    }

    globalVertexAIClient = new VertexAI({ project: GCP_PROJECT_ID, location: GCP_LOCATION, credentials });
    globalGeminiModel = globalVertexAIClient.getGenerativeModel({ model: MODEL_ID });
    console.log(`Global Google Vertex AI Client Initialized in debug_index.js. Default Model: ${MODEL_ID}`);
} catch (error) {
    console.error("CRITICAL: Failed to initialize Global Google Vertex AI Client in debug_index.js:", error.message);
    if (error.stack) console.error("Gemini Init Stack Trace:", error.stack);
    globalGeminiModel = null; // Ensure it's null if initialization fails
}

/* ---------- AIRTABLE CONFIGURATION (Copied from index.js) ------------------------------- */
console.log("Attempting to configure Airtable...");
let base; // Declare base, so it's available for queueDispatcher if it expects a global 'base'
try {
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
        throw new Error("AIRTABLE_API_KEY and AIRTABLE_BASE_ID environment variables are required.");
    }
    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
    base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    console.log("Airtable configured successfully in debug_index.js.");
} catch (error) {
    console.error("CRITICAL: Failed to configure Airtable in debug_index.js:", error.message);
    if (error.stack) console.error("Airtable Config Stack Trace:", error.stack);
    base = null; // Ensure it's null if configuration fails
}

// --- Now, attempt to load and use queueDispatcher ---
let mountTheRealQueueDispatcher;
try {
    console.log("Attempting to require('./queueDispatcher') [FULL original version] after global inits...");
    mountTheRealQueueDispatcher = require("./queueDispatcher");
    console.log("Successfully required './queueDispatcher' [FULL original version].");
    console.log("Type of mountTheRealQueueDispatcher is:", typeof mountTheRealQueueDispatcher);
} catch (e) {
    console.error("ERROR during require('./queueDispatcher') [FULL original version]:", e.message);
    console.error("Stack trace for require error:", e.stack);
}

if (typeof mountTheRealQueueDispatcher === 'function') {
    try {
        console.log("Attempting to call mountTheRealQueueDispatcher(app)...");
        // Note: If queueDispatcher expects 'base' or 'globalGeminiModel' to be passed,
        // or if it relies on them being set globally exactly like this, this test will help.
        // Some modules in index.js are mounted like: someModule(app, base);
        // queueDispatcher was mounted as: mountQueue(app);
        // We are keeping that pattern here.
        mountTheRealQueueDispatcher(app);
        console.log("Successfully called mountTheRealQueueDispatcher(app).");
    } catch (e) {
        console.error("ERROR calling mountTheRealQueueDispatcher(app):", e.message);
        console.error("Stack trace for call error:", e.stack);
    }
} else {
    console.error("mountTheRealQueueDispatcher is NOT a function. Actual value received:", mountTheRealQueueDispatcher);
    console.error("This means require('./queueDispatcher') [FULL version] did not return the expected function.");
}

app.get("/debug-health", (req, res) => {
    console.log("/debug-health (Version H) endpoint hit");
    res.json({
        message: "Debug server (Version H - testing full queueDispatcher with global inits) is healthy!",
        geminiModelInitialized: !!globalGeminiModel,
        airtableBaseInitialized: !!base,
        queueDispatcherLoaded: typeof mountTheRealQueueDispatcher === 'function'
    });
});

// NEW: LinkedIn Routes Testing Endpoint (Added Jan 2025)
app.get("/debug-linkedin-routes", async (req, res) => {
    console.log("/debug-linkedin-routes endpoint hit - testing LinkedIn API endpoints");
    
    const tests = [];
    const baseUrl = "https://pb-webhook-server.onrender.com";
    
    try {
        // Test follow-ups endpoint
        try {
            const followUpsRes = await fetch(`${baseUrl}/api/linkedin/leads/follow-ups`);
            tests.push({
                endpoint: "/api/linkedin/leads/follow-ups",
                status: followUpsRes.status,
                success: followUpsRes.ok,
                message: followUpsRes.ok ? "✅ Follow-ups endpoint working" : `❌ Status ${followUpsRes.status}`
            });
        } catch (e) {
            tests.push({
                endpoint: "/api/linkedin/leads/follow-ups",
                status: "ERROR",
                success: false,
                message: `❌ ${e.message}`
            });
        }

        // Test top-scoring-posts endpoint  
        try {
            const topPostsRes = await fetch(`${baseUrl}/api/linkedin/leads/top-scoring-posts`);
            tests.push({
                endpoint: "/api/linkedin/leads/top-scoring-posts", 
                status: topPostsRes.status,
                success: topPostsRes.ok,
                message: topPostsRes.ok ? "✅ Top scoring posts endpoint working" : `❌ Status ${topPostsRes.status}`
            });
        } catch (e) {
            tests.push({
                endpoint: "/api/linkedin/leads/top-scoring-posts",
                status: "ERROR", 
                success: false,
                message: `❌ ${e.message}`
            });
        }

        // Test search endpoint
        try {
            const searchRes = await fetch(`${baseUrl}/api/linkedin/leads/search?q=test`);
            tests.push({
                endpoint: "/api/linkedin/leads/search",
                status: searchRes.status,
                success: searchRes.ok,
                message: searchRes.ok ? "✅ Search endpoint working" : `❌ Status ${searchRes.status}`
            });
        } catch (e) {
            tests.push({
                endpoint: "/api/linkedin/leads/search",
                status: "ERROR",
                success: false, 
                message: `❌ ${e.message}`
            });
        }

        const allPassed = tests.every(test => test.success);
        
        res.json({
            message: "LinkedIn Routes Debug Test Results",
            allTestsPassed: allPassed,
            summary: `${tests.filter(t => t.success).length}/${tests.length} endpoints working`,
            tests: tests,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("Error in debug-linkedin-routes:", error);
        res.status(500).json({
            message: "Error testing LinkedIn routes",
            error: error.message,
            tests: tests
        });
    }
});

app.listen(port, () => {
    console.log(`Debug server (Version H) running on port ${port}. Startup complete.`);
    console.log("Review logs above for success or failure of global initializations AND loading/calling queueDispatcher.");
    console.log("NEW: Access /debug-linkedin-routes to test LinkedIn API endpoints");
    if (globalGeminiModel) console.log("Gemini Model status: INITIALIZED"); else console.log("Gemini Model status: FAILED or NOT INITIALIZED");
    if (base) console.log("Airtable Base status: INITIALIZED"); else console.log("Airtable Base status: FAILED or NOT INITIALIZED");
});