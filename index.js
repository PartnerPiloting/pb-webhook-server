// PB Webhook Server
// Main server file for handling Airtable webhooks and API endpoints
// Force redeploy for follow-ups endpoint - 2024-12-xx

// index.js
// Load environment variables from .env file
require("dotenv").config();

// --- CONFIGURATIONS ---
const geminiConfig = require('./config/geminiClient.js');
const globalGeminiModel = geminiConfig ? geminiConfig.geminiModel : null;
const base = require('./config/airtableClient.js'); // Your Airtable base connection

// Initialize OpenAI client for attribute editing
const { initializeOpenAI } = require('./config/openaiClient.js');
let openaiClient = null;
try {
    openaiClient = initializeOpenAI();
    console.log("index.js: OpenAI client initialized successfully for attribute editing");
} catch (openaiError) {
    console.warn("index.js: OpenAI client initialization failed - attribute editing will not work:", openaiError.message);
}

// --- Potentially import your update function ---
// const { updateLeadRecordFunction } = require('./updateLeadApi'); // OR './your-airtable-utils.js'
// ^^^ If updateLeadApi.js or another module exports a function to update records, import it here.

// --- CORE NPM MODULES ---
const express = require("express");
const path = require('path');

console.log("<<<<< INDEX.JS - REFACTOR 8.4 - AFTER CORE REQUIRES >>>>>"); // Your existing log

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

/* ---------- APP-LEVEL ENV CONFIGURATION & CONSTANTS --- */
const GPT_CHAT_URL = process.env.GPT_CHAT_URL;
if (!GPT_CHAT_URL) {
    console.error("CRITICAL WARNING: Missing GPT_CHAT_URL environment variable. pointerApi may not function correctly.");
}

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID; // Corrected line from bug fix
const AIRTABLE_LEADS_TABLE_ID_OR_NAME = "Leads";
const AIRTABLE_LINKEDIN_URL_FIELD = "LinkedIn Profile URL";
const AIRTABLE_NOTES_FIELD = "Notes";

if (!AIRTABLE_BASE_ID) {
    console.error("CRITICAL WARNING: Missing AIRTABLE_BASE_ID environment variable. Airtable operations will fail for textblaze-linkedin-webhook.");
}

// --- NEW: CONSTANTS FOR POST SCORING ---
const POST_SCORING_ATTRIBUTES_TABLE_NAME = "Post Scoring Attributes";
const POST_SCORING_INSTRUCTIONS_TABLE_NAME = "Post Scoring Instructions";
const POST_DATE_SCORED_FIELD = "Date Posts Scored";
const POSTS_CONTENT_FIELD = "Posts Content";
const POSTS_PLAIN_TEXT_FIELD = "Posts Plain Text"; // NEW: Plain text field for posts
const POST_RELEVANCE_SCORE_FIELD = "Posts Relevance Score";
const POST_AI_EVALUATION_FIELD = "Posts AI Evaluation";
const POST_TOP_SCORING_POST_FIELD = "Top Scoring Post"; // Renamed field
const CREDENTIALS_TABLE_NAME = "Credentials"; // Or "Global Settings", your table for keywords

// --- NEW: CONFIGURATION OBJECT FOR POST ANALYSIS/SCORING ---
const postAnalysisConfig = {
    // Airtable Table Names for Post Scoring - using our new constants
    leadsTableName: AIRTABLE_LEADS_TABLE_ID_OR_NAME,
    attributesTableName: POST_SCORING_ATTRIBUTES_TABLE_NAME,
    promptComponentsTableName: POST_SCORING_INSTRUCTIONS_TABLE_NAME,
    settingsTableName: CREDENTIALS_TABLE_NAME,

    // Field Names in your 'Leads' Table related to Post Scoring - using our new constants
    fields: {
        dateScored: POST_DATE_SCORED_FIELD,
        postsContent: POSTS_CONTENT_FIELD, // Switched back to structured JSON field
        relevanceScore: POST_RELEVANCE_SCORE_FIELD,
        aiEvaluation: POST_AI_EVALUATION_FIELD,
        topScoringPost: POST_TOP_SCORING_POST_FIELD, // Renamed and updated field
        linkedinUrl: AIRTABLE_LINKEDIN_URL_FIELD // Ensure this is mapped for original/repost filtering
    },
    // AI Keywords are now loaded from Airtable by postAttributeLoader.js
    // Model ID and Timeout reuse your existing lead scoring environment variables for consistency.
};

