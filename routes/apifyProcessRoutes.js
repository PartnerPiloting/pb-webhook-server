// routes/apifyProcessRoutes.js
// Process a client's leads in batches until Posts Daily Target is met

const express = require('express');
const router = express.Router();
const { getClientBase, createBaseInstance } = require('../config/airtableClient');
const { getClientById } = require('../services/clientService');
const { getFetch } = require('../utils/safeFetch');
const fetch = getFetch();
const runIdUtils = require('../utils/runIdUtils');
const runIdService = require('../services/runIdService');

// Check if we're in batch process testing mode
const TESTING_MODE = process.env.FIRE_AND_FORGET_BATCH_PROCESS_TESTING === 'true';
// Check if we should ignore post harvesting limits
const IGNORE_POST_HARVESTING_LIMITS = process.env.IGNORE_POST_HARVESTING_LIMITS === 'true';

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
  // Align with selection criteria: has URL, not actioned, not already post-scored, and eligible harvest status
  const formula = `AND({${LINKEDIN_URL_FIELD}} != '',
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
  // Prefer sorting by most recently created leads first. If the Created Time field
  // does not exist on a tenant base, gracefully fall back to no explicit sort.
  const selectOptions = {
    filterByFormula: formula,
    maxRecords: batchSize,
    fields: [LINKEDIN_URL_FIELD, STATUS_FIELD, CREATED_TIME_FIELD],
    sort: [{ field: CREATED_TIME_FIELD, direction: 'desc' }]
  };
  try {
    const records = await base(LEADS_TABLE).select(selectOptions).firstPage();
    return records;
  } catch (e) {
    // Fallback without sort (e.g., if Created Time field is missing)
    const fallbackOptions = {
      filterByFormula: formula,
      maxRecords: batchSize,
      fields: [LINKEDIN_URL_FIELD, STATUS_FIELD]
    };
    const records = await base(LEADS_TABLE).select(fallbackOptions).firstPage();
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
router.post('/api/apify/process-client', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const clientId = req.headers['x-client-id'];
    if (!clientId) return res.status(400).json({ ok: false, error: 'Missing x-client-id header' });

    // Get parent run ID from query params or body (if provided)
    const parentRunId = req.query.parentRunId || (req.body && req.body.parentRunId);

    const client = await getClientById(clientId);
    console.log(`[apify/process-client] Processing client: ${clientId}`);
    if (!client) {
      console.log(`[apify/process-client] Client not found: ${clientId}`);
      return res.status(404).json({ ok: false, error: 'Client not found' });
    }
    console.log(`[apify/process-client] Client found: ${client.clientName}, status: ${client.status}, serviceLevel: ${client.serviceLevel}`);
    
    // Skip inactive clients and service level check UNLESS we're in testing mode
    if (!TESTING_MODE) {
      if (client.status !== 'Active') {
        console.log(`[apify/process-client] Client ${clientId} not Active, skipping`);
        return res.status(200).json({ ok: true, skipped: true, reason: 'Client not Active' });
      }
      if (Number(client.serviceLevel) < 2) {
        console.log(`[apify/process-client] Client ${clientId} service level ${client.serviceLevel} < 2, skipping`);
        return res.status(200).json({ ok: true, skipped: true, reason: 'Service level < 2' });
      }
    } else {
      console.log(`[apify/process-client] 🧪 TESTING MODE - Bypassing active status and service level checks`);
    }

    // In testing mode, use small fixed limits; otherwise use client configuration
    let postsTarget, batchSize, maxBatches;
    
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

    const base = await getClientBase(clientId);

    // running tally
    let postsToday = await computeTodaysPosts(base);
    console.log(`[apify/process-client] Client ${clientId} postsToday: ${postsToday}, target: ${postsTarget}`);
    
    let batches = 0;
    const runs = [];

  const debugMode = req.query?.debug === '1' || req.body?.debug === true;
  const debugBatches = [];

  while ((IGNORE_POST_HARVESTING_LIMITS || postsToday < postsTarget) && batches < maxBatches) {
      console.log(`[apify/process-client] Client ${clientId} batch ${batches + 1}: picking ${batchSize} leads`);
      const pick = await pickLeadBatch(base, batchSize);
      console.log(`[apify/process-client] Client ${clientId} picked ${pick.length} leads`);
      if (!pick.length) {
        console.log(`[apify/process-client] Client ${clientId} no more eligible leads, breaking`);
        break;
      }

      // Generate a proper run ID using runIdService
      const placeholderRunId = runIdService.generateRunId(clientId);
      console.log(`[apify/process-client] Client ${clientId} batch ${batches + 1}: Generated run ID: ${placeholderRunId}`);
      await base(LEADS_TABLE).update(pick.map(r => ({
        id: r.id,
        fields: { [STATUS_FIELD]: 'Processing', [RUN_ID_FIELD]: placeholderRunId, [LAST_CHECK_AT_FIELD]: nowISO() }
      })));

      // prepare targetUrls
      const targetUrls = pick.map(r => r.get(LINKEDIN_URL_FIELD)).filter(Boolean);
      console.log(`[apify/process-client] Client ${clientId} batch ${batches + 1}: ${targetUrls.length} LinkedIn URLs to process`);
      
      if (debugMode) {
        debugBatches.push({ pickedCount: pick.length, targetUrls });
      }

      // call our own /api/apify/run in inline mode so we wait and sync immediately
      const baseUrl = process.env.API_PUBLIC_BASE_URL
        || process.env.NEXT_PUBLIC_API_BASE_URL
        || `http://localhost:${process.env.PORT || 3001}`;
      console.log(`[apify/process-client] Client ${clientId} calling Apify run at ${baseUrl}/api/apify/run`);
      
      const startResp = await fetch(`${baseUrl}/api/apify/run`, {
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
      const startData = await startResp.json().catch(() => ({}));
      console.log(`[apify/process-client] Client ${clientId} Apify response status: ${startResp.status}, data:`, startData);

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
  
  // Update client run record with post harvest metrics
  try {
    const airtableService = require('../services/airtableService');
    // Use parentRunId if provided, otherwise fall back to the latest run ID
    let runIdToUse;
    
    if (parentRunId) {
      // If we have a parent run ID from Smart Resume, use it for consistent tracking
      // Use runIdService to normalize the run ID with the client suffix
      runIdToUse = runIdService.normalizeRunId(parentRunId, clientId);
      console.log(`[apify/process-client] Using normalized run ID: ${runIdToUse} from parent ID ${parentRunId}`);
      console.log(`[apify/process-client] Generated client-specific run ID: ${runIdToUse} from parent ID ${parentRunId}`);
    } else {
      // Fall back to latest run ID from this process
      const latestRun = runs.length > 0 ? runs[runs.length - 1] : null;
      runIdToUse = latestRun?.runId;
    }
    
    if (runIdToUse) {
      await airtableService.updateClientRun(runIdToUse, clientId, {
        'Total Posts Harvested': postsToday
      });
      console.log(`[apify/process-client] Updated client run record for ${clientId} with ${postsToday} posts harvested (Run ID: ${runIdToUse})`);
    }
  } catch (metricError) {
    console.error(`[apify/process-client] Failed to update post harvesting metrics: ${metricError.message}`);
    // Continue execution even if metrics update fails
  }
  
  const payload = { ok: true, clientId, postsToday, postsTarget, batches, runs };
  if (debugMode) payload.debug = { batches: debugBatches };
  return res.json(payload);

  } catch (e) {
    console.error('[apify/process-client] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

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

module.exports = router;

// Orchestrator: process all active clients (or one via ?client=)
// POST /api/apify/process?client=OptionalClientId&debug=1
// Headers: Authorization: Bearer PB_WEBHOOK_SECRET
// Body: { maxBatchesOverride?: number }
router.post('/api/apify/process', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const singleClientId = (req.query?.client || req.body?.clientId || '').toString().trim();
    const debug = req.query?.debug === '1' || req.body?.debug === true;
    const maxBatchesOverride = req.body?.maxBatchesOverride;

    const baseUrl = process.env.API_PUBLIC_BASE_URL
      || process.env.NEXT_PUBLIC_API_BASE_URL
      || `http://localhost:${process.env.PORT || 3001}`;

    // Helper to call process-client
    const callProcessClient = async (clientId) => {
      const url = `${baseUrl}/api/apify/process-client${debug ? '?debug=1' : ''}`;
      const body = {};
      if (typeof maxBatchesOverride !== 'undefined') body.maxBatchesOverride = maxBatchesOverride;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret}`,
          'x-client-id': clientId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => ({}));
      return { status: resp.status, data };
    };

    if (singleClientId) {
      const result = await callProcessClient(singleClientId);
      return res.status(result.status).json({ ok: true, mode: 'single', clientId: singleClientId, result: result.data });
    }

    // No client specified: iterate through clients
    let clientsToProcess = [];
    
    if (TESTING_MODE) {
      // In testing mode, get ALL clients, not just active ones, but limit to 5
      const { getAllClients } = require('../services/clientService');
      const allClients = await getAllClients();
      clientsToProcess = allClients.slice(0, 5); // Process at most 5 clients in testing mode
      console.log(`[apify/process] 🧪 TESTING MODE - Processing up to 5 clients regardless of status: ${clientsToProcess.map(c => c.clientId).join(', ')}`);
    } else {
      // Normal mode - only process active clients
      const { getAllActiveClients } = require('../services/clientService');
      clientsToProcess = await getAllActiveClients();
      console.log(`[apify/process] Normal mode - Processing ${clientsToProcess.length} active clients`);
    }
    const summaries = [];

    for (const c of clientsToProcess) {
      // In normal mode, skip clients with service level < 2; in testing mode, process all
      if (!TESTING_MODE && Number(c.serviceLevel) < 2) {
        console.log(`[apify/process] Skipping client ${c.clientId}: service level ${c.serviceLevel} < 2`);
        summaries.push({ clientId: c.clientId, skipped: true, reason: 'Service level < 2' });
        continue;
      }
      
      try {
        const r = await callProcessClient(c.clientId);
        summaries.push({ clientId: c.clientId, status: r.status, result: r.data });
      } catch (err) {
        summaries.push({ clientId: c.clientId, status: 500, result: { ok: false, error: err.message } });
      }
    }

    const processed = summaries.length;
    return res.json({ ok: true, mode: 'all', processed, summaries });
  } catch (e) {
    console.error('[apify/process] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Orchestrator: pick N leads, harvest via Apify (inline), then score just those leads.
// POST /api/apify/pick-run-score?limit=10
// Headers: Authorization: Bearer <PB_WEBHOOK_SECRET>, x-client-id: <clientId>
// Body: { postedLimit?: 'year'|'any', maxPosts?: number }
// Returns: { ok, picked, harvest: { items, posts, runId }, scoring: { processed, scored, skipped, errors }, ids }
router.post('/api/apify/pick-run-score', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const clientId = req.headers['x-client-id'];
    if (!clientId) return res.status(400).json({ ok: false, error: 'Missing x-client-id header' });

    // In testing mode, always limit to 5, otherwise use the provided limit
    const limit = TESTING_MODE ? 
      Math.min(5, Math.max(1, parseInt(req.query.limit || req.body?.limit || '5', 10))) :
      Math.max(1, parseInt(req.query.limit || req.body?.limit || '10', 10));
      
    if (TESTING_MODE) {
      console.log(`[apify/pick-run-score] 🧪 TESTING MODE - Limiting batch to ${limit} leads`);
    }
    
    const base = await getClientBase(clientId);

    // Pick leads (reuse pickLeadBatch but cap to limit)
    const batch = await pickLeadBatch(base, limit);
    if (!batch.length) return res.json({ ok: true, picked: 0, note: 'No eligible leads to harvest' });

    // Prepare target URLs
    const targetUrls = batch.map(r => r.get(LINKEDIN_URL_FIELD)).filter(Boolean);
    // Run Apify inline to harvest immediately
    const baseUrl = process.env.API_PUBLIC_BASE_URL
      || process.env.NEXT_PUBLIC_API_BASE_URL
      || `http://localhost:${process.env.PORT || 3001}`;
    const apifyResp = await fetch(`${baseUrl}/api/apify/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'x-client-id': clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        targetUrls,
        mode: 'inline',
        options: {
          // In testing mode, cap at 2 posts per profile
          maxPosts: TESTING_MODE ? 2 : (Number(req.body?.maxPosts) || Number(process.env.APIFY_MAX_POSTS) || 2),
          postedLimit: typeof req.body?.postedLimit === 'string' ? req.body.postedLimit : (process.env.APIFY_POSTED_LIMIT || 'year'),
          expectsCookies: true
        }
      })
    });
    const apifyData = await apifyResp.json().catch(() => ({}));

    // Score exactly these picked records (by record IDs)
    const ids = batch.map(r => r.id);
    const scoreResp = await fetch(`${baseUrl}/run-post-batch-score-simple?clientId=${encodeURIComponent(clientId)}&limit=${ids.length}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, verboseErrors: true, maxVerboseErrors: 25 })
    });
    const scoreData = await scoreResp.json().catch(() => ({}));

    return res.json({
      ok: true,
      picked: batch.length,
      ids,
      harvest: apifyData?.counts ? { items: apifyData.counts.items || 0, posts: apifyData.counts.posts || 0, runId: apifyData.runId || null } : null,
      scoring: scoreData?.status ? {
        processed: scoreData.processed || 0,
        scored: scoreData.scored || 0,
        skipped: scoreData.skipped || 0,
        errors: scoreData.errors || 0,
        skipCounts: scoreData.skipCounts || {}
      } : null
    });
  } catch (e) {
    console.error('[apify/pick-run-score] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Orchestrator: process only active clients with service level >= 2
// POST /api/apify/process-level2
// Headers: Authorization: Bearer PB_WEBHOOK_SECRET
router.post('/api/apify/process-level2', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const baseUrl = process.env.API_PUBLIC_BASE_URL
      || process.env.NEXT_PUBLIC_API_BASE_URL
      || `http://localhost:${process.env.PORT || 3001}`;

    const { getAllActiveClients } = require('../services/clientService');
    const activeClients = await getAllActiveClients();
    const candidates = activeClients.filter(c => Number(c.serviceLevel) >= 2);

    const summaries = [];
    const callProcessClient = async (clientId) => {
      const url = `${baseUrl}/api/apify/process-client`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret}`,
          'x-client-id': clientId,
          'Content-Type': 'application/json'
        }
      });
      const data = await resp.json().catch(() => ({}));
      return { status: resp.status, data };
    };

    for (const c of candidates) {
      try {
        const r = await callProcessClient(c.clientId);
        summaries.push({ clientId: c.clientId, status: r.status, result: r.data });
      } catch (err) {
        summaries.push({ clientId: c.clientId, status: 500, result: { ok: false, error: err.message } });
      }
    }

    return res.json({ ok: true, processed: summaries.length, summaries });
  } catch (e) {
    console.error('[apify/process-level2] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Fire-and-forget version: POST /api/apify/process-level2-v2
// Headers: Authorization: Bearer PB_WEBHOOK_SECRET
// Query params: ?stream=1 (optional, defaults to 1)
router.post('/api/apify/process-level2-v2', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const stream = parseInt(req.query.stream) || 1;
    const singleClientId = req.query.clientId; // Optional: process single client
    const parentRunId = req.query.parentRunId; // Optional: parent run ID from Smart Resume
    const { generateJobId, setJobStatus, setProcessingStream, getActiveClientsByStream } = require('../services/clientService');
    
    // Generate job ID and set initial status
    const jobId = generateJobId('post_harvesting', stream);
    const clientDesc = singleClientId ? ` for client ${singleClientId}` : '';
    console.log(`[apify/process-level2-v2] Starting fire-and-forget post harvesting${clientDesc}, jobId: ${jobId}, stream: ${stream}`);

    // Return 202 Accepted immediately
    res.status(202).json({
      ok: true,
      message: `Post harvesting started in background${clientDesc}`,
      jobId,
      stream,
      clientId: singleClientId,
      timestamp: new Date().toISOString()
    });

    // Start background processing
    processPostHarvestingInBackground(jobId, stream, secret, singleClientId, parentRunId);

  } catch (e) {
    console.error('[apify/process-level2-v2] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Background processing function for post harvesting
async function processPostHarvestingInBackground(jobId, stream, secret, singleClientId, parentRunId) {
  const {
    getAllActiveClients,
    setJobStatus,
    setProcessingStream,
    formatDuration,
    getActiveClientsByStream
  } = require('../services/clientService');
  
  // Create a structured logger for post harvesting with the specific process type
  const { StructuredLogger } = require('../utils/structuredLogger');
  const harvestLogger = new StructuredLogger('POST-HARVEST-JOB', null, 'post_harvesting');

  const MAX_CLIENT_PROCESSING_MINUTES = parseInt(process.env.MAX_CLIENT_PROCESSING_MINUTES) || 10;
  const MAX_JOB_PROCESSING_HOURS = parseInt(process.env.MAX_JOB_PROCESSING_HOURS) || 2;

  const jobStartTime = Date.now();
  const jobTimeoutMs = MAX_JOB_PROCESSING_HOURS * 60 * 60 * 1000;
  const clientTimeoutMs = MAX_CLIENT_PROCESSING_MINUTES * 60 * 1000;

  let processedCount = 0;
  let harvestedCount = 0;
  let errorCount = 0;

  try {
    harvestLogger.setup(`Starting job ${jobId} on stream ${stream}`);

    // Set initial job status (don't set processing stream for operation)
    await setJobStatus(null, 'post_harvesting', 'STARTED', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: '0 seconds',
      lastRunCount: 0
    });

    // Get active clients filtered by processing stream and service level >= 2
    const streamClients = await getActiveClientsByStream(stream, singleClientId);
    const candidates = streamClients.filter(c => Number(c.serviceLevel) >= 2);
    
    harvestLogger.setup(`Found ${candidates.length} level 2+ clients on stream ${stream} to process`);
    
    // Add detailed reason if no clients found
    if (candidates.length === 0) {
      const reason = singleClientId 
        ? `No eligible client found with ID ${singleClientId} (requires service level 2+)`
        : `No eligible clients found on stream ${stream} (requires service level 2+)`;
      
      harvestLogger.info(reason);
      
      // Complete job with reason
      await setJobStatus(null, 'post_harvesting', 'COMPLETED', jobId, {
        lastRunDate: new Date().toISOString(),
        lastRunTime: formatDuration(Date.now() - jobStartTime),
        lastRunCount: 0,
        lastRunStatus: reason
      });
      
      return {
        processed: 0,
        harvested: 0,
        errors: 0,
        reason: reason
      };
    }

    const baseUrl = process.env.API_PUBLIC_BASE_URL
      || process.env.NEXT_PUBLIC_API_BASE_URL
      || `http://localhost:${process.env.PORT || 3001}`;

    // Update status to RUNNING
    await setJobStatus(null, 'post_harvesting', 'RUNNING', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: formatDuration(Date.now() - jobStartTime),
      lastRunCount: processedCount
    });

    // Process each client
    for (const client of candidates) {
      // Check job timeout
      if (Date.now() - jobStartTime > jobTimeoutMs) {
        const timeoutReason = `Job timeout reached (${MAX_JOB_PROCESSING_HOURS}h), killing job ${jobId}`;
        harvestLogger.warn(timeoutReason);
        
        await setJobStatus(null, 'post_harvesting', 'JOB_TIMEOUT_KILLED', jobId, {
          lastRunDate: new Date().toISOString(),
          lastRunTime: formatDuration(Date.now() - jobStartTime),
          lastRunCount: processedCount,
          lastRunStatus: timeoutReason
        });
        return;
      }

      const clientStartTime = Date.now();
      harvestLogger.process(`Processing client ${client.clientId} (${processedCount + 1}/${candidates.length})`);

      try {
        // Set up client timeout
        const clientPromise = processClientForHarvesting(client.clientId, secret, baseUrl, parentRunId);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Client timeout')), clientTimeoutMs)
        );

        const result = await Promise.race([clientPromise, timeoutPromise]);
        
        if (result?.data?.harvest?.posts) {
          harvestedCount += result.data.harvest.posts;
        }

        const clientDuration = Date.now() - clientStartTime;
        harvestLogger.info(`Client ${client.clientId} completed in ${formatDuration(clientDuration)}`);

      } catch (error) {
        errorCount++;
        if (error.message === 'Client timeout') {
          harvestLogger.warn(`Client ${client.clientId} timeout (${MAX_CLIENT_PROCESSING_MINUTES}m), skipping`);
        } else {
          harvestLogger.error(`Client ${client.clientId} error: ${error.message}`);
        }
      }

      processedCount++;

      // Update progress
      await setJobStatus(null, 'post_harvesting', 'RUNNING', jobId, {
        lastRunDate: new Date().toISOString(),
        lastRunTime: formatDuration(Date.now() - jobStartTime),
        lastRunCount: harvestedCount
      });
    }

    // Job completed successfully
    const finalDuration = formatDuration(Date.now() - jobStartTime);
    
    // Create a detailed summary of what happened
    const summaryReason = `Job completed. Processed ${processedCount} clients, harvested ${harvestedCount} posts${errorCount > 0 ? `, with ${errorCount} errors` : ''}`;
    
    harvestLogger.summary(`Job ${jobId} completed. Processed: ${processedCount}, Harvested: ${harvestedCount}, Errors: ${errorCount}, Duration: ${finalDuration}`);

    // If we have a parent run ID, update the client run record with the harvested posts count
    if (parentRunId) {
      try {
        const airtableService = require('../services/airtableService');
        for (const client of candidates) {
          // Create a client-specific version of the parent run ID using utility functions
          const baseRunId = runIdUtils.stripClientSuffix(parentRunId);
          const clientRunId = runIdUtils.addClientSuffix(baseRunId, client.clientId);
          harvestLogger.info(`Generated client-specific run ID: ${clientRunId} from parent ID ${parentRunId}`);
          
          await airtableService.updateClientRun(clientRunId, client.clientId, {
            'Total Posts Harvested': harvestedCount
            // Removed problematic fields 'Last Run Date' and 'Last Run Time'
          });
          harvestLogger.info(`Updated client run record for ${client.clientId} with ${harvestedCount} posts harvested using run ID: ${clientRunId}`);
        }
      } catch (metricError) {
        harvestLogger.error(`Failed to update post harvesting metrics with parent run ID: ${metricError.message}`);
        // Continue execution even if metrics update fails
      }
    }

    await setJobStatus(null, 'post_harvesting', 'COMPLETED', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: finalDuration,
      lastRunCount: harvestedCount,
      lastRunStatus: summaryReason // Include the summary reason
    });

  } catch (error) {
    harvestLogger.error(`Job ${jobId} failed: ${error.message}`);
    const failureReason = `Job failed: ${error.message}`;
    
    await setJobStatus(null, 'post_harvesting', 'FAILED', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: formatDuration(Date.now() - jobStartTime),
      lastRunCount: harvestedCount,
      lastRunStatus: failureReason
    });
  }
}

// Helper function to process individual client for harvesting
async function processClientForHarvesting(clientId, secret, baseUrl, parentRunId) {
  const url = `${baseUrl}/api/apify/process-client${parentRunId ? `?parentRunId=${encodeURIComponent(parentRunId)}` : ''}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secret}`,
      'x-client-id': clientId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      parentRunId: parentRunId // Also include in body for safety
    })
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}
