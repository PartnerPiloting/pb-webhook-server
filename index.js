console.log("<<<<< INDEX.JS - REFACTOR 5 (Patched) - MOVED APP/API/JOB ROUTES - TOP OF FILE >>>>>");
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
const { buildPrompt, slimLead }    = require("./promptBuilder");
const { loadAttributes }          = require("./attributeLoader");
const { computeFinalScore }       = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");
const { scoreLeadNow }            = require("./singleScorer");

console.log("<<<<< INDEX.JS - REFACTOR 5 (Patched) - AFTER MINIMAL REQUIRES >>>>>");

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

/* ------------------------------------------------------------------
    1)  Express App Setup
------------------------------------------------------------------*/
const app = express();
app.use(express.json({ limit: "10mb" }));

/* ------------------------------------------------------------------
    2) Mount All Route Handlers and Sub-APIs
------------------------------------------------------------------*/
console.log("index.js: Mounting routes...");

// Mount existing sub-APIs
require("./promptApi")(app); 
require("./recordApi")(app);
require("./scoreApi")(app); 
const mountQueue = require("./queueDispatcher");
mountQueue(app);

// Mount our newly refactored route modules
const webhookRoutes = require('./routes/webhookHandlers.js');
app.use(webhookRoutes); 
console.log("index.js: Webhook routes mounted.");

const appRoutes = require('./routes/apiAndJobRoutes.js'); 
app.use(appRoutes);                                       
console.log("index.js: App/API/Job routes mounted.");

// TODO: Re-add mountPointerApi, mountLatestLead, mountUpdateLead here
// const mountPointerApi = require("./pointerApi.js");
// const mountLatestLead = require("./latestLeadApi.js");
// const mountUpdateLead = require("./updateLeadApi.js");
// if (GPT_CHAT_URL && base && mountPointerApi && mountLatestLead && mountUpdateLead) { 
//     mountPointerApi(app, base, GPT_CHAT_URL);
//     mountLatestLead(app, base);
//     mountUpdateLead(app, base);
//     console.log("index.js: pointerApi, latestLeadApi, updateLeadApi mounted.");
// } else {
//     console.warn("index.js: One or more dependencies for pointer/latestLead/updateLead APIs are missing. These APIs will not be mounted.");
// }

/* ------------------------------------------------------------------
    3) Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
    `▶︎ Server starting – Version: Gemini Integrated (Refactor 5 Patched) – Commit ${process.env.RENDER_GIT_COMMIT || "local"
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