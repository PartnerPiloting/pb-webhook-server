// PB Webhook Server
// touch: force reload for nodemon - 2025-08-16
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
const { v4: uuidv4 } = require('uuid');

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
// Note: The CORS package does not treat wildcard strings in the origin array as patterns.
// We must use a function and/or regular expressions to match dynamic subdomains like *.vercel.app
const cors = require('cors');

const allowedOrigins = [
    /^http:\/\/localhost(:\d+)?$/i,
    'https://pb-webhook-server.vercel.app',
    'https://pb-webhook-server-staging.vercel.app',
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
    'https://australiansidehustles.com.au',
    'https://www.australiansidehustles.com.au'
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow non-browser requests (e.g., curl, server-to-server) where origin may be undefined
        if (!origin) return callback(null, true);

        const isAllowed = allowedOrigins.some((rule) =>
            rule instanceof RegExp ? rule.test(origin) : rule === origin
        );

        if (isAllowed) return callback(null, true);
        return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    // Include PATCH for incremental updates (e.g., search terms)
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-WP-Nonce', 'Cookie', 'x-client-id'],
    optionsSuccessStatus: 204
}));
console.log("CORS enabled for allowed origins including *.vercel.app and staging frontend");

// ABSOLUTE BASIC TEST - Should work 100%
app.get('/basic-test', (req, res) => {
    res.send('BASIC ROUTE WORKING - Express is alive!');
});
console.log("Basic test route added at /basic-test");

// Friendly root route to reduce confusion when visiting http://localhost:3001
app.get('/', (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const apiBase = `http://localhost:${process.env.PORT || 3001}`;
        const uiUrl = 'http://localhost:3000/top-scoring-leads?testClient=Guy-Wilson';
        res.end(`
<!doctype html>
<html>
    <head>
        <meta charset="utf-8"/>
        <title>PB Webhook Server</title>
        <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",sans-serif;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.5}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style>
    </head>
    <body>
        <h1>PB Webhook Server</h1>
        <p>This is the API server. For the UI, open <a href="${uiUrl}">${uiUrl}</a>.</p>
        <h2>Quick links</h2>
        <ul>
            <li><a href="${apiBase}/api/top-scoring-leads/status">Top Scoring Leads · Status</a></li>
            <li><a href="${apiBase}/api/top-scoring-leads/_debug/routes">Top Scoring Leads · Routes</a></li>
            <li><a href="${apiBase}/api/test/minimal-json">Minimal JSON Test</a></li>
            <li><a href="${apiBase}/basic-test">Basic Test</a></li>
        </ul>
        <p style="color:#6b7280">Tip: Start both servers with <code>npm run dev:simple</code> (API:3001, Frontend:3000).</p>
    </body>
</html>`);
});

// JSON DIAGNOSTIC TEST - Tests if Express/Node/Render can produce clean JSON
app.get('/api/test/minimal-json', (req, res) => {
    // No middleware, no async, no database calls - just pure Express JSON response
    console.log('Minimal JSON Test: Sending pure Express JSON response');
    res.json({ 
        test: 'minimal',
        status: 'success', 
        number: 123,
        boolean: true,
        array: [1, 2, 3],
        nested: { key: 'value', another: 'data' },
        timestamp: new Date().toISOString()
    });
});
console.log("JSON diagnostic test route added at /api/test/minimal-json");

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

// Use authenticated LinkedIn routes instead of old non-authenticated ones
try { 
    const linkedinRoutesWithAuth = require('./LinkedIn-Messaging-FollowUp/backend-extensions/routes/linkedinRoutesWithAuth.js'); 
    app.use('/api/linkedin', linkedinRoutesWithAuth); 
    console.log("index.js: Authenticated LinkedIn routes mounted at /api/linkedin"); 
} catch(e) { 
    console.error("index.js: Error mounting authenticated LinkedIn routes", e.message, e.stack); 
    // Fallback to old routes if new ones fail
    try { 
        const linkedinRoutes = require('./LinkedIn-Messaging-FollowUp/backend-extensions/routes/linkedinRoutes.js'); 
        app.use('/api/linkedin', linkedinRoutes); 
        console.log("index.js: Fallback: Old LinkedIn routes mounted at /api/linkedin"); 
    } catch(fallbackError) { 
        console.error("index.js: Error mounting fallback LinkedIn routes", fallbackError.message, fallbackError.stack); 
    }
}

// Authentication test routes
try { const authTestRoutes = require('./routes/authTestRoutes.js'); app.use('/api/auth', authTestRoutes); console.log("index.js: Authentication test routes mounted at /api/auth"); } catch(e) { console.error("index.js: Error mounting authentication test routes", e.message, e.stack); }

// Debug routes for JSON serialization issues
try { const debugRoutes = require('./routes/debugRoutes.js'); app.use('/api/debug', debugRoutes); console.log("index.js: Debug routes mounted at /api/debug"); } catch(e) { console.error("index.js: Error mounting debug routes", e.message, e.stack); }

// Top Scoring Leads scaffold (feature gated inside the router module)
try {
    const mountTopScoringLeads = require('./routes/topScoringLeadsRoutes.js');
    if (typeof mountTopScoringLeads === 'function') {
        mountTopScoringLeads(app, base);
        console.log('index.js: Top Scoring Leads routes mounted at /api/top-scoring-leads');
    }
} catch(e) {
    console.error('index.js: Error mounting Top Scoring Leads routes', e.message, e.stack);
}

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

