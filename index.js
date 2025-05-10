console.log("<<<<< INDEX.JS - REFACTOR 5 - MOVED APP/API/JOB ROUTES - TOP OF FILE >>>>>");
/***************************************************************
 Main Server File - Orchestrator
***************************************************************/
require("dotenv").config(); 

// --- CONFIGURATIONS ---
const globalGeminiModel = require('./config/geminiClient.js');
const base = require('./config/airtableClient.js'); 

// --- CORE NPM MODULES ---
const express = require("express");

// --- LOCAL SERVICE & HELPER MODULES (that index.js might still directly use or pass) ---
// Note: Many of these might only be used by the route handlers now.
// We can refine these requires later if they are no longer directly needed by index.js itself.
const { buildPrompt, slimLead }    = require("./promptBuilder");       // Used by pointerApi (TODO)
const { loadAttributes }          = require("./attributeLoader");     // Used by /score-lead, /api/test-score (now in routes)
const { computeFinalScore }       = require("./scoring");             // Used by /score-lead, /api/test-score (now in routes)
const { buildAttributeBreakdown } = require("./breakdown");           // Used by /score-lead, /api/test-score (now in routes)
const { scoreLeadNow }            = require("./singleScorer");        // Used by /score-lead, /api/test-score (now in routes)
// const batchScorer                 = require("./batchScorer");      // batchScorer.run is called by a route now in apiAndJobRoutes.js
// const { upsertLead }              = require('./services/leadService.js'); // upsertLead is called by routes now in apiAndJobRoutes.js & webhookHandlers.js
// const { alertAdmin, getJsonUrl, canonicalUrl, isAustralian, safeDate, getLastTwoOrgs, isMissingCritical } = require('./utils/appHelpers.js'); // These are used by routes now

console.log("<<<<< INDEX.JS - REFACTOR 5 - AFTER MINIMAL REQUIRES >>>>>");

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

/* ---------- APP-LEVEL ENV CONFIGURATION (if needed by index.js directly) --- */
const GPT_CHAT_URL = process.env.GPT_CHAT_URL; // Needed for pointerApi (TODO)

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
require("./promptApi")(app); 
require("./recordApi")(app);
require("./scoreApi")(app); 
const mountQueue = require("./queueDispatcher");
mountQueue(app);

// Mount our newly refactored route modules
const webhookRoutes = require('./routes/webhookHandlers.js');
app.use(webhookRoutes); 
console.log("index.js: Webhook routes mounted.");

const appRoutes = require('./routes/apiAndJobRoutes.js'); // <-- REQUIRE NEW ROUTES
app.use(appRoutes);                                       // <-- USE NEW ROUTES
console.log("index.js: App/API/Job routes mounted.");

// TODO: Re-add mountPointerApi, mountLatestLead, mountUpdateLead here
// Example (these will need their own require statements once we confirm their files):
// const mountPointerApi = require("./pointerApi.js");
// const mountLatestLead = require("./latestLeadApi.js");
// const mountUpdateLead = require("./updateLeadApi.js");
// if (GPT_CHAT_URL && base && mountPointerApi && mountLatestLead && mountUpdateLead) { // Ensure dependencies are met
//     mountPointerApi(app, base, GPT_CHAT_URL);
//     mountLatestLead(app, base);
//     mountUpdateLead(app, base);
//     console.log("index.js: pointerApi, latestLeadApi, updateLeadApi mounted.");
// } else {
//     console.warn("index.js: One or more dependencies for pointer/latestLead/updateLead APIs are missing. These APIs will not be mounted.");
// }


/*
    BLOCKS REMOVED:
    - /health route handler
    - /run-batch-score route handler
    - /score-lead route handler
    - /api/test-score route handler
    - Phantombuster pull (currentLastRunId, PB_LAST_RUN_ID_FILE, fs logic, and /pb-pull/connections route handler)
    - /debug-gemini-info route handler
    (All these are now handled in routes/apiAndJobRoutes.js)
*/

/* ------------------------------------------------------------------
    3) Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
    `▶︎ Server starting – Version: Gemini Integrated (Refactor 5) – Commit ${process.env.RENDER_GIT_COMMIT || "local"
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
    LEGACY SECTION (Commented Out)
------------------------------------------------------------------*/
/*
async function getScoringData() { /* ... */ }
function parseMarkdownTables(markdown) { /* ... */ }
*/