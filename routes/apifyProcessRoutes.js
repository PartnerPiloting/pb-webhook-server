// routes/apifyProcessRoutes.js
// Process a client's leads in batches until Posts Daily Target is met

const express = require('express');
const router = express.Router();
const Airtable = require('airtable');
const { getClientBase, createBaseInstance } = require('../config/airtableClient');
const clientService = require('../services/clientService');
const { getClientById } = clientService;
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger, getLoggerFromOptions } = require('../utils/loggerHelper');
const { getFetch } = require('../utils/safeFetch');
const fetch = getFetch();
// Import field constants
const { 
  APIFY_RUN_ID,
  CLIENT_RUN_FIELDS 
} = require('../constants/airtableUnifiedConstants');
const runIdUtils = require('../utils/runIdUtils');
// Updated to use unified run ID service
const runIdService = require('../services/unifiedRunIdService');
// Import run ID generator
const { generateTimestampRunId: generateRunId } = runIdService;
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
const CREATED_TIME_FIELD = 'Created Time';

// Helper to format ISO now
const nowISO = () => new Date().toISOString();

// Pick a batch of leads:
// - Pending (or blank)
// - Processing older than 30 minutes
// Permanently skip any with status 'No Posts'
async function pickLeadBatch(base, batchSize) {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  
  console.log(`🔍 LEAD_SELECTION_START: Starting to pick leads batch of size ${batchSize}`);
  
  // Query Airtable to get counts of leads matching different criteria
  try {
    console.log(`🔍 LEAD_SELECTION_DIAG: Running diagnostic counts on lead criteria...`);
    
    // Remove field name detection since we're not using id field anymore
    
    // Check LinkedIn URL field presence
    const urlRecords = await base(LEADS_TABLE).select({
      filterByFormula: `{${LINKEDIN_URL_FIELD}} != ''`,
      // Don't request any fields - we only need count
      maxRecords: 1
    }).firstPage();
    console.log(`🔍 LEAD_SELECTION_DIAG: Leads with LinkedIn URLs: ${urlRecords.length ? 'YES' : 'NONE'}`);
    
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
        
        console.log(`🔍 LEAD_SELECTION_DIAG: Leads with status '${status || 'BLANK'}': ${statusRecords.length}`);
        statusesByValue[status || 'BLANK'] = statusRecords.length;
      } catch (err) {
        console.log(`🔍 LEAD_SELECTION_DIAG: Error checking status '${status}': ${err.message}`);
      }
    });
    
    // Check Posts Actioned field
    const actionedRecords = await base(LEADS_TABLE).select({
      filterByFormula: `OR({${POSTS_ACTIONED_FIELD}} = 0, {${POSTS_ACTIONED_FIELD}} = '', {${POSTS_ACTIONED_FIELD}} = BLANK())`,
      // No fields needed for count
      maxRecords: 1
    }).firstPage();
    console.log(`🔍 LEAD_SELECTION_DIAG: Leads with Posts Actioned empty/0: ${actionedRecords.length ? 'YES' : 'NONE'}`);
    
    // Check Date Posts Scored field
    const scoredRecords = await base(LEADS_TABLE).select({
      filterByFormula: `{${DATE_POSTS_SCORED_FIELD}} = BLANK()`,
      // No fields needed for count
      maxRecords: 1
    }).firstPage();
    console.log(`🔍 LEAD_SELECTION_DIAG: Leads not yet scored (Date Posts Scored empty): ${scoredRecords.length ? 'YES' : 'NONE'}`);
  } catch (err) {
    console.log(`🔍 LEAD_SELECTION_DIAG: Error running diagnostics: ${err.message}`);
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
  
  console.log(`🔍 LEAD_SELECTION_FORMULA: ${formula.replace(/\n\s+/g, ' ')}`);
  
  // Prefer sorting by most recently created leads first. If the Created Time field
  // does not exist on a tenant base, gracefully fall back to no explicit sort.
  const selectOptions = {
    filterByFormula: formula,
    maxRecords: batchSize,
    fields: [LINKEDIN_URL_FIELD, STATUS_FIELD, CREATED_TIME_FIELD],
    sort: [{ field: CREATED_TIME_FIELD, direction: 'desc' }]
  };
  let records;
  try {
    records = await base(LEADS_TABLE).select(selectOptions).firstPage();
    return records;
  } catch (e) {
    // Fallback without sort (e.g., if Created Time field is missing)
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
  console.log(`[process-level2-v2] ENTRY POINT: New request received at ${new Date().toISOString()}`);
  console.log(`[process-level2-v2] Headers: ${JSON.stringify(Object.keys(req.headers))}`);
  console.log(`[process-level2-v2] Query params: ${JSON.stringify(req.query)}`);
  console.log(`[process-level2-v2] Body params: ${JSON.stringify(req.body || {})}`);
  
  // Detailed debugging for clientId identification
  console.log(`[process-level2-v2] COMPARISON DEBUG: clientId sources:`);
  console.log(`[process-level2-v2] - From x-client-id header: ${req.headers['x-client-id'] || 'missing'}`);
  console.log(`[process-level2-v2] - From query.client: ${req.query.client || 'missing'}`);
  console.log(`[process-level2-v2] - From query.clientId: ${req.query.clientId || 'missing'}`);
  console.log(`[process-level2-v2] - From body.clientId: ${req.body?.clientId || 'missing'}`);
  console.log(`[process-level2-v2] - From body.client: ${req.body?.client || 'missing'}`);
  console.log(`[process-level2-v2] - From stream: ${req.query.stream || 'missing'}`);
  console.log(`[process-level2-v2] - Authorization present: ${!!req.headers['authorization']}`);
  
  // Compare with values expected in the processClientHandler
  const clientIdForHandler = req.headers['x-client-id'] || req.query.client || req.query.clientId || (req.body && (req.body.clientId || req.body.client));
  console.log(`[process-level2-v2] - Effective clientId for handler: ${clientIdForHandler || 'missing'}`);
  
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
    console.log(`[process-level2-v2] 🔍 FULL REQUEST: ${JSON.stringify(requestStructure, null, 2).substring(0, 1000)}...`);
  } catch (e) {
    console.log(`[process-level2-v2] Could not stringify full request: ${e.message}`);
  }
  
  
  // Validate auth first
  const auth = req.headers['authorization'];
  const secret = process.env.PB_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[process-level2-v2] Server missing PB_WEBHOOK_SECRET');
    return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
  }
  if (!auth || auth !== `Bearer ${secret}`) {
    console.error('[process-level2-v2] Unauthorized request');
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Get client ID from header, query param or body
  const clientId = req.headers['x-client-id'] || req.query.clientId || (req.body && req.body.clientId);
  if (!clientId) {
    console.error('[process-level2-v2] Missing clientId');
    return res.status(400).json({ ok: false, error: 'Missing clientId parameter' });
  }

  const stream = req.query.stream || 'default';
  // Changed from const to let to allow reassignment if needed
  let parentRunId = req.query.parentRunId || (req.body && req.body.parentRunId) || '';
  
  console.log(`[process-level2-v2] Received post harvesting request for client ${clientId}, stream ${stream}, parentRunId: ${parentRunId || 'none'}`);
  
  // Acknowledge the request immediately (fire-and-forget pattern)
  res.status(202).json({ 
    ok: true, 
    message: 'Post harvesting initiated', 
    accepted: true, 
    stream,
    clientId
  });
  
  console.log(`[process-level2-v2] ✅ Request acknowledged, starting background processing for client ${clientId}`);
  
  // Clone the request object and attach some tracking data
  // Create a deeper clone that preserves important objects like headers
  const reqClone = {
    ...req,
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
  
  console.log(`[process-level2-v2] DEBUG CLONE: Cloned request object with clientId=${clientId}`);
  console.log(`[process-level2-v2] DEBUG CLONE: Cloned headers x-client-id=${reqClone.headers['x-client-id']}`);
  console.log(`[process-level2-v2] DEBUG CLONE: Cloned query clientId=${reqClone.query.clientId}`);
  
  
  // Process in the background
  processClientHandler(reqClone, null).catch(err => {
    console.error(`[process-level2-v2] Background processing error for client ${clientId}:`, err.message);
    console.error(`[process-level2-v2] Error stack: ${err.stack}`);
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
      console.error('[processClientHandler] Server missing PB_WEBHOOK_SECRET');
      if (res) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
      throw new Error('Server missing PB_WEBHOOK_SECRET');
    }
    
    if (!auth || auth !== `Bearer ${secret}`) {
      console.error('[processClientHandler] Unauthorized request');
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
      console.error(`[processClientHandler] ${errMsg}`);
      
      if (res) {
        return res.status(400).json({ ok: false, error: errMsg });
      }
      throw new Error(errMsg);
    }

    // Get parent run ID from query params or body (if provided)
    // Changed from const to let to allow reassignment later
    let parentRunId = req.query.parentRunId || (req.body && req.body.parentRunId);
    
    // Add debug logs to identify the issue
    console.log(`[processClientHandler] DEBUG: req.path = ${req.path}`);
    console.log(`[processClientHandler] DEBUG: req.url = ${req.url}`);
    
    // Fix: Add null check before calling includes
    // FIXED: Changed const to let to prevent "Assignment to constant variable" errors
    let endpoint = req.path && req.path.includes('smart-resume') ? 'smart-resume' : 'apify';
    console.log(`[processClientHandler] DEBUG: Using endpoint = ${endpoint}`);

    // Process all clients if requested
    if (processAllClients) {
      console.log(`[${endpoint}/process-client] Processing all clients`);
      
      // Get all active clients
      let clients = await getAllClients();
      if (!clients || !clients.length) {
        console.error(`[${endpoint}/process-client] No clients found`);
        if (res) return res.status(404).json({ ok: false, error: 'No clients found' });
        throw new Error('No clients found');
      }
      
      console.log(`[${endpoint}/process-client] Found ${clients.length} clients to process`);
      
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
        console.log(`[${endpoint}/process-client] Background processing of ${clients.length} clients`);
        // When in fire-and-forget mode, just throw since we can't process all clients
        throw new Error('Process all clients not supported in fire-and-forget mode');
      }
    }

    // Single client processing
    let client = await getClientById(clientId);
    console.log(`[${endpoint}/process-client] Processing client: ${clientId}`);
    if (!client) {
      console.log(`[${endpoint}/process-client] Client not found: ${clientId}`);
      if (res) return res.status(404).json({ ok: false, error: 'Client not found' });
      throw new Error(`Client not found: ${clientId}`);
    }
    console.log(`[${endpoint}/process-client] Client found: ${client.clientName}, status: ${client.status}, serviceLevel: ${client.serviceLevel}`);
    
    // Skip inactive clients and service level check UNLESS we're in testing mode
    if (!TESTING_MODE) {
      if (client.status !== 'Active') {
        console.log(`[apify/process-client] Client ${clientId} not Active, skipping`);
        if (res) return res.status(200).json({ ok: true, skipped: true, reason: 'Client not Active' });
        throw new Error(`Client ${clientId} not Active, skipping`);
      }
      if (Number(client.serviceLevel) < 2) {
        console.log(`[apify/process-client] Client ${clientId} service level ${client.serviceLevel} < 2, skipping`);
        if (res) return res.status(200).json({ ok: true, skipped: true, reason: 'Service level < 2' });
        throw new Error(`Client ${clientId} service level ${client.serviceLevel} < 2, skipping`);
      }
    } else {
      console.log(`[apify/process-client] 🧪 TESTING MODE - Bypassing active status and service level checks`);
    }

    // In testing mode, use small fixed limits; otherwise use client configuration
    if (TESTING_MODE) {
      // Use limited values for testing
      postsTarget = 5; // Target 5 posts total
      batchSize = 5;   // Process 5 profiles at a time
      maxBatches = 1;  // Run only 1 batch
      console.log(`[apify/process-client] 🧪 TESTING MODE - Using limited batch settings: postsTarget=${postsTarget}, batchSize=${batchSize}, maxBatches=${maxBatches}`);
    } else {
      // Use normal client settings
      postsTarget = Number(client.postsDailyTarget || 0);
      batchSize = Number(client.leadsBatchSizeForPostCollection || 20);
      maxBatches = Number(req.body?.maxBatchesOverride ?? client.maxPostBatchesPerDayGuardrail ?? 10);
      console.log(`[apify/process-client] Client ${clientId} targets: postsTarget=${postsTarget}, batchSize=${batchSize}, maxBatches=${maxBatches}`);
      
      if (!postsTarget || !batchSize) {
        console.log(`[apify/process-client] Client ${clientId} missing targets, skipping`);
        return res.status(200).json({ ok: true, skipped: true, reason: 'Missing targets' });
      }
    }

    let base = await getClientBase(clientId);

    // running tally
    postsToday = await computeTodaysPosts(base);
    console.log(`[apify/process-client] Client ${clientId} postsToday: ${postsToday}, target: ${postsTarget}`);
    
    batches = 0;
    
    // Set debug mode
    debugMode = req.query?.debug === '1' || req.body?.debug === true;

    while ((IGNORE_POST_HARVESTING_LIMITS || postsToday < postsTarget) && batches < maxBatches) {
      console.log(`[apify/process-client] Client ${clientId} batch ${batches + 1}: picking ${batchSize} leads`);
      
      // Enhanced debugging for post harvesting
      console.log(`🔍 POST_HARVEST_LEADS: About to select eligible leads for client ${clientId}`);
      
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      console.log(`🔍 POST_HARVEST_CRITERIA: Selection criteria includes:
        - Has LinkedIn Profile URL
        - Status is 'Pending', blank, or 'Processing' but older than ${thirtyMinAgo}
        - Status is not 'No Posts'
        - Posts Actioned is 0, blank, or null
        - Date Posts Scored is blank`);
      
      let pick = await pickLeadBatch(base, batchSize);
      console.log(`[apify/process-client] Client ${clientId} picked ${pick.length} leads`);
      
      // Detailed inspection of the client's base
      try {
        let clientInfo = await getClientById(clientId);
        console.log(`🔍 CLIENT_DEBUG: Client ${clientId} info found: ${!!clientInfo}`);
        if (clientInfo) {
          console.log(`🔍 CLIENT_DEBUG: Client ${clientId} service level: ${clientInfo.serviceLevel}`);
          console.log(`🔍 CLIENT_DEBUG: Client ${clientId} base ID: ${clientInfo.airtableBaseId}`);
          
          // Query total number of leads in the base for context
          // Remove field name check as we don't need specific fields
          
          const allLeads = await base(LEADS_TABLE).select({
            // No fields needed - just checking if records exist
            maxRecords: 1
          }).firstPage();
          
          console.log(`🔍 CLIENT_DEBUG: Client ${clientId} has leads in Airtable: ${allLeads.length > 0 ? 'YES' : 'NO'}`);
        }
      } catch (err) {
        console.log(`🔍 CLIENT_DEBUG: Error getting client info: ${err.message}`);
      }
      
      if (!pick.length) {
        console.log(`[apify/process-client] Client ${clientId} no more eligible leads, breaking`);
        console.log(`🔍 POST_HARVEST_LEADS: No eligible leads found for client ${clientId}.`);
        console.log(`🔍 POST_HARVEST_LEADS: This is likely because:`);
        console.log(`🔍 POST_HARVEST_LEADS: 1. All leads have already been processed`);
        console.log(`🔍 POST_HARVEST_LEADS: 2. There are no new leads with LinkedIn URLs`);
        console.log(`🔍 POST_HARVEST_LEADS: 3. All leads have been marked 'No Posts'`);
        console.log(`🔍 POST_HARVEST_LEADS: 4. All leads have already had posts scored`);
        
        // Try a quick diagnostic query with minimal criteria
        try {
          // Remove field name check as we don't need to request id field
          
          const anyLeadsWithUrl = await base(LEADS_TABLE).select({
            filterByFormula: `{${LINKEDIN_URL_FIELD}} != ''`,
            fields: [STATUS_FIELD, POSTS_ACTIONED_FIELD, DATE_POSTS_SCORED_FIELD],
            maxRecords: 5
          }).firstPage();
          
          if (anyLeadsWithUrl.length) {
            console.log(`🔍 DIAGNOSTIC: Found ${anyLeadsWithUrl.length} leads with LinkedIn URLs`);
            for (let i = 0; i < anyLeadsWithUrl.length; i++) {
              const lead = anyLeadsWithUrl[i];
              console.log(`🔍 DIAGNOSTIC: Lead #${i+1} - Status: ${lead.fields[STATUS_FIELD] || 'EMPTY'}, ` +
                `Posts Actioned: ${lead.fields[POSTS_ACTIONED_FIELD] || 'EMPTY'}, ` +
                `Date Posts Scored: ${lead.fields[DATE_POSTS_SCORED_FIELD] || 'EMPTY'}`);
            }
          } else {
            console.log(`🔍 DIAGNOSTIC: No leads found with LinkedIn URLs`);
          }
        } catch (err) {
          console.log(`🔍 DIAGNOSTIC: Error running quick diagnostic: ${err.message}`);
        }
        
        break;
      }
      
      console.log(`🔍 POST_HARVEST_LEADS: Found ${pick.length} eligible leads for client ${clientId}`);
      // Log the first 3 leads to provide context
      if (pick.length > 0) {
        console.log(`🔍 POST_HARVEST_LEADS_SAMPLE: Showing details for first ${Math.min(3, pick.length)} leads:`);
        for (let i = 0; i < Math.min(3, pick.length); i++) {
          console.log(`🔍 POST_HARVEST_LEADS_SAMPLE: Lead #${i+1} - ID: ${pick[i].id}, LinkedIn URL: ${pick[i].fields[LINKEDIN_URL_FIELD] ? 'Present' : 'Missing'}`);
        }
      }

      // Generate a proper run ID using runIdService
      // UPDATED: Using generateTimestampRunId directly for consistency
      const placeholderRunId = runIdService.generateTimestampRunId(clientId);
      console.log(`[apify/process-client] Client ${clientId} batch ${batches + 1}: Generated run ID: ${placeholderRunId}`);
      await base(LEADS_TABLE).update(pick.map(r => ({
        id: r.id,
        fields: { [STATUS_FIELD]: 'Processing', [RUN_ID_FIELD]: placeholderRunId, [LAST_CHECK_AT_FIELD]: nowISO() }
      })));

      // prepare targetUrls
      targetUrls = pick.map(r => r.get(LINKEDIN_URL_FIELD)).filter(Boolean);
      console.log(`[apify/process-client] Client ${clientId} batch ${batches + 1}: ${targetUrls.length} LinkedIn URLs to process`);
      
      if (debugMode) {
        debugBatches.push({ pickedCount: pick.length, targetUrls });
      }

      // call our own /api/apify/run in inline mode so we wait and sync immediately
      const baseUrl = process.env.API_PUBLIC_BASE_URL
        || process.env.NEXT_PUBLIC_API_BASE_URL
        || `http://localhost:${process.env.PORT || 3001}`;
      console.log(`[apify/process-client] Client ${clientId} calling Apify run at ${baseUrl}/api/apify/run`);
      
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
      console.log(`[apify/process-client] Client ${clientId} Apify response status: ${startResp.status}, data:`, startData);
      
      // Log detailed information about the startData object for debugging
      console.log(`[DEBUG][METRICS_TRACKING] Received startData for client ${clientId}:`);
      console.log(`[DEBUG][METRICS_TRACKING] - runId: ${startData.runId || '(not present)'}`);
      console.log(`[DEBUG][METRICS_TRACKING] - apifyRunId: ${startData.apifyRunId || '(not present)'}`);
      console.log(`[DEBUG][METRICS_TRACKING] - actorRunId: ${startData.actorRunId || '(not present)'}`);
      console.log(`[DEBUG][METRICS_TRACKING] - full data:`, JSON.stringify(startData));

      // after inline run, use returned counts to compute gained
      const gained = Number((startData && startData.counts && startData.counts.posts) || 0);
      console.log(`[apify/process-client] Client ${clientId} batch ${batches + 1}: gained ${gained} posts`);
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

    console.log(`[apify/process-client] Client ${clientId} completed: ${batches} batches, postsToday: ${postsToday}, target: ${postsTarget}`);
    
    // SIMPLIFIED: We must get a parent run ID from Smart Resume - THIS IS THE KEY CHANGE
    // Legacy import - only used for other functions not related to run records
    const airtableService = require('../services/airtableService');
    
    // SIMPLIFIED: We use the parent run ID if provided, otherwise we're in standalone mode and skip metrics
    console.log(`[DEBUG-RUN-ID-FLOW] Starting run ID check. parentRunId=${parentRunId}, clientId=${clientId}, req.body.parentRunId=${req.body.parentRunId}, req.query.parentRunId=${req.query.parentRunId}`);
    
    // Determine if this is a standalone run (no parent run ID)
    const isStandaloneRun = !parentRunId;
    
    if (isStandaloneRun) {
      // Generate a parent run ID just for tracking purposes, but don't create a record
      // UPDATED: Using generateTimestampRunId directly for consistency
      parentRunId = runIdService.generateTimestampRunId(clientId);
      console.log(`[DEBUG-RUN-ID-FLOW] Running in standalone mode (no metrics recording) with tracking ID: ${parentRunId}`);
    } else {
      console.log(`[DEBUG-RUN-ID-FLOW] Using provided parent run ID: ${parentRunId}`);
      
      // ARCHITECTURAL FIX: We should ONLY check for existing records, never create them in this route
      try {
        console.log(`[DEBUG-RUN-ID-FLOW] Checking for existing run record with runId=${parentRunId}, clientId=${clientId}`);
        
        // Check if record exists first
        const recordExists = await runRecordService.checkRunRecordExists({
          runId: parentRunId,
          clientId,
          options: {
            source: 'post_harvesting_check',
          }
        });
        
        if (!recordExists) {
          console.error(`[CRITICAL ERROR] No run record exists for ${parentRunId}/${clientId} - cannot process webhook without an existing run record`);
          return res.status(400).json({
            error: 'No active run found for this client',
            message: 'Post harvesting webhooks must be part of an active run with an existing record',
            runId: parentRunId,
            clientId
          });
        }
        
        // Record exists, update it with webhook received status
        await runRecordService.updateRunRecord({
          runId: parentRunId,
          clientId,
          updates: {
            'System Notes': `Apify webhook received at ${new Date().toISOString()}`,
            'Status': 'Running',
          },
          options: {
            source: 'post_harvesting_webhook',
          },
          date: new Date().toISOString()
        });
        console.log(`[DEBUG-RUN-ID-FLOW] Successfully created new run record for ${parentRunId}`);
      } catch (createError) {
        console.error(`[DEBUG-RUN-ID-FLOW] FAILED to create run record: ${createError.message}`);
        console.error(`[DEBUG-RUN-ID-FLOW] Error stack: ${createError.stack}`);
        // Continue processing even if run record creation fails
      }
    }
    
    // Use the parent run ID from Smart Resume
    console.log(`[DEBUG-RUN-ID-FLOW] Parent run ID before normalization: ${parentRunId}`);
    
    // Log the runIdService details
    console.log(`[DEBUG-RUN-ID-FLOW] runIdService type: ${typeof runIdService}`);
    console.log(`[DEBUG-RUN-ID-FLOW] runIdService.normalizeRunId type: ${typeof runIdService.normalizeRunId}`);
    
    // CRITICAL FIX: STRICT RUN ID HANDLING
    // This implements a true single-source-of-truth pattern for run IDs
    // No more implicit conversions or normalizations - explicit control only
    
    console.log(`[DEBUG-RUN-ID-FLOW] 🔍 STRICT RUN ID CHECK - Available sources:`);
    console.log(`[DEBUG-RUN-ID-FLOW] 🔍 - req.specificRunId: ${req.specificRunId || 'not provided'}`);
    console.log(`[DEBUG-RUN-ID-FLOW] 🔍 - req.query.runId: ${req.query?.runId || 'not provided'}`);
    console.log(`[DEBUG-RUN-ID-FLOW] 🔍 - req.body.runId: ${req.body?.runId || 'not provided'}`);
    console.log(`[DEBUG-RUN-ID-FLOW] 🔍 - parentRunId: ${parentRunId || 'not provided'}`);
    
    // Priority order for run ID sources:
    if (req.specificRunId) {
      runIdToUse = req.specificRunId;
      console.log(`[DEBUG-RUN-ID-FLOW] ✅ Using provided specific run ID: ${runIdToUse}`);
    } else if (req.query?.runId) {
      runIdToUse = req.query.runId;
      console.log(`[DEBUG-RUN-ID-FLOW] ✅ Using run ID from query: ${runIdToUse}`);
    } else if (req.body?.runId) {
      runIdToUse = req.body.runId;
      console.log(`[DEBUG-RUN-ID-FLOW] ✅ Using run ID from body: ${runIdToUse}`);
    } else if (parentRunId) {
      // Use parent run ID directly without normalization
      runIdToUse = parentRunId;
      console.log(`[DEBUG-RUN-ID-FLOW] ✅ Using parent run ID directly: ${runIdToUse}`);
    } else {
      // Only if we have no other source, generate a new ID
      // This should be rare as most calls should have a runId from upstream
      console.log(`[DEBUG-RUN-ID-FLOW] ⚠️ WARNING: No run ID provided, generating new one`);
      runIdToUse = runIdService.generateTimestampRunId(clientId);
      console.log(`[DEBUG-RUN-ID-FLOW] ✅ Generated new run ID: ${runIdToUse}`);
    }
    
    console.log(`[DEBUG-RUN-ID-FLOW] Using run ID: ${runIdToUse} (clientId: ${clientId})`);
    
    // Verify that we have a runIdToUse (from parent) - it should always be provided
    if (!runIdToUse) {
      console.error(`[DEBUG-RUN-ID-FLOW] CRITICAL ERROR: Normalization returned null/undefined runIdToUse`);
      throw new Error('[apify/process-client] No run ID provided - this process should be called with a parent run ID');
    }
    console.log(`[DEBUG-RUN-ID-FLOW] Using parent run record: ${runIdToUse} for client ${clientId}`);
    
    // NOTE: We no longer create a run record here. The Smart Resume process (parent)
    // is responsible for creating the run record, and we just update it.
    // This ensures all metrics (lead scoring, post harvesting, post scoring)
    // accumulate in the same record in the Client Run Results table.
    
    // Update client run record with post harvest metrics
    try {      
      // Calculate estimated API costs (based on LinkedIn post queries)
      const estimatedCost = (postsToday * 0.02); // $0.02 per post as estimate - send as number, not string
      
      console.log(`[DEBUG-RUN-ID-FLOW] METRICS UPDATE: About to update metrics for run ID ${runIdToUse}, client ${clientId}`);
      console.log(`[DEBUG-RUN-ID-FLOW] METRICS UPDATE: Estimated cost: ${estimatedCost}, posts today: ${postsToday}`);
        
      // Get the client run record to check existing values
      try {
        console.log(`[DEBUG-RUN-ID-FLOW] RECORD CHECK: Checking for existing client run record with ID: ${runIdToUse} for client ${clientId}`);
        console.log(`[DEBUG-RUN-ID-FLOW] RECORD CHECK: Using filter: {Run ID} = '${runIdToUse}'`);
        
        // Check client exists before trying to get base
        const client = await clientService.getClientById(clientId);
        if (!client || !client.airtableBaseId) {
          throw new Error(`Client ${clientId} not found or has no associated Airtable base`);
        }
        
        let clientBase = await getClientBase(clientId);
        
        // Log client base details
        console.log(`[DEBUG-RUN-ID-FLOW] CLIENT BASE: ${clientBase ? "Successfully retrieved" : "Failed to retrieve"} for ${clientId}`);
        
        // Create a proxy to intercept and properly handle any attempts to access .tables
        clientBase = new Proxy(clientBase, {
          get: function(target, prop) {
            if (prop === 'tables') {
              console.error('[DEBUG-RUN-ID-FLOW] WARNING: Attempted to access clientBase.tables which is not a function');
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
          console.log(`[DEBUG-RUN-ID-FLOW] Skipping Client Run Results table check in client base - using Master base instead`);
          
          // We could verify the Master base has the table, but that would be redundant
          // since runRecordService.checkRunRecordExists will handle that correctly
        } catch (tableError) {
          console.error(`[DEBUG-RUN-ID-FLOW] TABLE CHECK ERROR: ${tableError.message}`);
          // Don't throw the error - we'll let the runRecordService handle this
        }
        
        // Use our enhanced checkRunRecordExists function from runRecordAdapterSimple
        console.log(`[DEBUG-EXTREME] About to check if run record exists for runId=${runIdToUse}, clientId=${clientId}`);
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
        console.log(`[DEBUG-EXTREME] checkRunRecordExists result: ${recordExists}`);
        
        // Let's verify the fields and table names
        console.log(`[DEBUG-EXTREME] FIELD_VERIFICATION: Expected table name = 'Client Run Results'`);
        console.log(`[DEBUG-EXTREME] FIELD_VERIFICATION: Run ID field name = 'Run ID'`);
        
        if (recordExists) {
          // Record exists, now fetch it to get current values
          console.log(`[DEBUG-RUN-ID-FLOW] Run record exists for ${runIdToUse}, fetching details`);
          
          // ARCHITECTURE FIX: Use Master Clients Base instead of client-specific base
          let masterBase = airtableService.initialize(); // Get the Master base
          console.log(`[DEBUG-RUN-ID-FLOW] Using Master base for Client Run Results table query`);
          
          // ROOT CAUSE FIX: Client Run Results records use client-suffixed Run IDs
          // We need to add the client suffix before querying
          const clientSpecificRunId = `${runIdToUse}-${clientId}`;
          console.log(`[DEBUG-RUN-ID-FLOW] Query filter: {Run ID} = '${clientSpecificRunId}' (base: ${runIdToUse}, client: ${clientId})`);
          
          // Query for the run record now that we know it exists
          let runRecords = await masterBase('Client Run Results').select({
            filterByFormula: `{Run ID} = '${clientSpecificRunId}'`,
            maxRecords: 1
          }).firstPage();
          
          console.log(`[DEBUG-RUN-ID-FLOW] Query completed. Records found: ${runRecords ? runRecords.length : 0}`);
          if (runRecords && runRecords.length === 0) {
            console.error(`[DEBUG-RUN-ID-FLOW] ❌ CRITICAL: checkRunRecordExists returned TRUE but SELECT returned ZERO records!`);
            console.error(`[DEBUG-RUN-ID-FLOW] This indicates a Run ID mismatch between check and select`);
            console.error(`[DEBUG-RUN-ID-FLOW] Searched for: ${clientSpecificRunId}, but record may exist with different format`);
          }
          
          if (runRecords && runRecords.length > 0) {
            // Get current values, default to 0 if not set
            const currentRecord = runRecords[0];
          
          console.log(`[DEBUG-RUN-ID-FLOW] RECORD FOUND: ✅ Found run record with ID ${currentRecord.id} for run ID ${runIdToUse}`);
          
          // Log all available fields for debugging
          const allFields = Object.keys(currentRecord.fields).map(key => `${key}: ${currentRecord.fields[key]}`);
          console.log(`[DEBUG-RUN-ID-FLOW] RECORD FIELDS: ${JSON.stringify(allFields, null, 2)}`);
          
          const currentPostCount = Number(currentRecord.get(CLIENT_RUN_FIELDS.TOTAL_POSTS_HARVESTED) || 0);
          const currentApiCosts = Number(currentRecord.get(CLIENT_RUN_FIELDS.APIFY_API_COSTS) || 0);
          const profilesSubmittedCount = Number(currentRecord.get(CLIENT_RUN_FIELDS.PROFILES_SUBMITTED) || 0);
          const currentApifyRunId = currentRecord.get(CLIENT_RUN_FIELDS.APIFY_RUN_ID);
          
          console.log(`[DEBUG-RUN-ID-FLOW] RECORD VALUES: Found existing record for ${runIdToUse}:`);
          console.log(`[DEBUG-RUN-ID-FLOW] - Current Posts Harvested: ${currentPostCount}`);
          console.log(`[DEBUG-RUN-ID-FLOW] - Current API Costs: ${currentApiCosts}`);
          console.log(`[DEBUG-RUN-ID-FLOW] - Current Profiles Submitted: ${profilesSubmittedCount}`);
          console.log(`[DEBUG-RUN-ID-FLOW] - Current Apify Run ID: ${currentApifyRunId || '(empty)'}`);
          console.log(`[DEBUG-RUN-ID-FLOW] - New postsToday value: ${postsToday}`);
          
          // Get the Apify Run ID if it exists in the start data
          const apifyRunId = startData?.apifyRunId || startData?.actorRunId || '';
          console.log(`[DEBUG][METRICS_TRACKING] - New Apify Run ID from startData: ${apifyRunId || '(empty)'}`);
          
          // Take the higher count for posts harvested
          const updatedCount = Math.max(currentPostCount, postsToday);
          // Add to API costs
          const updatedCosts = currentApiCosts + Number(estimatedCost);
          // Track profiles submitted (should be at least the batch size we processed)
          const updatedProfilesSubmitted = Math.max(profilesSubmittedCount, targetUrls ? targetUrls.length : 0);
          
          console.log(`[DEBUG][METRICS_TRACKING] - Updated values to save:`);
          console.log(`[DEBUG][METRICS_TRACKING] - Posts Harvested: ${updatedCount}`);
          console.log(`[DEBUG][METRICS_TRACKING] - API Costs: ${updatedCosts}`);
          console.log(`[DEBUG][METRICS_TRACKING] - Profiles Submitted: ${updatedProfilesSubmitted}`);
          
          try {
            if (typeof runRecordService.updateClientMetrics !== 'function') {
              console.error(`[ERROR] runRecordService.updateClientMetrics is not a function - cannot update metrics`);
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
              
              console.log(`[apify/process-client] Updated client run record for ${clientId}:`);
            }
          } catch (metricError) {
            console.error(`[ERROR] Failed to update client metrics: ${metricError.message}`);
          }
          console.log(`  - Total Posts Harvested: ${currentPostCount} → ${updatedCount}`);
          console.log(`  - Apify API Costs: ${currentApiCosts} → ${updatedCosts}`);
          }
        } else {
          // ERROR: Record not found - this should have been created at the beginning of this process
          const errorMsg = `ERROR: Client run record not found for ${runIdToUse} (${clientId})`;
          console.error(`[DEBUG-RUN-ID-FLOW] ❌ RECORD NOT FOUND: ${errorMsg}`);
          console.error(`[DEBUG-RUN-ID-FLOW] This indicates a process kickoff issue - run record should exist`);
          console.error(`[DEBUG-RUN-ID-FLOW] Run ID details: originalParentRunId=${parentRunId}, normalizedRunId=${runIdToUse}, clientId=${clientId}`);
          
          // Try to find any records with similar run IDs
          try {
            console.log(`[DEBUG-RUN-ID-FLOW] RECOVERY ATTEMPT: Searching for similar run IDs...`);
            const clientBase = await getClientBase(clientId);
            const baseRunId = runIdService.stripClientSuffix(runIdToUse);
            const partialRunId = baseRunId.split('-')[0]; // Just the date part
            
            console.log(`[DEBUG-RUN-ID-FLOW] RECOVERY ATTEMPT: Searching with partialRunId=${partialRunId}`);
            
            // ARCHITECTURE FIX: Use Master Clients Base instead of client-specific base
            let masterBase = airtableService.initialize(); // Get the Master base
            console.log(`[DEBUG-RUN-ID-FLOW] Using Master base for recovery search`);
            
            let similarRecords = await masterBase('Client Run Results').select({
              filterByFormula: `AND(FIND('${partialRunId}', {Run ID}) > 0, {Client ID} = '${clientId}')`,
              maxRecords: 5
            }).firstPage();
            
            if (similarRecords && similarRecords.length > 0) {
              console.log(`[DEBUG-RUN-ID-FLOW] RECOVERY ATTEMPT: Found ${similarRecords.length} similar records:`);
              similarRecords.forEach(record => {
                console.log(`[DEBUG-RUN-ID-FLOW] - Similar Run ID: ${record.fields['Run ID']}, Record ID: ${record.id}`);
              });
            } else {
              console.log(`[DEBUG-RUN-ID-FLOW] RECOVERY ATTEMPT: No similar records found`);
            }
          } catch (searchError) {
            console.error(`[DEBUG-RUN-ID-FLOW] RECOVERY ATTEMPT FAILED: ${searchError.message}`);
          }
          
          // Get the Apify Run ID if it exists in the start data
          const apifyRunId = startData?.apifyRunId || startData?.actorRunId || '';
          const profilesSubmitted = targetUrls ? targetUrls.length : 0;
          
          // We still need to try to update metrics for operational continuity
          // but we'll log it as an error
          try {
            if (typeof runRecordService.updateClientMetrics !== 'function') {
              console.error(`[ERROR] runRecordService.updateClientMetrics is not a function - cannot update metrics in fallback handler`);
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
              
              console.log(`[apify/process-client] Attempted metrics update despite missing run record`);
              console.log(`  - Total Posts Harvested: ${postsToday}`);
            }
          } catch (metricError) {
            console.error(`[ERROR] Failed to update client metrics in fallback handler: ${metricError.message}`);
          }
          console.log(`  - Apify API Costs: ${estimatedCost}`);
        }
      } catch (recordError) {
        // Error checking for existing record
        console.error(`[apify/process-client] ERROR: Failed to check for existing record: ${recordError.message}`);
        console.error(`[apify/process-client] Run ID: ${runIdToUse}, Client ID: ${clientId}`);
        
        // Try to update metrics anyway for operational continuity
        try {
          // Get the Apify Run ID if it exists in the start data
          const apifyRunId = startData?.apifyRunId || startData?.actorRunId || '';
          
          if (typeof runRecordService.updateClientMetrics !== 'function') {
            console.error(`[ERROR] runRecordService.updateClientMetrics is not a function - cannot update metrics in emergency handler`);
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
          console.log(`[apify/process-client] Attempted metrics update despite record lookup failure`);
        } catch (updateError) {
          console.error(`[apify/process-client] Failed to update metrics: ${updateError.message}`);
        }
      }
    } catch (metricError) {
      console.error(`[apify/process-client] Failed to update post harvesting metrics: ${metricError.message}`);
      console.error(`[DEBUG][METRICS_TRACKING] ERROR updating metrics: ${metricError.message}`);
      console.error(`[DEBUG][METRICS_TRACKING] Error stack: ${metricError.stack}`);
      console.error(`[DEBUG][METRICS_TRACKING] Client ID: ${clientId}, Run ID to use: ${runIdToUse || '(none)'}`);
      console.error(`[DEBUG][METRICS_TRACKING] Posts today value: ${postsToday}`);
      // Continue execution even if metrics update fails
    }
    
    const payload = { ok: true, clientId, postsToday, postsTarget, batches, runs };
    if (debugMode) payload.debug = { batches: debugBatches };
    
    // Check if response object exists (will be null in fire-and-forget mode)
    if (res) {
      return res.json(payload);
    } else {
      console.log(`[apify/process-level2-v2] Background processing completed successfully for client ${clientId}`);
      console.log(`[apify/process-level2-v2] Posts harvested: ${postsToday}, batches: ${batches}, runs: ${runs.length}`);
      return payload;
    }
    
  } catch (e) {
    let endpoint = req.path && req.path.includes('smart-resume') ? 'smart-resume' : 'apify';
    console.error(`[${endpoint}/process-client] error:`, e.message);
    
    // Check if response object exists (will be null in fire-and-forget mode)
    if (res) {
      return res.status(500).json({ ok: false, error: e.message });
    } else {
      console.error(`[apify/process-level2-v2] Background processing error: ${e.message}`);
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
    console.error('[apify/canary] error:', e.message);
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
      console.error('Missing MASTER_CLIENTS_BASE_ID env variable');
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
      status: record.get('Status')
    })).filter(client => client.clientId);
  } catch (error) {
    console.error('Error getting all clients:', error.message);
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
    // UPDATED: Using generateTimestampRunId directly for consistency
    const masterRunId = parentRunId || runIdService.generateTimestampRunId('batch-all-clients');
    console.log(`[batch-process] Starting batch processing with master run ID ${masterRunId} for ${clients.length} clients`);
    
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
        console.log(`[${endpoint}/batch] Processing client ${client.clientId} (${client.clientName})`);
        
        // Skip inactive clients
        if (client.status !== 'Active') {
          console.log(`[${endpoint}/batch] Skipping inactive client ${client.clientId}`);
          results.skipped++;
          results.clientResults[client.clientId] = { status: 'skipped', reason: 'inactive' };
          continue;
        }
        
        // Skip clients with service level < 2 for post harvesting (apify endpoint)
        if (endpoint === 'apify' && Number(client.serviceLevel) < 2) {
          console.log(`[${endpoint}/batch] Skipping client ${client.clientId} - service level ${client.serviceLevel} < 2`);
          results.skipped++;
          results.clientResults[client.clientId] = { status: 'skipped', reason: 'service_level' };
          continue;
        }
        
        // Create a consistent client-specific run ID that maintains the connection to the master run
        // This ensures job tracking records can be found consistently
        const clientRunId = `${masterRunId}-${client.clientId}`;
        console.log(`[${endpoint}/batch] Using consistent clientRunId: ${clientRunId} for client ${client.clientId}`);
        
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
        
        console.log(`[${endpoint}/batch] 🔍 STRICT RUN ID FLOW: For client ${client.clientId}:`);
        console.log(`[${endpoint}/batch] 🔍 - Source masterRunId: ${masterRunId}`);
        console.log(`[${endpoint}/batch] 🔍 - Client-specific runId: ${clientRunId}`);
        console.log(`[${endpoint}/batch] 🔍 - This specific runId will be preserved throughout the entire chain`);
        
        
        // Use a promise to capture the response
        const responsePromise = new Promise(resolve => {
          const mockRes = {
            json: resolve,
            status: () => ({ json: resolve })
          };
          
          processClientHandler(mockReq, mockRes);
        });
        
        const result = await responsePromise;
        console.log(`[${endpoint}/batch] Client ${client.clientId} result:`, result);
        
        if (result.ok) {
          results.successful++;
          results.clientResults[client.clientId] = { status: 'success', ...result };
        } else {
          results.failed++;
          results.clientResults[client.clientId] = { status: 'failed', error: result.error };
        }
      } catch (clientError) {
        console.error(`[${endpoint}/batch] Error processing client ${client.clientId}:`, clientError.message);
        results.failed++;
        results.clientResults[client.clientId] = { status: 'failed', error: clientError.message };
      }
      
      // Add a small delay between client processing to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    results.endTime = new Date().toISOString();
    
    // Log the final results
    console.log(`[${endpoint}/batch] Batch processing complete: ${results.successful} successful, ${results.failed} failed, ${results.skipped} skipped`);
    
    // Save batch results to a file for debugging if needed
    try {
      const fs = require('fs');
      const resultsDir = './batch-results';
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
      }
      fs.writeFileSync(`${resultsDir}/${masterRunId}.json`, JSON.stringify(results, null, 2));
    } catch (fsError) {
      console.error(`[${endpoint}/batch] Error saving results:`, fsError.message);
    }
    
    return results;
  } catch (error) {
    console.error('[batch-process] Error processing clients in background:', error.message);
    return { error: error.message };
  }
}

module.exports = router;