// --- HELP / START HERE (PHASE 1) ---
// Simple in-memory cache for start_here help content
let __helpStartHereCache = { data: null, fetchedAt: 0 };
const HELP_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Utility to slugify for stable IDs
function slugify(str) {
    return (str || '')
        .toString()
        .trim()
        .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Flexible order extraction: tries multiple field names & numeric strings; falls back to 9999
function extractOrder(fields, possibleKeys) {
    for (const k of possibleKeys) {
        if (Object.prototype.hasOwnProperty.call(fields, k) && fields[k] != null) {
            const v = fields[k];
            if (typeof v === 'number' && !Number.isNaN(v)) return v;
            if (typeof v === 'string') {
                const num = parseInt(v.trim(), 10);
                if (!Number.isNaN(num)) return num;
            }
            if (Array.isArray(v) && v.length) {
                const first = v[0];
                if (typeof first === 'number' && !Number.isNaN(first)) return first;
                if (typeof first === 'string') {
                    const num = parseInt(first.trim(), 10);
                    if (!Number.isNaN(num)) return num;
                }
            }
        }
    }
    // Fuzzy fallback: match keys that START WITH a desired key or contain it before a parenthetical Airtable suffix
    const lcKeys = Object.keys(fields);
    for (const baseKey of possibleKeys) {
        const baseNorm = baseKey.toLowerCase();
        const candidate = lcKeys.find(k => {
            const kl = k.toLowerCase();
            return kl === baseNorm || kl.startsWith(baseNorm + ' ') || kl.startsWith(baseNorm + '(') || kl.includes(baseNorm + ' (from');
        });
        if (candidate && fields[candidate] != null) {
            const v = fields[candidate];
            if (typeof v === 'number' && !Number.isNaN(v)) return v;
            if (typeof v === 'string') {
                const num = parseInt(v.trim(), 10);
                if (!Number.isNaN(num)) return num;
            }
            if (Array.isArray(v) && v.length) {
                const first = v[0];
                if (typeof first === 'number' && !Number.isNaN(first)) return first;
                if (typeof first === 'string') {
                    const num = parseInt(first.trim(), 10);
                    if (!Number.isNaN(num)) return num;
                }
            }
        }
    }
    return 9999;
}

// Attempt to pull a numeric prefix from a name like "01. Getting Started" → { order:1, name:"Getting Started" }
function parsePrefixedName(name) {
    if (!name) return { order: 9999, name: name };
    // Accept standard punctuation separators including en dash (–) and em dash (—)
    const m = name.match(/^(\d{1,4})[)\.\-_:\s–—]+(.+)/);
    if (m) {
        const order = parseInt(m[1], 10);
        if (!Number.isNaN(order)) {
            return { order, name: m[2].trim() };
        }
    }
    return { order: 9999, name };
}

