console.log("<<<<< INDEX.JS - REFACTOR 6 - REINSTATED CUSTOM GPT APIS - TOP OF FILE >>>>>");
/***************************************************************
 Main Server File - Orchestrator
***************************************************************/
require("dotenv").config(); 

// --- CONFIGURATIONS ---
const globalGeminiModel = require('./config/geminiClient.js');
const base = require('./config/airtableClient.js'); 

// --- CORE NPM MODULES ---
const express = require("express");

// --- LOCAL SERVICE & HELPER MODULES ---
// These are likely used by the various route/API modules
// const { buildPrompt, slimLead }    = require("./promptBuilder"); // buildPrompt used by old scoreApi, slimLead by old upsertLead
// const { loadAttributes }          = require("./attributeLoader");
// const { computeFinalScore }       = require("./scoring");
// const { buildAttributeBreakdown } = require("./breakdown");
// const { scoreLeadNow }            = require("./singleScorer");

console.log("<<<<< INDEX.JS - REFACTOR 6 - AFTER MINIMAL CORE REQUIRES >>>>>");

// --- INITIALIZATION CHECKS ---
if (!globalGeminiModel) {
    console.error("FATAL ERROR in index.js: Gemini Model failed to initialize. Scoring will not work. Check logs in config/geminiClient.js.");
} else {
    console.log("index.js: Gemini Model loaded successfully from config.");
}
if (!base) {
    console.error("FATAL ERROR in index.js: Airtable Base failed to initialize. Airtable operations will fail. Check logs in config/airtableClient.js.");
} else {
    console.log("index.js: Airtable Base loaded successfully from config.");
}

/* ---------- APP-LEVEL ENV CONFIGURATION --- */
const GPT_CHAT_URL = process.env.GPT_CHAT_URL; 
if (!GPT_CHAT_URL) {
    // Matching old behavior: throw error if critical for pointerApi
    // Consider if a console.warn and not mounting pointerApi is preferable if it's not always used
    console.error("CRITICAL WARNING: Missing GPT_CHAT_URL environment variable. pointerApi will likely fail or not be mounted properly.");
    // throw new Error("Missing GPT_CHAT_URL env var"); // Uncomment if this should halt startup
}


/* ------------------------------------------------------------------
    1)  Express App Setup
------------------------------------------------------------------*/
const app = express();
app.use(express.json({ limit: "10mb" }));

/* ------------------------------------------------------------------
    2) Mount All Route Handlers and Sub-APIs
------------------------------------------------------------------*/
console.log("index.js: Mounting routes...");

// Mount existing sub-APIs (these are already in their own files)
require("./promptApi")(app);  // Assumes it handles its own 'base' or doesn't need it
require("./recordApi")(app); // Assumes it handles its own 'base' or doesn't need it
require("./scoreApi")(app);  // Assumes it handles its own 'base' or doesn't need it
const mountQueue = require("./queueDispatcher");
if (mountQueue && typeof mountQueue === 'function') { // Added check
    mountQueue(app); // Assumes it handles its own 'base' or doesn't need it
    console.log("index.js: Queue Dispatcher mounted.");
} else {
    console.error("index.js: Failed to load or mount queueDispatcher.");
}


// Mount our newly refactored route modules
const webhookRoutes = require('./routes/webhookHandlers.js');
app.use(webhookRoutes); 
console.log("index.js: Webhook routes mounted.");

const appRoutes = require('./routes/apiAndJobRoutes.js'); 
app.use(appRoutes);                                       
console.log("index.js: App/API/Job routes mounted.");

// --- Reinstating Custom GPT APIs ---
console.log("index.js: Attempting to mount Custom GPT support APIs...");
try {
    const mountPointerApi = require("./pointerApi.js");
    const mountLatestLead = require("./latestLeadApi.js");
    const mountUpdateLead = require("./updateLeadApi.js");

    if (!GPT_CHAT_URL && mountPointerApi) { // Specific check if GPT_CHAT_URL is vital for pointerApi
        console.warn("index.js: GPT_CHAT_URL is not set. pointerApi might not function correctly or will not be mounted if it throws an error.");
        // mountPointerApi might throw its own error if GPT_CHAT_URL is critical internally, or handle it.
    }
    
    if (mountPointerApi && typeof mountPointerApi === 'function') {
        mountPointerApi(app, base, GPT_CHAT_URL); // Pass base and GPT_CHAT_URL
        console.log("index.js: pointerApi mounted.");
    } else {
        console.error("index.js: pointerApi.js not found or did not export a function.");
    }

    if (mountLatestLead && typeof mountLatestLead === 'function') {
        mountLatestLead(app, base); // Pass base
        console.log("index.js: latestLeadApi mounted.");
    } else {
        console.error("index.js: latestLeadApi.js not found or did not export a function.");
    }

    if (mountUpdateLead && typeof mountUpdateLead === 'function') {
        mountUpdateLead(app, base); // Pass base
        console.log("index.js: updateLeadApi mounted.");
    } else {
        console.error("index.js: updateLeadApi.js not found or did not export a function.");
    }
} catch (apiMountError) {
    console.error("index.js: Error mounting one of the Custom GPT support APIs (pointer, latestLead, updateLead):", apiMountError.message);
}


/* ------------------------------------------------------------------
    3) Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
    `▶︎ Server starting – Version: Gemini Integrated (Refactor 6) – Commit ${process.env.RENDER_GIT_COMMIT || "local"
    } – ${new Date().toISOString()}`
);

app.listen(port, () => {
    console.log(`Server running on port ${port}.`);
    if (!globalGeminiModel) {
        console.error("Final Check: Server started BUT Global Gemini Model is not available. Scoring will fail.");
    } else if (!base) {
        console.error("Final Check: Server started BUT Airtable Base is not available. Airtable operations will fail.");
    } else {
        console.log("Final Check: Server started and essential services (Gemini, Airtable) appear to be loaded and routes mounted.");
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