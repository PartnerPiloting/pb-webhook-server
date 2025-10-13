// PB Webhook Server
// touch: force reload for nodemon - 2025-10-03
// Main server file for handling Airtable webhooks and API endpoints
// Force redeploy for follow-ups endpoint - 2024-12-xx
// 
// MAJOR BUG FIX - 2025-10-03
// Fixed run ID consistency issues that were causing "job tracking record not found" errors
// by implementing a strict single-source-of-truth pattern for run IDs. Run IDs are now
// generated exactly once and passed unchanged through the entire request chain.
// This is a clean architectural fix that eliminates the root cause of tracking failures.
// See commits for feature/comprehensive-field-standardization for full implementation details.

// index.js
// Load environment variables from .env file FIRST
require("dotenv").config();

// Import structured logging
const { createLogger } = require('./utils/contextLogger');
// Create module-level logger for server initialization and requests
const moduleLogger = createLogger({ runId: 'SERVER', clientId: 'SYSTEM', operation: 'server_init' });

// --- CONFIGURATIONS ---
const geminiConfig = require('./config/geminiClient.js');
const globalGeminiModel = geminiConfig ? geminiConfig.geminiModel : null;
const base = require('./config/airtableClient.js'); // Your Airtable base connection
const { getMasterClientsBase } = require('./config/airtableClient'); // For Production Issues table

// Initialize OpenAI client for attribute editing
const { initializeOpenAI } = require('./config/openaiClient.js');
let openaiClient = null;

// Production issue analysis utilities - NO MODULE CACHING
// Everything created fresh inline in the endpoint to prevent stale data
try {
    openaiClient = initializeOpenAI();
    moduleLogger.info("index.js: OpenAI client initialized successfully for attribute editing");
} catch (openaiError) {
    moduleLogger.warn("index.js: OpenAI client initialization failed - attribute editing will not work:", openaiError.message);
}

// --- Potentially import your update function ---
// const { updateLeadRecordFunction } = require('./updateLeadApi'); // OR './your-airtable-utils.js'
// ^^^ If updateLeadApi.js or another module exports a function to update records, import it here.

// --- CORE NPM MODULES ---
const express = require("express");
const path = require('path');
const { v4: uuidv4 } = require('uuid');

moduleLogger.info("<<<<< INDEX.JS - REFACTOR 8.4 - AFTER CORE REQUIRES >>>>>"); // Your existing log

// --- INITIALIZATION CHECKS ---
if (!globalGeminiModel) {
    moduleLogger.error("FATAL ERROR in index.js: Gemini Model (default instance) failed to initialize. Scoring will not work. Check logs in config/geminiClient.js.");
} else {
    moduleLogger.info("index.js: Gemini Model (default instance) loaded successfully from config.");
}
if (!geminiConfig || !geminiConfig.vertexAIClient) {
    moduleLogger.error("FATAL ERROR in index.js: VertexAI Client is not available from geminiConfig. Batch scoring might fail. Check logs in config/geminiClient.js.");
}
if (!base) {
    moduleLogger.error("FATAL ERROR in index.js: Airtable Base failed to initialize. Airtable operations will fail. Check logs in config/airtableClient.js.");
} else {
    moduleLogger.info("index.js: Airtable Base loaded successfully from config.");
}

// Initialize the run record service (Single Creation Point pattern implementation)
const runRecordService = require('./services/runRecordAdapter');
try {
    runRecordService.initialize();
    moduleLogger.info("index.js: Run Record Service initialized successfully - Single Creation Point pattern active");
} catch (runRecordError) {
    moduleLogger.error("FATAL ERROR in index.js: Run Record Service failed to initialize:", runRecordError.message);
}

/* ---------- APP-LEVEL ENV CONFIGURATION & CONSTANTS --- */
const GPT_CHAT_URL = process.env.GPT_CHAT_URL;
if (!GPT_CHAT_URL) {
    moduleLogger.error("CRITICAL WARNING: Missing GPT_CHAT_URL environment variable. pointerApi may not function correctly.");
}

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID; // Corrected line from bug fix
const AIRTABLE_LEADS_TABLE_ID_OR_NAME = "Leads";
const AIRTABLE_LINKEDIN_URL_FIELD = "LinkedIn Profile URL";
const AIRTABLE_NOTES_FIELD = "System Notes"; // Changed from "Notes" to match Airtable schema