app.get('/api/help/start-here', async (req, res) => {
    try {
        const refresh = req.query.refresh === '1';
        const now = Date.now();
        if (!refresh && __helpStartHereCache.data && (now - __helpStartHereCache.fetchedAt) < HELP_CACHE_TTL_MS) {
            return res.json({ ...__helpStartHereCache.data, meta: { ...__helpStartHereCache.data.meta, cached: true } });
        }

    const targetBaseId = process.env.AIRTABLE_HELP_BASE_ID || process.env.MASTER_CLIENTS_BASE_ID || process.env.AIRTABLE_BASE_ID;
        if (!targetBaseId) return res.status(500).json({ ok: false, error: 'Missing Airtable base id for help content' });
        if (!base) return res.status(500).json({ ok: false, error: 'Airtable base instance not initialized' });

        // Dev stub bypass: allow quick UI testing without Airtable access
        if (req.query.stub === '1') {
            const stubPayload = {
                area: 'start_here',
                fetchedAt: new Date().toISOString(),
                categories: [
                    { id: 'cat::sample', name: 'Sample Category', order: 1, subCategories: [ { id: 'sub::sample::intro', name: 'Intro', order: 1, topics: [ { id: 'stubA', title: 'Welcome (stub)', order: 1 }, { id: 'stubB', title: 'Navigation tips', order: 2 } ] } ] }
                ],
                meta: { totalTopics: 2, generationMs: 0, cached: false, stub: true, baseId: targetBaseId }
            };
            return res.json(stubPayload);
        }

        // Dynamically pick correct base instance (support dedicated help base)
        let helpBase = base; // default
    const defaultBaseId = process.env.AIRTABLE_BASE_ID;
    const masterClientsBaseId = process.env.MASTER_CLIENTS_BASE_ID;
        try {
            if (targetBaseId && defaultBaseId && targetBaseId !== defaultBaseId) {
                if (typeof base.createBaseInstance === 'function') {
                    helpBase = base.createBaseInstance(targetBaseId);
                    console.log(`[HelpStartHere] Using non-default help base ${targetBaseId}`);
                } else {
                    console.warn('[HelpStartHere] createBaseInstance not available on base export; falling back to default base');
                }
            } else {
                if (targetBaseId === masterClientsBaseId && targetBaseId !== defaultBaseId) {
                    console.log('[HelpStartHere] Using MASTER_CLIENTS_BASE_ID for help content');
                } else {
                    console.log('[HelpStartHere] Using default base for help content');
                }
            }
        } catch (bErr) {
            console.error('[HelpStartHere] Failed to initialize help base', bErr.message);
            return res.status(500).json({ ok: false, error: 'Failed to initialize help base instance' });
        }

        const start = Date.now();
        const rows = [];
        // Airtable pagination
        // NEW: Direct 3-table join (Categories, Sub-Categories, Help topics)
        const includeBody = req.query.include === 'body';
        const rowsTopics = [];
        const rowsCategories = [];
        const rowsSubCategories = [];

        const collectAll = async (tableName, sink) => {
            await helpBase(tableName).select({ pageSize: 100 }).eachPage((records, next) => {
                records.forEach(r => sink.push(r));
                next();
            });
        };

        const collectFiltered = async (tableName, sink, filterByFormula) => {
            await helpBase(tableName).select({ pageSize: 100, filterByFormula }).eachPage((records, next) => {
                records.forEach(r => sink.push(r));
                next();
            });
        };

        await collectAll('Categories', rowsCategories);
        await collectAll('Sub-Categories', rowsSubCategories);
        await collectFiltered('Help', rowsTopics, "{help_area} = 'start_here'");

        // Maps
        const catMap = new Map();
        const subMap = new Map();

        const normOrder = (val, nameForPrefix) => {
            if (typeof val === 'number' && !Number.isNaN(val)) return val;
            if (typeof val === 'string' && val.trim()) {
                const parsed = parseInt(val.trim(), 10);
                if (!Number.isNaN(parsed)) return parsed;
            }
            if (nameForPrefix) {
                const pref = parsePrefixedName(nameForPrefix);
                if (pref.order !== 9999) return pref.order;
            }
            return 9999;
        };

        rowsCategories.forEach(r => {
            const f = r.fields || {};
            const name = (f.category_name || '').toString().trim() || 'Unnamed Category';
            const order = normOrder(f.category_order, name);
            catMap.set(r.id, {
                id: 'cat::' + slugify(name),
                airtableId: r.id,
                name,
                description: (f.description || '').toString().trim() || null,
                order,
                subCategories: [],
                _rawOrder: f.category_order
            });
        });

        rowsSubCategories.forEach(r => {
            const f = r.fields || {};
            const name = (f.sub_category_name || '').toString().trim() || 'Unnamed Sub-Category';
            const order = normOrder(f.sub_category_order, name);
            const catLink = Array.isArray(f.Categories) && f.Categories.length ? f.Categories[0] : null; // linked record id
            subMap.set(r.id, {
                id: 'sub::' + slugify(name + '::' + (catLink || 'orphan')),
                airtableId: r.id,
                name,
                description: (f.description || '').toString().trim() || null,
                order,
                categoryAirtableId: catLink,
                topics: [],
                _rawOrder: f.sub_category_order
            });
        });

        let missingSubCategoryLinks = 0;
        let missingCategoryLinks = 0;

        rowsTopics.forEach(r => {
            const f = r.fields || {};
            const title = (f.title || '').toString().trim() || '(Untitled Topic)';
            const order = normOrder(f.topic_order, title);
            const subLink = Array.isArray(f.sub_category) && f.sub_category.length ? f.sub_category[0] : null;
            if (!subLink) { missingSubCategoryLinks++; return; }
            const sub = subMap.get(subLink);
            if (!sub) { missingSubCategoryLinks++; return; }
            const cat = catMap.get(sub.categoryAirtableId);
            if (!cat) { missingCategoryLinks++; return; }
            sub.topics.push({
                id: r.id,
                title,
                order,
                body: includeBody ? (f.monologue_context || '').toString() : undefined,
                contextType: f.context_type || null
            });
        });

        // Attach subcategories to categories
        subMap.forEach(sub => {
            const cat = catMap.get(sub.categoryAirtableId);
            if (!cat) { missingCategoryLinks++; return; }
            cat.subCategories.push(sub);
        });

        // Convert to arrays & sort
        const categories = Array.from(catMap.values())
            .filter(c => c.subCategories.some(sc => sc.topics.length)) // only with content
            .sort((a,b)=> a.order - b.order || a.name.localeCompare(b.name))
            .map(c => ({
                id: c.id,
                name: c.name,
                order: c.order,
                description: c.description,
                subCategories: c.subCategories
                    .filter(sc => sc.topics.length)
                    .sort((a,b)=> a.order - b.order || a.name.localeCompare(b.name))
                    .map(sc => ({
                        id: sc.id,
                        name: sc.name,
                        order: sc.order,
                        description: sc.description,
                        topics: sc.topics.sort((a,b)=> a.order - b.order || a.title.localeCompare(b.title)).map(t => ({
                            id: t.id,
                            title: t.title,
                            order: t.order,
                            ...(includeBody ? { body: t.body } : {}),
                            contextType: t.contextType
                        }))
                    }))
            }));

        const debug = req.query.debug === '1';
        const payload = {
            area: 'start_here',
            fetchedAt: new Date().toISOString(),
            categories,
            meta: {
                totalTopics: rowsTopics.length,
                totalCategories: categories.length,
                totalSubCategories: categories.reduce((s,c)=> s + c.subCategories.length, 0),
                generationMs: Date.now() - start,
                cached: false,
                baseId: targetBaseId,
                orderingStrategy: 'explicit+prefixFallback',
                missingSubCategoryLinks,
                missingCategoryLinks,
                includeBody,
                debugIncluded: !!debug
            }
        };
        if (debug) {
            payload.debug = {
                sampleCategoryIds: categories.slice(0,3).map(c=>c.id),
                rawCounts: { rowsCategories: rowsCategories.length, rowsSubCategories: rowsSubCategories.length, rowsTopics: rowsTopics.length }
            };
        }
        __helpStartHereCache = { data: payload, fetchedAt: Date.now() };
        res.json(payload);
    } catch (e) {
        try { console.error('Help Start Here endpoint error raw =>', e); } catch {}
        try { if (e && e.stack) console.error('Stack:', e.stack); } catch {}
        // Provide actionable diagnostics on NOT_AUTHORIZED
        const isAuth = (e && (e.error === 'NOT_AUTHORIZED' || e.statusCode === 403));
        if (isAuth && process.env.ENABLE_HELP_STUB === '1') {
            console.warn('[HelpStartHere] NOT_AUTHORIZED – serving stub help data because ENABLE_HELP_STUB=1');
            const payload = {
                area: 'start_here',
                fetchedAt: new Date().toISOString(),
                categories: [
                    {
                        id: 'cat::getting-started',
                        name: 'Getting Started',
                        order: 1,
                        subCategories: [
                            {
                                id: 'sub::getting-started::overview',
                                name: 'Overview',
                                order: 1,
                                topics: [
                                    { id: 'stub1', title: 'Welcome & Orientation', order: 1 },
                                    { id: 'stub2', title: 'Core Concepts', order: 2 }
                                ]
                            }
                        ]
                    },
                    {
                        id: 'cat::troubleshooting',
                        name: 'Troubleshooting',
                        order: 2,
                        subCategories: [
                            {
                                id: 'sub::troubleshooting::common-issues',
                                name: 'Common Issues',
                                order: 1,
                                topics: [
                                    { id: 'stub3', title: 'Why can\'t I see my leads?', order: 1 },
                                    { id: 'stub4', title: 'Scoring delays explained', order: 2 }
                                ]
                            }
                        ]
                    }
                ],
                meta: { totalTopics: 4, generationMs: 0, cached: false, stub: true }
            };
            return res.json(payload);
        }
        const msg = isAuth
            ? 'Airtable NOT_AUTHORIZED (403). Verify AIRTABLE_HELP_BASE_ID (currently set?) and that the API key has at least read access to the Help table in that base.'
            : (e?.message || e?.error || 'Failed to load start_here help content');
        res.status(500).json({ ok: false, error: msg, authError: isAuth });
    }
});
console.log('index.js: Help Start Here endpoint mounted at /api/help/start-here');

