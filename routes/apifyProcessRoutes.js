// routes/apifyProcessRoutes.js
// Process a client's leads in batches until Posts Daily Target is met

const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/contextLogger');

// Create module-level logger for apify process routes
const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'apify-process-routes' 
});
// Old error logger removed - now using Render log analysis
const logCriticalError = async () => {}; // No-op
const Airtable = require('airtable');
const { getClientBase, createBaseInstance } = require('../config/airtableClient');
const clientService = require('../services/clientService');
const { getClientById } = clientService;
const { JobTracking, appendToProgressLog, getAESTTime } = require('../services/jobTracking');
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger, getLoggerFromOptions } = require('../utils/loggerHelper');
const { getFetch } = require('../utils/safeFetch');
const fetch = getFetch();

// Helper function for logging route errors to Airtable
async function logRouteError(error, req = null, additionalContext = {}) {
  try {
    // Handle both route mode (has req) and background mode (no req)
    const endpoint = req ? `${req.method || 'POST'} ${req.path || req.url || 'unknown'}` : 'background-job';
    const clientId = additionalContext.clientId || req?.headers?.['x-client-id'] || req?.query?.clientId || req?.body?.clientId || null;
    const runId = additionalContext.runId || req?.query?.runId || req?.body?.runId || null;
    
    await logCriticalError(error, {
      endpoint,
      clientId,
      runId,
      requestBody: req?.body || null,
      queryParams: req?.query || null,
      ...additionalContext
    });
  } catch (loggingError) {
    logger.error('Failed to log route error to Airtable:', loggingError.message);
  }
}

// Import field constants
const { 
  APIFY_RUN_ID,
  CLIENT_RUN_FIELDS,
  LEAD_FIELDS
} = require('../constants/airtableUnifiedConstants');
const runIdUtils = require('../utils/runIdUtils');
// Use canonical run ID system
const runIdSystem = require('../services/runIdSystem');
// Import run ID generator
const { generateRunId } = runIdSystem;
// SIMPLIFIED: Use the adapter that enforces the Simple Creation Point pattern
const runRecordService = require('../services/runRecordAdapterSimple');
// Import airtableService for direct access to the Master base
const airtableService = require('../services/airtableService');

// Check if we're in batch process testing mode
const TESTING_MODE = process.env.FIRE_AND_FORGET_BATCH_PROCESS_TESTING === 'true';
// Check if we should ignore post harvesting limits
const IGNORE_POST_HARVESTING_LIMITS = process.env.IGNORE_POST_HARVESTING_LIMITS === 'true';
// Check if we should use relaxed selection criteria (useful for debugging)
const RELAXED_LEAD_SELECTION = process.env.RELAXED_LEAD_SELECTION === 'true';

const LEADS_TABLE = 'Leads';
const LINKEDIN_URL_FIELD = 'LinkedIn Profile URL';
const STATUS_FIELD = 'Posts Harvest Status';
const LAST_CHECK_AT_FIELD = 'Last Post Check At';
const FOUND_LAST_RUN_FIELD = 'Posts Found (Last Run)';
const RUN_ID_FIELD = 'Posts Harvest Run ID';
const POSTS_ACTIONED_FIELD = 'Posts Actioned';
const DATE_POSTS_SCORED_FIELD = 'Date Posts Scored';
const DATE_CREATED_FIELD = LEAD_FIELDS.DATE_CREATED; // Use constant instead of hardcoded 'Created Time'

// Helper to format ISO now
const nowISO = () => new Date().toISOString();

// Pick a batch of leads:
// - Pending (or blank)
// - Processing older than 30 minutes
// Permanently skip any with status 'No Posts'
async function pickLeadBatch(base, batchSize) {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  
  logger.info(`🔍 LEAD_SELECTION_START: Starting to pick leads batch of size ${batchSize}`);
  
  // Query Airtable to get counts of leads matching different criteria
  try {
    logger.info(`🔍 LEAD_SELECTION_DIAG: Running diagnostic counts on lead criteria...`);
    
    // Remove field name detection since we're not using id field anymore
    
    // Check LinkedIn URL field presence
    const urlRecords = await base(LEADS_TABLE).select({
      filterByFormula: `{${LINKEDIN_URL_FIELD}} != ''`,
      // Don't request any fields - we only need count
      maxRecords: 1
    }).firstPage();
    logger.info(`🔍 LEAD_SELECTION_DIAG: Leads with LinkedIn URLs: ${urlRecords.length ? 'YES' : 'NONE'}`);
    
    // Check status field values
    const statusesByValue = {};
    ['Pending', '', 'Processing', 'No Posts', 'Complete'].forEach(async (status) => {
      try {
        let filter = status === '' 
          ? `OR({${STATUS_FIELD}} = '', {${STATUS_FIELD}} = BLANK())`
          : `{${STATUS_FIELD}} = '${status}'`;
        
        const statusRecords = await base(LEADS_TABLE).select({
          filterByFormula: filter,
          // No fields needed for count
          maxRecords: 100
        }).firstPage();
        
        logger.info(`🔍 LEAD_SELECTION_DIAG: Leads with status '${status || 'BLANK'}': ${statusRecords.length}`);
        statusesByValue[status || 'BLANK'] = statusRecords.length;
      } catch (err) {
        logger.info(`🔍 LEAD_SELECTION_DIAG: Error checking status '${status}': ${err.message}`);
    logCriticalError(err, { operation: 'unknown', isSearch: true }).catch(() => {});
      }
    });
    
    // Check Posts Actioned field
    const actionedRecords = await base(LEADS_TABLE).select({
      filterByFormula: `OR({${POSTS_ACTIONED_FIELD}} = 0, {${POSTS_ACTIONED_FIELD}} = '', {${POSTS_ACTIONED_FIELD}} = BLANK())`,
      // No fields needed for count
      maxRecords: 1
    }).firstPage();
    logger.info(`🔍 LEAD_SELECTION_DIAG: Leads with Posts Actioned empty/0: ${actionedRecords.length ? 'YES' : 'NONE'}`);
    
    // Check Date Posts Scored field
    const scoredRecords = await base(LEADS_TABLE).select({
      filterByFormula: `{${DATE_POSTS_SCORED_FIELD}} = BLANK()`,
      // No fields needed for count
      maxRecords: 1
    }).firstPage();
    logger.info(`🔍 LEAD_SELECTION_DIAG: Leads not yet scored (Date Posts Scored empty): ${scoredRecords.length ? 'YES' : 'NONE'}`);
  } catch (err) {
    logger.info(`🔍 LEAD_SELECTION_DIAG: Error running diagnostics: ${err.message}`);
    logCriticalError(err, { operation: 'unknown', isSearch: true }).catch(() => {});
  }
  
  let formula;
  
  // Regular strict criteria
  // Align with selection criteria: has URL, not actioned, not already post-scored, and eligible harvest status
  formula = `AND({${LINKEDIN_URL_FIELD}} != '',
    OR(
      {${STATUS_FIELD}} = 'Pending',
      {${STATUS_FIELD}} = '',
      LEN({${STATUS_FIELD}}) = 0,
      AND({${STATUS_FIELD}} = 'Processing', {${LAST_CHECK_AT_FIELD}} < '${thirtyMinAgo}')
    ),
    {${STATUS_FIELD}} != 'No Posts',
    OR({${POSTS_ACTIONED_FIELD}} = 0, {${POSTS_ACTIONED_FIELD}} = '', {${POSTS_ACTIONED_FIELD}} = BLANK()),
    {${DATE_POSTS_SCORED_FIELD}} = BLANK()
  )`;
  
  logger.info(`🔍 LEAD_SELECTION_FORMULA: ${formula.replace(/\n\s+/g, ' ')}`);
  
  // Prefer sorting by most recently created leads first. If the Date Created field
  // does not exist on a tenant base, gracefully fall back to no explicit sort.
  const selectOptions = {
    filterByFormula: formula,
    maxRecords: batchSize,
    fields: [LINKEDIN_URL_FIELD, STATUS_FIELD, DATE_CREATED_FIELD],
    sort: [{ field: DATE_CREATED_FIELD, direction: 'desc' }]
  };
  let records;
  try {
    records = await base(LEADS_TABLE).select(selectOptions).firstPage();
    return records;
  } catch (e) {
    // Log the error
    logCriticalError(e, { operation: 'search_leads_with_sort_fallback', isSearch: true }).catch(() => {});
    
    // Fallback without sort (e.g., if Date Created field is missing)
    const fallbackOptions = {
      filterByFormula: formula,
      maxRecords: batchSize,
      fields: [LINKEDIN_URL_FIELD, STATUS_FIELD]
    };
    records = await base(LEADS_TABLE).select(fallbackOptions).firstPage();
    return records;
  }
}

