console.log("<<<<< INDEX.JS - REFACTOR 8 - FINALIZED ROUTE MODULARIZATION - TOP OF FILE >>>>>");
/***************************************************************
 Main Server File - Orchestrator
***************************************************************/
require("dotenv").config(); 

// --- CONFIGURATIONS ---
// These now export objects or instances directly
const geminiConfig = require('./config/geminiClient.js');
const globalGeminiModel = geminiConfig ? geminiConfig.geminiModel : null;
// const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null; // Available if index directly needs to pass it
// const configuredGeminiModelId = geminiConfig ? geminiConfig.geminiModelId : null; // Available if index directly needs to pass it

const base = require('./config/airtableClient.js'); 

// --- CORE NPM MODULES ---
const express = require("express");

console.log("<<<<< INDEX.JS - REFACTOR 8 - AFTER CORE REQUIRES >>>>>");

// --- INITIALIZATION CHECKS ---
if (!globalGeminiModel) {
    console.error("FATAL ERROR in index.js: Gemini Model (default instance) failed to initialize. Scoring will not work. Check logs in config/geminiClient.js.");
} else {
    console.log("index.js: Gemini Model (default instance) loaded successfully from config.");
}
if (!geminiConfig || !geminiConfig.vertexAIClient) { 
    console.error("FATAL ERROR in index.js: VertexAI Client is not available from geminiConfig. Batch scoring might fail. Check logs in config/geminiClient.js.");
}
if (!base) {
    console.error("FATAL ERROR in index.js: Airtable Base failed to initialize. Airtable operations will fail. Check logs in config/airtableClient.js.");
} else {
    console.log("index.js: Airtable Base loaded successfully from config.");
}

/* ---------- APP-LEVEL ENV CONFIGURATION --- */
const GPT_CHAT_URL = process.env.GPT_CHAT_URL; 
if (!GPT_CHAT_URL) {
    console.error("CRITICAL WARNING: Missing GPT_CHAT_URL environment variable. pointerApi may not function correctly.");
}

/* ------------------------------------------------------------------
    1)  Express App Setup
------------------------------------------------------------------*/
const app = express();
app.use(express.json({ limit: "10mb" }));

/* ------------------------------------------------------------------
    2) Mount All Route Handlers and Sub-APIs
------------------------------------------------------------------*/
console.log("index.js: Mounting routes and APIs...");

// Mount existing sub-APIs (these are already in their own files)
try { require("./promptApi")(app); console.log("index.js: promptApi mounted."); } catch(e) { console.error("index.js: Error mounting promptApi", e.message, e.stack); }
try { require("./recordApi")(app); console.log("index.js: recordApi mounted."); } catch(e) { console.error("index.js: Error mounting recordApi", e.message, e.stack); }
try { require("./scoreApi")(app); console.log("index.js: scoreApi mounted."); } catch(e) { console.error("index.js: Error mounting scoreApi", e.message, e.stack); }

const mountQueue = require("./queueDispatcher");
if (mountQueue && typeof mountQueue === 'function') {
    try { mountQueue(app); console.log("index.js: Queue Dispatcher mounted."); } catch(e) { console.error("index.js: Error mounting queueDispatcher", e.message, e.stack); }
} else {
    console.error("index.js: Failed to load queueDispatcher or it's not a function.");
}

// Mount our newly refactored route modules
try { const webhookRoutes = require('./routes/webhookHandlers.js'); app.use(webhookRoutes); console.log("index.js: Webhook routes mounted."); } catch(e) { console.error("index.js: Error mounting webhookRoutes", e.message, e.stack); }
try { const appRoutes = require('./routes/apiAndJobRoutes.js'); app.use(appRoutes); console.log("index.js: App/API/Job routes mounted."); } catch(e) { console.error("index.js: Error mounting appRoutes", e.message, e.stack); }

// Reinstating Custom GPT APIs
console.log("index.js: Attempting to mount Custom GPT support APIs...");
try {
    const mountPointerApi = require("./pointerApi.js");
    const mountLatestLead = require("./latestLeadApi.js");
    const mountUpdateLead = require("./updateLeadApi.js");

    if (!GPT_CHAT_URL && mountPointerApi && typeof mountPointerApi === 'function') {
        console.warn("index.js: GPT_CHAT_URL is not set; pointerApi might not function fully if it relies on it internally beyond the parameter.");
    }
    
    if (mountPointerApi && typeof mountPointerApi === 'function') {
        mountPointerApi(app, base, GPT_CHAT_URL); 
        console.log("index.js: pointerApi mounted.");
    } else { console.error("index.js: pointerApi.js not found or did not export a function."); }

    if (mountLatestLead && typeof mountLatestLead === 'function') {
        mountLatestLead(app, base); 
        console.log("index.js: latestLeadApi mounted.");
    } else { console.error("index.js: latestLeadApi.js not found or did not export a function."); }

    if (mountUpdateLead && typeof mountUpdateLead === 'function') {
        mountUpdateLead(app, base); 
        console.log("index.js: updateLeadApi mounted.");
    } else { console.error("index.js: updateLeadApi.js not found or did not export a function."); }
} catch (apiMountError) {
    console.error("index.js: Error mounting one of the Custom GPT support APIs (pointer, latestLead, updateLead):", apiMountError.message, apiMountError.stack);
}

/*
    BLOCKS REMOVED from index.js:
    - Inline route definitions for:
        * /health
        * /run-batch-score
        * /score-lead
        * /api/test-score
        * /pb-pull/connections
        * /debug-gemini-info
    - Top-level 'fs' require and Phantombuster 'currentLastRunId' / 'PB_LAST_RUN_ID_FILE' logic.
    (These are all now handled in routes/apiAndJobRoutes.js)
*/

/* ------------------------------------------------------------------
    3) Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
    `▶︎ Server starting – Version: Gemini Integrated (Refactor 8) – Commit ${process.env.RENDER_GIT_COMMIT || "local"
    } – ${new Date().toISOString()}`
);

app.listen(port, () => {
    console.log(`Server running on port ${port}.`);
    if (!globalGeminiModel) {
        console.error("Final Check: Server started BUT Global Gemini Model (default instance) is not available. Scoring will fail.");
    } else if (!base) {
        console.error("Final Check: Server started BUT Airtable Base is not available. Airtable operations will fail.");
    } else if (!geminiConfig || !geminiConfig.vertexAIClient) {
        console.error("Final Check: Server started BUT VertexAI Client is not available from geminiConfig. Batch scoring may fail.");
    }
    else {
        console.log("Final Check: Server started and essential services (Gemini client, default model, Airtable) appear to be loaded and all routes mounted.");
    }
});

/* ------------------------------------------------------------------
    LEGACY SECTION (Properly Commented Out)
------------------------------------------------------------------*/
/*
async function getScoringData() {
  // Original content would be here. For now, a placeholder.
  console.warn("Legacy getScoringData function called - likely obsolete.");
  return {}; // Return a sensible default if it were ever called
}

function parseMarkdownTables(markdown) {
  // Original content would be here. For now, a placeholder.
  console.warn("Legacy parseMarkdownTables function called - likely obsolete.");
  return {}; // Return a sensible default
}
*/