// Check for critical Post Analysis configurations
if (!postAnalysisConfig.attributesTableName || !postAnalysisConfig.promptComponentsTableName) {
    console.error("CRITICAL WARNING: Missing essential Airtable table name configurations for Post Analysis. Post scoring may fail.");
}


/* ------------------------------------------------------------------
    1)  Express App Setup
------------------------------------------------------------------*/
const app = express();
app.use(express.json({ limit: "10mb" }));

// Add CORS configuration to allow frontend requests
const cors = require('cors');
app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://pb-webhook-server.vercel.app',
        'https://pb-webhook-server-*.vercel.app', // Allow preview deployments
        'https://*.vercel.app' // Allow all Vercel deployments for now
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-WP-Nonce']
}));
console.log("CORS enabled for Vercel frontend");

// ABSOLUTE BASIC TEST - Should work 100%
app.get('/basic-test', (req, res) => {
    res.send('BASIC ROUTE WORKING - Express is alive!');
});
console.log("Basic test route added at /basic-test");

// --- ADMIN REPAIR ENDPOINT (SECURE) ---
// Full import for repair script
const repairAirtablePostsContentQuotes = require('./utils/repairAirtablePostsContentQuotes');
const scanBadJsonRecords = require('./scanBadJsonRecords');
const repairSingleBadJsonRecord = require('./repairSingleBadJsonRecord');
const repairAllBadJsonRecords = require('./repairAllBadJsonRecords');
// Use your existing PB_WEBHOOK_SECRET for the repair endpoint
const REPAIR_SECRET = process.env.PB_WEBHOOK_SECRET || 'changeme-please-update-this!';

/**
 * Admin endpoint to trigger the Posts Content repair script.
 * POST /admin/repair-posts-content
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 */
app.post('/admin/repair-posts-content', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
        const summary = await repairAirtablePostsContentQuotes();
        res.json({ ok: true, summary });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Repair failed' });
    }
});

/**
 * Admin endpoint to trigger the scanBadJsonRecords utility.
 * POST /admin/scan-bad-json
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 */
app.post('/admin/scan-bad-json', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
        const result = await scanBadJsonRecords();
        res.json({ ok: true, result });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Scan failed' });
    }
});

/**
 * Admin endpoint to repair a single bad JSON record by recordId.
 * POST /admin/repair-single-bad-json
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 * Body: { "recordId": "recXXXXXXXXXXXXXX" }
 */