if (!AIRTABLE_BASE_ID) {
    moduleLogger.error("CRITICAL WARNING: Missing AIRTABLE_BASE_ID environment variable. Airtable operations will fail for textblaze-linkedin-webhook.");
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
    moduleLogger.error("CRITICAL WARNING: Missing essential Airtable table name configurations for Post Analysis. Post scoring may fail.");
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
moduleLogger.info("CORS enabled for allowed origins including *.vercel.app and staging frontend");

// ABSOLUTE BASIC TEST - Should work 100%
app.get('/basic-test', (req, res) => {
    res.send('BASIC ROUTE WORKING - Express is alive!');
});
moduleLogger.info("Basic test route added at /basic-test");

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
    moduleLogger.info('Minimal JSON Test: Sending pure Express JSON response');
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
moduleLogger.info("JSON diagnostic test route added at /api/test/minimal-json");

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
 * Admin endpoint: generate Airtable Scripting code to add missing fields for a table
 * POST /admin/airtable-field-script { table: "Leads" }
 */
app.post('/admin/airtable-field-script', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
        const table = (req.body?.table || 'Leads').toString();
        const { buildScriptFor } = require('./utils/airtableFieldScriptGen');
        const script = buildScriptFor(table);
        res.json({ ok: true, table, script });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
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
    3) Production Issue Analysis Endpoints
------------------------------------------------------------------*/
const ProductionIssueService = require('./services/productionIssueService');

/**
 * Analyze recent Render logs and create Production Issue records
 * POST /api/analyze-logs/recent
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 * Body (optional): { minutes: 60 }
 */
app.post('/api/analyze-logs/recent', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
        const { minutes = 60 } = req.body || {};
        const service = new ProductionIssueService();
        const results = await service.analyzeRecentLogs({ minutes });
        
        res.json({ 
            ok: true, 
            ...results,
            message: `Analyzed ${minutes} minutes of logs. Found ${results.issues} issues (${results.summary.critical} critical, ${results.summary.error} errors, ${results.summary.warning} warnings)`
        });
    } catch (error) {
        moduleLogger.error('Failed to analyze recent logs:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * Analyze provided log text and create Production Issue records
 * POST /api/analyze-logs/text
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 * Body: { logText: "...full log text..." }
 */
app.post('/api/analyze-logs/text', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
        const { logText } = req.body || {};
        
        if (!logText || typeof logText !== 'string') {
            return res.status(400).json({ ok: false, error: 'Missing or invalid logText in request body' });
        }

        const service = new ProductionIssueService();
        const results = await service.analyzeLogText(logText);
        
        res.json({ 
            ok: true, 
            ...results,
            message: `Analyzed log text. Found ${results.issues} issues (${results.summary.critical} critical, ${results.summary.error} errors, ${results.summary.warning} warnings)`
        });
    } catch (error) {
        moduleLogger.error('Failed to analyze log text:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/run-daily-log-analyzer
 * TEST ENDPOINT: Runs the daily-log-analyzer utility on demand
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 * Body: { runId?: "251013-100000" } (optional - if omitted, runs in auto mode from last checkpoint)
 * 
 * REQUIREMENTS:
 * - RENDER_API_KEY environment variable must be set
 * - RENDER_OWNER_ID environment variable must be set
 * - RENDER_SERVICE_ID environment variable (optional - defaults to current service)
 */
app.post('/api/run-daily-log-analyzer', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
        // Check required environment variables
        if (!process.env.RENDER_API_KEY) {
            return res.status(500).json({ 
                ok: false, 
                error: 'RENDER_API_KEY environment variable is not set on Render. Please add it in Environment settings.' 
            });
        }
        
        if (!process.env.RENDER_OWNER_ID) {
            return res.status(500).json({ 
                ok: false, 
                error: 'RENDER_OWNER_ID environment variable is not set on Render. Please add it in Environment settings.' 
            });
        }
        
        const { runId } = req.body || {};
        
        moduleLogger.info(`🔍 Running daily-log-analyzer via API${runId ? ` for runId: ${runId}` : ' (auto mode - from last checkpoint)'}`);
        
        // Import and run the daily log analyzer
        const { runDailyLogAnalysis } = require('./daily-log-analyzer');
        
        // Pass runId as option parameter instead of command line arg
        const results = await runDailyLogAnalysis({ runId });
        
        res.json({ 
            ok: true, 
            ...results,
            message: runId 
                ? `Analyzed logs for run ${runId}. Found ${results.issues} issues.`
                : `Analyzed from last checkpoint. Found ${results.issues} issues.`
        });
        
    } catch (error) {
        moduleLogger.error('Failed to run daily-log-analyzer:', error);
        res.status(500).json({ ok: false, error: error.message, stack: error.stack });
    }
});

/**
 * TEST ENDPOINT: Verify STACKTRACE markers are written to Render logs
 * GET /api/test-stacktrace-markers
 * NO AUTH - Quick test endpoint
 * 
 * This endpoint:
 * 1. Triggers an error with stack trace
 * 2. Waits 3 seconds for Render to capture logs
 * 3. Fetches recent Render logs
 * 4. Searches for STACKTRACE markers
 * 5. Returns PASS/FAIL with details
 */
app.get('/api/test-stacktrace-markers', async (req, res) => {
    const testLogger = createLogger({ runId: 'TEST', clientId: 'STACKTRACE-TEST', operation: 'test_stacktrace' });
    
    try {
        testLogger.info('🧪 Starting STACKTRACE marker test...');
        
        // Step 1: Trigger an error with stack trace
        const { logErrorWithStackTrace } = require('./utils/errorHandler');
        const testError = new Error('TEST ERROR: STACKTRACE marker verification test');
        const testRunId = 'TEST-' + Date.now();
        
        testLogger.info(`Triggering test error with Run ID: ${testRunId}`);
        
        const timestamp = await logErrorWithStackTrace(testError, {
            runId: testRunId,
            clientId: 'STACKTRACE-TEST',
            context: '[TEST] Verifying STACKTRACE markers',
            loggerName: 'TEST',
            operation: 'testStackTrace'
        });
        
        testLogger.info(`✅ Error logged with timestamp: ${timestamp}`);
        
        // Step 2: Wait for Render to capture logs
        testLogger.info('Waiting 3 seconds for Render to capture logs...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Step 3: Fetch recent Render logs directly from Render API
        testLogger.info('Fetching recent Render logs from Render API...');
        const https = require('https');
        const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID;
        const RENDER_API_KEY = process.env.RENDER_API_KEY;
        
        if (!RENDER_SERVICE_ID || !RENDER_API_KEY) {
            throw new Error('RENDER_SERVICE_ID or RENDER_API_KEY not configured');
        }
        
        // Fetch logs from last 5 minutes
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const now = new Date().toISOString();
        
        const logText = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.render.com',
                path: `/v1/services/${RENDER_SERVICE_ID}/logs?startTime=${fiveMinutesAgo}&endTime=${now}&limit=10000`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${RENDER_API_KEY}`,
                    'Accept': 'application/json'
                }
            };
            
            https.get(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const logs = parsed.map(entry => entry.message || entry.log || '').join('\n');
                        resolve(logs);
                    } catch (e) {
                        resolve(data); // Return raw if not JSON
                    }
                });
            }).on('error', reject);
        });
        
        // Step 4: Search for STACKTRACE markers
        const foundTimestamp = logText.includes(`STACKTRACE:${timestamp}`);
        const debugBefore = logText.includes('[DEBUG-STACKTRACE] About to log STACKTRACE marker');
        const debugAfter = logText.includes('[DEBUG-STACKTRACE] STACKTRACE marker logged successfully');
        
        const allStacktraceMarkers = (logText.match(/STACKTRACE:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g) || []).length;
        
        // Step 5: Return results
        const passed = foundTimestamp && debugBefore && debugAfter;
        
        res.json({
            ok: true,
            testPassed: passed,
            timestamp: timestamp,
            runId: testRunId,
            checks: {
                specificTimestampFound: foundTimestamp,
                debugMarkerBefore: debugBefore,
                debugMarkerAfter: debugAfter
            },
            stats: {
                totalStacktraceMarkers: allStacktraceMarkers,
                logLength: logText.length
            },
            verdict: passed 
                ? '🎉 SUCCESS! STACKTRACE markers ARE being written to Render logs!' 
                : '❌ FAIL: STACKTRACE markers NOT found in Render logs',
            nextSteps: passed
                ? 'System is working! Stack traces will be linked to Production Issues.'
                : 'Check errorHandler.js - console.log may not be writing to Render stdout'
        });
        
    } catch (error) {
        testLogger.error('Test failed:', error);
        res.status(500).json({
            ok: false,
            testPassed: false,
            error: error.message,
            stack: error.stack
        });
    }
});

/**
 * Auto-analyze the latest run from Job Tracking
 * POST /api/auto-analyze-latest-run
 * NO AUTHENTICATION REQUIRED (public endpoint like smart-resume)
 * 
 * This endpoint:
 * 1. Finds the most recent run in Job Tracking
 * 2. Fetches Render logs for that time period (or custom startTime if provided)
 * 3. Analyzes the smart-resume flow
 * 4. Checks for errors
 * 5. Returns comprehensive diagnosis
 * 
 * Optional body parameters:
 * - startTime: ISO 8601 timestamp to start fetching logs from (overrides Job Tracking start time)
 */
app.post('/api/auto-analyze-latest-run', async (req, res) => {
    try {
        const autoAnalyze = require('./auto-analyze-latest-run');
        
        // Import required dependencies
        const { getMasterClientsBase } = require('./config/airtableClient');
        const RenderLogService = require('./services/renderLogService');
        const { filterLogs, generateSummary } = require('./services/logFilterService');
        
        // Get latest run from Job Tracking
        const masterBase = getMasterClientsBase();
        const records = await masterBase('Job Tracking')
            .select({
                maxRecords: 1,
                sort: [{ field: 'Start Time', direction: 'desc' }],
                filterByFormula: "AND({Run ID} != '', {Start Time} != '')"
            })
            .firstPage();
        
        if (!records || records.length === 0) {
            return res.status(404).json({ ok: false, error: 'No runs found in Job Tracking table' });
        }
        
        const record = records[0];
        const runId = record.get('Run ID');
        const jobTrackingStartTime = record.get('Start Time');
        const endTime = record.get('End Time');
        const status = record.get('Status');
        
        // Allow override of start time from request body
        const startTime = req.body?.startTime || jobTrackingStartTime;
        
        // Fetch Render logs with pagination
        const renderService = new RenderLogService();
        const serviceId = process.env.RENDER_SERVICE_ID;
        const logEndTime = endTime || new Date().toISOString();
        
        let allLogs = [];
        let hasMore = true;
        let currentStartTime = startTime;
        let pageCount = 0;
        const maxPages = 10; // Safety limit to prevent infinite loops
        
        while (hasMore && pageCount < maxPages) {
            pageCount++;
            
            const result = await renderService.getServiceLogs(serviceId, {
                startTime: currentStartTime,
                endTime: logEndTime,
                limit: 1000
            });
            
            allLogs = allLogs.concat(result.logs || []);
            
            hasMore = result.hasMore;
            if (hasMore && result.nextStartTime) {
                currentStartTime = result.nextStartTime;
            }
        }
        
        console.log(`📊 Fetched ${allLogs.length} total logs across ${pageCount} pages`);
        
        // Convert logs to text
        const logText = allLogs
            .map(log => {
                if (typeof log === 'string') return log;
                if (log.message) return `[${log.timestamp || ''}] ${log.message}`;
                return JSON.stringify(log);
            })
            .join('\n');
        
        // Analyze smart-resume flow
        const flowChecks = {
            endpointCalled: false,
            lockAcquired: false,
            backgroundStarted: false,
            scriptLoaded: false,
            scriptCompleted: false,
            autoAnalysisStarted: false,
            autoAnalysisCompleted: false,
            runIdExtracted: null,
            errors: []
        };
        
        const lines = logText.split('\n');
        for (const line of lines) {
            if (line.includes('GET request received for /smart-resume-client-by-client') || 
                line.includes('smart_resume_get')) {
                flowChecks.endpointCalled = true;
            }
            if (line.includes('Smart resume lock acquired')) {
                flowChecks.lockAcquired = true;
            }
            if (line.includes('Smart resume background processing started') || line.includes('🎯')) {
                flowChecks.backgroundStarted = true;
            }
            if (line.includes('Loading smart resume module') || line.includes('MODULE_DEBUG: Script loading')) {
                flowChecks.scriptLoaded = true;
            }
            if (line.includes('Smart resume completed successfully') || line.includes('SCRIPT_END: Module execution completed')) {
                flowChecks.scriptCompleted = true;
            }
            if (line.includes('Starting automatic log analysis') || line.includes('🔍 Analyzing logs for specific runId')) {
                flowChecks.autoAnalysisStarted = true;
            }
            if (line.includes('Log analysis complete') || line.includes('errors saved to Production Issues')) {
                flowChecks.autoAnalysisCompleted = true;
            }
            if (line.includes('Script returned runId:')) {
                const match = line.match(/Script returned runId:\s*(\S+)/);
                if (match) flowChecks.runIdExtracted = match[1];
            }
            if (line.includes('[ERROR]') || line.includes('ERROR:')) {
                flowChecks.errors.push(line.substring(0, 200));
            }
        }
        
        // Analyze for errors
        const issues = filterLogs(logText, {
            deduplicateIssues: true,
            contextSize: 25,
            runIdFilter: runId
        });
        
        const summary = generateSummary(issues);
        
        // Diagnosis
        let diagnosis = 'Unknown';
        if (!flowChecks.endpointCalled) {
            diagnosis = 'Endpoint was never called or logs are missing';
        } else if (!flowChecks.lockAcquired) {
            diagnosis = 'Lock was not acquired (another job running?)';
        } else if (!flowChecks.backgroundStarted) {
            diagnosis = 'Background processing never started';
        } else if (!flowChecks.scriptLoaded) {
            diagnosis = 'Smart resume script failed to load';
        } else if (!flowChecks.scriptCompleted) {
            diagnosis = 'Script started but never completed (still running, crashed, or timeout)';
        } else if (!flowChecks.autoAnalysisStarted) {
            diagnosis = 'Auto-analysis never started after script completed';
        } else if (!flowChecks.autoAnalysisCompleted) {
            diagnosis = 'Auto-analysis started but failed';
        } else {
            diagnosis = 'SUCCESS - Complete flow executed!';
        }
        
        res.json({
            success: true,
            runId,
            startTime,
            endTime,
            status,
            logLineCount: allLogs.length,
            pagesFetched: pageCount,
            flowChecks,
            errorAnalysis: {
                totalIssues: issues.length,
                summary,
                issues: issues.slice(0, 5).map(i => ({
                    severity: i.severity,
                    patternMatched: i.patternMatched,
                    errorMessage: i.errorMessage.substring(0, 200),
                    timestamp: i.timestamp
                }))
            },
            diagnosis
        });
        
    } catch (error) {
        moduleLogger.error('Failed to auto-analyze latest run:', error);
        res.status(500).json({ ok: false, error: error.message, stack: error.stack });
    }
});

/**
 * POST /api/reconcile-errors
 * NO AUTHENTICATION REQUIRED (public endpoint like smart-resume and auto-analyze)
 * 
 * Reconciles errors between Render logs and Production Issues table for a specific runId
 * 
 * Required body parameters:
 * - runId: The Run ID from Job Tracking table
 * - startTime: ISO 8601 timestamp (AEST will be converted to UTC)
 * 
 * Returns:
 * - stats: totalInLogs, totalInTable, matched, inLogNotInTable, inTableNotInLog, captureRate
 * - errors: matched[], inLogNotInTable[], inTableNotInLog[]
 */
app.post('/api/reconcile-errors', async (req, res) => {
    try {
        const { reconcileErrors } = require('./reconcile-errors');
        
        const { runId, startTime } = req.body;
        
        if (!runId || !startTime) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required parameters: runId and startTime' 
            });
        }
        
        console.log(`\n🔍 Starting error reconciliation for runId: ${runId}, startTime: ${startTime}`);
        
        const result = await reconcileErrors(runId, startTime);
        
        console.log(`✅ Reconciliation complete: ${result.stats.captureRate}% capture rate`);
        
        res.json({
            success: true,
            ...result
        });
        
    } catch (error) {
        moduleLogger.error('Failed to reconcile errors:', error);
        res.status(500).json({ success: false, error: error.message, stack: error.stack });
    }
});

/**
 * GET /api/analyze-issues
 * NO AUTHENTICATION REQUIRED (public endpoint)
 * 
 * Analyzes Production Issues table and generates comprehensive report
 * 
 * Query parameters (all optional):
 * - runId: Filter to specific run ID
 * - days: Filter to last N days
 * - severity: Filter by severity (ERROR, WARNING, etc.)
 * - client: Filter by client ID
 * - status: Filter by status (default: 'unfixed' = NEW/INVESTIGATING/BLANK, or 'all', 'NEW', 'FIXED', 'IGNORED')
 * - limit: Max records to analyze (default 1000)
 * - format: 'json' or 'html' (default: json)
 * 
 * Returns analysis with:
 * - Total issues
 * - Breakdown by severity, pattern, client, run ID
 * - Top issues by frequency
 * - Actionable recommendations
 */
app.get('/api/analyze-issues', async (req, res) => {
    try {
        const args = {
            runId: req.query.runId || null,
            days: req.query.days ? parseInt(req.query.days) : null,
            severity: req.query.severity || null,
            client: req.query.client || null,
            status: req.query.status || 'unfixed', // Default: only unfixed issues
            limit: req.query.limit ? parseInt(req.query.limit) : 1000,
            format: req.query.format || 'json'
        };
        
        console.log(`\n📊 Analyzing Production Issues with filters:`, args);
        
        // Build filter formula
        const conditions = [];
        if (args.runId) conditions.push(`{Run ID} = '${args.runId}'`);
        if (args.days) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - args.days);
            const isoDate = cutoffDate.toISOString().split('T')[0];
            conditions.push(`IS_AFTER({Timestamp}, '${isoDate}')`);
        }
        if (args.severity) conditions.push(`{Severity} = '${args.severity}'`);
        if (args.client) conditions.push(`FIND('${args.client}', {Client ID})`);
        
        // Status filter: default to unfixed issues only
        if (args.status === 'unfixed') {
            // Show NEW, INVESTIGATING, and blank status (exclude FIXED and IGNORED)
            conditions.push(`OR({Status} = 'NEW', {Status} = 'INVESTIGATING', {Status} = '')`);
        } else if (args.status !== 'all') {
            // Specific status requested
            conditions.push(`{Status} = '${args.status}'`);
        }
        // If status=all, no filter applied
        
        const filterFormula = conditions.length === 0 ? '' : 
            conditions.length === 1 ? conditions[0] : 
            `AND(${conditions.join(', ')})`;
        
        // FETCH ISSUES - Fresh inline code (no module caching)
        const Airtable = require('airtable');
        const MASTER_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
        const freshBase = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(MASTER_BASE_ID);
        
        const queryOptions = {
            maxRecords: args.limit,
            sort: [{ field: 'Timestamp', direction: 'desc' }],
            view: 'All Issues'
        };
        
        if (filterFormula) {
            queryOptions.filterByFormula = filterFormula;
        }
        
        const records = await freshBase('Production Issues').select(queryOptions).all();
        
        const issues = records.map(record => ({
            id: record.id,
            runId: record.get('Run ID') || 'N/A',
            timestamp: record.get('Timestamp'),
            severity: record.get('Severity') || 'UNKNOWN',
            pattern: record.get('Pattern Matched') || 'UNKNOWN',
            message: record.get('Error Message') || '',
            stream: record.get('Stream') || '',
            clientId: record.get('Client ID') || 'N/A',
            stackTrace: record.get('Stack Trace') || null
        }));
        
        if (issues.length === 0) {
            return res.json({
                success: true,
                message: 'No issues found matching the filter criteria',
                total: 0,
                filters: args
            });
        }
        
        // If format=raw, return raw issues array without analysis
        if (args.format === 'raw') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            return res.json({
                success: true,
                total: issues.length,
                filters: args,
                issues: issues
            });
        }
        
        // ANALYZE ISSUES - Inline analysis code (no module caching)
        const analysis = {
            total: issues.length,
            bySeverity: {},
            byPattern: {},
            byClient: {},
            byRunId: {},
            uniqueMessages: new Map()
        };

        issues.forEach(issue => {
            analysis.bySeverity[issue.severity] = (analysis.bySeverity[issue.severity] || 0) + 1;
            analysis.byPattern[issue.pattern] = (analysis.byPattern[issue.pattern] || 0) + 1;
            analysis.byClient[issue.clientId] = (analysis.byClient[issue.clientId] || 0) + 1;
            analysis.byRunId[issue.runId] = (analysis.byRunId[issue.runId] || 0) + 1;

            const msgKey = issue.message.substring(0, 100);
            if (!analysis.uniqueMessages.has(msgKey)) {
                analysis.uniqueMessages.set(msgKey, {
                    count: 0,
                    fullMessage: issue.message,
                    severity: issue.severity,
                    pattern: issue.pattern,
                    examples: []
                });
            }
            const entry = analysis.uniqueMessages.get(msgKey);
            entry.count++;
            if (entry.examples.length < 3) {
                entry.examples.push({
                    runId: issue.runId,
                    timestamp: issue.timestamp,
                    clientId: issue.clientId
                });
            }
        });
        
        // Convert Map to Array for JSON serialization
        const topIssues = Array.from(analysis.uniqueMessages.entries())
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 15)
            .map(([msgKey, data]) => ({
                pattern: data.pattern,
                severity: data.severity,
                count: data.count,
                percentage: ((data.count / analysis.total) * 100).toFixed(1),
                message: data.fullMessage,
                examples: data.examples
            }));
        
        // Group actionable warnings by classification reason (simplified - skip classification for now)
        const actionableWarningsByReason = {};
        
        const result = {
            success: true,
            filters: args,
            total: analysis.total,
            bySeverity: analysis.bySeverity,
            
            // Warning classification (simplified - skip for now)
            warningClassification: {
                actionable: 0,
                noise: 0,
                byReason: []
            },
            
            byPattern: Object.entries(analysis.byPattern)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([pattern, count]) => ({ pattern, count, percentage: ((count / analysis.total) * 100).toFixed(1) })),
            byClient: analysis.byClient,
            byRunId: Object.entries(analysis.byRunId)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .slice(0, 10)
                .map(([runId, count]) => ({ runId, count })),
            topIssues,
            recommendations: [
                'Prioritize CRITICAL and ERROR severity issues first',
                'Focus on patterns affecting multiple runs',
                'Use ?runId=XXX to drill down into specific runs',
                'Use ?severity=ERROR to focus on critical issues only',
                'Use ?status=all to see FIXED and IGNORED issues'
            ]
        };
        
        console.log(`✅ Analysis complete: ${analysis.total} issues analyzed`);
        
        // Add no-cache headers to force fresh data every time
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        res.json(result);
        
    } catch (error) {
        moduleLogger.error('Failed to analyze Production Issues:', error);
        res.status(500).json({ success: false, error: error.message, stack: error.stack });
    }
});

/**
 * GET /api/fresh-check-production-issues
 * Run fresh check on Production Issues table (bypass all existing code)
 */
app.get('/api/fresh-check-production-issues', async (req, res) => {
    try {
        const Airtable = require('airtable');
        const MASTER_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;
        
        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(MASTER_BASE_ID);
        const records = await base('Production Issues').select({ maxRecords: 100, view: 'All Issues' }).all();
        
        res.json({
            success: true,
            baseId: MASTER_BASE_ID,
            recordCount: records.length,
            isEmpty: records.length === 0,
            records: records.map(r => ({
                id: r.id,
                runId: r.fields['Run ID'],
                severity: r.fields.Severity,
                timestamp: r.fields.Timestamp
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/mark-issue-fixed
 * NO AUTHENTICATION REQUIRED (public endpoint - for now, can add auth later)
 * 
 * Mark Production Issues matching a pattern as FIXED
 * 
 * Request body:
 * {
 *   "pattern": "at scoreChunk",           // Text to search in Error Message
 *   "commitHash": "6203483",              // Git commit hash
 *   "fixNotes": "Description of fix",     // What was fixed
 *   "issueIds": [123, 124]                // Optional: specific Issue IDs to update
 * }
 * 
 * Returns:
 * {
 *   "success": true,
 *   "updated": 5,
 *   "issues": [...details of updated issues...]
 * }
 */
app.post('/api/mark-issue-fixed', async (req, res) => {
    try {
        const { pattern, commitHash, fixNotes, issueIds, broadSearch } = req.body;
        
        // Validation
        if (!commitHash || !fixNotes) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: commitHash and fixNotes are required' 
            });
        }
        
        if (!pattern && !issueIds) {
            return res.status(400).json({ 
                success: false, 
                error: 'Must provide either pattern (to search) or issueIds (specific records)' 
            });
        }
        
        moduleLogger.info(`[MARK-FIXED] Pattern: ${pattern || 'N/A'}, IDs: ${issueIds || 'N/A'}, Commit: ${commitHash}, Broad: ${broadSearch || false}`);
        
        const Airtable = require('airtable');
        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_CLIENTS_BASE_ID);
        
        let records;
        let searchDetails = {};
        
        if (issueIds && issueIds.length > 0) {
            // Update specific issue IDs - GENEROUS approach, includes all specified IDs
            const issueIdConditions = issueIds.map(id => `{Issue ID} = ${id}`).join(', ');
            const filterFormula = `AND(OR(${issueIdConditions}), {Status} != "FIXED")`;
            
            moduleLogger.info(`[MARK-FIXED] Searching by Issue IDs: ${issueIds.join(', ')}`);
            
            records = await base('Production Issues')
                .select({ filterByFormula: filterFormula })
                .all();
                
            searchDetails = { method: 'issueIds', ids: issueIds };
        } else if (pattern) {
            // GENEROUS PATTERN SEARCH: 
            // Search in Error Message, Pattern Matched, AND Stack Trace for maximum coverage
            // This ensures we catch all related issues, relying on self-correction via future runs
            let filterFormula;
            
            if (broadSearch) {
                // Ultra-broad: search across Error Message, Pattern Matched, Stack Trace, and Context
                filterFormula = `AND(
                    OR(
                        SEARCH("${pattern}", {Error Message}) > 0,
                        SEARCH("${pattern}", {Pattern Matched}) > 0,
                        SEARCH("${pattern}", {Stack Trace}) > 0,
                        SEARCH("${pattern}", {Context}) > 0
                    ),
                    {Status} != "FIXED"
                )`;
                moduleLogger.info(`[MARK-FIXED] BROAD search for pattern: "${pattern}" across all text fields`);
            } else {
                // Standard: search Error Message and Pattern Matched
                filterFormula = `AND(
                    OR(
                        SEARCH("${pattern}", {Error Message}) > 0,
                        SEARCH("${pattern}", {Pattern Matched}) > 0
                    ),
                    {Status} != "FIXED"
                )`;
                moduleLogger.info(`[MARK-FIXED] Standard search for pattern: "${pattern}"`);
            }
            
            records = await base('Production Issues')
                .select({ filterByFormula: filterFormula })
                .all();
                
            searchDetails = { method: 'pattern', pattern, broadSearch: broadSearch || false };
        }
        
        if (!records || records.length === 0) {
            moduleLogger.warn(`[MARK-FIXED] No unfixed issues found. Search: ${JSON.stringify(searchDetails)}`);
            return res.json({
                success: true,
                updated: 0,
                message: 'No unfixed issues found matching the criteria',
                searchDetails
            });
        }
        
        moduleLogger.info(`[MARK-FIXED] Found ${records.length} issue(s) to mark as FIXED`);
        
        // Log what we're about to mark for transparency
        records.forEach(r => {
            const issueId = r.get('Issue ID');
            const severity = r.get('Severity');
            const preview = (r.get('Error Message') || '').substring(0, 80);
            moduleLogger.info(`[MARK-FIXED]   #${issueId} [${severity}] ${preview}...`);
        });
        
        // Prepare updates
        const updates = records.map(record => ({
            id: record.id,
            fields: {
                'Status': 'FIXED',
                'Fixed Time': new Date().toISOString(),
                'Fix Notes': fixNotes,
                'Fix Commit': commitHash
            }
        }));
        
        // Update in batches of 10 (Airtable limit)
        const updatedRecords = [];
        for (let i = 0; i < updates.length; i += 10) {
            const batch = updates.slice(i, i + 10);
            const result = await base('Production Issues').update(batch);
            updatedRecords.push(...result);
            moduleLogger.info(`[MARK-FIXED] Updated batch ${Math.floor(i/10) + 1} (${batch.length} issues)`);
        }
        
        moduleLogger.info(`✅ [MARK-FIXED] Successfully marked ${updatedRecords.length} issue(s) as FIXED with commit ${commitHash}`);
        
        // Return detailed summary
        const summary = updatedRecords.map(r => ({
            issueId: r.get('Issue ID'),
            timestamp: r.get('Timestamp'),
            severity: r.get('Severity'),
            patternMatched: r.get('Pattern Matched'),
            message: (r.get('Error Message') || '').substring(0, 100) + '...',
            status: r.get('Status'),
            fixedTime: r.get('Fixed Time'),
            fixCommit: r.get('Fix Commit')
        }));
        
        res.json({
            success: true,
            updated: updatedRecords.length,
            commitHash: commitHash,
            fixNotes: fixNotes,
            searchDetails: searchDetails,
            issues: summary
        });
        
    } catch (error) {
        moduleLogger.error('[MARK-FIXED] Failed to mark issues as fixed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message, 
            stack: error.stack 
        });
    }
});

/**
 * POST /api/delete-production-issues
 * AUTH REQUIRED
 * 
 * Permanently DELETE Production Issues matching a pattern (and their stack traces)
 * Use this for cleanup instead of marking as FIXED when you want to remove false positives
 * 
 * Request body:
 * {
 *   "pattern": "error text to search",    // Text to search in Error Message
 *   "issueIds": [123, 124],               // OR: specific Issue IDs to delete
 *   "reason": "Why deleting"              // Required: explanation
 * }
 * 
 * Returns:
 * {
 *   "success": true,
 *   "deleted": { "productionIssues": 5, "stackTraces": 3 }
 * }
 */
app.post('/api/delete-production-issues', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    
    try {
        const { pattern, issueIds, reason } = req.body;
        
        if (!reason) {
            return res.status(400).json({ 
                success: false, 
                error: 'Reason is required for deletion' 
            });
        }
        
        if (!pattern && !issueIds) {
            return res.status(400).json({ 
                success: false, 
                error: 'Must provide either pattern or issueIds' 
            });
        }
        
        moduleLogger.info(`[DELETE-ISSUES] Pattern: ${pattern || 'N/A'}, IDs: ${issueIds || 'N/A'}, Reason: ${reason}`);
        
        const Airtable = require('airtable');
        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_CLIENTS_BASE_ID);
        
        let productionIssueRecords;
        
        // Find Production Issues to delete
        if (issueIds && issueIds.length > 0) {
            const issueIdConditions = issueIds.map(id => `{Issue ID} = ${id}`).join(', ');
            const filterFormula = `OR(${issueIdConditions})`;
            
            productionIssueRecords = await base('Production Issues')
                .select({ filterByFormula: filterFormula })
                .all();
        } else if (pattern) {
            const filterFormula = `OR(
                SEARCH("${pattern}", {Error Message}) > 0,
                SEARCH("${pattern}", {Pattern Matched}) > 0
            )`;
            
            productionIssueRecords = await base('Production Issues')
                .select({ filterByFormula: filterFormula })
                .all();
        }
        
        if (!productionIssueRecords || productionIssueRecords.length === 0) {
            return res.json({
                success: true,
                deleted: { productionIssues: 0, stackTraces: 0 },
                message: 'No issues found matching criteria'
            });
        }
        
        moduleLogger.info(`[DELETE-ISSUES] Found ${productionIssueRecords.length} Production Issues to delete`);
        
        // Collect stack trace IDs linked to these issues
        const stackTraceIds = productionIssueRecords
            .map(r => r.get('Stack Trace'))
            .flat()
            .filter(id => id);
        
        // Delete Production Issues (in batches of 10)
        let deletedIssues = 0;
        for (let i = 0; i < productionIssueRecords.length; i += 10) {
            const batch = productionIssueRecords.slice(i, i + 10).map(r => r.id);
            await base('Production Issues').destroy(batch);
            deletedIssues += batch.length;
            moduleLogger.info(`[DELETE-ISSUES] Deleted batch ${Math.floor(i/10) + 1} (${batch.length} Production Issues)`);
        }
        
        // Delete linked Stack Traces (in batches of 10)
        let deletedStackTraces = 0;
        if (stackTraceIds.length > 0) {
            for (let i = 0; i < stackTraceIds.length; i += 10) {
                const batch = stackTraceIds.slice(i, i + 10);
                await base('Stack Traces').destroy(batch);
                deletedStackTraces += batch.length;
                moduleLogger.info(`[DELETE-ISSUES] Deleted batch ${Math.floor(i/10) + 1} (${batch.length} Stack Traces)`);
            }
        }
        
        moduleLogger.info(`✅ [DELETE-ISSUES] Deleted ${deletedIssues} Production Issues and ${deletedStackTraces} Stack Traces. Reason: ${reason}`);
        
        res.json({
            success: true,
            deleted: {
                productionIssues: deletedIssues,
                stackTraces: deletedStackTraces
            },
            reason: reason
        });
        
    } catch (error) {
        moduleLogger.error('[DELETE-ISSUES] Failed to delete issues:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message, 
            stack: error.stack 
        });
    }
});