// --- ENVIRONMENT MANAGEMENT ENDPOINTS ---
// Environment status - tells you exactly where you are and what to do
app.get('/api/environment/status', (req, res) => {
    const currentEnv = process.env.NODE_ENV || 'development';
    const renderCommit = process.env.RENDER_GIT_COMMIT || 'local';
    const currentBranch = process.env.RENDER_GIT_BRANCH || 'main';
    
    // Determine environment based on URL or environment variables
    let environment = 'development';
    let chromeProfile = 'Development';
    let visualIndicator = '🟢 DEVELOPMENT';
    let safetyLevel = 'SAFE';
    
    if (req.get('host')?.includes('pb-webhook-server') && req.get('host')?.includes('render')) {
        environment = 'production';
        chromeProfile = 'Production';
        visualIndicator = '🔴 PRODUCTION';
        safetyLevel = 'DANGER - LIVE DATA';
    } else if (req.get('host')?.includes('staging') || currentBranch === 'staging') {
        environment = 'staging';
        chromeProfile = 'Staging';
        visualIndicator = '🟡 STAGING';
        safetyLevel = 'CAUTION - TEST DATA';
    }
    
    res.json({
        environment: environment,
        chromeProfile: chromeProfile,
        visualIndicator: visualIndicator,
        safetyLevel: safetyLevel,
        instructions: {
            currentLocation: `You are currently on: ${req.get('host')}`,
            recommendedProfile: `Use Chrome Profile: "${chromeProfile}"`,
            bookmarkThis: `Bookmark this URL in your ${chromeProfile} profile`,
            nextSteps: environment === 'production' 
                ? ['⚠️ You are in PRODUCTION', 'Double-check all changes', 'Consider testing in staging first']
                : ['✅ Safe to experiment', 'Changes won\'t affect live users', 'Test freely']
        },
        technicalInfo: {
            branch: currentBranch,
            commit: renderCommit,
            airtableBase: AIRTABLE_BASE_ID ? 'Connected' : 'Not configured',
            timestamp: new Date().toISOString()
        }
    });
});

// Global routes map for debugging (non-secret; shows only paths/methods)
app.get('/api/_debug/routes', (req, res) => {
    try {
        const list = [];
        const stack = app._router && app._router.stack ? app._router.stack : [];
        for (const layer of stack) {
            if (layer && layer.route && layer.route.path) {
                const path = layer.route.path;
                const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
                list.push({ path, methods, mount: 'app' });
            } else if (layer && layer.name === 'router' && layer.handle && layer.handle.stack) {
                // Mounted routers (e.g., app.use('/base', router))
                const mountPath = layer.regexp && layer.regexp.fast_star ? '*' : (layer.regexp && layer.regexp.toString());
                for (const r of layer.handle.stack) {
                    if (r && r.route) {
                        const path = r.route.path;
                        const methods = Object.keys(r.route.methods || {}).filter(Boolean);
                        list.push({ path, methods, mount: mountPath });
                    }
                }
            }
        }
        res.json({ ok: true, count: list.length, routes: list });
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
});

// Agent command endpoint - responds to plain English instructions
app.post('/api/environment/agent-command', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    
    const { command } = req.body;
    const response = {
        understood: command,
        timestamp: new Date().toISOString()
    };
    
    if (command?.toLowerCase().includes('production')) {
        response.action = 'SWITCH TO PRODUCTION';
        response.instructions = [
            '1. Open Chrome Profile: "Production"',
            '2. Navigate to: https://pb-webhook-server.onrender.com',
            '3. Bookmark this URL in Production profile',
            '4. ⚠️ WARNING: You will be working with LIVE DATA'
        ];
        response.chromeProfile = 'Production';
        response.url = 'https://pb-webhook-server.onrender.com';
        response.warning = '🔴 PRODUCTION ENVIRONMENT - BE CAREFUL!';
    } else if (command?.toLowerCase().includes('staging') || command?.toLowerCase().includes('test')) {
        response.action = 'SWITCH TO STAGING';
        response.instructions = [
            '1. Open Chrome Profile: "Staging"',
            '2. Navigate to: https://pb-webhook-staging.onrender.com',
            '3. Bookmark this URL in Staging profile',
            '4. ✅ Safe to test - using test data'
        ];
        response.chromeProfile = 'Staging';
        response.url = 'https://pb-webhook-staging.onrender.com';
        response.warning = '🟡 STAGING ENVIRONMENT - TEST DATA';
    } else if (command?.toLowerCase().includes('local') || command?.toLowerCase().includes('development')) {
        response.action = 'SWITCH TO DEVELOPMENT';
        response.instructions = [
            '1. Open Chrome Profile: "Development"',
            '2. Navigate to: http://localhost:3000',
            '3. Make sure your local server is running',
            '4. ✅ Completely safe - local only'
        ];
        response.chromeProfile = 'Development';
        response.url = 'http://localhost:3000';
        response.warning = '🟢 DEVELOPMENT ENVIRONMENT - LOCAL ONLY';
    } else {
        response.action = 'UNKNOWN COMMAND';
        response.suggestions = [
            'Try: "switch to production"',
            'Try: "switch to staging"', 
            'Try: "switch to development"',
            'Try: "create hotfix branch"'
        ];
    }
    
    res.json(response);
});

console.log("index.js: Environment management endpoints added");

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
const port = process.env.PORT || 3001;
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

// --- SAFETY GUARD: Prevent silent use of production base in non-production ---
(function safetyGuardForAirtableBase() {
    const PROD_BASE_ID = 'appXySOLo6V9PfMfa'; // Production fallback base (from your .env)
    const env = process.env.NODE_ENV || 'development';
    if (env !== 'production' && AIRTABLE_BASE_ID === PROD_BASE_ID) {
        console.warn(`⚠️  SAFETY WARNING: Running in NODE_ENV=${env} while AIRTABLE_BASE_ID is set to the production base (${PROD_BASE_ID}).\n` +
            'If this is intentional (legacy fallback), ensure you always supply ?testClient=... so client-specific bases are used.');
    }
})();

// Middleware to warn per-request if no client specified and production base fallback is in use
app.use((req, res, next) => {
    const clientParam = req.query.testClient || req.query.clientId || req.headers['x-client-id'];
    const PROD_BASE_ID = 'appXySOLo6V9PfMfa';
    if (!clientParam && AIRTABLE_BASE_ID === PROD_BASE_ID && (process.env.NODE_ENV !== 'production')) {
        console.warn(`⚠️  Request ${req.method} ${req.path} used DEFAULT production base (no clientId/testClient provided). Add ?testClient=CLIENT_ID to target that client base.`);
    }
    next();
});