// Compute today's posts from leads table
async function computeTodaysPosts(base) {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(today.getUTCDate()).padStart(2, '0');
  const dayStart = `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
  const dayEnd = `${yyyy}-${mm}-${dd}T23:59:59.999Z`;
  const formula = `AND({${LAST_CHECK_AT_FIELD}} >= '${dayStart}', {${LAST_CHECK_AT_FIELD}} <= '${dayEnd}')`;
  const records = await base(LEADS_TABLE).select({
    filterByFormula: formula,
    fields: [FOUND_LAST_RUN_FIELD, LAST_CHECK_AT_FIELD]
  }).all();
  let sum = 0;
  for (const r of records) {
    const n = Number(r.get(FOUND_LAST_RUN_FIELD) || 0);
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

// POST /api/apify/process-client
// Headers: Authorization: Bearer PB_WEBHOOK_SECRET, x-client-id: <clientId>
// Body: { maxBatchesOverride?: number } optional
router.post('/api/apify/process-client', processClientHandler);

// POST /api/smart-resume/process-client - Clearer name for the same functionality
// Headers: Authorization: Bearer PB_WEBHOOK_SECRET, x-client-id: <clientId>
// Body: { maxBatchesOverride?: number } optional
router.post('/api/smart-resume/process-client', processClientHandler);

/**
 * POST /api/apify/process-level2-v2 - Fire-and-forget endpoint for post harvesting in client-by-client processing
 * 
 * This endpoint implements the fire-and-forget pattern for post harvesting. It returns a 202 Accepted
 * response immediately while continuing to process in the background. This is critical for the
 * client-by-client processing flow to avoid timeouts during lengthy operations.
 * 
 * Headers:
 *   - Authorization: Bearer PB_WEBHOOK_SECRET (required)
 *   - x-client-id: <clientId> (required if not in query params)
 * 
 * Query parameters: 
 *   - stream: Stream ID from the client-by-client process (for tracking)
 *   - clientId: Client ID (can also be passed in header)
 *   - parentRunId: Parent run ID for tracking execution flow
 *   - limit: Maximum number of leads to process (optional)
 * 
 * Body: 
 *   { 
 *     maxBatchesOverride?: number,  // Optional override for max batches
 *     clientId?: string,            // Alternative to header/query
 *     parentRunId?: string          // Alternative to query param
 *   }
 * 
 * Response: 202 Accepted with { ok: true, message: 'Post harvesting initiated', ... }
 * 
 * See POST-HARVESTING-ENDPOINT-DOCUMENTATION.md for more details
 */
router.post('/api/apify/process-level2-v2', async (req, res) => {
  // Enhanced logging to track execution
  logger.info(`[process-level2-v2] ENTRY POINT: New request received at ${new Date().toISOString()}`);
  logger.info(`[process-level2-v2] Headers: ${JSON.stringify(Object.keys(req.headers))}`);
  logger.info(`[process-level2-v2] Query params: ${JSON.stringify(req.query)}`);
  logger.info(`[process-level2-v2] Body params: ${JSON.stringify(req.body || {})}`);
  
  // Detailed debugging for clientId identification
  logger.info(`[process-level2-v2] COMPARISON DEBUG: clientId sources:`);
  logger.info(`[process-level2-v2] - From x-client-id header: ${req.headers['x-client-id'] || 'missing'}`);
  logger.info(`[process-level2-v2] - From query.client: ${req.query.client || 'missing'}`);
  logger.info(`[process-level2-v2] - From query.clientId: ${req.query.clientId || 'missing'}`);
  logger.info(`[process-level2-v2] - From body.clientId: ${req.body?.clientId || 'missing'}`);
  logger.info(`[process-level2-v2] - From body.client: ${req.body?.client || 'missing'}`);
  logger.info(`[process-level2-v2] - From stream: ${req.query.stream || 'missing'}`);
  logger.info(`[process-level2-v2] - Authorization present: ${!!req.headers['authorization']}`);
  
  // Compare with values expected in the processClientHandler
  const clientIdForHandler = req.headers['x-client-id'] || req.query.client || req.query.clientId || (req.body && (req.body.clientId || req.body.client));
  logger.info(`[process-level2-v2] - Effective clientId for handler: ${clientIdForHandler || 'missing'}`);
  
  // Log full request structure for complete debugging
  try {
    const requestStructure = {
      url: req.url,
      method: req.method,
      headers: req.headers,
      query: req.query,
      body: req.body || {},
      params: req.params || {}
    };
    logger.info(`[process-level2-v2] 🔍 FULL REQUEST: ${JSON.stringify(requestStructure, null, 2).substring(0, 1000)}...`);
  } catch (e) {
    logger.info(`[process-level2-v2] Could not stringify full request: ${e.message}`);
    logCriticalError(e, { operation: 'unknown', isSearch: true, clientId: clientId }).catch(() => {});
  }
  
  
  // Validate auth first
  const auth = req.headers['authorization'];
  const secret = process.env.PB_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('[process-level2-v2] Server missing PB_WEBHOOK_SECRET');
    return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
  }
  if (!auth || auth !== `Bearer ${secret}`) {
    logger.error('[process-level2-v2] Unauthorized request');
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Get client ID from header, query param or body
  const clientId = req.headers['x-client-id'] || req.query.clientId || (req.body && req.body.clientId);
  if (!clientId) {
    logger.error('[process-level2-v2] Missing clientId');
    return res.status(400).json({ ok: false, error: 'Missing clientId parameter' });
  }

  const stream = req.query.stream || 'default';
  // Changed from const to let to allow reassignment if needed
  let parentRunId = req.query.parentRunId || (req.body && req.body.parentRunId) || '';
  
  logger.info(`[process-level2-v2] Received post harvesting request for client ${clientId}, stream ${stream}, parentRunId: ${parentRunId || 'none'}`);
  
  // Acknowledge the request immediately (fire-and-forget pattern)
  res.status(202).json({ 
    ok: true, 
    message: 'Post harvesting initiated', 
    accepted: true, 
    stream,
    clientId
  });
  
  logger.info(`[process-level2-v2] ✅ Request acknowledged, starting background processing for client ${clientId}`);
  
  // Clone the request object and attach some tracking data
  // Create a deeper clone that preserves important objects like headers
  const reqClone = {
    ...req,
    method: req.method || 'POST',
    path: req.path || req.url || '/api/apify/process-level2-v2',
    url: req.url || '/api/apify/process-level2-v2',
    headers: {...req.headers},
    query: {...req.query},
    body: req.body ? {...req.body} : undefined
  };
  
  // Explicitly ensure clientId is preserved in multiple locations
  if (clientId) {
    reqClone.headers['x-client-id'] = clientId;
    reqClone.query.clientId = clientId;
  }
  
  reqClone.processingMetadata = {
    startTime: Date.now(),
    endpoint: 'process-level2-v2',
    stream,
    parentRunId
  };
  
  logger.info(`[process-level2-v2] DEBUG CLONE: Cloned request object with clientId=${clientId}`);
  logger.info(`[process-level2-v2] DEBUG CLONE: Cloned headers x-client-id=${reqClone.headers['x-client-id']}`);
  logger.info(`[process-level2-v2] DEBUG CLONE: Cloned query clientId=${reqClone.query.clientId}`);
  
  
  // Process in the background
  processClientHandler(reqClone, null).catch(err => {
    logger.error(`[process-level2-v2] Background processing error for client ${clientId}:`, err.message);
    logger.error(`[process-level2-v2] Error stack: ${err.stack}`);
  });
});

/**
 * Shared handler function for processing client post harvesting requests
 * 
 * This function is used by both the synchronous and fire-and-forget endpoints:
 * - /api/apify/process-client (synchronous)
 * - /api/smart-resume/process-client (synchronous)
 * - /api/apify/process-level2-v2 (fire-and-forget)
 * 
 * When res is null, the function runs in fire-and-forget mode and won't
 * attempt to send HTTP responses, instead throwing errors or returning 
 * payload objects directly.
 * 
 * @param {Object} req - Express request object or equivalent
 * @param {Object|null} res - Express response object or null for fire-and-forget mode
 * @returns {Promise<Object|void>} - Returns response payload or void
 * @throws {Error} - In fire-and-forget mode, throws errors instead of sending HTTP error responses
 */
async function processClientHandler(req, res) {
  // Define variables at the top level so they're available in all scopes
  let runIdToUse;
  let startData = {};
  let postsToday = 0;
  let postsTarget = 0;
  let batches = 0;
  let runs = [];
  let debugBatches = [];
  let targetUrls = [];
  let debugMode = false;
  let clientId = '';
  let batchSize = 0;
  let maxBatches = 0;
  
  try {
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    
    if (!secret) {
      logger.error('[processClientHandler] Server missing PB_WEBHOOK_SECRET');
      if (res) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
      throw new Error('Server missing PB_WEBHOOK_SECRET');
    }
    
    if (!auth || auth !== `Bearer ${secret}`) {
      logger.error('[processClientHandler] Unauthorized request');
      if (res) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      throw new Error('Unauthorized');
    }

    // Get client ID from header, query param or body
    clientId = req.headers['x-client-id'] || req.query.client || req.query.clientId || (req.body && (req.body.clientId || req.body.client));
    
    // If no client ID specified, check if this is an all-clients batch processing request
    const processAllClients = !clientId && (req.query.processAll === 'true' || (req.body && req.body.processAll === true));
    
    if (!clientId && !processAllClients) {
      // For backward compatibility, require client ID if not explicitly processing all clients
      const errMsg = 'Missing client identifier. Use x-client-id header, client query param, or add ?processAll=true to process all clients';
      logger.error(`[processClientHandler] ${errMsg}`);
      
      if (res) {
        return res.status(400).json({ ok: false, error: errMsg });
      }
      throw new Error(errMsg);
    }

    // Get parent run ID and client-specific run ID from query params or body (if provided)
    // parentRunId: Master run ID (e.g., "251006-225513") - IMMUTABLE, never modified
    // clientRunId: Client-specific run ID (e.g., "251006-225513-Guy-Wilson") - created by smart-resume
    const parentRunId = req.query.parentRunId || (req.body && req.body.parentRunId);
    const clientRunId = req.query.clientRunId || (req.body && req.body.clientRunId);
    
    // Add debug logs to identify the issue
    logger.info(`[processClientHandler] DEBUG: req.path = ${req.path}`);
    logger.info(`[processClientHandler] DEBUG: req.url = ${req.url}`);
    
    // Fix: Add null check before calling includes
    // FIXED: Changed const to let to prevent "Assignment to constant variable" errors
    let endpoint = req.path && req.path.includes('smart-resume') ? 'smart-resume' : 'apify';
    logger.info(`[processClientHandler] DEBUG: Using endpoint = ${endpoint}`);

    // Process all clients if requested
    if (processAllClients) {
      logger.info(`[${endpoint}/process-client] Processing all clients`);
      
      // Get all active clients
      let clients = await getAllClients();
      if (!clients || !clients.length) {
        logger.error(`[${endpoint}/process-client] No clients found`);
        if (res) return res.status(404).json({ ok: false, error: 'No clients found' });
        throw new Error('No clients found');
      }
      
      logger.info(`[${endpoint}/process-client] Found ${clients.length} clients to process`);
      
      // Start processing - respond immediately to avoid timeout
      if (res) {
        res.json({ 
          ok: true, 
          message: `Processing ${clients.length} clients in the background`, 
          clientCount: clients.length 
        });
        
        // Process each client asynchronously (in the background)
        processAllClientsInBackground(clients, req.path, parentRunId);
        
        return; // Already sent response
      } else {
        logger.info(`[${endpoint}/process-client] Background processing of ${clients.length} clients`);
        // When in fire-and-forget mode, just throw since we can't process all clients
        throw new Error('Process all clients not supported in fire-and-forget mode');
      }
    }

    // Single client processing
    let client = await getClientById(clientId);
    logger.info(`[${endpoint}/process-client] Processing client: ${clientId}`);
    if (!client) {
      logger.info(`[${endpoint}/process-client] Client not found: ${clientId}`);
      if (res) return res.status(404).json({ ok: false, error: 'Client not found' });
      throw new Error(`Client not found: ${clientId}`);
    }
    logger.info(`[${endpoint}/process-client] Client found: ${client.clientName}, status: ${client.status}, postAccessEnabled: ${client.postAccessEnabled}`);
    
    // Skip inactive clients and post access check UNLESS we're in testing mode
    if (!TESTING_MODE) {
      if (client.status !== 'Active') {
        logger.info(`[apify/process-client] Client ${clientId} not Active, skipping`);
        if (res) return res.status(200).json({ ok: true, skipped: true, reason: 'Client not Active' });
        throw new Error(`Client ${clientId} not Active, skipping`);
      }
      // Check postAccessEnabled field - only "Yes" allows post harvesting
      if (!client.postAccessEnabled) {
        logger.info(`[apify/process-client] Client ${clientId} post access not enabled, skipping`);
        
        // Log to Progress Log if we have a clientRunId (means this is part of an orchestrated run)
        if (clientRunId) {
          try {
            await appendToProgressLog(parentRunId, clientId, `[${getAESTTime()}] 🚀 Post Harvesting: Started`);
            await appendToProgressLog(parentRunId, clientId, `[${getAESTTime()}] ⏭️ Post Harvesting: Client not eligible (Post Access Enabled: No)`);
            await appendToProgressLog(parentRunId, clientId, `[${getAESTTime()}] ✅ Post Harvesting: Skipped`);
          } catch (logError) {
            logger.error(`[apify/process-client] Failed to log eligibility skip to Progress Log: ${logError.message}`);
          }
        }
        
        if (res) return res.status(200).json({ ok: true, skipped: true, reason: 'Post access not enabled' });
        throw new Error(`Client ${clientId} post access not enabled, skipping`);
      }
    } else {
      logger.info(`[apify/process-client] 🧪 TESTING MODE - Bypassing active status and post access checks`);
    }

    // In testing mode, use small fixed limits; otherwise use client configuration
    if (TESTING_MODE) {
      // Use limited values for testing
      postsTarget = 5; // Target 5 posts total
      batchSize = 5;   // Process 5 profiles at a time
      maxBatches = 1;  // Run only 1 batch
      logger.info(`[apify/process-client] 🧪 TESTING MODE - Using limited batch settings: postsTarget=${postsTarget}, batchSize=${batchSize}, maxBatches=${maxBatches}`);
    } else {
      // Use normal client settings
      postsTarget = Number(client.postsDailyTarget || 0);
      batchSize = Number(client.leadsBatchSizeForPostCollection || 20);
      maxBatches = Number(req.body?.maxBatchesOverride ?? client.maxPostBatchesPerDayGuardrail ?? 10);
      logger.info(`[apify/process-client] Client ${clientId} targets: postsTarget=${postsTarget}, batchSize=${batchSize}, maxBatches=${maxBatches}`);
      
      if (!postsTarget || !batchSize) {
        logger.info(`[apify/process-client] Client ${clientId} missing targets, skipping`);
        return res.status(200).json({ ok: true, skipped: true, reason: 'Missing targets' });
      }
    }

    let base = await getClientBase(clientId);

    // running tally
    postsToday = await computeTodaysPosts(base);
    logger.info(`[apify/process-client] Client ${clientId} postsToday: ${postsToday}, target: ${postsTarget}`);
    
    // Log "Started" to Progress Log if we have a clientRunId (orchestrated run)
    if (clientRunId) {
      try {
        await appendToProgressLog(parentRunId, clientId, `[${getAESTTime()}] 🚀 Post Harvesting: Started`);
      } catch (logError) {
        logger.error(`[apify/process-client] Failed to log start to Progress Log: ${logError.message}`);
      }
    }
    
    batches = 0;
    
    // Set debug mode
    debugMode = req.query?.debug === '1' || req.body?.debug === true;

    while ((IGNORE_POST_HARVESTING_LIMITS || postsToday < postsTarget) && batches < maxBatches) {
      logger.info(`[apify/process-client] Client ${clientId} batch ${batches + 1}: picking ${batchSize} leads`);
      
      // Enhanced debugging for post harvesting
      logger.info(`🔍 POST_HARVEST_LEADS: About to select eligible leads for client ${clientId}`);
      
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      logger.info(`🔍 POST_HARVEST_CRITERIA: Selection criteria includes:
        - Has LinkedIn Profile URL
        - Status is 'Pending', blank, or 'Processing' but older than ${thirtyMinAgo}
        - Status is not 'No Posts'
        - Posts Actioned is 0, blank, or null
        - Date Posts Scored is blank`);
      
      let pick = await pickLeadBatch(base, batchSize);
      logger.info(`[apify/process-client] Client ${clientId} picked ${pick.length} leads`);
      
      // Detailed inspection of the client's base
      try {
        let clientInfo = await getClientById(clientId);
        logger.info(`🔍 CLIENT_DEBUG: Client ${clientId} info found: ${!!clientInfo}`);
        if (clientInfo) {
          logger.info(`🔍 CLIENT_DEBUG: Client ${clientId} service level: ${clientInfo.serviceLevel}`);
          logger.info(`🔍 CLIENT_DEBUG: Client ${clientId} base ID: ${clientInfo.airtableBaseId}`);
          
          // Query total number of leads in the base for context
          // Remove field name check as we don't need specific fields
          
          const allLeads = await base(LEADS_TABLE).select({
            // No fields needed - just checking if records exist
            maxRecords: 1
          }).firstPage();
          
          logger.info(`🔍 CLIENT_DEBUG: Client ${clientId} has leads in Airtable: ${allLeads.length > 0 ? 'YES' : 'NO'}`);
        }
      } catch (err) {
        logger.info(`🔍 CLIENT_DEBUG: Error getting client info: ${err.message}`);
    logCriticalError(err, { operation: 'unknown', isSearch: true }).catch(() => {});
      }
      
      if (!pick.length) {
        logger.info(`[apify/process-client] Client ${clientId} no more eligible leads, breaking`);
        logger.info(`🔍 POST_HARVEST_LEADS: No eligible leads found for client ${clientId}.`);
        logger.info(`🔍 POST_HARVEST_LEADS: This is likely because:`);
        logger.info(`🔍 POST_HARVEST_LEADS: 1. All leads have already been processed`);
        logger.info(`🔍 POST_HARVEST_LEADS: 2. There are no new leads with LinkedIn URLs`);
        logger.info(`🔍 POST_HARVEST_LEADS: 3. All leads have been marked 'No Posts'`);
        logger.info(`🔍 POST_HARVEST_LEADS: 4. All leads have already had posts scored`);
        
        // Try a quick diagnostic query with minimal criteria
        try {
          // Remove field name check as we don't need to request id field
          
          const anyLeadsWithUrl = await base(LEADS_TABLE).select({
            filterByFormula: `{${LINKEDIN_URL_FIELD}} != ''`,
            fields: [STATUS_FIELD, POSTS_ACTIONED_FIELD, DATE_POSTS_SCORED_FIELD],
            maxRecords: 5
          }).firstPage();
          
          if (anyLeadsWithUrl.length) {
            logger.info(`🔍 DIAGNOSTIC: Found ${anyLeadsWithUrl.length} leads with LinkedIn URLs`);
            for (let i = 0; i < anyLeadsWithUrl.length; i++) {
              const lead = anyLeadsWithUrl[i];
              logger.info(`🔍 DIAGNOSTIC: Lead #${i+1} - Status: ${lead.fields[STATUS_FIELD] || 'EMPTY'}, ` +
                `Posts Actioned: ${lead.fields[POSTS_ACTIONED_FIELD] || 'EMPTY'}, ` +
                `Date Posts Scored: ${lead.fields[DATE_POSTS_SCORED_FIELD] || 'EMPTY'}`);
            }
          } else {
            logger.info(`🔍 DIAGNOSTIC: No leads found with LinkedIn URLs`);
          }
        } catch (err) {
          logger.info(`🔍 DIAGNOSTIC: Error running quick diagnostic: ${err.message}`);
    logCriticalError(err, { operation: 'unknown', isSearch: true }).catch(() => {});
        }
        
        break;
      }
      
      logger.info(`🔍 POST_HARVEST_LEADS: Found ${pick.length} eligible leads for client ${clientId}`);
      // Log the first 3 leads to provide context
      if (pick.length > 0) {
        logger.info(`🔍 POST_HARVEST_LEADS_SAMPLE: Showing details for first ${Math.min(3, pick.length)} leads:`);
        for (let i = 0; i < Math.min(3, pick.length); i++) {
          logger.info(`🔍 POST_HARVEST_LEADS_SAMPLE: Lead #${i+1} - ID: ${pick[i].id}, LinkedIn URL: ${pick[i].fields[LINKEDIN_URL_FIELD] ? 'Present' : 'Missing'}`);
        }
      }

      // Generate a proper run ID using canonical runIdSystem
      const placeholderRunId = runIdSystem.createClientRunId(runIdSystem.generateRunId(), clientId);
      logger.info(`[apify/process-client] Client ${clientId} batch ${batches + 1}: Generated run ID: ${placeholderRunId}`);
      await base(LEADS_TABLE).update(pick.map(r => ({
        id: r.id,
        fields: { [STATUS_FIELD]: 'Processing', [RUN_ID_FIELD]: placeholderRunId, [LAST_CHECK_AT_FIELD]: nowISO() }
      })));

      // prepare targetUrls
      targetUrls = pick.map(r => r.get(LINKEDIN_URL_FIELD)).filter(Boolean);
      logger.info(`[apify/process-client] Client ${clientId} batch ${batches + 1}: ${targetUrls.length} LinkedIn URLs to process`);
      
      if (debugMode) {
        debugBatches.push({ pickedCount: pick.length, targetUrls });
      }

      // call our own /api/apify/run in inline mode so we wait and sync immediately
      const baseUrl = process.env.API_PUBLIC_BASE_URL
        || process.env.NEXT_PUBLIC_API_BASE_URL
        || `http://localhost:${process.env.PORT || 3001}`;
      logger.info(`[apify/process-client] Client ${clientId} calling Apify run at ${baseUrl}/api/apify/run`);
      
      let startResp = await fetch(`${baseUrl}/api/apify/run`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret}`,
          'x-client-id': clientId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          targetUrls,
          mode: 'inline',
          // Allow overriding actor/build to match a proven-good console run
          actorId: process.env.ACTOR_ID || process.env.APIFY_ACTOR_ID || undefined,
          options: {
            // In testing mode, always use 1-2 posts; otherwise use configured values
            maxPosts: TESTING_MODE ? 2 : (Number(process.env.APIFY_MAX_POSTS) || 2),
            // Default to 'year' window to align with testing and reduce stale content
            postedLimit: process.env.APIFY_POSTED_LIMIT || 'year',
            expectsCookies: true,
            build: process.env.APIFY_BUILD || process.env.BUILD || undefined
          }
        })
      });
      startData = await startResp.json().catch(() => ({}));
      logger.info(`[apify/process-client] Client ${clientId} Apify response status: ${startResp.status}, data:`, startData);
      
      // Log detailed information about the startData object for debugging
      logger.info(`[DEBUG][METRICS_TRACKING] Received startData for client ${clientId}:`);
      logger.info(`[DEBUG][METRICS_TRACKING] - runId: ${startData.runId || '(not present)'}`);
      logger.info(`[DEBUG][METRICS_TRACKING] - apifyRunId: ${startData.apifyRunId || '(not present)'}`);
      logger.info(`[DEBUG][METRICS_TRACKING] - actorRunId: ${startData.actorRunId || '(not present)'}`);
      logger.info(`[DEBUG][METRICS_TRACKING] - full data:`, JSON.stringify(startData));

      // after inline run, use returned counts to compute gained
      const gained = Number((startData && startData.counts && startData.counts.posts) || 0);
      logger.info(`[apify/process-client] Client ${clientId} batch ${batches + 1}: gained ${gained} posts`);
      postsToday += gained;

      // Update statuses based on gain
      if (gained > 0) {
        // mark batch Done with counts distributed
        await base(LEADS_TABLE).update(pick.map(r => ({
          id: r.id,
          fields: {
            [STATUS_FIELD]: 'Done',
            [FOUND_LAST_RUN_FIELD]: Math.round(gained / pick.length),
            [LAST_CHECK_AT_FIELD]: nowISO(),
            [RUN_ID_FIELD]: startData.runId || placeholderRunId
          }
        })));
      } else {
        // low-churn permanent: mark as 'No Posts' and never re-pick automatically
        await base(LEADS_TABLE).update(pick.map(r => ({
          id: r.id,
          fields: {
            [STATUS_FIELD]: 'No Posts',
            [LAST_CHECK_AT_FIELD]: nowISO(),
            [RUN_ID_FIELD]: startData.runId || placeholderRunId
          }
        })));
      }

      runs.push({ runId: startData.runId || placeholderRunId, gained, after: postsToday });
      batches++;
    }

    logger.info(`[apify/process-client] Client ${clientId} completed: ${batches} batches, postsToday: ${postsToday}, target: ${postsTarget}`);
    
    // SIMPLIFIED: We must get a parent run ID from Smart Resume - THIS IS THE KEY CHANGE
    // Legacy import - only used for other functions not related to run records
    const airtableService = require('../services/airtableService');
    
    // SIMPLIFIED: We use the parent run ID if provided, otherwise we're in standalone mode and skip metrics
    
    // CLEAN ARCHITECTURE: Single source of truth - smart-resume creates clientRunId, we just use it
    // If clientRunId provided: normal mode (metrics tracked)
    // If no clientRunId: standalone mode (skip all metrics)
    const runIdToUse = clientRunId || null;
    
    // Determine if this is a standalone run (no client run ID means skip all metrics)
    const isStandaloneRun = !clientRunId;
    
    if (!isStandaloneRun) {
      // ARCHITECTURAL FIX: We should ONLY check for existing records, never create them in this route
      try {
        
        // Check if record exists first (runIdToUse already has client suffix)
        const recordExists = await runRecordService.checkRunRecordExists({
          runId: runIdToUse,
          clientId,
          options: {
            source: 'post_harvesting_check',
          }
        });
        
        if (!recordExists) {
          logger.error(`[CRITICAL ERROR] No run record exists for ${runIdToUse} (parent: ${parentRunId}, client: ${clientId}) - cannot process webhook without an existing run record`);
          return res.status(400).json({
            error: 'No active run found for this client',
            message: 'Post harvesting webhooks must be part of an active run with an existing record',
            runId: runIdToUse,
            parentRunId: parentRunId,
            clientId
          });
        }
        
        // Record exists, update it with webhook received status
        await runRecordService.updateRunRecord({
          runId: runIdToUse,
          clientId,
          updates: {
            'System Notes': `Apify webhook received at ${new Date().toISOString()}`
          },
          options: {
            source: 'post_harvesting_webhook',
          },
          date: new Date().toISOString()
        });
      } catch (createError) {
        await logRouteError(createError, req).catch(() => {});
        // Continue processing even if run record creation fails
      }
    }
    
    // Use the parent run ID from Smart Resume
    // NOTE: runIdToUse (client-specific) is already set above - this comment preserved for context
    
    // NOTE: We no longer create a run record here. The Smart Resume process (parent)
    // is responsible for creating the run record, and we just update it.
    // This ensures all metrics (lead scoring, post harvesting, post scoring)
    // accumulate in the same record in the Client Run Results table.
    
    // Update client run record with post harvest metrics
    try {      
      // Calculate estimated API costs (based on LinkedIn post queries)
      const estimatedCost = (postsToday * 0.02); // $0.02 per post as estimate - send as number, not string
      
        
      // Get the client run record to check existing values
      try {
        
        // Check client exists before trying to get base
        const client = await clientService.getClientById(clientId);
        if (!client || !client.airtableBaseId) {
          throw new Error(`Client ${clientId} not found or has no associated Airtable base`);
        }
        
        let clientBase = await getClientBase(clientId);
        
        // Log client base details
        
        // Create a proxy to intercept and properly handle any attempts to access .tables
        clientBase = new Proxy(clientBase, {
          get: function(target, prop) {
            if (prop === 'tables') {
              // Return a mock function that logs an error when called
              return function() {
                throw new Error('clientBase.tables is not a function - use clientBase("TableName") instead');
              };
            }
            return target[prop];
          }
        });
        
        // ARCHITECTURE FIX: Client Run Results table exists in Master base, not client bases
        let hasClientRunResultsTable = true; // Assume true, we don't need to check anymore
        try {
          // No need to check if the table exists in client base - it doesn't and shouldn't
          // The correct approach is to use the Master Clients Base which we do through runRecordService
          
          // We could verify the Master base has the table, but that would be redundant
          // since runRecordService.checkRunRecordExists will handle that correctly
        } catch (tableError) {
          await logRouteError(tableError, req).catch(() => {});
          // Don't throw the error - we'll let the runRecordService handle this
        }
        
        // Use our enhanced checkRunRecordExists function from runRecordAdapterSimple
        logger.info(`[DEBUG-EXTREME] About to check if run record exists for runId=${runIdToUse}, clientId=${clientId}`);
        const debugLogger = createSafeLogger(clientId, runIdToUse, 'apify_process');
        debugLogger.debug(`Starting run record check for ${runIdToUse}`);
        
        const recordExists = await runRecordService.checkRunRecordExists({ 
          runId: runIdToUse, 
          clientId,
          options: { 
            source: 'apify_process_client', 
            logger: debugLogger 
          }
        });
        logger.info(`[DEBUG-EXTREME] checkRunRecordExists result: ${recordExists}`);
        
        // Let's verify the fields and table names
        logger.info(`[DEBUG-EXTREME] FIELD_VERIFICATION: Expected table name = 'Client Run Results'`);
        logger.info(`[DEBUG-EXTREME] FIELD_VERIFICATION: Run ID field name = 'Run ID'`);
        
        if (recordExists) {
          // Record exists, now fetch it to get current values
          
          // ARCHITECTURE FIX: Use Master Clients Base instead of client-specific base
          let masterBase = airtableService.initialize(); // Get the Master base
          
          // CRITICAL FIX: runIdToUse is ALREADY the complete client run ID (e.g., "251007-055311-Guy-Wilson")
          // DO NOT add client suffix again - that causes double suffix bug (Guy-Wilson-Guy-Wilson)
          // Just use runIdToUse exactly as-is (pure consumer pattern)
          
          // Query for the run record now that we know it exists
          // MUST search by BOTH Run ID AND Client ID for correct record lookup
          let runRecords = await masterBase('Client Run Results').select({
            filterByFormula: `AND({Run ID} = '${runIdToUse}', {Client ID} = '${clientId}')`,
            maxRecords: 1
          }).firstPage();
          
          if (runRecords && runRecords.length === 0) {
          }
          
          if (runRecords && runRecords.length > 0) {
            // Get current values, default to 0 if not set
            const currentRecord = runRecords[0];
          
          
          // Log all available fields for debugging
          const allFields = Object.keys(currentRecord.fields).map(key => `${key}: ${currentRecord.fields[key]}`);
          
          const currentPostCount = Number(currentRecord.get(CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED) || 0);
          const currentApiCosts = Number(currentRecord.get(CLIENT_RUN_FIELDS.APIFY_API_COSTS) || 0);
          const profilesSubmittedCount = Number(currentRecord.get(CLIENT_RUN_FIELDS.PROFILES_SUBMITTED) || 0);
          const currentApifyRunId = currentRecord.get(CLIENT_RUN_FIELDS.APIFY_RUN_ID);
          
          
          // Get the Apify Run ID if it exists in the start data
          const apifyRunId = startData?.apifyRunId || startData?.actorRunId || '';
          logger.info(`[DEBUG][METRICS_TRACKING] - New Apify Run ID from startData: ${apifyRunId || '(empty)'}`);
          
          // Take the higher count for posts harvested
          const updatedCount = Math.max(currentPostCount, postsToday);
          // Add to API costs
          const updatedCosts = currentApiCosts + Number(estimatedCost);
          // Track profiles submitted (should be at least the batch size we processed)
          const updatedProfilesSubmitted = Math.max(profilesSubmittedCount, targetUrls ? targetUrls.length : 0);
          
          logger.info(`[DEBUG][METRICS_TRACKING] - Updated values to save:`);
          logger.info(`[DEBUG][METRICS_TRACKING] - Posts Harvested: ${updatedCount}`);
          logger.info(`[DEBUG][METRICS_TRACKING] - API Costs: ${updatedCosts}`);
          logger.info(`[DEBUG][METRICS_TRACKING] - Profiles Submitted: ${updatedProfilesSubmitted}`);
          
          try {
            if (typeof runRecordService.updateClientMetrics !== 'function') {
              logger.error(`[ERROR] runRecordService.updateClientMetrics is not a function - cannot update metrics`);
            } else {
              await runRecordService.updateClientMetrics({
                runId: runIdToUse,
                clientId: clientId,
                metrics: {
                  [CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: updatedCount,
                  [CLIENT_RUN_FIELDS.APIFY_API_COSTS]: updatedCosts,
                  [CLIENT_RUN_FIELDS.APIFY_RUN_ID]: apifyRunId,
                  [CLIENT_RUN_FIELDS.PROFILES_SUBMITTED]: updatedProfilesSubmitted
                },
                options: { source: 'apifyProcessRoutes' }
              });
              
              logger.info(`[apify/process-client] Updated client run record for ${clientId}:`);
            }
          } catch (metricError) {
            logger.error(`[ERROR] Failed to update client metrics: ${metricError.message}`);
            await logRouteError(metricError, req).catch(() => {});
          }
          logger.info(`  - Total Posts Harvested: ${currentPostCount} → ${updatedCount}`);
          logger.info(`  - Apify API Costs: ${currentApiCosts} → ${updatedCosts}`);
          }
        } else {
          // ERROR: Record not found - this should have been created at the beginning of this process
          const errorMsg = `ERROR: Client run record not found for ${runIdToUse} (${clientId})`;
          
          // Log this critical error to Airtable for debugging without Render access
          const notFoundError = new Error(`Client run record not found for ${runIdToUse}`);
          await logRouteError(notFoundError, req, {
            clientId,
            operation: 'apify-post-harvest-metrics-update',
            runId: runIdToUse,
            parentRunId,
            additionalContext: 'Record should have been created at process start'
          }).catch(() => {});
          
          // Try to find any records with similar run IDs
          try {
            const clientBase = await getClientBase(clientId);
            const baseRunId = runIdSystem.getBaseRunId(runIdToUse);
            const partialRunId = baseRunId.split('-')[0]; // Just the date part
            
            
            // ARCHITECTURE FIX: Use Master Clients Base instead of client-specific base
            let masterBase = airtableService.initialize(); // Get the Master base
            
            let similarRecords = await masterBase('Client Run Results').select({
              filterByFormula: `AND(FIND('${partialRunId}', {Run ID}) > 0, {Client ID} = '${clientId}')`,
              maxRecords: 5
            }).firstPage();
            
            if (similarRecords && similarRecords.length > 0) {
              similarRecords.forEach(record => {
              });
            } else {
            }
          } catch (searchError) {
            await logRouteError(searchError, req).catch(() => {});
          }
          
          // Get the Apify Run ID if it exists in the start data
          const apifyRunId = startData?.apifyRunId || startData?.actorRunId || '';
          const profilesSubmitted = targetUrls ? targetUrls.length : 0;
          
          // We still need to try to update metrics for operational continuity
          // but we'll log it as an error
          try {
            if (typeof runRecordService.updateClientMetrics !== 'function') {
              logger.error(`[ERROR] runRecordService.updateClientMetrics is not a function - cannot update metrics in fallback handler`);
            } else {
              await runRecordService.updateClientMetrics({
                runId: runIdToUse,
                clientId: clientId,
                metrics: {
                  [CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: postsToday,
                  [CLIENT_RUN_FIELDS.APIFY_API_COSTS]: estimatedCost,
                  [CLIENT_RUN_FIELDS.APIFY_RUN_ID]: apifyRunId,
                  [CLIENT_RUN_FIELDS.PROFILES_SUBMITTED]: profilesSubmitted
                },
                options: { source: 'apifyProcessRoutes_fallback' }
              });
              
              logger.info(`[apify/process-client] Attempted metrics update despite missing run record`);
              logger.info(`  - Total Posts Harvested: ${postsToday}`);
            }
          } catch (metricError) {
            logger.error(`[ERROR] Failed to update client metrics in fallback handler: ${metricError.message}`);
            await logRouteError(metricError, req).catch(() => {});
          }
          logger.info(`  - Apify API Costs: ${estimatedCost}`);
        }
      } catch (recordError) {
        // Error checking for existing record
        logger.error(`[apify/process-client] ERROR: Failed to check for existing record: ${recordError.message}`);
        await logRouteError(recordError, req).catch(() => {});
        logger.error(`[apify/process-client] Run ID: ${runIdToUse}, Client ID: ${clientId}`);
        
        // Try to update metrics anyway for operational continuity
        try {
          // Get the Apify Run ID if it exists in the start data
          const apifyRunId = startData?.apifyRunId || startData?.actorRunId || '';
          
          if (typeof runRecordService.updateClientMetrics !== 'function') {
            logger.error(`[ERROR] runRecordService.updateClientMetrics is not a function - cannot update metrics in emergency handler`);
          } else {
            await runRecordService.updateClientMetrics({
              runId: runIdToUse,
              clientId: clientId,
              metrics: {
                [CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED]: postsToday,
                [CLIENT_RUN_FIELDS.APIFY_RUN_ID]: apifyRunId,
                [CLIENT_RUN_FIELDS.PROFILES_SUBMITTED]: targetUrls ? targetUrls.length : 0
              },
              options: { source: 'apifyProcessRoutes_emergency' }
            });
          }
          logger.info(`[apify/process-client] Attempted metrics update despite record lookup failure`);
        } catch (updateError) {
          logger.error(`[apify/process-client] Failed to update metrics: ${updateError.message}`);
          await logRouteError(updateError, req).catch(() => {});
        }
      }
    } catch (metricError) {
      logger.error(`[apify/process-client] Failed to update post harvesting metrics: ${metricError.message}`);
      await logRouteError(metricError, req).catch(() => {});
      logger.error(`[DEBUG][METRICS_TRACKING] ERROR updating metrics: ${metricError.message}`);
      logger.error(`[DEBUG][METRICS_TRACKING] Error stack: ${metricError.stack}`);
      logger.error(`[DEBUG][METRICS_TRACKING] Client ID: ${clientId}, Run ID to use: ${runIdToUse || '(none)'}`);
      logger.error(`[DEBUG][METRICS_TRACKING] Posts today value: ${postsToday}`);
      // Continue execution even if metrics update fails
    }
    
    // Log completion to Progress Log if we have a clientRunId (orchestrated run)
    if (clientRunId) {
      try {
        const statsMessage = postsToday > 0 
          ? `${postsToday} posts harvested from ${batches} batch${batches !== 1 ? 'es' : ''}`
          : 'No posts harvested';
        await appendToProgressLog(parentRunId, clientId, `[${getAESTTime()}] ✅ Post Harvesting: Completed (${statsMessage})`);
      } catch (logError) {
        logger.error(`[apify/process-client] Failed to log completion to Progress Log: ${logError.message}`);
      }
    }
    
    const payload = { ok: true, clientId, postsToday, postsTarget, batches, runs };
    if (debugMode) payload.debug = { batches: debugBatches };
    
    // Check if response object exists (will be null in fire-and-forget mode)
    if (res) {
      return res.json(payload);
    } else {
      logger.info(`[apify/process-level2-v2] Background processing completed successfully for client ${clientId}`);
      logger.info(`[apify/process-level2-v2] Posts harvested: ${postsToday}, batches: ${batches}, runs: ${runs.length}`);
      return payload;
    }
    
  } catch (e) {
    let endpoint = req.path && req.path.includes('smart-resume') ? 'smart-resume' : 'apify';
    logger.error(`[${endpoint}/process-client] error:`, e.message);
    await logCriticalError(e, { operation: 'process_client_handler', req }).catch(() => {});
    
    // Log error to Progress Log if we have a clientRunId (orchestrated run)
    if (clientRunId) {
      try {
        await appendToProgressLog(parentRunId, clientId, `[${getAESTTime()}] ❌ Post Harvesting: Error - ${e.message}`);
      } catch (logError) {
        logger.error(`[apify/process-client] Failed to log error to Progress Log: ${logError.message}`);
      }
    }
    
    // Check if response object exists (will be null in fire-and-forget mode)
    if (res) {
      return res.status(500).json({ ok: false, error: e.message });
    } else {
      logger.error(`[apify/process-level2-v2] Background processing error: ${e.message}`);
      throw e; // Re-throw to be caught by the caller for proper error logging
    }
  }
}

// Lightweight canary to test 1 post per 3 sample leads before a full batch
// POST /api/apify/canary
router.post('/api/apify/canary', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const clientId = req.headers['x-client-id'];
    if (!clientId) return res.status(400).json({ ok: false, error: 'Missing x-client-id header' });

    const base = await getClientBase(clientId);
    // Pick a small sample
    const sample = await pickLeadBatch(base, 3);
    if (!sample.length) return res.json({ ok: true, sample: 0, note: 'No eligible leads' });
    const targetUrls = sample.map(r => r.get(LINKEDIN_URL_FIELD)).filter(Boolean);

    const baseUrl = process.env.API_PUBLIC_BASE_URL
      || process.env.NEXT_PUBLIC_API_BASE_URL
      || `http://localhost:${process.env.PORT || 3001}`;
    const resp = await fetch(`${baseUrl}/api/apify/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'x-client-id': clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        targetUrls,
        mode: 'inline',
        actorId: process.env.ACTOR_ID || process.env.APIFY_ACTOR_ID || undefined,
        options: {
          maxPosts: 1,
          postedLimit: 'year',
          expectsCookies: true,
          build: process.env.APIFY_BUILD || process.env.BUILD || undefined
        }
      })
    });
    const data = await resp.json().catch(() => ({}));
    return res.json({ ok: true, clientId, urls: targetUrls, counts: data.counts || null, runId: data.runId || null });
  } catch (e) {
    logger.error('[apify/canary] error:', e.message);
    await logCriticalError(error, req).catch(() => {});
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Get all active clients from the master clients base
 */
async function getAllClients() {
  try {
    const masterClientsBase = process.env.MASTER_CLIENTS_BASE_ID;
    if (!masterClientsBase) {
      logger.error('Missing MASTER_CLIENTS_BASE_ID env variable');
      return [];
    }
    
    // Connect to the master clients base
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(masterClientsBase);
    
    // Get all active clients
    const records = await base('Clients').select({
      filterByFormula: "{Status} = 'Active'"
    }).all();
    
    return records.map(record => ({
      clientId: record.get('Client ID'),
      clientName: record.get('Client Name'),
      serviceLevel: record.get('Service Level'),
      status: record.get('Status'),
      postAccessEnabled: record.get('Post Access Enabled') === 'Yes'
    })).filter(client => client.clientId);
  } catch (error) {
    logger.error('Error getting all clients:', error.message);
    await logRouteError(error, req).catch(() => {});
    return [];
  }
}

/**
 * Process all clients in the background
 * @param {Array} clients List of client objects
 * @param {string} path Original request path
 * @param {string} parentRunId Optional parent run ID for tracking
 */
async function processAllClientsInBackground(clients, path, parentRunId) {
  try {
    // Use the parentRunId if provided, otherwise generate a new master run ID
    // This maintains the connection with the parent process that initiated this batch
    const masterRunId = parentRunId || runIdSystem.createClientRunId(runIdSystem.generateRunId(), 'batch-all-clients');
    logger.info(`[batch-process] Starting batch processing with master run ID ${masterRunId} for ${clients.length} clients`);
    
    // Changed from const to let to prevent "Assignment to constant variable" errors
    let endpoint = path.includes('smart-resume') ? 'smart-resume' : 'apify';
    const results = {
      masterRunId,
      successful: 0,
      failed: 0,
      skipped: 0,
      clientResults: {},
      startTime: new Date().toISOString(),
      endTime: null
    };
    
    // Process clients sequentially to avoid rate limits and resource contention
    for (const client of clients) {
      try {
        logger.info(`[${endpoint}/batch] Processing client ${client.clientId} (${client.clientName})`);
        
        // Skip inactive clients
        if (client.status !== 'Active') {
          logger.info(`[${endpoint}/batch] Skipping inactive client ${client.clientId}`);
          results.skipped++;
          results.clientResults[client.clientId] = { status: 'skipped', reason: 'inactive' };
          continue;
        }
        
        // Skip clients without post access for post harvesting (apify endpoint)
        if (endpoint === 'apify' && !client.postAccessEnabled) {
          logger.info(`[${endpoint}/batch] Skipping client ${client.clientId} - post access not enabled`);
          results.skipped++;
          results.clientResults[client.clientId] = { status: 'skipped', reason: 'post_access_disabled' };
          continue;
        }
        
        // Create a consistent client-specific run ID that maintains the connection to the master run
        // This ensures job tracking records can be found consistently
        const clientRunId = `${masterRunId}-${client.clientId}`;
        logger.info(`[${endpoint}/batch] Using consistent clientRunId: ${clientRunId} for client ${client.clientId}`);
        
        // Call the process-client handler directly with a mock request/response
        // IMPORTANT: We use the exact same runId throughout the chain to maintain consistency
        const mockReq = {
          headers: { 'x-client-id': client.clientId, 'authorization': `Bearer ${process.env.PB_WEBHOOK_SECRET}` },
          query: { parentRunId: masterRunId, runId: clientRunId },
          body: { parentRunId: masterRunId, runId: clientRunId },  // Add runId in both query and body for redundancy
          path,
          // Store the specific clientRunId to prevent regeneration - this is the SINGLE SOURCE OF TRUTH
          specificRunId: clientRunId
        };
        
        logger.info(`[${endpoint}/batch] 🔍 STRICT RUN ID FLOW: For client ${client.clientId}:`);
        logger.info(`[${endpoint}/batch] 🔍 - Source masterRunId: ${masterRunId}`);
        logger.info(`[${endpoint}/batch] 🔍 - Client-specific runId: ${clientRunId}`);
        logger.info(`[${endpoint}/batch] 🔍 - This specific runId will be preserved throughout the entire chain`);
        
        
        // Use a promise to capture the response
        const responsePromise = new Promise(resolve => {
          const mockRes = {
            json: resolve,
            status: () => ({ json: resolve })
          };
          
          processClientHandler(mockReq, mockRes);
        });
        
        const result = await responsePromise;
        logger.info(`[${endpoint}/batch] Client ${client.clientId} result:`, result);
        
        if (result.ok) {
          results.successful++;
          results.clientResults[client.clientId] = { status: 'success', ...result };
        } else {
          results.failed++;
          results.clientResults[client.clientId] = { status: 'failed', error: result.error };
        }
      } catch (clientError) {
        logger.error(`[${endpoint}/batch] Error processing client ${client.clientId}:`, clientError.message);
        await logRouteError(clientError, req).catch(() => {});
        results.failed++;
        results.clientResults[client.clientId] = { status: 'failed', error: clientError.message };
      }
      
      // Add a small delay between client processing to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    results.endTime = new Date().toISOString();
    
    // Log the final results
    logger.info(`[${endpoint}/batch] Batch processing complete: ${results.successful} successful, ${results.failed} failed, ${results.skipped} skipped`);
    
    // Save batch results to a file for debugging if needed
    try {
      const fs = require('fs');
      const resultsDir = './batch-results';
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
      }
      fs.writeFileSync(`${resultsDir}/${masterRunId}.json`, JSON.stringify(results, null, 2));
    } catch (fsError) {
      logger.error(`[${endpoint}/batch] Error saving results:`, fsError.message);
      await logRouteError(fsError, req).catch(() => {});
    }
    
    return results;
  } catch (error) {
    logger.error('[batch-process] Error processing clients in background:', error.message);
    await logRouteError(error, req).catch(() => {});
    return { error: error.message };
  }
}

module.exports = router;