app.post('/admin/repair-single-bad-json', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const { recordId } = req.body;
    if (!recordId) {
        return res.status(400).json({ ok: false, error: 'Missing recordId' });
    }
    try {
        await repairSingleBadJsonRecord(recordId);
        res.json({ ok: true, message: `Repair attempted for record ${recordId}` });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Admin endpoint to trigger batch repair of all bad JSON records.
 * POST /admin/repair-all-bad-json
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 */
app.post('/admin/repair-all-bad-json', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
        repairAllBadJsonRecords(); // Fire and forget, logs will show progress
        res.json({ ok: true, message: 'Batch repair started. Check logs for progress and summary.' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

/* ------------------------------------------------------------------
    2) Mount All Route Handlers and Sub-APIs
------------------------------------------------------------------*/
console.log("index.js: Mounting routes and APIs...");

// Mount existing sub-APIs
try { require("./promptApi")(app, base); console.log("index.js: promptApi mounted."); } catch(e) { console.error("index.js: Error mounting promptApi", e.message, e.stack); }
try { require("./recordApi")(app, base); console.log("index.js: recordApi mounted."); } catch(e) { console.error("index.js: Error mounting recordApi", e.message, e.stack); }
try { require("./scoreApi")(app, base, globalGeminiModel); console.log("index.js: scoreApi mounted."); } catch(e) { console.error("index.js: Error mounting scoreApi", e.message, e.stack); }

// --- NEW: MOUNT POST SCORING APIS ---
try {
    // Mounts the API for testing a SINGLE lead's posts
    require("./postScoreTestApi")(app, base, geminiConfig.vertexAIClient, postAnalysisConfig);
    // Mounts the API for triggering the BATCH process for ALL pending leads
    require("./postScoreBatchApi")(app, base, geminiConfig.vertexAIClient, postAnalysisConfig);
} catch(e) {
    console.error("index.js: Error mounting one of the new Post Scoring APIs", e.message, e.stack);
}
// ------------------------------------

const mountQueue = require("./queueDispatcher");
if (mountQueue && typeof mountQueue === 'function') {
    try { mountQueue(app, base); console.log("index.js: Queue Dispatcher mounted."); } catch(e) { console.error("index.js: Error mounting queueDispatcher", e.message, e.stack); }
} else {
    console.error("index.js: Failed to load queueDispatcher or it's not a function.");
}

try { const webhookRoutes = require('./routes/webhookHandlers.js'); app.use(webhookRoutes); console.log("index.js: Webhook routes mounted."); } catch(e) { console.error("index.js: Error mounting webhookRoutes", e.message, e.stack); }
try { const linkedinRoutes = require('./LinkedIn-Messaging-FollowUp/backend-extensions/routes/linkedinRoutes.js'); app.use('/api/linkedin', linkedinRoutes); console.log("index.js: LinkedIn routes mounted at /api/linkedin"); } catch(e) { console.error("index.js: Error mounting LinkedIn routes", e.message, e.stack); }

// EMERGENCY DEBUG ROUTE - Direct in index.js
app.get('/api/linkedin/debug', (req, res) => {
    res.json({ 
        message: 'DIRECT DEBUG ROUTE WORKING', 
        timestamp: new Date().toISOString(),
        path: req.path 
    });
});

// TEST DIFFERENT PATH - NOT /api/
app.get('/test/linkedin/debug', (req, res) => {
    res.json({ 
        message: 'NON-API PATH WORKING', 
        timestamp: new Date().toISOString(),
        path: req.path 
    });
});

console.log("index.js: Emergency debug routes added");

try { const appRoutes = require('./routes/apiAndJobRoutes.js'); app.use(appRoutes); console.log("index.js: App/API/Job routes mounted."); } catch(e) { console.error("index.js: Error mounting appRoutes", e.message, e.stack); }

// --- BROKEN PORTAL ROUTES REMOVED ---
// The following routes were removed as they were trying to serve non-existent files:
// - /linkedin and /linkedin/ routes
// - /portal route  
// - Static file serving for LinkedIn-Messaging-FollowUp/web-portal/build/
//
// ACTUAL WORKING FRONTEND: Next.js app deployed separately on Vercel
// Frontend URL: https://pb-webhook-server.vercel.app
// Backend APIs: Continue to work correctly on Render

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

// --- WEBHOOK FOR TEXT BLAZE LINKEDIN DATA ---
app.post('/textblaze-linkedin-webhook', async (req, res) => {
    console.log('Received data from Text Blaze /textblaze-linkedin-webhook:');
    console.log('Request Body:', req.body);

    const { linkedinMessage, profileUrl, timestamp } = req.body;

    if (!linkedinMessage || !profileUrl || !timestamp) {
        console.error("Webhook Error: Missing linkedinMessage, profileUrl, or timestamp in request body.");
        return res.status(400).json({
            status: 'error',
            message: 'Missing required data: linkedinMessage, profileUrl, or timestamp.'
        });
    }
    
    if (!base) {
        console.error("Webhook Error: Airtable base not configured on server.");
        return res.status(500).json({
            status: 'error',
            message: 'Airtable integration not available on server.'
        });
    }
    if (!AIRTABLE_BASE_ID) {
        console.error("Webhook Error: AIRTABLE_BASE_ID not configured on server.");
        return res.status(500).json({
            status: 'error',
            message: 'Airtable Base ID not configured on server.'
        });
    }

    // Normalize the incoming profileUrl to remove a trailing slash, if present
    let normalizedProfileUrl = profileUrl;
    if (typeof normalizedProfileUrl === 'string' && normalizedProfileUrl.endsWith('/')) {
        normalizedProfileUrl = normalizedProfileUrl.slice(0, -1);
    }
    console.log(`Normalized Profile URL for Airtable search: ${normalizedProfileUrl}`);


    try {
        console.log(`Searching Airtable for Lead with URL: ${normalizedProfileUrl}`); // Use normalized URL
        const records = await base(AIRTABLE_LEADS_TABLE_ID_OR_NAME).select({
            maxRecords: 1,
            // Use the normalized URL in the filter formula
            filterByFormula: `({${AIRTABLE_LINKEDIN_URL_FIELD}} = '${normalizedProfileUrl}')`
        }).firstPage();

        if (records && records.length > 0) {
            const record = records[0];
            const recordId = record.id;
            console.log(`Found Lead with Record ID: ${recordId}`);

            const existingNotes = record.get(AIRTABLE_NOTES_FIELD) || "";
            const newNoteEntry = `📅 ${timestamp} – Sent: ${linkedinMessage}`;
            // Prepend new note, ensuring a clean separation if existingNotes is empty
            const updatedNotes = existingNotes
                ? `${newNoteEntry}\n\n---\n\n${existingNotes}`
                : newNoteEntry;

            // Using the direct update logic as discussed
            await base(AIRTABLE_LEADS_TABLE_ID_OR_NAME).update([
                {
                    "id": recordId,
                    "fields": {
                        [AIRTABLE_NOTES_FIELD]: updatedNotes
                    }
                }
            ]);
            console.log(`Successfully updated Notes for Record ID: ${recordId}`);
            
            const airtableRecordUrl = `https://airtable.com/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_LEADS_TABLE_ID_OR_NAME)}/${recordId}`;

            return res.status(200).json({
                status: 'success',
                message: `Airtable record updated for ${normalizedProfileUrl}`,
                airtableRecordUrl: airtableRecordUrl,
                recordId: recordId
            });
        } else {
            console.warn(`No Lead found in Airtable with URL: ${normalizedProfileUrl}`);
            return res.status(404).json({
                status: 'error',
                message: `No Lead found in Airtable with LinkedIn Profile URL: ${normalizedProfileUrl}`
            });
        }
    } catch (error) {
        console.error("Error interacting with Airtable:", error);
        let errorMessage = "Error updating Airtable.";
        if (error.message) {
            errorMessage += ` Details: ${error.message}`;
        }
        return res.status(500).json({
            status: 'error',
            message: errorMessage,
            errorDetails: error.toString()
        });
    }
});

// Diagnostic route to see exactly what's wrong with static files
app.get('/debug-linkedin-files', (req, res) => {
    const fs = require('fs');
    const targetPath = path.join(__dirname, 'LinkedIn-Messaging-FollowUp/web-portal/build');
    const indexPath = path.join(targetPath, 'index.html');
    
    res.json({
        __dirname: __dirname,
        targetPath: targetPath,
        targetExists: fs.existsSync(targetPath),
        indexExists: fs.existsSync(indexPath),
        dirContents: fs.existsSync(targetPath) ? fs.readdirSync(targetPath) : 'directory not found',
        indexContent: fs.existsSync(indexPath) ? 'file exists' : 'file not found'
    });
});

/* ------------------------------------------------------------------
    3) Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
    `▶︎ Server starting – Version: Gemini Integrated (Refactor 8.4) – Commit ${process.env.RENDER_GIT_COMMIT || "local"
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