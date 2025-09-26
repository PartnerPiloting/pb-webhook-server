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
// SIMPLIFIED: Use the adapter that enforces the Simple Creation Point pattern
const runRecordService = require('../services/runRecordAdapterSimple');

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
    if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    clientId = req.headers['x-client-id'];
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
    postsToday = await computeTodaysPosts(base);
    console.log(`[apify/process-client] Client ${clientId} postsToday: ${postsToday}, target: ${postsTarget}`);
    
    batches = 0;
    
    // Set debug mode
    debugMode = req.query?.debug === '1' || req.body?.debug === true;

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
    
    // SIMPLIFIED: We strictly require a parent run ID - no fallbacks
    if (!parentRunId) {
      // No parent run ID provided - this is now a hard error
      const errorMsg = `No parent run ID provided - this process requires a parent run ID`;
      console.error(`[ERROR] ${errorMsg}`);
      return res.status(400).json({ ok: false, error: errorMsg });
    }
    
    // Use the parent run ID from Smart Resume
    console.log(`[DEBUG][METRICS_TRACKING] Parent run ID provided: ${parentRunId}`);
    runIdToUse = runIdService.normalizeRunId(parentRunId, clientId);
    console.log(`[DEBUG][METRICS_TRACKING] Using parent run ID: ${runIdToUse}`);
    
    // Verify that we have a runIdToUse (from parent) - it should always be provided
    if (!runIdToUse) {
      throw new Error('[apify/process-client] No run ID provided - this process should be called with a parent run ID');
    }
    console.log(`[apify/process-client] Using parent run record: ${runIdToUse}`);
    
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
        console.log(`[DEBUG][METRICS_TRACKING] Checking for existing client run record: ${runIdToUse} for client ${clientId}`);
        const clientBase = await getClientBase(clientId);
        const runRecords = await clientBase('Client Run Results').select({
          filterByFormula: `{Run ID} = '${runIdToUse}'`,
          maxRecords: 1
        }).firstPage();
        
        if (runRecords && runRecords.length > 0) {
          // Get current values, default to 0 if not set
          const currentRecord = runRecords[0];
          const currentPostCount = Number(currentRecord.get('Total Posts Harvested') || 0);
          const currentApiCosts = Number(currentRecord.get('Apify API Costs') || 0);
          const profilesSubmittedCount = Number(currentRecord.get('Profiles Submitted for Post Harvesting') || 0);
          const currentApifyRunId = currentRecord.get('Apify Run ID');
          
          console.log(`[DEBUG][METRICS_TRACKING] Found existing record for ${runIdToUse}:`);
          console.log(`[DEBUG][METRICS_TRACKING] - Current Posts Harvested: ${currentPostCount}`);
          console.log(`[DEBUG][METRICS_TRACKING] - Current API Costs: ${currentApiCosts}`);
          console.log(`[DEBUG][METRICS_TRACKING] - Current Profiles Submitted: ${profilesSubmittedCount}`);
          console.log(`[DEBUG][METRICS_TRACKING] - Current Apify Run ID: ${currentApifyRunId || '(empty)'}`);
          console.log(`[DEBUG][METRICS_TRACKING] - New postsToday value: ${postsToday}`);
          
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
          
          await runRecordService.updateClientMetrics(runIdToUse, clientId, {
            'Total Posts Harvested': updatedCount,
            'Apify API Costs': updatedCosts,
            'Apify Run ID': apifyRunId,
            'Profiles Submitted for Post Harvesting': updatedProfilesSubmitted
          }, { source: 'apifyProcessRoutes' });
          
          console.log(`[apify/process-client] Updated client run record for ${clientId}:`);
          console.log(`  - Total Posts Harvested: ${currentPostCount} → ${updatedCount}`);
          console.log(`  - Apify API Costs: ${currentApiCosts} → ${updatedCosts}`);
        } else {
          // ERROR: Record not found - this should have been created at the beginning of this process
          const errorMsg = `ERROR: Client run record not found for ${runIdToUse} (${clientId})`;
          console.error(`[apify/process-client] ${errorMsg}`);
          console.error(`[apify/process-client] This indicates a process kickoff issue - run record should exist`);
          console.error(`[apify/process-client] Run ID: ${runIdToUse}, Client ID: ${clientId}`);
          
          // Get the Apify Run ID if it exists in the start data
          const apifyRunId = startData?.apifyRunId || startData?.actorRunId || '';
          const profilesSubmitted = targetUrls ? targetUrls.length : 0;
          
          // We still need to try to update metrics for operational continuity
          // but we'll log it as an error
          try {
            await runRecordService.updateClientMetrics(runIdToUse, clientId, {
              'Total Posts Harvested': postsToday,
              'Apify API Costs': estimatedCost,
              'Apify Run ID': apifyRunId,
              'Profiles Submitted for Post Harvesting': profilesSubmitted
            }, { source: 'apifyProcessRoutes_fallback' });
            
            console.log(`[apify/process-client] Attempted metrics update despite missing run record`);
            console.log(`  - Total Posts Harvested: ${postsToday}`);
            console.log(`  - Apify API Costs: ${estimatedCost}`);
          } catch (updateError) {
            console.error(`[apify/process-client] Failed to update metrics: ${updateError.message}`);
          }
        }
      } catch (recordError) {
        // Error checking for existing record
        console.error(`[apify/process-client] ERROR: Failed to check for existing record: ${recordError.message}`);
        console.error(`[apify/process-client] Run ID: ${runIdToUse}, Client ID: ${clientId}`);
        
        // Try to update metrics anyway for operational continuity
        try {
          // Get the Apify Run ID if it exists in the start data
          const apifyRunId = startData?.apifyRunId || startData?.actorRunId || '';
          
          await runRecordService.updateClientMetrics(runIdToUse, clientId, {
            'Total Posts Harvested': postsToday,
            'Apify Run ID': apifyRunId,
            'Profiles Submitted for Post Harvesting': targetUrls ? targetUrls.length : 0
          }, { source: 'apifyProcessRoutes_emergency' });
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