/**
 * GET /api/cleanup-old-production-issues
 * Simple endpoint to delete old production issues from runs before bug fixes
 * Just visit in browser: https://pb-webhook-server-staging.onrender.com/api/cleanup-old-production-issues
 */
app.get('/api/cleanup-old-production-issues', async (req, res) => {
    try {
        moduleLogger.info('🗑️ Starting cleanup of old production issues...');
        
        const runIds = ['251012-005615', '251012-010957', '251012-072642'];
        const reason = 'Old errors from runs before bug fixes deployed (commits d2ccab2, a843e39, 1939c80). All root causes already fixed.';
        
        const masterBase = getMasterClientsBase();
        
        // Find all issues from these runs
        const filter = `OR(${runIds.map(id => `{Run ID} = '${id}'`).join(',')})`;
        const issues = await masterBase('Production Issues')
            .select({ filterByFormula: filter })
            .all();
        
        moduleLogger.info(`Found ${issues.length} issues to delete from runs: ${runIds.join(', ')}`);
        
        // Delete in batches of 10
        let deleted = 0;
        for (let i = 0; i < issues.length; i += 10) {
            const batch = issues.slice(i, i + 10);
            await masterBase('Production Issues').destroy(batch.map(r => r.id));
            deleted += batch.length;
            moduleLogger.info(`Deleted ${deleted}/${issues.length} issues...`);
        }
        
        moduleLogger.info(`✅ Cleanup complete. Deleted ${deleted} old production issues.`);
        
        res.json({
            success: true,
            deleted: deleted,
            runIds: runIds,
            reason: reason,
            message: `Successfully deleted ${deleted} old production issues`
        });
        
    } catch (error) {
        moduleLogger.error('[CLEANUP-OLD-ISSUES] Failed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message
        });
    }
});

/**
 * POST /api/cleanup-record-not-found-errors
 * AUTH REQUIRED
 * 
 * Deletes "Record not found" errors from Production Issues and Stack Traces
 * These are false errors caused by the Run ID mismatch bug (fixed in commit 1939c80)
 */