// --- HELP BASE RESOLUTION HELPERS (used by topic + QA endpoints) ---
function getHelpBaseId() {
    return process.env.AIRTABLE_HELP_BASE_ID || process.env.MASTER_CLIENTS_BASE_ID || process.env.AIRTABLE_BASE_ID;
}

function getHelpBase() {
    if (!base) return null;
    const targetBaseId = getHelpBaseId();
    const defaultBaseId = process.env.AIRTABLE_BASE_ID;
    if (targetBaseId && defaultBaseId && targetBaseId !== defaultBaseId) {
        if (typeof base.createBaseInstance === 'function') {
            try {
                const inst = base.createBaseInstance(targetBaseId);
                return inst;
            } catch (e) {
                console.error('[getHelpBase] Failed to create base instance', e.message);
                return null;
            }
        } else {
            console.warn('[getHelpBase] createBaseInstance not available; falling back to default base');
        }
    }
    return base;
}

// --- Single Topic endpoint: returns structured blocks with media resolution ---
app.get('/api/help/topic/:id', async (req, res) => {
    const start = Date.now();
    const topicId = req.params.id;
    const includeInstructions = (req.query.include_instructions === '1');
    try {
        const helpBase = getHelpBase();
        if (!helpBase) return res.status(500).json({ error: 'HELP_BASE_UNRESOLVED' });

        // 1. Fetch the topic record
        let record;
        try {
            record = await helpBase('Help').find(topicId);
        } catch (e) {
            return res.status(404).json({ error: 'TOPIC_NOT_FOUND', id: topicId });
        }
        const f = record.fields || {};
        const rawBody = (f.monologue_context || f.body || f.content || '').toString();
        const title = (f.title || f.Name || '').toString();

        // 2. Extract media/link token ids: [media:12], [link:5]
        const TOKEN_RE = /\[(media|link):(\d+)\]/gi;
        const mediaIds = new Set();
        let m;
        while ((m = TOKEN_RE.exec(rawBody)) !== null) {
            mediaIds.add(m[2]);
        }

        // 3. Fetch referenced media records (by media_id numeric). Build OR formula.
        const mediaMap = new Map();
        if (mediaIds.size) {
            const idsArr = Array.from(mediaIds);
            // Airtable formula supports only limited OR length; assume small set.
            const formula = 'OR(' + idsArr.map(id => `{media_id}=${id}`).join(',') + ')';
            await helpBase('Media').select({ filterByFormula: formula, pageSize: idsArr.length }).eachPage((records, next) => {
                records.forEach(r => mediaMap.set(String(r.fields.media_id), r));
                next();
            });
        }

        // 4. Parse body into blocks: split on tokens preserving order
        const blocks = [];
        let lastIndex = 0;
        rawBody.replace(TOKEN_RE, (match, kind, id, offset) => {
            if (offset > lastIndex) {
                const textSegment = rawBody.slice(lastIndex, offset);
                if (textSegment.trim()) blocks.push({ type: 'text', markdown: textSegment });
            }
            const mediaRec = mediaMap.get(id);
            if (mediaRec) {
                const mf = mediaRec.fields || {};
                const attachment = Array.isArray(mf.attachment) && mf.attachment.length ? mf.attachment[0] : null;
                const resolved = {
                    media_id: mf.media_id,
                    type: (mf.type || (kind === 'link' ? 'link' : (attachment ? 'image' : 'unknown'))),
                    url: mf.url || (attachment && attachment.url) || null,
                    attachment,
                    caption: mf.caption || null,
                    description: mf.description || null,
                    instructions: includeInstructions ? (mf.instructions || null) : undefined
                };
                blocks.push({ type: 'media', token: match, media: resolved });
            } else {
                blocks.push({ type: 'media-missing', token: match, media_id: id });
            }
            lastIndex = offset + match.length;
            return match;
        });
        if (lastIndex < rawBody.length) {
            const tail = rawBody.slice(lastIndex);
            if (tail.trim()) blocks.push({ type: 'text', markdown: tail });
        }

        // 5. Basic markdown note: we return raw markdown, frontend decides renderer.
        const payload = {
            id: topicId,
            title,
            blocks,
            meta: {
                generationMs: Date.now() - start,
                mediaTokenCount: mediaIds.size,
                mediaResolved: Array.from(mediaMap.keys()).length,
                mediaUnresolved: mediaIds.size - mediaMap.size,
                includeInstructions,
                baseId: getHelpBaseId() || null
            }
        };
        res.json(payload);
    } catch (e) {
        console.error('Help topic endpoint error', e);
        res.status(500).json({ error: 'TOPIC_FETCH_ERROR', message: e.message });
    }
});

// --- Simple QA endpoint (Phase 0 stub) ---
// POST { topicId, question, includeInstructions? } => basic keyword scan answer
app.post('/api/help/qa', express.json(), async (req, res) => {
    const start = Date.now();
    try {
    const { topicId, question, includeInstructions, priorMessages } = req.body || {};
        if (!topicId || !question) return res.status(400).json({ error: 'MISSING_PARAMS' });
        const helpBase = getHelpBase();
        if (!helpBase) return res.status(500).json({ error: 'HELP_BASE_UNRESOLVED' });

        // --- (12a) Lightweight intent parsing ---
        function parseIntent(q) {
            const lower = q.toLowerCase();
            const manualPhrases = [ 'manual', 'according to the manual', 'from the manual', 'official doc', 'official documentation', 'implementation guide' ];
            const enumerativeTriggers = [ 'all ', 'every ', 'full list', 'list all', 'list of', 'types of', 'kinds of', 'categories of', 'possible ', 'available ', 'options', 'actions', 'steps', 'requirements' ];
            const manualOnly = manualPhrases.some(p => lower.includes(p));
            const enumerative = enumerativeTriggers.some(p => lower.includes(p));
            let enumerativeCategory = null;
            if (lower.includes('campaign')) enumerativeCategory = 'campaign';
            else if (lower.includes('working hour') || lower.includes('working-hours') || lower.includes('work hours')) enumerativeCategory = 'working-hours';
            return { manualOnly, enumerative, enumerativeCategory };
        }
        const intent = parseIntent(question);

        // 1. Fetch primary topic
        let record;
        try { record = await helpBase('Help').find(topicId); } catch { return res.status(404).json({ error: 'TOPIC_NOT_FOUND' }); }
        const f = record.fields || {};
        const rawBody = (f.monologue_context || f.body || f.content || '').toString();

        // 2. Optionally fetch related topics (same sub_category)
        const related = [];
        const subLink = Array.isArray(f.sub_category) && f.sub_category.length ? f.sub_category[0] : null;
        if (subLink) {
            try {
                // limit pageSize to prevent heavy pulls; most subcategories small
                const formula = `FIND("${subLink}", ARRAYJOIN({sub_category}))`;
                await helpBase('Help').select({ pageSize: 50, filterByFormula: formula }).eachPage((recs, next) => {
                    recs.forEach(r => { if (r.id !== topicId) related.push(r); });
                    next();
                });
            } catch (relErr) {
                console.warn('[helpQA] Related topics fetch failed', relErr.message);
            }
        }

        // 3. Collect media instructions for the main topic if requested
        let mediaInstructions = '';
        if (includeInstructions) {
            const TOKEN_RE = /\[(media|link):(\d+)\]/gi;
            const ids = new Set();
            let m; while ((m = TOKEN_RE.exec(rawBody))!==null) ids.add(m[2]);
            if (ids.size) {
                const formula = 'OR(' + Array.from(ids).map(id => `{media_id}=${id}`).join(',') + ')';
                await helpBase('Media').select({ filterByFormula: formula, pageSize: ids.size }).eachPage((recs, next) => { recs.forEach(r => { if (r.fields?.instructions) mediaInstructions += '\n' + r.fields.instructions; }); next(); });
            }
        }

        const primaryContext = rawBody + (mediaInstructions ? ('\n' + mediaInstructions) : '');

        // 4. Prepare query terms + synonym expansion
        const qWords = question.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2);
        let expandedTerms = new Set(qWords);
        try {
            const synonyms = require('./qaSynonyms');
            for (const w of qWords) {
                if (synonyms[w]) synonyms[w].forEach(v => { if (v.length>2) expandedTerms.add(v.toLowerCase()); });
            }
        } catch {}
        const allQueryTerms = Array.from(expandedTerms);

        // 5. Sentence-level scoring for primary topic
        function scoreSentence(s) {
            const lower = s.toLowerCase();
            return allQueryTerms.reduce((acc,w)=> acc + (lower.includes(w)?1:0),0);
        }
        const sentences = primaryContext.split(/(?<=[.!?])\s+/);
        let bestPrimary = null, bestPrimaryScore = 0;
        sentences.forEach(s => { const sc = scoreSentence(s); if (sc > bestPrimaryScore) { bestPrimaryScore = sc; bestPrimary = s; } });

        // 6. Related topics scanning (truncate each body to first 4000 chars for safety)
        const relatedResults = [];
        for (const r of related) {
            try {
                const rf = r.fields || {};
                const body = (rf.monologue_context || rf.body || rf.content || '').toString().slice(0,4000);
                if (!body) continue;
                const rsentences = body.split(/(?<=[.!?])\s+/);
                let bestSent = null, bestScore = 0;
                rsentences.forEach(s => { const sc = scoreSentence(s); if (sc > bestScore) { bestScore = sc; bestSent = s; } });
                if (bestScore > 0) {
                    relatedResults.push({ topicId: r.id, title: (rf.title || rf.Name || '').toString(), sentence: bestSent, score: bestScore });
                }
            } catch {}
        }
        relatedResults.sort((a,b)=> b.score - a.score);
        const bestRelated = relatedResults[0] || null;

        // 7. Threshold heuristic to decide sufficiency
        const maxPossible = allQueryTerms.length || 1;
        const suffThreshold = Math.max(2, Math.ceil(maxPossible * 0.6));
        let chosen = null; let source = null; let chosenScore = 0;
        if (bestPrimaryScore >= suffThreshold) { chosen = bestPrimary; source = 'topic'; chosenScore = bestPrimaryScore; }
        else if (bestRelated && bestRelated.score >= suffThreshold) { chosen = bestRelated.sentence; source = 'related'; chosenScore = bestRelated.score; }

        // 8. Manual segments (for potential LLM grounding only)
    const { searchManual } = require('./helpManualStore');
    // For manual-only or enumerative intent, pull more manual segments up-front
    const manualHits = searchManual(allQueryTerms, intent.manualOnly || intent.enumerative ? 20 : 3);

        // 9. Global (whole-table) lexical fallback if structural retrieval weak
        let globalResult = null;
        let globalMeta = null;
        if (!chosen) {
            try {
                const { ensureIndex, searchGlobalHelp } = require('./helpGlobalIndex');
                const ensure = await ensureIndex(helpBase, { ttlMs: 5*60*1000 });
                const globalHits = searchGlobalHelp(allQueryTerms, { topK: 5 });
                if (globalHits && globalHits.length) {
                    // Pick best snippet sentence from top doc
                    const top = globalHits[0];
                    const body = top.body.slice(0, 6000);
                    const gSentences = body.split(/(?<=[.!?])\s+/);
                    let gBest = null, gBestScore = 0;
                    gSentences.forEach(s => { const sc = scoreSentence(s); if (sc > gBestScore) { gBestScore = sc; gBest = s; } });
                    if (gBestScore > 0) {
                        globalResult = { sentence: gBest, score: gBestScore, docId: top.docId, title: top.title, bm25Score: top.score };
                    }
                    globalMeta = { ensure, globalHits: globalHits.length, topDocScore: top.score, bestSentenceScore: globalResult?.score || 0 };
                }
            } catch (gErr) {
                console.warn('[helpQA] Global help search failed', gErr.message);
            }
        }

        // If global sentence passes threshold treat as chosen (but mark source)
        if (!chosen && globalResult && globalResult.score >= suffThreshold) {
            chosen = globalResult.sentence;
            source = 'global';
            chosenScore = globalResult.score;
        }

        // (Phase 2) Enumerative / Manual-only aggregation + action extraction & coverage
        if (intent.manualOnly || intent.enumerative) {
            const { extractActionsFromBlocks, computeCoverage, getTaxonomyCategoryItems } = require('./actionExtractor');
            // Re-score primary for richer context
            const primarySentences = primaryContext.split(/(?<=[.!?])\s+/).map(s => ({ s, score: scoreSentence(s) })).filter(o => o.score>0).sort((a,b)=> b.score - a.score);
            const topPrimary = primarySentences.slice(0, Math.min(6, primarySentences.length));
            const topRelated = relatedResults.slice(0, 8);
            const manualSegs = manualHits;
            const sources = []; let counter = 1; const idGen = ()=>'S'+(counter++);
            const push = o => sources.push(o);
            topPrimary.forEach(p=> push({ id:idGen(), type:'topic', title:f.title||'Primary', snippet:p.s.trim().slice(0,320), fullText: p.s, score:p.score }));
            topRelated.forEach(r=> push({ id:idGen(), type:'related', title:r.title||'Related', snippet:r.sentence.trim().slice(0,320), fullText: r.sentence, score:r.score, topicId:r.topicId }));
            manualSegs.forEach(seg=> push({ id:idGen(), type:'manual', title:'Manual', snippet: seg.slice(0,500), fullText: seg }));

            // Extract actions
            const actions = extractActionsFromBlocks(sources);
            // Coverage vs taxonomy
            const coverage = computeCoverage(actions);

            // Build answer body
            let answerBody = '';
            if (intent.enumerative && intent.enumerativeCategory) {
                // Baseline enumeration from taxonomy category + mark which ones found
                const catItems = getTaxonomyCategoryItems(intent.enumerativeCategory);
                if (catItems.length) {
                    const foundSet = new Set(actions.map(a=>a.phrase.toLowerCase()));
                    const lines = catItems.map(it => `${foundSet.has(it.phrase.toLowerCase()) ? '✓' : '•'} ${it.phrase}`);
                    answerBody += `**${intent.enumerativeCategory.replace(/-/g,' ')} actions:**\n` + lines.join('\n');
                } else if (actions.length) {
                    answerBody += '**Actions / Steps Found:**\n' + actions.map(a=>`- ${a.phrase}`).join('\n');
                } else {
                    answerBody += 'No actions found in current context.';
                }
            } else if (intent.enumerative && actions.length) {
                answerBody += '**Actions / Steps Found:**\n';
                answerBody += actions.map(a=>`- ${a.phrase}`).join('\n');
            } else {
                // fallback to grouped snippets if no clear actions
                const group = (name, filterType)=> {
                    const filt = sources.filter(s=>s.type===filterType); if(!filt.length) return '';
                    return `**${name}:**\n` + filt.map(s=>`- ${s.snippet}${s.snippet.endsWith('.')?'':'.'}`).join('\n');
                };
                const parts = [];
                if (topPrimary.length) parts.push(group('From This Topic','topic'));
                if (topRelated.length) parts.push(group('Related Topics','related'));
                if (manualSegs.length) parts.push(group('Manual','manual'));
                answerBody = parts.filter(Boolean).join('\n\n');
            }

            const completeness = {
                enumerative: !!intent.enumerative,
                manualOnly: !!intent.manualOnly,
                sourcesConsidered: {
                    primarySentences: primarySentences.length,
                    primaryUsed: topPrimary.length,
                    relatedTotal: relatedResults.length,
                    relatedUsed: topRelated.length,
                    manualTotal: manualSegs.length,
                    manualUsed: manualSegs.length
                },
                coverage,
                note: coverage.coveragePct!=null ? `Coverage ${coverage.coveragePct}% (${coverage.matched}/${coverage.taxonomyItems})` : 'No taxonomy baseline configured.'
            };
            if (intent.enumerativeCategory) {
                const catItems = getTaxonomyCategoryItems(intent.enumerativeCategory);
                const foundSet = new Set(actions.map(a=>a.phrase.toLowerCase()));
                const foundInCat = catItems.filter(it=>foundSet.has(it.phrase.toLowerCase())).length;
                completeness.baselineCategory = intent.enumerativeCategory;
                completeness.baselineFound = foundInCat;
                completeness.baselineTotal = catItems.length;
            }

            return res.json({
                answer: answerBody,
                method: 'aggregated-enumerative',
                sources,
                actions,
                completeness,
                meta: {
                    generationMs: Date.now()-start,
                    intent,
                    expandedQueryTerms: allQueryTerms.length,
                    primaryScore: bestPrimaryScore,
                    relatedConsidered: relatedResults.length
                }
            });
        }

        // 10. Decide if we escalate to LLM (after global attempt)
        const llmQueryParam = req.query.llm; // allow explicit override
        const defaultLlmEnabled = process.env.HELP_QA_LLM === '0' ? false : true; // environment gate
        const wantLLMExplicit = llmQueryParam === '1';
        const forceDisableLLM = llmQueryParam === '0';
        const retrievalStrong = !!chosen;
        const shouldEscalate = !retrievalStrong && !forceDisableLLM;
        const useLLM = (wantLLMExplicit || shouldEscalate) && defaultLlmEnabled && openaiClient;

        if (useLLM) {
            try {
                const allowUngrounded = (typeof HELP_QA_UNGROUNDED_OVERRIDE === 'boolean') ? HELP_QA_UNGROUNDED_OVERRIDE : (process.env.HELP_QA_LLM_ALLOW_UNGROUNDED === '1');
                // Build grounding: primary truncated + top related sentences + manual snippets
                const groundingBlocks = [];
                groundingBlocks.push(`Primary Topic (truncated)\n${primaryContext.slice(0,4000)}`);
                if (bestRelated) groundingBlocks.push(`Best Related Topic: ${bestRelated.title}\n${bestRelated.sentence}`);
                if (relatedResults.length > 1) groundingBlocks.push('Other Related Snippets:\n' + relatedResults.slice(1,4).map(r=>`- (${r.score}) ${r.sentence}`).join('\n'));
                if (manualHits.length) groundingBlocks.push('Manual Segments:\n' + manualHits.join('\n---\n'));
                const grounding = groundingBlocks.join('\n\n====\n\n');
                const strictInstruction = `You are a concise support assistant. ONLY use the provided context blocks. If the answer is not clearly present, reply exactly: "I don't have enough information in the current knowledge base." Provide sections when natural: Answer, Key Points, Next Step.`;
                // Incorporate prior chat (if provided) for follow-up coherence (LLM only)
                let convo = '';
                if (Array.isArray(priorMessages) && priorMessages.length) {
                    const recent = priorMessages.slice(-8);
                    convo = 'Conversation so far:\n' + recent.map(m=>`${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}` ).join('\n') + '\n\n';
                }
                const prompt = `${strictInstruction}\n\n${convo}Question: ${question}\n\nContext Blocks:\n${grounding}`;
                const chat = await openaiClient.chat.completions.create({
                    model: process.env.HELP_QA_LLM_MODEL || 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'Answer only from context. Be concise.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3,
                    max_tokens: 380
                });
                let llmAnswer = chat.choices?.[0]?.message?.content?.trim();
                if (llmAnswer) {
                    const insufficient = /i don't have enough information in the current knowledge base\.?/i.test(llmAnswer);
                    if (insufficient && allowUngrounded) {
                        try {
                            const fbPrompt = `User question: ${question}\nProvide best effort answer from general knowledge if safe. Clearly prefix any part NOT in context with '(general)'.`;
                            const chat2 = await openaiClient.chat.completions.create({
                                model: process.env.HELP_QA_LLM_MODEL || 'gpt-4o-mini',
                                messages: [ { role: 'system', content: 'Helpful answer with clear general markers.' }, { role: 'user', content: fbPrompt } ],
                                temperature: 0.4,
                                max_tokens: 400
                            });
                            const llmAnswer2 = chat2.choices?.[0]?.message?.content?.trim();
                            if (llmAnswer2) llmAnswer = llmAnswer2 + '\n\n(meta: ungrounded fallback)';
                        } catch (fbErr) { console.warn('[helpQA] Ungrounded fallback failed', fbErr.message); }
                    }
                    return res.json({
                        answer: llmAnswer,
                        method: 'llm-after-retrieval',
                        meta: {
                            generationMs: Date.now()-start,
                            retrievalStrong,
                            primaryScore: bestPrimaryScore,
                            bestRelatedScore: bestRelated?.score || 0,
                            threshold: suffThreshold,
                            expandedQueryTerms: allQueryTerms.length,
                            relatedConsidered: relatedResults.length,
                            llmModel: process.env.HELP_QA_LLM_MODEL || 'gpt-4o-mini'
                        }
                    });
                }
            } catch (llmErr) {
                console.warn('[helpQA] LLM escalation failed, falling back to retrieval result if any', llmErr.message);
            }
        }

    // 11. Return retrieval result (even if weak)
        if (chosen) {
            return res.json({
                answer: chosen.trim(),
                method: source === 'topic' ? 'topic-direct' : 'related-direct',
                meta: {
                    generationMs: Date.now()-start,
                    primaryScore: bestPrimaryScore,
                    bestRelatedScore: bestRelated?.score || 0,
                    threshold: suffThreshold,
                    source,
                    expandedQueryTerms: allQueryTerms.length,
            relatedConsidered: relatedResults.length,
            global: globalMeta || null
                }
            });
        }

    // 12. No sufficient retrieval and LLM disabled/failed
        return res.json({
            answer: "I don't have enough information in the current knowledge base.",
            method: 'no-answer',
            meta: {
                generationMs: Date.now()-start,
                primaryScore: bestPrimaryScore,
                bestRelatedScore: bestRelated?.score || 0,
                threshold: suffThreshold,
                relatedConsidered: relatedResults.length,
        expandedQueryTerms: allQueryTerms.length,
        global: globalMeta || null
            }
        });
    } catch (e) {
        console.error('QA endpoint error', e);
        res.status(500).json({ error: 'QA_ERROR', message: e.message });
    }
});