app.post('/api/cleanup-record-not-found-errors', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    
    try {
        const masterBase = getMasterClientsBase();
        
        // Step 1: Find and delete from Production Issues
        const productionIssues = await masterBase('Production Issues')
            .select({
                filterByFormula: `AND(
                    OR(
                        FIND('Client run record not found', {Error Message}),
                        FIND('Record not found for 251012-', {Error Message})
                    ),
                    FIND('jobTracking.js', {Stack Trace})
                )`
            })
            .all();
        
        const deletedIssueIds = [];
        if (productionIssues.length > 0) {
            for (let i = 0; i < productionIssues.length; i += 10) {
                const batch = productionIssues.slice(i, i + 10);
                const ids = batch.map(r => r.id);
                await masterBase('Production Issues').destroy(ids);
                deletedIssueIds.push(...ids);
            }
        }
        
        // Step 2: Find and delete from Stack Traces
        const stackTraces = await masterBase('Stack Traces')
            .select({
                filterByFormula: `AND(
                    FIND('Client run record not found', {Error Message}),
                    FIND('updateClientRun', {Stack Trace})
                )`
            })
            .all();
        
        const deletedTraceIds = [];
        if (stackTraces.length > 0) {
            for (let i = 0; i < stackTraces.length; i += 10) {
                const batch = stackTraces.slice(i, i + 10);
                const ids = batch.map(r => r.id);
                await masterBase('Stack Traces').destroy(ids);
                deletedTraceIds.push(...ids);
            }
        }
        
        res.json({
            success: true,
            deleted: {
                productionIssues: deletedIssueIds.length,
                stackTraces: deletedTraceIds.length,
                total: deletedIssueIds.length + deletedTraceIds.length
            },
            message: `Cleaned up ${deletedIssueIds.length + deletedTraceIds.length} false error records caused by Run ID mismatch bug (fixed in commit 1939c80)`
        });
        
    } catch (error) {
        moduleLogger.error('[CLEANUP] Failed to cleanup records:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Get Production Issues from Airtable with filters
 * GET /api/production-issues
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 * Query params: ?status=NEW&severity=CRITICAL&limit=50
 */
app.get('/api/production-issues', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
        const { status, severity, limit } = req.query;
        const service = new ProductionIssueService();
        const issues = await service.getProductionIssues({ 
            status, 
            severity, 
            limit: limit ? parseInt(limit) : 100 
        });
        
        res.json({ ok: true, count: issues.length, issues });
    } catch (error) {
        moduleLogger.error('Failed to get production issues:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * Mark a Production Issue as fixed
 * POST /api/production-issues/:recordId/mark-fixed
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 * Body: { fixNotes: "...", commitHash: "a3b2c1d" }
 */
app.post('/api/production-issues/:recordId/mark-fixed', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
        const { recordId } = req.params;
        const { fixNotes, commitHash } = req.body || {};
        
        const service = new ProductionIssueService();
        const updated = await service.markAsFixed(recordId, { fixNotes, commitHash });
        
        res.json({ ok: true, message: 'Issue marked as fixed', record: updated });
    } catch (error) {
        moduleLogger.error('Failed to mark issue as fixed:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * Verify Production Issues table schema
 * GET /api/verify-production-issues-table
 * Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
 * Tests field names and single select options by creating/deleting a test record
 */
app.get('/api/verify-production-issues-table', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
        const base = getMasterClientsBase();
        const table = base('Production Issues');
        
        moduleLogger.info('🔍 Verifying Production Issues table schema...');
        
        // Create a comprehensive test record with ALL 19 fields (except auto-generated Issue ID)
        const testRecord = {
            // Core Fields (7)
            'Timestamp': new Date().toISOString(),
            'Severity': 'WARNING', // Test single select
            'Pattern Matched': 'Test Pattern - Verification Script',
            'Error Message': 'This is a comprehensive test record to verify ALL field names match code',
            'Context': 'Test context - created by verification endpoint. Will be deleted immediately. This tests the long text field.',
            'Status': 'NEW', // Test single select
            
            // Metadata Fields (4)
            'Stack Trace': 'Test stack trace\n  at testFunction (test.js:123:45)\n  at main (index.js:789:10)',
            'Run Type': 'api-endpoint', // Test single select
            'Client ID': 'Guy Wilson', // Single line text field
            'Service/Function': 'verifyProductionIssuesTable',
            
            // Tracking Fields (4) - test with placeholder values
            'Fixed Time': new Date().toISOString(), // DateTime field
            'Fix Notes': 'Test fix notes - this field stores resolution details',
            'Fix Commit': 'abc123def456', // Test commit hash format
            
            // Reference Fields (1)
            'Render Log URL': 'https://dashboard.render.com/test/logs?start=1234567890',
            
            // Optional Fields (3)
            'Occurrences': 1,
            'First Seen': new Date().toISOString(),
            'Last Seen': new Date().toISOString(),
        };
        
        moduleLogger.info('Creating test record with ALL 18 fields (19 total including auto-generated Issue ID)...');
        const created = await table.create([{ fields: testRecord }]);
        const recordId = created[0].id;
        
        moduleLogger.info(`✅ Test record created: ${recordId}`);
        
        // Now delete it
        await table.destroy([recordId]);
        moduleLogger.info('✅ Test record deleted');
        
        res.json({
            ok: true,
            message: 'Table verification successful - ALL fields tested!',
            verified: {
                table_name: 'Production Issues',
                fields_tested_count: Object.keys(testRecord).length,
                fields_tested: Object.keys(testRecord),
                single_select_values_tested: {
                    Status: 'NEW',
                    Severity: 'WARNING',
                    'Run Type': 'api-endpoint'
                },
                field_types_tested: {
                    datetime: 4,
                    single_select: 3,
                    long_text: 4,
                    single_line_text: 7,
                    url: 1,
                    number: 1
                },
                total_expected_fields: 19,
                all_fields_tested: true,
                test_record_created_and_deleted: true
            },
            next_steps: [
                'All core field names match ✓',
                'Single select options match ✓',
                'Ready to analyze production logs!',
                'Try: POST /api/analyze-logs/text with sample logs'
            ]
        });
        
    } catch (error) {
        moduleLogger.error('❌ Table verification failed:', error.message);
        
        let troubleshooting = [];
        
        if (error.message.includes('Unknown field name')) {
            const match = error.message.match(/Unknown field name: "(.+)"/);
            troubleshooting = [
                `Field name mismatch detected: "${match ? match[1] : 'unknown'}"`,
                'Check that field exists in Airtable with exact spelling and capitalization',
                'Expected fields: Timestamp, Severity, Pattern Matched, Error Message, Context, Status, Occurrences, First Seen, Last Seen'
            ];
        } else if (error.message.toLowerCase().includes('invalid') || error.message.toLowerCase().includes('value')) {
            troubleshooting = [
                'Invalid single select value detected',
                'Check these options match exactly:',
                '  • Status: NEW, INVESTIGATING, FIXED, IGNORED',
                '  • Severity: CRITICAL, ERROR, WARNING',
                '  • Run Type: smart-resume, batch-score, apify-webhook, api-endpoint, scheduled-job, other'
            ];
        } else if (error.message.includes('Could not find table')) {
            troubleshooting = [
                'Table "Production Issues" not found in Master Clients base',
                'Please create the table first'
            ];
        }
        
        res.status(500).json({
            ok: false,
            error: error.message,
            troubleshooting,
            failed_at: 'Table verification'
        });
    }
});

moduleLogger.info("Production Issue Analysis endpoints added:");
moduleLogger.info("  POST /api/analyze-logs/recent");
moduleLogger.info("  POST /api/analyze-logs/text");
moduleLogger.info("  GET /api/production-issues");
moduleLogger.info("  POST /api/production-issues/:recordId/mark-fixed");
moduleLogger.info("  GET /api/verify-production-issues-table");

/* ------------------------------------------------------------------
    4) Mount All Route Handlers and Sub-APIs
------------------------------------------------------------------*/
moduleLogger.info("index.js: Mounting routes and APIs...");

// Mount existing sub-APIs
try { require("./promptApi")(app, base); moduleLogger.info("index.js: promptApi mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting promptApi", e.message, e.stack); }
try { require("./recordApi")(app, base); moduleLogger.info("index.js: recordApi mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting recordApi", e.message, e.stack); }
try { require("./scoreApi")(app, base, globalGeminiModel); moduleLogger.info("index.js: scoreApi mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting scoreApi", e.message, e.stack); }

// --- NEW: MOUNT POST SCORING APIS ---
try {
    // Mounts the API for testing a SINGLE lead's posts
    require("./postScoreTestApi")(app, base, geminiConfig.vertexAIClient, postAnalysisConfig);
    // Mounts the API for triggering the BATCH process for ALL pending leads
    require("./postScoreBatchApi")(app, base, geminiConfig.vertexAIClient, postAnalysisConfig);
} catch(e) {
    moduleLogger.error("index.js: Error mounting one of the new Post Scoring APIs", e.message, e.stack);
}
// ------------------------------------

const mountQueue = require("./queueDispatcher");
if (mountQueue && typeof mountQueue === 'function') {
    try { mountQueue(app, base); moduleLogger.info("index.js: Queue Dispatcher mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting queueDispatcher", e.message, e.stack); }
} else {
    moduleLogger.error("index.js: Failed to load queueDispatcher or it's not a function.");
}

try { const webhookRoutes = require('./routes/webhookHandlers.js'); app.use(webhookRoutes); moduleLogger.info("index.js: Webhook routes mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting webhookRoutes", e.message, e.stack); }

// Mount Apify webhook routes (for LinkedIn posts ingestion)
try { const apifyWebhookRoutes = require('./routes/apifyWebhookRoutes.js'); app.use(apifyWebhookRoutes); moduleLogger.info("index.js: Apify webhook routes mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting apifyWebhookRoutes", e.message, e.stack); }
// Mount Apify control routes (start runs programmatically)
try { const apifyControlRoutes = require('./routes/apifyControlRoutes.js'); app.use(apifyControlRoutes); moduleLogger.info("index.js: Apify control routes mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting apifyControlRoutes", e.message, e.stack); }
// Mount Apify runs management routes (multi-tenant run tracking)
try { const apifyRunsRoutes = require('./routes/apifyRunsRoutes.js'); app.use(apifyRunsRoutes); moduleLogger.info("index.js: Apify runs management routes mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting apifyRunsRoutes", e.message, e.stack); }
// Mount Apify process routes (batch client processing)
try { const apifyProcessRoutes = require('./routes/apifyProcessRoutes.js'); app.use(apifyProcessRoutes); moduleLogger.info("index.js: Apify process routes mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting apifyProcessRoutes", e.message, e.stack); }

// Use authenticated LinkedIn routes instead of old non-authenticated ones
try { 
    const linkedinRoutesWithAuth = require('./LinkedIn-Messaging-FollowUp/backend-extensions/routes/linkedinRoutesWithAuth.js'); 
    app.use('/api/linkedin', linkedinRoutesWithAuth); 
    moduleLogger.info("index.js: Authenticated LinkedIn routes mounted at /api/linkedin"); 
} catch(e) { 
    moduleLogger.error("index.js: Error mounting authenticated LinkedIn routes", e.message, e.stack); 
    // Fallback to old routes if new ones fail
    try { 
        const linkedinRoutes = require('./LinkedIn-Messaging-FollowUp/backend-extensions/routes/linkedinRoutes.js'); 
        app.use('/api/linkedin', linkedinRoutes); 
        moduleLogger.info("index.js: Fallback: Old LinkedIn routes mounted at /api/linkedin"); 
    } catch(fallbackError) { 
        moduleLogger.error("index.js: Error mounting fallback LinkedIn routes", fallbackError.message, fallbackError.stack); 
    }
}

// Authentication test routes
try { const authTestRoutes = require('./routes/authTestRoutes.js'); app.use('/api/auth', authTestRoutes); moduleLogger.info("index.js: Authentication test routes mounted at /api/auth"); } catch(e) { moduleLogger.error("index.js: Error mounting authentication test routes", e.message, e.stack); }

// Debug routes for JSON serialization issues
try { const debugRoutes = require('./routes/debugRoutes.js'); app.use('/api/debug', debugRoutes); moduleLogger.info("index.js: Debug routes mounted at /api/debug"); } catch(e) { moduleLogger.error("index.js: Error mounting debug routes", e.message, e.stack); }

// Diagnostic routes for development and testing
try { 
    const diagnosticRoutes = require('./routes/diagnosticRoutes.js'); 
    app.use('/api/diagnostic', diagnosticRoutes); 
    moduleLogger.info("index.js: Diagnostic routes mounted at /api/diagnostic"); 
} catch(e) { 
    moduleLogger.error("index.js: Error mounting diagnostic routes", e.message, e.stack); 
}

// Top Scoring Leads scaffold (feature gated inside the router module)
try {
    const mountTopScoringLeads = require('./routes/topScoringLeadsRoutes.js');
    if (typeof mountTopScoringLeads === 'function') {
        mountTopScoringLeads(app, base);
        moduleLogger.info('index.js: Top Scoring Leads routes mounted at /api/top-scoring-leads');
    }
} catch(e) {
    moduleLogger.error('index.js: Error mounting Top Scoring Leads routes', e.message, e.stack);
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

moduleLogger.info("index.js: Emergency debug routes added");

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

// --- HELP BODY SANITIZATION UTILITIES ---
// Strip a leading 'Monologue' heading line produced by ChatGPT (various punctuation / markdown variants)
function stripMonologueHeading(body) {
    if (!body) return body;
    let text = body.toString().replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
    // Remove first non-empty line if it starts with Monologue (case-insensitive) with optional hashes and punctuation, keep rest.
    const lines = text.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue; // skip leading blanks
        // Accept optional markdown hashes then the word Monologue then optional punctuation (dash, en dash, em dash, colon)
        if (/^(?:#{1,6}\s*)?Monologue\b[ \t]*([:\-]|–|—)?[ \t]*.*$/i.test(lines[i])) {
            lines.splice(i, 1);
            // Remove following blank lines
            while (i < lines.length && !lines[i].trim()) lines.splice(i, 1);
        }
        break; // only inspect first non-empty line
    }
    return lines.join('\n');
}

function sanitizeHelpPayloadMonologues(payload) {
    if (!payload || !Array.isArray(payload.categories)) return 0;
    let removed = 0;
    for (const cat of payload.categories) {
        if (!cat || !Array.isArray(cat.subCategories)) continue;
        for (const sub of cat.subCategories) {
            if (!sub || !Array.isArray(sub.topics)) continue;
            for (const t of sub.topics) {
                if (t && typeof t.body === 'string' && /Monologue\b/i.test((t.body.split(/\n/)[0]||''))) {
                    const newBody = stripMonologueHeading(t.body);
                    if (newBody !== t.body) {
                        t.body = newBody;
                        removed++;
                    }
                }
            }
        }
    }
    if (!payload.meta) payload.meta = {};
    payload.meta.monologueHeadingsStripped = (payload.meta.monologueHeadingsStripped || 0) + removed;
    return removed;
}

// --- Auto-formatting of raw help topic bodies (lightweight, heuristic, idempotent) ---
function formattingScore(raw) {
    if (!raw || typeof raw !== 'string') return 0;
    let score = 0;
    if (/#\s/.test(raw)) score++;
    if (/\n-\s/.test(raw)) score++;
    if (/\*\*[A-Za-z].+?\*\*/.test(raw)) score++;
    if (/```/.test(raw)) score++;
    if (/^>\s/m.test(raw)) score++;
    // Dense line breaks & short lines typical of already formatted markdown
    const lines = raw.split(/\n/);
    const shortLines = lines.filter(l => l.trim() && l.length < 68).length;
    if (shortLines / Math.max(1, lines.length) > 0.6) score++;
    return score;
}

function autoFormatHelpBody(raw) {
    try {
        if (!raw || typeof raw !== 'string') return raw;
        const original = raw;
        // Skip if already looks formatted
        if (formattingScore(raw) >= 2) return raw;
        let text = raw.trim().replace(/\r\n/g, '\n');
        // Normalise double blank lines to a single
        text = text.replace(/\n{3,}/g, '\n\n');
        const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
        const transformed = [];
        // Detect sequences of candidate bullet sentences at end of doc
        const isBulletCandidate = l => /^(They|You|We|It|This|These|Your)\b/.test(l) && /\.("|'|”)?$/.test(l.trim());
        for (let i = 0; i < paragraphs.length; i++) {
            let p = paragraphs[i];
            // Heading detection: short line without period, or Title Case phrase
            if (/^[A-Za-z][A-Za-z\s]{1,60}$/.test(p) && !/[.!?]$/.test(p) && p.split(/\s+/).length <= 10) {
                transformed.push('### ' + p);
                continue;
            }
            // Label lead-ins inside paragraph sentences: Long game: Foo bar.
            p = p.replace(/(^|\n)([A-Z][A-Za-z ]{1,25})(?:—|–|-|:)\s+(?=\S)/g, (m, pre, label) => `${pre}**${label.trim()}:** `);
            // If paragraph contains 3+ consecutive bullet candidate sentences, split
            const sentences = p.split(/\n/).flatMap(line => line.split(/(?<=[.!?])\s+/));
            const bulletGroup = [];
            const otherBits = [];
            sentences.forEach(s => {
                if (isBulletCandidate(s.trim())) bulletGroup.push(s.trim()); else otherBits.push(s.trim());
            });
            if (bulletGroup.length >= 3 && bulletGroup.length >= otherBits.length) {
                // Keep any prefatory text (first sentence if not bullet)
                if (otherBits.length && !isBulletCandidate(otherBits[0])) {
                    transformed.push(otherBits[0]);
                }
                bulletGroup.forEach(b => transformed.push('- ' + b.replace(/\.$/, '')));
            } else {
                transformed.push(p);
            }
        }
        let out = transformed.join('\n\n');
    // Image lines: convert bare image URLs to markdown image syntax, preserving an optional trailing alt text phrase
    out = out.replace(/^(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp))(?:\s+-\s+([^\n]{0,80}))?$/gim, (m, url, alt) => `![$${alt ? alt.trim() : ''}](${url})`);
    // Wrap naked (non-image) URLs that stand alone on a line (not already in markdown link) with angle brackets to ensure autolink
    out = out.replace(/^(https?:\/\/[^\s]+)$/gim, (m) => `<${m}>`);
        // Secondary pass: run through remark (GFM + smartypants) to normalize punctuation & tables (best effort, lazy loaded)
        try {
            const { unified } = require('unified');
            const remarkParse = require('remark-parse');
            const remarkGfm = require('remark-gfm');
            const remarkSmartypants = require('remark-smartypants');
            const processor = unified().use(remarkParse).use(remarkGfm).use(remarkSmartypants);
            // We only need to round-trip parse -> stringify minimal; use toString on root (no custom stringify plugin for now)
            const tree = processor.parse(out);
            // (Potential future transforms on tree here)
            out = processor.stringify(tree);
        } catch (mdErr) {
            // Non-fatal if remark not available
        }
        // Collapse accidental multiple blank lines again
        out = out.replace(/\n{3,}/g, '\n\n').trim();
        // Idempotence guard: if we made it longer by >60% (likely bad), revert.
        if (out.length > original.length * 1.6) return original;
        return out;
    } catch (err) {
        moduleLogger.warn('[autoFormatHelpBody] failed', err.message);
        return raw;
    }
}

// ---- LLM Layout Formatting (optional) ----
const crypto = require('crypto');
const __layoutCache = new Map(); // key: sha256(bodyRaw)+modelVersion -> { layout, meta }
const LAYOUT_MODEL = process.env.HELP_LAYOUT_MODEL || 'gpt-4o-mini';

function hashRaw(raw) {
    return crypto.createHash('sha256').update(raw || '').digest('hex');
}

function extractAssets(raw) {
    const images = [];
    const links = [];
    const imageRegex = /^https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\s+-\s+([^\n]{0,80}))?$/gim;
    let m;
    while ((m = imageRegex.exec(raw)) !== null) {
        images.push({ id: 'IMG_' + (images.length + 1), src: m[0].split(/\s+-\s+/)[0].trim(), alt: m[1]?.trim() || null });
    }
    const markdownImg = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    while ((m = markdownImg.exec(raw)) !== null) {
        images.push({ id: 'IMG_' + (images.length + 1), src: m[2], alt: m[1] || null });
    }
    const urlRegex = /(^|\s)(https?:\/\/[^\s)]+)(?=$|[)\]\s])/g;
    while ((m = urlRegex.exec(raw)) !== null) {
        const url = m[2];
        if (!images.some(im => im.src === url)) {
            links.push({ id: 'LINK_' + (links.length + 1), url });
        }
    }
    return { images, links };
}

async function generateLayout(raw, openaiClient) {
    if (!raw || !openaiClient) return null;
    const sourceHash = hashRaw(raw);
    const cacheKey = sourceHash + ':' + LAYOUT_MODEL + ':v1';
    if (__layoutCache.has(cacheKey)) return { ...( __layoutCache.get(cacheKey) ), cached: true };
    const { images, links } = extractAssets(raw);
    // Create placeholder substituted text so model must reference placeholders
    let substitutedText = raw;
    images.forEach(im => { substitutedText = substitutedText.replace(im.src, `[${im.id}]`); });
    links.forEach(l => { substitutedText = substitutedText.replace(new RegExp(l.url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'), `[${l.id}]`); });
    const system = 'You are a precise formatting engine. Convert raw help text into strict JSON layout. NEVER add new facts, numbers, names, links, or images.';
    const user = [
        'Raw help text (placeholders like [IMG_1], [LINK_2] preserved) between triple backticks.',
        'Return ONLY JSON.',
        'Schema (TypeScript literal):',
        '{',
        "  title?: string;",
        "  sections: Array<{ type: 'paragraph'|'bullets'|'quote'|'callout'|'image'; heading?: string; content?: string; items?: string[]; imageId?: string; tone?: 'tip'|'note'|'warning'; }>;",
        "  images: Array<{ id: string; src: string; alt?: string|null; caption?: string|null }>;",
        "  links: Array<{ id: string; url: string; text?: string }>;",
        '}',
        'Rules:',
        '- Use existing placeholders exactly once if referenced.',
        '- Preserve meaning; you may tighten wording slightly.',
        '- Keep bullet items short (<= 140 chars).',
        "- Use 'callout' only for a single highlighted takeaway.",
        "- If a guiding quote exists, put it in a 'quote' section.",
        '```',
        substitutedText,
        '```'
    ].join('\n');
    let jsonTxt = null; let modelLatencyMs = 0; let error = null; let usage = null;
    const t0 = Date.now();
    try {
        const chat = await openaiClient.chat.completions.create({
            model: LAYOUT_MODEL,
            temperature: 0.2,
            max_tokens: 900,
            messages: [ { role: 'system', content: system }, { role: 'user', content: user } ]
        });
        modelLatencyMs = Date.now() - t0;
        const content = (chat.choices?.[0]?.message?.content || '').trim();
        usage = chat.usage || null;
        // Extract JSON
        const firstBrace = content.indexOf('{');
        const lastBrace = content.lastIndexOf('}');
        if (firstBrace >=0 && lastBrace > firstBrace) {
            jsonTxt = content.slice(firstBrace, lastBrace+1);
        } else {
            throw new Error('No JSON braces found in model output');
        }
        const parsed = JSON.parse(jsonTxt);
        // Basic schema validation
        if (!Array.isArray(parsed.sections)) throw new Error('sections missing');
        // Asset rehydration & guard: ensure all placeholders used are from known sets
        const referencedImageIds = new Set(parsed.sections.filter(s=>s.imageId).map(s=>s.imageId));
        referencedImageIds.forEach(id => { if (!images.find(im=>im.id===id)) throw new Error('Unknown imageId '+id); });
        // Reassign original src (ignore any model tampering)
        parsed.images = images.map(im => ({ id: im.id, src: im.src, alt: im.alt || null, caption: null }));
        parsed.links = links; // preserve original
        // Diff guard: ensure no new link domains introduced
        const outputText = JSON.stringify(parsed);
        for (const l of links) { /* ensure preserved */ if (!outputText.includes(l.id)) { /* allow omission but warn */ } }
        const record = { layout: parsed, meta: { sourceHash, model: LAYOUT_MODEL, modelLatencyMs, usage } };
        __layoutCache.set(cacheKey, record);
        return { ...record, cached: false };
    } catch (e) {
        error = e.message;
        return { layout: null, meta: { sourceHash, model: LAYOUT_MODEL, error, modelLatencyMs } };
    }
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

// --- Very small HTML sanitizer (allow-list). Not exhaustive, just for help content. ---
function sanitizeHelpHtml(html) {
    try {
        if (!html || typeof html !== 'string') return html;
        let out = html;
        // Drop script/style tags entirely
        out = out.replace(/<\/(?:script|style)>/gi, '')
                 .replace(/<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>/gi,'');
        // Remove on* inline event handlers
        out = out.replace(/ on[a-z]+="[^"]*"/gi,'');
        // Allow list tags; escape others by replacing <tag with &lt;tag
    // Added 'u' to allow underline tags authored in help content
    const allowed = /^(p|h[1-6]|ul|ol|li|strong|b|em|i|a|img|blockquote|hr|code|pre|br|span|div|u)$/i;
        out = out.replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (m,tag,attrs) => {
            if (!allowed.test(tag)) return m.replace('<','&lt;').replace('>','&gt;');
            // Restrict attributes
            let safeAttrs = '';
            attrs.replace(/([a-zA-Z0-9:-]+)=("[^"]*"|'[^']*')/g,(m2,name,val)=>{
                const ln = name.toLowerCase();
                if (['href','src','alt','title','class','data-media-id','data-media-type'].includes(ln)) safeAttrs += ' '+ln+'='+val;
                return m2;
            });
            return '<'+ (m[1]=='/'?'/' : '') + tag + safeAttrs + '>';
        });
        // Collapse excessive blank lines to avoid large vertical gaps in rendered help
        out = out.replace(/\n{3,}/g, '\n\n');
        return out;
    } catch { return html; }
}

app.get('/api/help/start-here', async (req, res) => {
    try {
        const refresh = req.query.refresh === '1';
        const now = Date.now();
        if (!refresh && __helpStartHereCache.data && (now - __helpStartHereCache.fetchedAt) < HELP_CACHE_TTL_MS) {
            const cachedCopy = JSON.parse(JSON.stringify(__helpStartHereCache.data));
            // If the cached payload still has unresolved {{media:ID}} tokens (from an earlier version
            // before placeholder resolution executed), bypass the cache and rebuild so users do not
            // see raw tokens in the UI.
            const hasUnresolvedMedia = JSON.stringify(cachedCopy).includes('{{media:');
            if (!hasUnresolvedMedia) {
                sanitizeHelpPayloadMonologues(cachedCopy);
                cachedCopy.meta = { ...cachedCopy.meta, cached: true };
                return res.json(cachedCopy);
            } else {
                moduleLogger.warn('[HelpStartHere] Bypassing stale cached help (unresolved media tokens detected)');
            }
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
                    moduleLogger.info(`[HelpStartHere] Using non-default help base ${targetBaseId}`);
                } else {
                    moduleLogger.warn('[HelpStartHere] createBaseInstance not available on base export; falling back to default base');
                }
            } else {
                if (targetBaseId === masterClientsBaseId && targetBaseId !== defaultBaseId) {
                    moduleLogger.info('[HelpStartHere] Using MASTER_CLIENTS_BASE_ID for help content');
                } else {
                    moduleLogger.info('[HelpStartHere] Using default base for help content');
                }
            }
        } catch (bErr) {
            moduleLogger.error('[HelpStartHere] Failed to initialize help base', bErr.message);
            return res.status(500).json({ ok: false, error: 'Failed to initialize help base instance' });
        }

        const start = Date.now();
        const rows = [];
        // Airtable pagination
        // NEW: Direct 3-table join (Categories, Sub-Categories, Help topics)
    const includeBody = req.query.include === 'body';
    const enableAutoFormat = includeBody; // always on now
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
    // Help table selection logic:
    //   Default now points to original 'Help' table (HTML authoring stabilized).
    //   ?table=copy  -> forces legacy 'Help copy' table.
    //   ?table=help  -> forces original 'Help' table explicitly.
    //   HELP_TABLE_DEFAULT env var can override default (e.g., set to 'Help copy').
    let helpTableName;
    if (req.query.table === 'copy') helpTableName = 'Help copy';
    else if (req.query.table === 'help') helpTableName = 'Help';
    else helpTableName = process.env.HELP_TABLE_DEFAULT || 'Help';
    await collectFiltered(helpTableName, rowsTopics, "{help_area} = 'start_here'");

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
            let bodyVal = includeBody ? stripMonologueHeading((f.monologue_context || '').toString()) : undefined;
            let bodyHtml = undefined; let bodyFormat = 'markdown';
            if (bodyVal && ( /<\s*(?:p|h[1-6]|ul|ol|li|img|blockquote|hr|div|section|strong|em)/i.test(bodyVal) || /<img[^>]+\{\{media:[^}]+\}\}/i.test(bodyVal) || /\{\{media:[^}]+\}\}/i.test(bodyVal) )) {
                // Treat as HTML content (author provided)
                bodyHtml = sanitizeHelpHtml(bodyVal);
                bodyFormat = 'html';
            } else if (enableAutoFormat && bodyVal) {
                bodyVal = autoFormatHelpBody(bodyVal);
            }
            sub.topics.push({
                id: r.id,
                title,
                order,
                body: bodyFormat === 'markdown' ? bodyVal : undefined,
                bodyHtml: bodyHtml,
                bodyFormat,
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
                            ...(includeBody ? { body: t.body, bodyHtml: t.bodyHtml, bodyFormat: t.bodyFormat } : {}),
                            contextType: t.contextType
                        }))
                    }))
            }));

    // --- HTML Media Placeholder & Link Resolution (numeric IDs => Media table) ---
        // Supports patterns:
        //   <img src="{{media:12}}" alt="Optional" />
        //   {{media:12}} (standalone token)
        // Media table expected fields: media_id (number), attachment (array) OR url, caption, description
        let mediaPlaceholderTotal = 0, mediaResolved = 0, mediaMissing = 0;
        if (includeBody) {
            // 1. Collect all numeric media ids referenced in topics with HTML bodies (regardless of bodyFormat)
            //    Accept variants like "{{media:12}}", "{{ media:12 }}" (case-insensitive, flexible whitespace)
            const mediaIdSet = new Set();
            for (const cat of categories) {
                for (const sub of cat.subCategories) {
                    for (const topic of sub.topics) {
                        if (typeof topic.bodyHtml === 'string' && /\{\{\s*media\s*:\s*\d+\s*}}/i.test(topic.bodyHtml)) {
                            const html = topic.bodyHtml;
                            const re = /\{\{\s*media\s*:\s*(\d+)\s*}}/gi;
                            let m; while((m = re.exec(html))!==null) { mediaIdSet.add(m[1]); }
                        }
                    }
                }
            }
            if (mediaIdSet.size) {
                try {
                    // 2. Fetch referenced media records
                    const helpBaseForMedia = getHelpBase && typeof getHelpBase === 'function' ? getHelpBase() : helpBase; // reuse helper if present
                    const mediaMap = new Map();
                    const idsArr = Array.from(mediaIdSet.values());
                    // Airtable OR filter formula (chunk if needed for safety)
                    const chunkSize = 80; // Airtable usually fine up to ~100 operands
                    for (let i=0;i<idsArr.length;i+=chunkSize) {
                        const chunk = idsArr.slice(i, i+chunkSize);
                        const formula = 'OR(' + chunk.map(id => `{media_id}=${id}`).join(',') + ')';
                        await helpBaseForMedia('Media').select({ filterByFormula: formula, pageSize: chunk.length }).eachPage((records,next)=>{
                            records.forEach(r => { const mf = r.fields || {}; if (mf.media_id!=null) mediaMap.set(String(mf.media_id), r); });
                            next();
                        });
                    }
                    // 3. Replace placeholders in each HTML topic
                    // Accept optional whitespace inside the token: {{ media:12 }}
                    const IMG_TAG_RE = /<img\b[^>]*src=["']\{\{\s*media\s*:\s*(\d+)\s*}}["'][^>]*>/gi;
                    const A_TAG_RE = /<a\b[^>]*href=["']\{\{\s*media\s*:\s*(\d+)\s*}}["'][^>]*>([\s\S]*?)<\/a>/gi;
                    const TOKEN_RE = /\{\{\s*media\s*:\s*(\d+)\s*}}/gi; // standalone
                    for (const cat of categories) {
                        for (const sub of cat.subCategories) {
                            for (const topic of sub.topics) {
                                if (typeof topic.bodyHtml !== 'string') continue;
                                let html = topic.bodyHtml;
                                // Replace <img src="{{media:ID}}">
                                html = html.replace(IMG_TAG_RE, (match, id) => {
                                    mediaPlaceholderTotal++;
                                    const rec = mediaMap.get(String(id));
                                    if (!rec) { mediaMissing++; return match.replace(/\{\{\s*media\s*:\s*\d+\s*}}/i, '').replace(/src=["'][^"']+["']/, 'src="" data-media-missing="1" data-media-id="'+id+'"'); }
                                    const f = rec.fields || {};
                                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                                    const url = f.url || (attachment && attachment.url) || '';
                                    const caption = f.caption || f.description || '';
                                    mediaResolved++;
                                    // Preserve existing alt if present; otherwise derive
                                    let altMatch = match.match(/alt=["']([^"']*)["']/i);
                                    const altText = altMatch ? altMatch[1] : (caption || ('Media '+id));
                                    return `<img src="${url}" alt="${altText.replace(/"/g,'&quot;')}" data-media-id="${id}" class="help-media-image" />` + (caption ? `<div class="help-media-caption" data-media-id="${id}">${caption}</div>` : '');
                                });
                                // Replace <a href="{{media:ID}}">...</a>
                                html = html.replace(A_TAG_RE, (match, id, inner) => {
                                    mediaPlaceholderTotal++;
                                    const rec = mediaMap.get(String(id));
                                    if (!rec) { mediaMissing++; return match.replace(/\{\{\s*media\s*:\s*\d+\s*}}/i, '#').replace('<a','<a data-media-missing="1" data-media-id="'+id+'"'); }
                                    const f = rec.fields || {};
                                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                                    const urlRaw = f.url || (attachment && attachment.url) || '';
                                    const url = /^https?:\/\//i.test(urlRaw) ? urlRaw : (urlRaw ? 'https://'+urlRaw : '#');
                                    mediaResolved++;
                                    return `<a href="${url}" data-media-id="${id}" target="_blank" rel="noopener noreferrer">${inner || url}</a>`;
                                });
                                // Replace standalone {{media:ID}} tokens
                                html = html.replace(TOKEN_RE, (match, id) => {
                                    mediaPlaceholderTotal++;
                                    const rec = mediaMap.get(String(id));
                                    if (!rec) { mediaMissing++; return `<span class="media-missing" data-media-id="${id}">[media ${id} missing]</span>`; }
                                    const f = rec.fields || {};
                                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                                    const url = f.url || (attachment && attachment.url) || '';
                                    const caption = f.caption || f.description || '';
                                    mediaResolved++;
                                    return `<figure class="help-media" data-media-id="${id}"><img src="${url}" alt="${(caption||('Media '+id)).replace(/"/g,'&quot;')}" />${caption?`<figcaption>${caption}</figcaption>`:''}</figure>`;
                                });
                                // Optional: auto-link bare domains inside this topic's HTML (simple heuristic)
                                html = html.replace(/(?<![\w@])(https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(\/[\w\-._~:/?#[\]@!$&'()*+,;=%]*)?(?=\s|<|$)/gi, (m, proto, domain, path) => {
                                    // Skip if already part of an existing anchor tag
                                    if (/href=/.test(m)) return m;
                                    const url = (proto? proto : 'https://') + domain + (path||'');
                                    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${domain}${path||''}</a>`;
                                });
                                topic.bodyHtml = html;
                            }
                        }
                    }
                    // 4. Safety pass: if any residual {{media:ID}} tokens remain (e.g., inside unexpected attribute context
                    // or nested in author markup we did not pattern-match), attempt a generic replacement now.
                    const GENERIC_TOKEN = /\{\{\s*media\s*:\s*(\d+)\s*}}/gi;
                    for (const cat of categories) {
                        for (const sub of cat.subCategories) {
                            for (const topic of sub.topics) {
                                if (typeof topic.bodyHtml !== 'string') continue;
                                if (!/\{\{\s*media\s*:\s*\d+\s*}}/i.test(topic.bodyHtml)) continue;
                                topic.bodyHtml = topic.bodyHtml.replace(GENERIC_TOKEN, (match, id) => {
                                    mediaPlaceholderTotal++;
                                    const rec = mediaMap.get(String(id));
                                    if (!rec) { mediaMissing++; return `<span class="media-missing" data-media-id="${id}">[media ${id} missing]</span>`; }
                                    const f = rec.fields || {};
                                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                                    const url = f.url || (attachment && attachment.url) || '';
                                    const caption = f.caption || f.description || '';
                                    mediaResolved++;
                                    return `<figure class="help-media" data-media-id="${id}"><img src="${url}" alt="${(caption||('Media '+id)).replace(/"/g,'&quot;')}" />${caption?`<figcaption>${caption}</figcaption>`:''}</figure>`;
                                });
                            }
                        }
                    }
                } catch (mediaErr) {
                    moduleLogger.warn('[HelpStartHere] Media placeholder resolution failed', mediaErr.message);
                }
            }
        }

        const debug = req.query.debug === '1';
    // Adjusted: revert to opt-in layout generation (must pass ?layout=1) since manual Markdown authoring is now the default.
    const wantLayout = includeBody && !!openaiClient && req.query.layout === '1';
        // Detect manual formatting quality (simple heuristic) so UI/admin can see which topics might still be "raw".
        let formattedTopics = 0;
        let rawTopics = 0;
        if (includeBody) {
            for (const c of categories) {
                for (const s of c.subCategories) {
                    for (const t of s.topics) {
                        if (typeof t.body === 'string') {
                            const sc = formattingScore(t.body);
                            t.formatQuality = sc >= 2 ? 'formatted' : 'raw';
                            if (sc >= 2) formattedTopics++; else rawTopics++;
                        }
                    }
                }
            }
        }

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
                autoFormatApplied: !!enableAutoFormat,
                layoutRequested: !!wantLayout,
                debugIncluded: !!debug,
                formattedTopics,
                rawTopics,
                helpTable: helpTableName
            }
        };
        // Flag presence of any unresolved tokens (should be zero unless a new pattern introduced)
        if (includeBody) {
            try {
                const unresolved = JSON.stringify(payload.categories).match(/\{\{\s*media\s*:\s*\d+\s*}}/g);
                if (unresolved && unresolved.length) {
                    payload.meta.unresolvedMediaTokens = unresolved.length;
                }
            } catch {}
        }
        if (includeBody) {
            payload.meta.mediaPlaceholders = mediaPlaceholderTotal;
            payload.meta.mediaResolved = mediaResolved;
            payload.meta.mediaMissing = mediaMissing;
        }
        if (debug) {
            payload.debug = {
                sampleCategoryIds: categories.slice(0,3).map(c=>c.id),
                rawCounts: { rowsCategories: rowsCategories.length, rowsSubCategories: rowsSubCategories.length, rowsTopics: rowsTopics.length }
            };
        }
    sanitizeHelpPayloadMonologues(payload);
    if (wantLayout) {
        const layoutStart = Date.now();
        let formattedCount = 0;
        let skipped = 0;
        const layoutErrors = [];
        // Sequential simple pass (keeps logic easy to reason about). If this proves slow, we can add concurrency later.
        for (const cat of payload.categories) {
            for (const sub of cat.subCategories) {
                for (const topic of sub.topics) {
                    if (!topic.body) { skipped++; continue; }
                    try {
                        const layoutResp = await generateLayout(topic.body, openaiClient);
                        if (layoutResp && layoutResp.layout) {
                            topic.layout = layoutResp.layout;
                            topic.layoutMeta = layoutResp.meta;
                            formattedCount++;
                        } else if (layoutResp && layoutResp.meta && layoutResp.meta.error) {
                            layoutErrors.push({ topicId: topic.id, error: layoutResp.meta.error });
                        }
                    } catch (le) {
                        layoutErrors.push({ topicId: topic.id, error: le.message || 'layout failure' });
                    }
                }
            }
        }
        payload.meta.layoutGenerationMs = Date.now() - layoutStart;
        payload.meta.layoutTopicsFormatted = formattedCount;
        payload.meta.layoutTopicsSkipped = skipped;
        if (layoutErrors.length) payload.meta.layoutErrors = layoutErrors.slice(0,10); // cap for response
        payload.meta.layoutMode = 'all';
    }
    __helpStartHereCache = { data: payload, fetchedAt: Date.now() };
    res.json(payload);
    } catch (e) {
        try { moduleLogger.error('Help Start Here endpoint error raw =>', e); } catch {}
        try { if (e && e.stack) moduleLogger.error('Stack:', e.stack); } catch {}
        // Provide actionable diagnostics on NOT_AUTHORIZED
        const isAuth = (e && (e.error === 'NOT_AUTHORIZED' || e.statusCode === 403));
        if (isAuth && process.env.ENABLE_HELP_STUB === '1') {
            moduleLogger.warn('[HelpStartHere] NOT_AUTHORIZED – serving stub help data because ENABLE_HELP_STUB=1');
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
moduleLogger.info('index.js: Help Start Here endpoint mounted at /api/help/start-here');

// Export selected utilities for internal scripts/tests (non-breaking)
try {
    module.exports = { autoFormatHelpBody, stripMonologueHeading };
} catch {}

// Area Help cache (per help_area)
let __helpAreaCache = new Map(); // key: area (lowercase) -> { data, fetchedAt }

// Context-sensitive Help by area (categories/sub-categories/topics)
app.get('/api/help/context', async (req, res) => {
    try {
        const areaRaw = (req.query.area || '').toString().trim();
        const area = areaRaw.toLowerCase();
        if (!area) return res.status(400).json({ ok: false, error: "Missing 'area' query param" });
        const refresh = req.query.refresh === '1';
        const now = Date.now();
        const cached = __helpAreaCache.get(area);
        if (!refresh && cached && (now - cached.fetchedAt) < HELP_CACHE_TTL_MS) {
            const copy = JSON.parse(JSON.stringify(cached.data));
            sanitizeHelpPayloadMonologues(copy);
            copy.meta = { ...copy.meta, cached: true };
            return res.json(copy);
        }

        const targetBaseId = process.env.AIRTABLE_HELP_BASE_ID || process.env.MASTER_CLIENTS_BASE_ID || process.env.AIRTABLE_BASE_ID;
        if (!targetBaseId) return res.status(500).json({ ok: false, error: 'Missing Airtable base id for help content' });
        if (!base) return res.status(500).json({ ok: false, error: 'Airtable base instance not initialized' });

        // Choose correct base (same logic as start-here)
        let helpBase = base;
        const defaultBaseId = process.env.AIRTABLE_BASE_ID;
        const masterClientsBaseId = process.env.MASTER_CLIENTS_BASE_ID;
        try {
            if (targetBaseId && defaultBaseId && targetBaseId !== defaultBaseId) {
                if (typeof base.createBaseInstance === 'function') {
                    helpBase = base.createBaseInstance(targetBaseId);
                    moduleLogger.info(`[HelpContext:${area}] Using non-default help base ${targetBaseId}`);
                } else {
                    moduleLogger.warn(`[HelpContext:${area}] createBaseInstance not available; using default base`);
                }
            } else {
                if (targetBaseId === masterClientsBaseId && targetBaseId !== defaultBaseId) {
                    moduleLogger.info(`[HelpContext:${area}] Using MASTER_CLIENTS_BASE_ID for help content`);
                } else {
                    moduleLogger.info(`[HelpContext:${area}] Using default base for help content`);
                }
            }
        } catch (bErr) {
            moduleLogger.error(`[HelpContext:${area}] Failed to initialize help base`, bErr.message);
            return res.status(500).json({ ok: false, error: 'Failed to initialize help base instance' });
        }

        const start = Date.now();
        const rowsTopics = [];
        const rowsCategories = [];
        const rowsSubCategories = [];

        const includeBody = req.query.include === 'body';
        const enableAutoFormat = includeBody;

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
        // Help table selection logic mirrors start-here
        let helpTableName;
        if (req.query.table === 'copy') helpTableName = 'Help copy';
        else if (req.query.table === 'help') helpTableName = 'Help';
        else helpTableName = process.env.HELP_TABLE_DEFAULT || 'Help';
        // Filter topics by help_area (case-insensitive) with alias support
        const areaAliases = new Map([
            ['lead_search_and_update_search', ['lead_search_and_update_search', 'lead_search_and_update']],
            ['lead_search_and_update_detail', ['lead_search_and_update_detail', 'lead_search_and_update']],
        ]);
        const areaList = (areaAliases.get(area) || [area]).map(a => a.replace(/'/g, "''"));
        const areaFilter = areaList.length === 1
            ? `LOWER({help_area}) = '${areaList[0]}'`
            : 'OR(' + areaList.map(a => `LOWER({help_area}) = '${a}'`).join(',') + ')';
        await collectFiltered(helpTableName, rowsTopics, areaFilter);

        // Build maps & normalize (reuse helpers from this file)
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
            const catLink = Array.isArray(f.Categories) && f.Categories.length ? f.Categories[0] : null;
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
            let bodyVal = includeBody ? stripMonologueHeading((f.monologue_context || '').toString()) : undefined;
            let bodyHtml = undefined; let bodyFormat = 'markdown';
            if (bodyVal && ( /<\s*(?:p|h[1-6]|ul|ol|li|img|blockquote|hr|div|section|strong|em)/i.test(bodyVal) || /<img[^>]+\{\{media:[^}]+\}\>/i.test(bodyVal) || /\{\{media:[^}]+\}\}/i.test(bodyVal) )) {
                bodyHtml = sanitizeHelpHtml(bodyVal);
                bodyFormat = 'html';
            } else if (enableAutoFormat && bodyVal) {
                bodyVal = autoFormatHelpBody(bodyVal);
            }
            sub.topics.push({
                id: r.id,
                title,
                order,
                body: bodyFormat === 'markdown' ? bodyVal : undefined,
                bodyHtml: bodyHtml,
                bodyFormat,
                contextType: f.context_type || null
            });
        });

        subMap.forEach(sub => {
            const cat = catMap.get(sub.categoryAirtableId);
            if (!cat) { missingCategoryLinks++; return; }
            cat.subCategories.push(sub);
        });

        const categories = Array.from(catMap.values())
            .filter(c => c.subCategories.some(sc => sc.topics.length))
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
                            ...(includeBody ? { body: t.body, bodyHtml: t.bodyHtml, bodyFormat: t.bodyFormat } : {}),
                            contextType: t.contextType
                        }))
                    }))
            }));

        // Media placeholder resolution for HTML topics (reuse logic simplified)
        let mediaPlaceholderTotal = 0, mediaResolved = 0, mediaMissing = 0;
        if (includeBody) {
            // Accept optional whitespace inside tokens: {{ media:12 }}
            const mediaIdSet = new Set();
            for (const cat of categories) {
                for (const sub of cat.subCategories) {
                    for (const topic of sub.topics) {
                        if (typeof topic.bodyHtml === 'string') {
                            const html = topic.bodyHtml;
                            const re = /\{\{\s*media\s*:\s*(\d+)\s*}}/gi;
                            let m; while((m = re.exec(html))!==null) { mediaIdSet.add(m[1]); }
                        }
                    }
                }
            }
            if (mediaIdSet.size) {
                try {
                    const helpBaseForMedia = getHelpBase && typeof getHelpBase === 'function' ? getHelpBase() : helpBase;
                    const mediaMap = new Map();
                    const idsArr = Array.from(mediaIdSet.values());
                    const chunkSize = 80;
                    for (let i=0;i<idsArr.length;i+=chunkSize) {
                        const chunk = idsArr.slice(i, i+chunkSize);
                        const formula = 'OR(' + chunk.map(id => `{media_id}=${id}`).join(',') + ')';
                        await helpBaseForMedia('Media').select({ filterByFormula: formula, pageSize: chunk.length }).eachPage((records,next)=>{
                            records.forEach(r => { const mf = r.fields || {}; if (mf.media_id!=null) mediaMap.set(String(mf.media_id), r); });
                            next();
                        });
                    }
                    const IMG_TAG_RE = /<img\b[^>]*src=["']\{\{\s*media\s*:\s*(\d+)\s*}}["'][^>]*>/gi;
                    const A_TAG_RE = /<a\b[^>]*href=["']\{\{\s*media\s*:\s*(\d+)\s*}}["'][^>]*>([\s\S]*?)<\/a>/gi;
                    const TOKEN_RE = /\{\{\s*media\s*:\s*(\d+)\s*}}/gi;
                    for (const cat of categories) {
                        for (const sub of cat.subCategories) {
                            for (const topic of sub.topics) {
                                if (typeof topic.bodyHtml !== 'string') continue;
                                let html = topic.bodyHtml;
                                html = html.replace(IMG_TAG_RE, (match, id) => {
                                    mediaPlaceholderTotal++;
                                    const rec = mediaMap.get(String(id));
                                    if (!rec) { mediaMissing++; return match.replace(/\{\{\s*media\s*:\s*\d+\s*}}/i, '').replace(/src=["'][^"]+["']/, 'src="" data-media-missing="1" data-media-id="'+id+'"'); }
                                    const f = rec.fields || {};
                                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                                    const url = f.url || (attachment && attachment.url) || '';
                                    const caption = f.caption || f.description || '';
                                    mediaResolved++;
                                    let altMatch = match.match(/alt=["']([^"']*)["']/i);
                                    const altText = altMatch ? altMatch[1] : (caption || ('Media '+id));
                                    return `<img src="${url}" alt="${altText.replace(/"/g,'&quot;')}" data-media-id="${id}" class="help-media-image" />` + (caption ? `<div class="help-media-caption" data-media-id="${id}">${caption}</div>` : '');
                                });
                                html = html.replace(A_TAG_RE, (match, id, inner) => {
                                    mediaPlaceholderTotal++;
                                    const rec = mediaMap.get(String(id));
                                    if (!rec) { mediaMissing++; return match.replace(/\{\{\s*media\s*:\s*\d+\s*}}/i, '#').replace('<a','<a data-media-missing="1" data-media-id="'+id+'"'); }
                                    const f = rec.fields || {};
                                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                                    const urlRaw = f.url || (attachment && attachment.url) || '';
                                    const url = /^https?:\/\//i.test(urlRaw) ? urlRaw : (urlRaw ? 'https://'+urlRaw : '#');
                                    mediaResolved++;
                                    return `<a href="${url}" data-media-id="${id}" target="_blank" rel="noopener noreferrer">${inner || url}</a>`;
                                });
                                html = html.replace(TOKEN_RE, (match, id) => {
                                    mediaPlaceholderTotal++;
                                    const rec = mediaMap.get(String(id));
                                    if (!rec) { mediaMissing++; return `<span class="media-missing" data-media-id="${id}">[media ${id} missing]</span>`; }
                                    const f = rec.fields || {};
                                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                                    const url = f.url || (attachment && attachment.url) || '';
                                    const caption = f.caption || f.description || '';
                                    mediaResolved++;
                                    return `<figure class="help-media" data-media-id="${id}"><img src="${url}" alt="${(caption||('Media '+id)).replace(/"/g,'&quot;')}" />${caption?`<figcaption>${caption}</figcaption>`:''}</figure>`;
                                });
                                // Bare domain autolink
                                html = html.replace(/(?<![\w@])(https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(\/[\w\-._~:\/?#[\]@!$&'()*+,;=%]*)?(?=\s|<|$)/gi, (m, proto, domain, path) => {
                                    if (/href=/.test(m)) return m;
                                    const url = (proto? proto : 'https://') + domain + (path||'');
                                    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${domain}${path||''}</a>`;
                                });
                                topic.bodyHtml = html;
                            }
                        }
                    }
                } catch (mediaErr) {
                    moduleLogger.warn(`[HelpContext:${area}] Media placeholder resolution failed`, mediaErr.message);
                }
            }
        }

        // Format quality markers (optional)
        let formattedTopics = 0;
        let rawTopics = 0;
        if (includeBody) {
            for (const c of categories) for (const s of c.subCategories) for (const t of s.topics) {
                if (typeof t.body === 'string') {
                    const sc = formattingScore(t.body);
                    t.formatQuality = sc >= 2 ? 'formatted' : 'raw';
                    if (sc >= 2) formattedTopics++; else rawTopics++;
                }
            }
        }

        const payload = {
            area,
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
                autoFormatApplied: !!enableAutoFormat,
                helpTable: helpTableName,
                formattedTopics,
                rawTopics
            }
        };
        sanitizeHelpPayloadMonologues(payload);
        __helpAreaCache.set(area, { data: payload, fetchedAt: Date.now() });
        res.json(payload);
    } catch (e) {
        moduleLogger.error('Help Context endpoint error =>', e?.message || e);
        res.status(500).json({ ok: false, error: e?.message || 'Failed to load help context' });
    }
});

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

moduleLogger.info("index.js: Environment management endpoints added");

try { const appRoutes = require('./routes/apiAndJobRoutes.js'); app.use(appRoutes); moduleLogger.info("index.js: App/API/Job routes mounted."); } catch(e) { moduleLogger.error("index.js: Error mounting appRoutes", e.message, e.stack); }

// --- BROKEN PORTAL ROUTES REMOVED ---
// The following routes were removed as they were trying to serve non-existent files:
// - /linkedin and /linkedin/ routes
// - /portal route  
// - Static file serving for LinkedIn-Messaging-FollowUp/web-portal/build/
//
// ACTUAL WORKING FRONTEND: Next.js app deployed separately on Vercel
// Frontend URL: https://pb-webhook-server.vercel.app
// Backend APIs: Continue to work correctly on Render

moduleLogger.info("index.js: Attempting to mount Custom GPT support APIs...");
try {
    const mountPointerApi = require("./pointerApi.js");
    const mountLatestLead = require("./latestLeadApi.js");
    const mountUpdateLead = require("./updateLeadApi.js");

    if (!GPT_CHAT_URL && mountPointerApi && typeof mountPointerApi === 'function') {
        moduleLogger.warn("index.js: GPT_CHAT_URL is not set; pointerApi might not function fully if it relies on it internally beyond the parameter.");
    }
    
    if (mountPointerApi && typeof mountPointerApi === 'function') {
        mountPointerApi(app, base, GPT_CHAT_URL);
        moduleLogger.info("index.js: pointerApi mounted.");
    } else { moduleLogger.error("index.js: pointerApi.js not found or did not export a function."); }

    if (mountLatestLead && typeof mountLatestLead === 'function') {
        mountLatestLead(app, base);
        moduleLogger.info("index.js: latestLeadApi mounted.");
    } else { moduleLogger.error("index.js: latestLeadApi.js not found or did not export a function."); }

    if (mountUpdateLead && typeof mountUpdateLead === 'function') {
        mountUpdateLead(app, base);
        moduleLogger.info("index.js: updateLeadApi mounted.");
    } else { moduleLogger.error("index.js: updateLeadApi.js not found or did not export a function."); }
} catch (apiMountError) {
    moduleLogger.error("index.js: Error mounting one of the Custom GPT support APIs (pointer, latestLead, updateLead):", apiMountError.message, apiMountError.stack);
}

// --- WEBHOOK FOR TEXT BLAZE LINKEDIN DATA ---
app.post('/textblaze-linkedin-webhook', async (req, res) => {
    moduleLogger.info('Received data from Text Blaze /textblaze-linkedin-webhook:');
    moduleLogger.info('Request Body:', req.body);

    const { linkedinMessage, profileUrl, timestamp } = req.body;

    if (!linkedinMessage || !profileUrl || !timestamp) {
        moduleLogger.error("Webhook Error: Missing linkedinMessage, profileUrl, or timestamp in request body.");
        return res.status(400).json({
            status: 'error',
            message: 'Missing required data: linkedinMessage, profileUrl, or timestamp.'
        });
    }
    
    if (!base) {
        moduleLogger.error("Webhook Error: Airtable base not configured on server.");
        return res.status(500).json({
            status: 'error',
            message: 'Airtable integration not available on server.'
        });
    }
    if (!AIRTABLE_BASE_ID) {
        moduleLogger.error("Webhook Error: AIRTABLE_BASE_ID not configured on server.");
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
    moduleLogger.info(`Normalized Profile URL for Airtable search: ${normalizedProfileUrl}`);


    try {
        moduleLogger.info(`Searching Airtable for Lead with URL: ${normalizedProfileUrl}`); // Use normalized URL
        const records = await base(AIRTABLE_LEADS_TABLE_ID_OR_NAME).select({
            maxRecords: 1,
            // Use the normalized URL in the filter formula
            filterByFormula: `({${AIRTABLE_LINKEDIN_URL_FIELD}} = '${normalizedProfileUrl}')`
        }).firstPage();

        if (records && records.length > 0) {
            const record = records[0];
            const recordId = record.id;
            moduleLogger.info(`Found Lead with Record ID: ${recordId}`);

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
            moduleLogger.info(`Successfully updated Notes for Record ID: ${recordId}`);
            
            const airtableRecordUrl = `https://airtable.com/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_LEADS_TABLE_ID_OR_NAME)}/${recordId}`;

            return res.status(200).json({
                status: 'success',
                message: `Airtable record updated for ${normalizedProfileUrl}`,
                airtableRecordUrl: airtableRecordUrl,
                recordId: recordId
            });
        } else {
            moduleLogger.warn(`No Lead found in Airtable with URL: ${normalizedProfileUrl}`);
            return res.status(404).json({
                status: 'error',
                message: `No Lead found in Airtable with LinkedIn Profile URL: ${normalizedProfileUrl}`
            });
        }
    } catch (error) {
        moduleLogger.error("Error interacting with Airtable:", error);
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
    3) Global Error Handling Middleware
------------------------------------------------------------------*/
// Old error logger removed - now using Render log analysis
const logCriticalError = async () => {}; // No-op

// 404 handler - must come before error handler
app.use((req, res, next) => {
    res.status(404).json({ 
        error: 'Not Found', 
        message: `Cannot ${req.method} ${req.path}`,
        path: req.path 
    });
});

// Global error handler - catches all unhandled errors
app.use(async (err, req, res, next) => {
    moduleLogger.error('Global error handler caught error:', err);
    
    // Log critical errors to Airtable
    try {
        await logCriticalError(err, {
            endpoint: `${req.method} ${req.path}`,
            clientId: req.headers['x-client-id'],
            requestBody: req.body,
            queryParams: req.query,
            headers: {
                'user-agent': req.headers['user-agent'],
                'content-type': req.headers['content-type']
            }
        });
    } catch (loggingError) {
        moduleLogger.error('Failed to log error to Airtable:', loggingError.message);
    }
    
    // Send error response to client
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
        error: err.name || 'Internal Server Error',
        message: err.message || 'An unexpected error occurred',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

/* ------------------------------------------------------------------
    SECURE ENV VAR EXPORT ENDPOINT (For Local Development Only)
    
    This endpoint allows local dev machines to fetch current env vars from Render.
    SECURITY: Protected by PB_WEBHOOK_SECRET (same as other admin endpoints)
    
    Usage: curl -H "Authorization: Bearer Diamond9753!!@@pb" https://pb-webhook-server-staging.onrender.com/export-env-vars
------------------------------------------------------------------*/
app.get('/export-env-vars', (req, res) => {
    const endpointLogger = createLogger({ runId: 'EXPORT_ENV', clientId: 'SYSTEM', operation: 'export_env_vars' });
    
    // Security check - require same secret as other admin endpoints
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.PB_WEBHOOK_SECRET}`;
    
    if (!authHeader || authHeader !== expectedAuth) {
        endpointLogger.warn('Unauthorized attempt to export env vars');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    endpointLogger.info('Exporting environment variables for local development');
    
    // Export all env vars in .env file format
    const envVars = Object.entries(process.env)
        .filter(([key]) => {
            // Only export our custom env vars, skip Node.js system vars
            return !key.startsWith('npm_') && 
                   !key.startsWith('NODE_') &&
                   key !== 'PATH' &&
                   key !== 'HOME' &&
                   key !== 'USER' &&
                   key !== 'SHELL' &&
                   key !== 'PWD';
        })
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    
    res.type('text/plain').send(envVars);
    endpointLogger.info(`Exported ${Object.keys(process.env).length} environment variables`);
});

/* ------------------------------------------------------------------
    SECURE ENDPOINT: Export Environment Variables (For Local Development)
------------------------------------------------------------------*/
app.get('/api/export-env-vars', (req, res) => {
    // CRITICAL SECURITY: This endpoint exposes ALL secrets!
    // It's protected by BOOTSTRAP_SECRET which must be set on Render
    
    const authHeader = req.headers['authorization'];
    const expectedAuth = `Bearer ${process.env.BOOTSTRAP_SECRET}`;
    
    if (!process.env.BOOTSTRAP_SECRET) {
        moduleLogger.error('[export-env-vars] BOOTSTRAP_SECRET not set - endpoint disabled for security');
        return res.status(503).json({ 
            error: 'ENDPOINT_DISABLED',
            message: 'BOOTSTRAP_SECRET environment variable not configured on server'
        });
    }
    
    if (!authHeader || authHeader !== expectedAuth) {
        moduleLogger.warn('[export-env-vars] Unauthorized access attempt');
        return res.status(401).json({ 
            error: 'UNAUTHORIZED',
            message: 'Invalid or missing authorization header'
        });
    }
    
    // Authenticated! Export env vars as .env file format
    moduleLogger.info('[export-env-vars] Authorized request - exporting environment variables');
    
    const envVars = [];
    
    // Export all env vars in .env format
    for (const [key, value] of Object.entries(process.env)) {
        // Skip system/internal variables that shouldn't be in .env
        if (key.startsWith('npm_') || 
            key.startsWith('NODE_') ||
            key === 'PATH' ||
            key === 'PWD' ||
            key === 'HOME' ||
            key === 'USER' ||
            key === 'SHELL' ||
            key === 'TMPDIR' ||
            key === 'LANG') {
            continue;
        }
        
        // Escape values that contain special characters
        const escapedValue = value.includes('\n') || value.includes('"') 
            ? `"${value.replace(/"/g, '\\"')}"` 
            : value;
        
        envVars.push(`${key}=${escapedValue}`);
    }
    
    const envFileContent = envVars.join('\n');
    
    moduleLogger.info(`[export-env-vars] Exported ${envVars.length} environment variables`);
    
    // Return as plain text (ready to write to .env file)
    res.setHeader('Content-Type', 'text/plain');
    res.send(envFileContent);
});

/* ------------------------------------------------------------------
    4) Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3001;
moduleLogger.info(
    `▶︎ Server starting – Version: Gemini Integrated (Refactor 8.4) – Commit ${process.env.RENDER_GIT_COMMIT || "local"
    } – ${new Date().toISOString()}`
);

app.listen(port, () => {
    moduleLogger.info(`Server running on port ${port}.`);
    if (!globalGeminiModel) {
        moduleLogger.error("Final Check: Server started BUT Global Gemini Model (default instance) is not available. Scoring will fail.");
    } else if (!base) {
        moduleLogger.error("Final Check: Server started BUT Airtable Base is not available. Airtable operations will fail.");
    } else if (!geminiConfig || !geminiConfig.vertexAIClient) {
        moduleLogger.error("Final Check: Server started BUT VertexAI Client is not available from geminiConfig. Batch scoring may fail.");
    }
    else {
        moduleLogger.info("Final Check: Server started and essential services (Gemini client, default model, Airtable) appear to be loaded and all routes mounted.");
    }
});

/* ------------------------------------------------------------------
    LEGACY SECTION (Properly Commented Out)
------------------------------------------------------------------*/
/*
async function getScoringData() {
  // Original content would be here. For now, a placeholder.
  moduleLogger.warn("Legacy getScoringData function called - likely obsolete.");
  return {}; // Return a sensible default if it were ever called
}

function parseMarkdownTables(markdown) {
  // Original content would be here. For now, a placeholder.
  moduleLogger.warn("Legacy parseMarkdownTables function called - likely obsolete.");
  return {}; // Return a sensible default
}
*/

// --- SAFETY GUARD: Prevent silent use of production base in non-production ---
(function safetyGuardForAirtableBase() {
    const PROD_BASE_ID = 'appXySOLo6V9PfMfa'; // Production fallback base (from your .env)
    const env = process.env.NODE_ENV || 'development';
    if (env !== 'production' && AIRTABLE_BASE_ID === PROD_BASE_ID) {
        moduleLogger.warn(`⚠️  SAFETY WARNING: Running in NODE_ENV=${env} while AIRTABLE_BASE_ID is set to the production base (${PROD_BASE_ID}).\n` +
            'If this is intentional (legacy fallback), ensure you always supply ?testClient=... so client-specific bases are used.');
    }
})();

// Middleware to warn per-request if no client specified and production base fallback is in use
app.use((req, res, next) => {
    const clientParam = req.query.testClient || req.query.clientId || req.headers['x-client-id'];
    const PROD_BASE_ID = 'appXySOLo6V9PfMfa';
    
    // Skip warning for Apify webhooks - we now handle client resolution there separately
    const isApifyWebhook = req.path.includes('/api/apify-webhook');
    
    if (!clientParam && !isApifyWebhook && AIRTABLE_BASE_ID === PROD_BASE_ID && (process.env.NODE_ENV !== 'production')) {
        moduleLogger.warn(`⚠️  Request ${req.method} ${req.path} used DEFAULT production base (no clientId/testClient provided). Add ?testClient=CLIENT_ID to target that client base.`);
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
                moduleLogger.error('[getHelpBase] Failed to create base instance', e.message);
                return null;
            }
        } else {
            moduleLogger.warn('[getHelpBase] createBaseInstance not available; falling back to default base');
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
    let rawBody = (f.monologue_context || f.body || f.content || '').toString();
    rawBody = rawBody.replace(/^(?:#+\s*)?Monologue\b[^\n]*\n?/i, '');
    // HTML normalisation for downstream parsing (retain original tokens like [media:ID])
    function htmlToTextInline(html) {
        if (!html) return '';
        let out = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
        out = out.replace(/<(?:p|div|section|h[1-6]|li|ul|ol|blockquote|pre|br)[^>]*>/gi, m => { if (/^<li/i.test(m)) return '\n- '; if(/^<br/i.test(m)) return '\n'; return '\n'; });
        out = out.replace(/<\/(?:p|div|section|h[1-6]|li|ul|ol|blockquote|pre)>/gi,'\n');
        out = out.replace(/<img[^>]*>/gi, tag => { const alt = (tag.match(/alt=["']([^"']*)["']/i)||[])[1]; return alt ? ` ${alt} ` : ' [image] '; });
        out = out.replace(/<[^>]+>/g,'');
        out = out.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
        out = out.split('\n').map(l=>l.trim()).filter(Boolean).join('\n');
        return out.trim();
    }
    // If the topic body is authored in HTML, preserve an HTML version while also
    // producing a plain-text version for block parsing.
    const isHtmlAuthored = /<[a-z][\s\S]*>/i.test(rawBody) && rawBody.includes('</');
    let preservedBodyHtml = isHtmlAuthored ? sanitizeHelpHtml(rawBody) : undefined;
    if (isHtmlAuthored) {
        rawBody = htmlToTextInline(rawBody);
    }
        const title = (f.title || f.Name || '').toString();

        // 2. Extract media/link token ids: [media:12], [link:5]
        const TOKEN_RE = /\[(media|link):(\d+)\]/gi;
        const mediaIds = new Set();
        let m;
        while ((m = TOKEN_RE.exec(rawBody)) !== null) {
            mediaIds.add(m[2]);
        }
        // Also extract any HTML placeholder tokens: {{media:12}} (allow whitespace)
        if (preservedBodyHtml) {
            const HTML_TOKEN_RE = /\{\{\s*media\s*:\s*(\d+)\s*}}/gi;
            let hm; while ((hm = HTML_TOKEN_RE.exec(preservedBodyHtml)) !== null) { mediaIds.add(hm[1]); }
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

        // 3b. If we preserved an HTML body, also resolve any {{media:ID}} placeholders within that HTML (img/src, a/href, standalone)
        if (preservedBodyHtml) {
            try {
                const IMG_TAG_RE = /<img\b[^>]*src=["']\{\{\s*media\s*:\s*(\d+)\s*}}["'][^>]*>/gi;
                const A_TAG_RE = /<a\b[^>]*href=["']\{\{\s*media\s*:\s*(\d+)\s*}}["'][^>]*>([\s\S]*?)<\/a>/gi;
                const TOKEN_RE = /\{\{\s*media\s*:\s*(\d+)\s*}}/gi;
                let html = preservedBodyHtml;
                html = html.replace(IMG_TAG_RE, (match, id) => {
                    const rec = mediaMap.get(String(id));
                    if (!rec) return match.replace(/\{\{\s*media\s*:\s*\d+\s*}}/i, '').replace(/src=["'][^"']+["']/, 'src="" data-media-missing="1" data-media-id="'+id+'"');
                    const f = rec.fields || {};
                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                    const url = f.url || (attachment && attachment.url) || '';
                    const caption = f.caption || f.description || '';
                    let altMatch = match.match(/alt=["']([^"']*)["']/i);
                    const altText = altMatch ? altMatch[1] : (caption || ('Media '+id));
                    return `<img src="${url}" alt="${altText.replace(/"/g,'&quot;')}" data-media-id="${id}" class="help-media-image" />` + (caption ? `<div class="help-media-caption" data-media-id="${id}">${caption}</div>` : '');
                });
                html = html.replace(A_TAG_RE, (match, id, inner) => {
                    const rec = mediaMap.get(String(id));
                    if (!rec) return match.replace(/\{\{\s*media\s*:\s*\d+\s*}}/i, '#').replace('<a','<a data-media-missing="1" data-media-id="'+id+'"');
                    const f = rec.fields || {};
                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                    const urlRaw = f.url || (attachment && attachment.url) || '';
                    const url = /^https?:\/\//i.test(urlRaw) ? urlRaw : (urlRaw ? 'https://'+urlRaw : '#');
                    return `<a href="${url}" data-media-id="${id}" target="_blank" rel="noopener noreferrer">${inner || url}</a>`;
                });
                html = html.replace(TOKEN_RE, (match, id) => {
                    const rec = mediaMap.get(String(id));
                    if (!rec) return `<span class="media-missing" data-media-id="${id}">[media ${id} missing]</span>`;
                    const f = rec.fields || {};
                    const attachment = Array.isArray(f.attachment) && f.attachment.length ? f.attachment[0] : null;
                    const url = f.url || (attachment && attachment.url) || '';
                    const caption = f.caption || f.description || '';
                    return `<figure class="help-media" data-media-id="${id}"><img src="${url}" alt="${(caption||('Media '+id)).replace(/"/g,'&quot;')}" />${caption?`<figcaption>${caption}</figcaption>`:''}</figure>`;
                });
                // Bare domain autolink
                html = html.replace(/(?<![\w@])(https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(\/[\w\-._~:\/?#[\]@!$&'()*+,;=%]*)?(?=\s|<|$)/gi, (m, proto, domain, path) => {
                    if (/href=/.test(m)) return m;
                    const url = (proto? proto : 'https://') + domain + (path||'');
                    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${domain}${path||''}</a>`;
                });
                preservedBodyHtml = html;
            } catch (e) {
                moduleLogger.warn('[HelpTopic] Failed to resolve media placeholders in HTML', e.message);
            }
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
                // Normalize URL like context endpoint: ensure protocol for links and attachments
                const urlRaw = mf.url || (attachment && attachment.url) || '';
                const normalizedUrl = urlRaw ? (/^https?:\/\//i.test(urlRaw) ? urlRaw : `https://${urlRaw}`) : null;
                const resolved = {
                    media_id: mf.media_id,
                    type: (mf.type || (kind === 'link' ? 'link' : (attachment ? 'image' : 'unknown'))),
                    url: normalizedUrl,
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
            // Provide both plain text (via blocks) and HTML when available so the UI can choose.
            ...(preservedBodyHtml ? { bodyHtml: preservedBodyHtml, bodyFormat: 'html' } : {}),
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
        moduleLogger.error('Help topic endpoint error', e);
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
    let rawBody = (f.monologue_context || f.body || f.content || '').toString();
    rawBody = rawBody.replace(/^(?:#+\s*)?Monologue\b[^\n]*\n?/i, '');
    function htmlToTextQA(html) {
        if (!html) return '';
        let out = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
        out = out.replace(/<(?:p|div|section|h[1-6]|li|ul|ol|blockquote|pre|br)[^>]*>/gi, m => { if (/^<li/i.test(m)) return '\n- '; if(/^<br/i.test(m)) return '\n'; return '\n'; });
        out = out.replace(/<\/(?:p|div|section|h[1-6]|li|ul|ol|blockquote|pre)>/gi,'\n');
        out = out.replace(/<img[^>]*>/gi, tag => { const alt = (tag.match(/alt=["']([^"']*)["']/i)||[])[1]; return alt ? ` ${alt} ` : ' [image] '; });
        out = out.replace(/<[^>]+>/g,'');
        out = out.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
        out = out.split('\n').map(l=>l.trim()).filter(Boolean).join('\n');
        return out.trim();
    }
    if (/<[a-z][\s\S]*>/i.test(rawBody) && rawBody.includes('</')) rawBody = htmlToTextQA(rawBody);

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
                moduleLogger.warn('[helpQA] Related topics fetch failed', relErr.message);
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
                moduleLogger.warn('[helpQA] Global help search failed', gErr.message);
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
                        } catch (fbErr) { moduleLogger.warn('[helpQA] Ungrounded fallback failed', fbErr.message); }
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
                moduleLogger.warn('[helpQA] LLM escalation failed, falling back to retrieval result if any', llmErr.message);
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
        moduleLogger.error('QA endpoint error', e);
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

// --- Option B: Embedding-based QA (no citations, simplified UX) ---
app.post('/api/help/qa-embed', express.json(), async (req, res) => {
    const started = Date.now();
    try {
        const { question, topicId } = req.body || {};
        if (!question) return res.status(400).json({ error: 'MISSING_QUESTION' });
        const helpBase = getHelpBase();
        if (!helpBase) return res.status(500).json({ error: 'HELP_BASE_UNRESOLVED' });
        if (!openaiClient) return res.status(500).json({ error: 'OPENAI_CLIENT_MISSING' });

        // 1. Ensure embedding index
        const { ensureIndex, search } = require('./helpEmbeddingIndex');
        await ensureIndex(helpBase, { openaiClient });

        // 2. Embed question
        const embedModel = process.env.HELP_EMBED_MODEL || 'text-embedding-3-small';
        const qEmbedResp = await openaiClient.embeddings.create({ model: embedModel, input: question });
        const qEmbedding = qEmbedResp.data[0].embedding;

        // 3. Search
    const results = search(qEmbedding, { topK: 7, topicId });
        const contextBlocks = results.map((r, i) => `Block ${i+1} (score ${(r.score).toFixed(3)}):\n${r.c.text}`).join('\n\n');

        // 4. Detect Linked Helper intent
        const lowerQ = question.toLowerCase();
        const lhIntent = /linked\s*helper|lh\b|campaign/.test(lowerQ);
        const enumerative = /list|all\b|every\b|what are the (possible|available) options|actions|steps|types/.test(lowerQ);

        // 5. Build prompt (no citations, instruct clarity)
    let system = 'You are a helpful assistant. Provide a clear, direct answer. If the context contains the answer, use it. If something is missing but you know it from general Linked Helper knowledge and the user is asking about Linked Helper, you may add it. If you are unsure, briefly state what is missing.';
        if (!lhIntent) {
            system = 'You are a helpful assistant. Use ONLY the context below. If the answer is not clearly there, say you do not have enough information.';
        }
        let baselineSection = '';
        if (lhIntent && enumerative) {
            try {
                const baseline = require('./helpEnumerationsBaseline.json');
                const lh = baseline.linkedHelper || {};
                if (lh.campaignTemplates && lh.workflowActions) {
                    const templateList = lh.campaignTemplates.map(t => `- ${t}`).join('\n');
                    const actionList = lh.workflowActions.map(a => `- ${a.name}: ${a.desc}`).join('\n');
                    const supportList = (lh.supportActions||[]).map(a => `- ${a.name}: ${a.desc}`).join('\n');
                    const categorySummary = (lh.categories||[]).map(c => `- ${c.name}: ${c.includes.join(', ')}`).join('\n');
                    baselineSection = `\nBaseline Templates:\n${templateList}\n\nBaseline Actions:\n${actionList}\n\nSupport Actions:\n${supportList}\n\nCategories:\n${categorySummary}`;
                }
            } catch (e) {
                moduleLogger.warn('[qa-embed] baseline load failed', e.message);
            }
        }

    const userPrompt = `User Question:\n${question}\n\nContext Blocks (retrieved):\n${contextBlocks || '(none)'}\n\nBaseline (for completeness – you may reorganize naturally):${baselineSection || '\n(none)'}\n\nInstructions (light):\n- Give a friendly one-line intro.\n- Group logically (e.g. Templates, Core Actions, Support / Utility, Categories). Order is flexible.\n- It's OK if an item appears in more than one conceptual group when it helps clarity, but prefer minimal redundancy.\n- Bullet format: **Name** – short purpose (<= 14 words).\n- If categories are present, you may include a compact category summary line or table.\n- End with: Ask if you want setup steps for any item.\n- No citations / IDs.`;

        // 6. LLM call
        const chat = await openaiClient.chat.completions.create({
            model: process.env.HELP_QA_LLM_MODEL || 'gpt-4o-mini',
            temperature: 0.55,
            max_tokens: 700,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: userPrompt }
            ]
        });
        let refinedAnswer = chat.choices?.[0]?.message?.content?.trim() || '';

        // Per-section (not cross-section) dedup only
        function perSectionDedup(ans) {
            const lines = ans.split(/\r?\n/);
            let current = null;
            const seenPer = {}; // section -> Set
            const out = [];
            for (const line of lines) {
                const sec = line.match(/^####\s+(.+)/);
                if (sec) {
                    current = sec[1].trim();
                    if (!seenPer[current]) seenPer[current] = new Set();
                    out.push(line);
                    continue;
                }
                const bullet = line.match(/^\s*[-*]\s+(.*)$/);
                if (bullet && current) {
                    const raw = bullet[1].trim();
                    const key = raw.split(/\s[–—-]|:/)[0].toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
                    if (key && seenPer[current].has(key)) {
                        continue; // skip duplicate within this section
                    }
                    if (key) seenPer[current].add(key);
                    out.push(line);
                } else {
                    out.push(line);
                }
            }
            return out.join('\n');
        }
        refinedAnswer = perSectionDedup(refinedAnswer);

        // --- Option 3: Guaranteed summary block ---
        function extractSections(ans) {
            const sectionRegex = /^####\s+(.+)/;
            const lines = ans.split(/\r?\n/);
            const sections = {};
            let current = null;
            for (const l of lines) {
                const m = l.match(sectionRegex);
                if (m) { current = m[1].trim(); sections[current] = sections[current] || { bullets: [] }; continue; }
                if (current && /^\s*[-*]\s+/.test(l)) {
                    const item = l.replace(/^\s*[-*]\s+/, '').trim();
                    sections[current].bullets.push(item);
                }
            }
            return sections;
        }
    // Removed 'At a Glance' summary block (user feedback: low value)
    const sections = extractSections(refinedAnswer);
    // Remove empty section headings (those with no bullets)
    function pruneEmptySections(ans, sections) {
        const empty = Object.entries(sections).filter(([k,v]) => !v.bullets.length).map(([k])=>k);
        if (!empty.length) return ans;
        let text = ans;
        for (const name of empty) {
            const pattern = new RegExp(`^####\\s+${name.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')}\\s*$(?:\\r?\\n)?`, 'm');
            text = text.replace(pattern, '');
        }
        return text.replace(/\n{3,}/g,'\n\n').trim();
    }
    let finalAnswer = pruneEmptySections(refinedAnswer, sections);
        // Ensure trailing invitation line present exactly once.
        if (!/Ask if you want setup steps for any item\.?$/i.test(finalAnswer.trim())) {
            finalAnswer = finalAnswer.replace(/Ask if you want setup steps for any item\.?/gi, '').trim() + '\n\nAsk if you want setup steps for any item.';
        }

        res.json({
            answer: finalAnswer,
            answerDraft: refinedAnswer, // single-pass now
            answerRefined: refinedAnswer,
            method: 'embedding-qa',
            meta: {
                generationMs: Date.now() - started,
                secondPassUsed: false,
                duplicatesRemoved: null,
                blocksUsed: results.length,
                lhIntent,
                enumerative,
                model: process.env.HELP_QA_LLM_MODEL || 'gpt-4o-mini',
                summaryAdded: false
            }
        });
    } catch (e) {
        moduleLogger.error('[qa-embed] error', e);
        res.status(500).json({ error: 'EMBED_QA_ERROR', message: e.message });
    }
});

// --- Admin: Reindex ALL help search structures (global + embedding) ---
app.post('/admin/help/reindex-all', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
        return res.status(401).json({ ok:false, error:'Unauthorized' });
    }
    try {
        const helpBaseInst = getHelpBase();
        if (!helpBaseInst) return res.status(500).json({ ok:false, error:'HELP_BASE_UNRESOLVED' });
        const globalIdx = require('./helpGlobalIndex');
        const embedIdx = require('./helpEmbeddingIndex');
        globalIdx.reset();
        embedIdx.reset();
        // Trigger rebuilds (embedding requires openaiClient)
        const globalEnsure = await globalIdx.ensureIndex(helpBaseInst, { force:true });
        let embedEnsure = null;
        if (openaiClient) {
            embedEnsure = await embedIdx.ensureIndex(helpBaseInst, { openaiClient });
        }
        res.json({ ok:true, global: globalIdx.status(), embedding: embedIdx.status(), ensure: { globalEnsure, embedReady: !!embedEnsure } });
    } catch (e) {
        res.status(500).json({ ok:false, error:e.message });
    }
});