// --- NEW: LH Manual Index Status Endpoint ---
app.get('/api/help/lh-manual/status', (req, res) => {
    try {
        const { status } = require('./lhManualIndex');
        res.json({ ok: true, status: status() });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// --- NEW: Admin Reindex Endpoint ---
app.post('/admin/lh-manual/reindex', (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
        const { rebuildIndex, status } = require('./lhManualIndex');
        const st = rebuildIndex();
        res.json({ ok: true, status: st });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// --- NEW: Admin Crawl Endpoint (crawl + index rebuild) ---
app.post('/admin/lh-manual/crawl', (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
        const { crawl } = require('./lhManualCrawler');
        crawl().then(result => {
            res.json({ ok: true, result });
        }).catch(err => {
            res.status(500).json({ ok: false, error: err.message });
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// --- NEW: Admin Seeds Update & View ---
app.post('/admin/lh-manual/seeds', (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok:false, error:'Unauthorized' });
    }
    try {
        const { seedUrls } = req.body || {};
        if (!Array.isArray(seedUrls) || !seedUrls.length) {
            return res.status(400).json({ ok:false, error:'Provide non-empty array seedUrls' });
        }
        const { setRuntimeSeeds, getRuntimeSeeds } = require('./lhManualSeedsRuntime');
        setRuntimeSeeds(seedUrls);
        res.json({ ok:true, seeds:getRuntimeSeeds(), count: getRuntimeSeeds().length });
    } catch (e) {
        res.status(500).json({ ok:false, error:e.message });
    }
});

app.get('/admin/lh-manual/seeds', (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok:false, error:'Unauthorized' });
    }
    try {
        const { getRuntimeSeeds } = require('./lhManualSeedsRuntime');
        res.json({ ok:true, seeds:getRuntimeSeeds(), count:getRuntimeSeeds().length });
    } catch (e) {
        res.status(500).json({ ok:false, error:e.message });
    }
});

// --- NEW: Admin Manual Reload Endpoint ---
app.post('/admin/help/manual/reload', (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok:false, error:'Unauthorized' });
    }
    try {
        const { reloadManual, getManualSegments } = require('./helpManualStore');
        const count = reloadManual();
        res.json({ ok:true, segments: count, sample: getManualSegments().slice(0,2) });
    } catch (e) {
        res.status(500).json({ ok:false, error:e.message });
    }
});

// --- NEW: Admin toggle for ungrounded fallback ---
let HELP_QA_UNGROUNDED_OVERRIDE = null; // null=use env, true/false override
app.post('/admin/help/llm/ungrounded', (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok:false, error:'Unauthorized' });
    }
    const { enable } = req.body || {};
    if (typeof enable !== 'boolean') {
        return res.status(400).json({ ok:false, error:'Provide {"enable": true|false }' });
    }
    HELP_QA_UNGROUNDED_OVERRIDE = enable;
    res.json({ ok:true, override: enable });
});