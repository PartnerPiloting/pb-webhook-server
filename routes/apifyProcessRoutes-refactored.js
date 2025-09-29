// routes/apifyProcessRoutes-refactored.js
// Process a client's leads in batches until Posts Daily Target is met
// Completely refactored to use the new service boundaries architecture

const express = require('express');
const router = express.Router();
const Airtable = require('airtable');
const { getClientBase, createBaseInstance } = require('../config/airtableClient');
const clientService = require('../services/clientService');
const { StructuredLogger } = require('../utils/structuredLogger');
const { getFetch } = require('../utils/safeFetch');
const fetch = getFetch();

// Use the new service boundaries architecture
const airtableService = require('../services/airtable/airtableService');
const runIdService = require('../services/airtable/runIdService');
const runRecordRepository = require('../services/airtable/runRecordRepository');
const baseManager = require('../services/airtable/baseManager');
const jobTrackingRepository = require('../services/airtable/jobTrackingRepository');

// Check if we're in batch process testing mode
const TESTING_MODE = process.env.FIRE_AND_FORGET_BATCH_PROCESS_TESTING === 'true';
// Check if we should ignore post harvesting limits
const IGNORE_POST_HARVESTING_LIMITS = process.env.IGNORE_POST_HARVESTING_LIMITS === 'true';
// Check if we should use relaxed selection criteria (useful for debugging)
const RELAXED_LEAD_SELECTION = process.env.RELAXED_LEAD_SELECTION === 'true';

// Table and field constants
const LEADS_TABLE = 'Leads';
const LINKEDIN_URL_FIELD = 'LinkedIn Profile URL';
const STATUS_FIELD = 'Posts Harvest Status';
const LAST_CHECK_AT_FIELD = 'Last Post Check At';
const FOUND_LAST_RUN_FIELD = 'Posts Found (Last Run)';
const RUN_ID_FIELD = 'Posts Harvest Run ID';
const POSTS_ACTIONED_FIELD = 'Posts Actioned';
const DATE_POSTS_SCORED_FIELD = 'Date Posts Scored';
const CREATED_TIME_FIELD = 'Created Time';

// Helper functions
const nowISO = () => new Date().toISOString();

/**
 * Helper to get the actual URL for an actor
 * @param {string} actorId - The Apify actor ID
 * @returns {string} The complete URL for the actor
 */
function getActorUrl(actorId) {
  return `https://api.apify.com/v2/acts/${actorId}/runs`;
}

/**
 * Estimate the cost of processing the given number of posts
 * @param {number} postCount - Number of posts being processed
 * @returns {number} Estimated cost in USD
 */
function estimateApifyCost(postCount) {
  return postCount * 0.02; // $0.02 per post
}

/**
 * Enforce post harvesting limits based on client service level and configuration
 * @param {Object} options - Options for enforcement
 * @param {Object} options.client - Client details
 * @param {number} options.currentPostCount - Current post count for the client
 * @param {number} options.postsToday - Posts harvested today
 * @param {number} options.targetUrls - Target URLs to process
 * @param {Object} options.logger - Logger instance
 * @returns {Object} Enforcement result with allowed URLs and reason
 */
function enforcePostHarvestingLimits({ client, currentPostCount, postsToday, targetUrls, logger }) {
  // Default to an empty array if not provided
  const urlsToProcess = targetUrls || [];
  
  // Get the client's service level limits
  const serviceLevel = client?.serviceLevel || 'basic';
  const dailyTarget = client?.postsTarget || 25; // Default to 25
  
  // Check if we're in testing mode or should ignore limits
  if (TESTING_MODE || IGNORE_POST_HARVESTING_LIMITS) {
    logger.debug(`Skipping post harvesting limits in testing mode or limits disabled`);
    return {
      allowedUrls: urlsToProcess,
      totalAllowed: urlsToProcess.length,
      enforced: false,
      reason: TESTING_MODE ? 'Testing mode enabled' : 'Limits explicitly disabled'
    };
  }
  
  // Determine how many more posts can be harvested today
  const postsRemaining = Math.max(0, dailyTarget - postsToday);
  
  // Determine how many more posts can be harvested in total
  const maxPostsPerClient = parseInt(process.env.MAX_POSTS_PER_CLIENT || '100', 10);
  const totalPostsRemaining = Math.max(0, maxPostsPerClient - currentPostCount);
  
  // Take the minimum of the two limits
  const harvestingLimit = parseInt(process.env.POST_HARVESTING_LIMIT || '50', 10);
  const actualLimit = Math.min(postsRemaining, totalPostsRemaining, harvestingLimit);
  
  if (actualLimit <= 0) {
    logger.debug(`Post harvesting limit reached: dailyTarget=${dailyTarget}, current=${postsToday}, total=${currentPostCount}`);
    return {
      allowedUrls: [],
      totalAllowed: 0,
      enforced: true,
      reason: postsRemaining <= 0 
        ? `Daily target of ${dailyTarget} posts reached (${postsToday} harvested)`
        : `Maximum post limit of ${maxPostsPerClient} reached (${currentPostCount} total posts)`
    };
  }
  
  // If there are more URLs than the limit, truncate the list
  if (urlsToProcess.length > actualLimit) {
    logger.debug(`Limiting URLs from ${urlsToProcess.length} to ${actualLimit}`);
    return {
      allowedUrls: urlsToProcess.slice(0, actualLimit),
      totalAllowed: actualLimit,
      enforced: true,
      reason: `Limited to ${actualLimit} posts (daily target: ${dailyTarget}, current: ${postsToday}, total: ${currentPostCount})`
    };
  }
  
  // No limits applied
  return {
    allowedUrls: urlsToProcess,
    totalAllowed: urlsToProcess.length,
    enforced: false,
    reason: `No limits applied (daily target: ${dailyTarget}, current: ${postsToday}, total: ${currentPostCount})`
  };
}

/**
 * Process a client for post harvesting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function processClientHandler(req, res) {
  // Define variables at the top level so they're available in all scopes
  const startTime = Date.now();
  let clientRunId = null;
  let clientId = null;
  const logger = new StructuredLogger('system', null, 'apify_process');
  
  try {
    // Basic validation
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    
    if (!secret) {
      logger.error('Server missing PB_WEBHOOK_SECRET');
      return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    }
    
    if (auth && auth !== `Bearer ${secret}`) {
      logger.warn('Invalid authorization token');
      return res.status(401).json({ ok: false, error: 'Invalid authorization token' });
    }
    
    // Extract parameters from request
    clientId = req.headers['x-client-id'] || req.query.clientId || req.body.clientId;
    const apifyToken = req.query.token || req.body.token || process.env.APIFY_TOKEN;
    const actorId = req.query.actorId || req.body.actorId || 'hlidac-shopu/linkedin-posts';
    const parentRunId = req.query.parentRunId || req.body.parentRunId || runIdService.generateRunId();
    const waitForFinish = req.query.waitForFinish === 'true';
    const batchMode = req.query.batchMode === 'true';
    
    // Validate required parameters
    if (!clientId) {
      logger.error('Missing clientId parameter');
      return res.status(400).json({ error: 'Missing clientId parameter' });
    }
    
    if (!apifyToken) {
      logger.error(`Missing Apify token for client ${clientId}`);
      return res.status(400).json({ error: 'Missing Apify token' });
    }
    
    // Create a client-specific logger
    const clientLogger = new StructuredLogger(clientId, null, 'apify_process');
    clientLogger.debug(`Starting post harvesting process for client ${clientId}`);
    
    // Get client details
    const client = await clientService.getClientById(clientId);
    if (!client) {
      clientLogger.error(`Client not found: ${clientId}`);
      return res.status(404).json({ error: `Client not found: ${clientId}` });
    }
    
    // Create a client-specific run ID
    clientRunId = runIdService.addClientSuffix(parentRunId, clientId);
    clientLogger.debug(`Using run ID: ${clientRunId}`);
    
    // Create run record
    await runRecordRepository.createRunRecord({
      runId: clientRunId,
      clientId,
      clientName: client.name || clientId,
      initialData: {
        'System Notes': 'Source: apify_process, Operation: post_harvesting',
        'Status': 'running'
      },
      options: {
        logger: clientLogger
      }
    });
    
    // Get the client's Airtable base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      clientLogger.error(`Failed to get Airtable base for client ${clientId}`);
      
      await runRecordRepository.updateRunRecord({
        runId: clientRunId,
        clientId,
        updates: {
          'Status': 'error',
          'Error': 'Failed to get Airtable base'
        },
        options: { logger: clientLogger }
      });
      
      await runRecordRepository.completeRunRecord({
        runId: clientRunId,
        clientId,
        status: 'Error',
        notes: 'Failed to get Airtable base',
        options: { logger: clientLogger }
      });
      
      return res.status(500).json({ error: 'Failed to get Airtable base' });
    }
    
    // Get current post count for the client
    let currentPostCount = 0;
    let postsToday = 0;
    
    try {
      // Check "Posts" table for current count
      const postsCountQuery = await clientBase('Posts').select({
        fields: ['id'],
        maxRecords: 1
      }).firstPage();
      
      // Get total count using count formula
      const countResult = await clientBase('Settings').select({
        fields: ['Posts Count', 'Posts Today']
      }).firstPage();
      
      if (countResult && countResult.length > 0) {
        currentPostCount = parseInt(countResult[0].get('Posts Count') || '0', 10);
        postsToday = parseInt(countResult[0].get('Posts Today') || '0', 10);
      }
      
      clientLogger.debug(`Current post count: ${currentPostCount}, posts today: ${postsToday}`);
    } catch (error) {
      clientLogger.warn(`Failed to get post count: ${error.message}`);
      // Continue with default values
    }
    
    // Get leads with LinkedIn URLs that haven't had posts harvested
    const leadsFilter = RELAXED_LEAD_SELECTION
      ? 'AND({LinkedIn URL} != "", NOT({Posts Harvested}))'
      : 'AND({LinkedIn URL} != "", NOT({Posts Harvested}), {Status} = "Ready to Score")';
    
    clientLogger.debug(`Using lead filter: ${leadsFilter}`);
    
    const leadsQuery = await clientBase('Leads').select({
      filterByFormula: leadsFilter,
      fields: ['id', 'Name', 'LinkedIn URL', 'Posts Harvested'],
      maxRecords: 100
    }).firstPage();
    
    const targetUrls = leadsQuery
      .map(record => record.get('LinkedIn URL'))
      .filter(url => url && url.includes('linkedin.com'));
    
    clientLogger.debug(`Found ${targetUrls.length} leads with LinkedIn URLs`);
    
    // Update run record with initial stats
    await runRecordRepository.updateRunRecord({
      runId: clientRunId,
      clientId,
      updates: {
        'Leads Examined': leadsQuery.length,
        'Profile URLs Found': targetUrls.length
      },
      options: { logger: clientLogger }
    });
    
    // Apply post harvesting limits
    const limitResult = enforcePostHarvestingLimits({
      client,
      currentPostCount,
      postsToday,
      targetUrls,
      logger: clientLogger
    });
    
    if (limitResult.totalAllowed === 0) {
      clientLogger.debug(`Post harvesting skipped: ${limitResult.reason}`);
      
      await runRecordRepository.updateRunRecord({
        runId: clientRunId,
        clientId,
        updates: {
          'Profiles Submitted for Post Harvesting': 0,
          'Posts Examined for Harvesting': targetUrls.length,
          'Posts Skipped': targetUrls.length,
          'Status': 'skipped',
          'Skip Reason': limitResult.reason
        },
        options: { logger: clientLogger }
      });
      
      await runRecordRepository.completeRunRecord({
        runId: clientRunId,
        clientId,
        status: 'Skipped',
        notes: `Post harvesting skipped: ${limitResult.reason}`,
        options: { logger: clientLogger }
      });
      
      const endTime = Date.now();
      return res.json({
        status: 'skipped',
        reason: limitResult.reason,
        clientId,
        urlsFound: targetUrls.length,
        urlsProcessed: 0,
        duration: Math.round((endTime - startTime) / 1000)
      });
    }
    
    // Prepare URLs for processing
    const urlsToProcess = limitResult.allowedUrls;
    clientLogger.debug(`Processing ${urlsToProcess.length} URLs for post harvesting`);
    
    // Configure Apify run
    const apifyConfig = {
      token: apifyToken,
      profileUrls: urlsToProcess,
      maxPostCount: 25, // Limit posts per profile
      includeComments: client.serviceLevel === 'enterprise',
      waitForFinish
    };
    
    // Calculate estimated cost
    const estimatedCost = estimateApifyCost(urlsToProcess.length);
    clientLogger.debug(`Estimated Apify cost: $${estimatedCost.toFixed(2)}`);
    
    // Start Apify run
    const actorUrl = getActorUrl(actorId);
    const response = await fetch(actorUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apifyToken}`
      },
      body: JSON.stringify({
        userId: clientId,
        customData: {
          clientId,
          runId: clientRunId,
          service: 'post-harvesting',
          profileUrls: urlsToProcess,
          maxPostCount: apifyConfig.maxPostCount,
          includeComments: apifyConfig.includeComments,
          webhookCallMethod: 'POST'
        },
        startUrls: urlsToProcess.map(url => ({ url })),
        maxItems: urlsToProcess.length * apifyConfig.maxPostCount,
        customMapFunction: `async ({ request, page, customData }) => {
          return { url: request.url, clientId: customData.clientId, runId: customData.runId };
        }`,
        proxyConfiguration: { useApifyProxy: true },
        // Enable webhook to notify when complete
        webhooks: [
          {
            eventTypes: ['ACTOR.RUN.SUCCEEDED'],
            requestUrl: `${process.env.RENDER_EXTERNAL_URL || 'https://pb-webhook-server-staging.onrender.com'}/api/apify/webhook`,
            payloadTemplate: '{"userId": {{userId}}, "clientId": {{customData.clientId}}, "runId": {{customData.runId}}, "actorRunId": {{actorRunId}}, "service": "post-harvesting", "status": "success"}'
          }
        ]
      })
    });
    
    // Process Apify response
    if (!response.ok) {
      const errorText = await response.text();
      clientLogger.error(`Apify API error: ${response.status} ${errorText}`);
      
      await runRecordRepository.updateRunRecord({
        runId: clientRunId,
        clientId,
        updates: {
          'Status': 'error',
          'Error': `Apify API error: ${response.status} ${errorText}`,
          'Posts Examined for Harvesting': urlsToProcess.length,
          'Posts Skipped': urlsToProcess.length
        },
        options: { logger: clientLogger }
      });
      
      await runRecordRepository.completeRunRecord({
        runId: clientRunId,
        clientId,
        status: 'Error',
        notes: `Apify API error: ${response.status} ${errorText}`,
        options: { logger: clientLogger }
      });
      
      return res.status(500).json({
        status: 'error',
        error: `Apify API error: ${response.status}`,
        details: errorText
      });
    }
    
    const apifyResponse = await response.json();
    const apifyRunId = apifyResponse.data?.id;
    clientLogger.debug(`Apify run started: ${apifyRunId}`);
    
    await runRecordRepository.updateRunRecord({
      runId: clientRunId,
      clientId,
      updates: {
        'Status': 'running',
        'Apify Run ID': apifyRunId,
        'Apify API Costs': estimatedCost,
        'Total Posts Harvested': 0, // Will be updated by webhook
        'Profiles Submitted for Post Harvesting': urlsToProcess.length
      },
      options: { logger: clientLogger }
    });
    
    // Update the job tracking record if in batch mode
    if (batchMode && parentRunId) {
      try {
        await jobTrackingRepository.updateClientJobStatus({
          parentRunId,
          clientId,
          status: 'running',
          metrics: {
            'profileUrlsFound': targetUrls.length,
            'profileUrlsProcessed': urlsToProcess.length,
            'apifyRunId': apifyRunId,
            'estimatedCost': estimatedCost
          },
          options: { logger: clientLogger }
        });
      } catch (error) {
        clientLogger.warn(`Failed to update job tracking record: ${error.message}`);
        // Continue execution even if job tracking update fails
      }
    }
    
    // Return success response
    const endTime = Date.now();
    return res.json({
      status: 'success',
      clientId,
      apifyRunId,
      clientRunId,
      urlsFound: targetUrls.length,
      urlsProcessed: urlsToProcess.length,
      estimatedCost,
      limitEnforced: limitResult.enforced,
      limitReason: limitResult.enforced ? limitResult.reason : null,
      duration: Math.round((endTime - startTime) / 1000)
    });
  } catch (error) {
    logger.error(`Error processing client ${clientId}: ${error.message}`);
    logger.debug(`Error stack: ${error.stack}`);
    
    // Update run record if created
    if (clientRunId && clientId) {
      try {
        await runRecordRepository.updateRunRecord({
          runId: clientRunId,
          clientId,
          updates: {
            'Status': 'error',
            'Error': `Processing error: ${error.message}`
          }
        });
        
        await runRecordRepository.completeRunRecord({
          runId: clientRunId,
          clientId,
          status: 'Error',
          notes: `Processing error: ${error.message}`
        });
      } catch (recordError) {
        logger.warn(`Failed to update run record: ${recordError.message}`);
      }
    }
    
    return res.status(500).json({
      status: 'error',
      error: error.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
    });
  }
}

/**
 * Get Apify run details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getApifyRunDetails(req, res) {
  const { runId } = req.params;
  const apifyToken = req.query.token || process.env.APIFY_TOKEN;
  
  if (!apifyToken) {
    return res.status(400).json({ error: 'Missing Apify token' });
  }
  
  if (!runId) {
    return res.status(400).json({ error: 'Missing runId parameter' });
  }
  
  try {
    const response = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: {
        'Authorization': `Bearer ${apifyToken}`
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        status: 'error',
        error: `Apify API error: ${response.status}`,
        details: errorText
      });
    }
    
    const runDetails = await response.json();
    return res.json({
      status: 'success',
      data: runDetails.data
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
}

/**
 * Process all clients in the background
 * @param {Array} clients - Array of clients to process
 * @param {string} path - Original request path
 * @param {string} parentRunId - Optional parent run ID for tracking
 * @returns {Object} Results of batch processing
 */
async function processAllClientsInBackground(clients, path, parentRunId) {
  const fs = require('fs');
  
  try {
    // Generate master run ID with a generic client ID prefix for batch processing
    const masterRunId = runIdService.generateRunId('batch-all-clients');
    console.log(`[batch-process] Starting batch processing with master run ID ${masterRunId} for ${clients.length} clients`);
    
    const endpoint = path.includes('smart-resume') ? 'smart-resume' : 'apify';
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
      const clientId = client.id;
      
      try {
        console.log(`[batch-process] Processing client: ${clientId}`);
        
        // Construct the API URL for the client
        const apiUrl = `http://localhost:${process.env.PORT || 3001}/api/${endpoint}/process-client`;
        
        // Set up request body
        const requestBody = {
          clientId,
          parentRunId: masterRunId,
          batchMode: true
        };
        
        // Process the client using the internal endpoint
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': clientId,
            'Authorization': `Bearer ${process.env.PB_WEBHOOK_SECRET}`
          },
          body: JSON.stringify(requestBody)
        });
        
        // Process the result
        const result = await response.json();
        
        // Store result
        results.clientResults[clientId] = result;
        
        // Update counts
        if (result.status === 'success') {
          results.successful++;
        } else if (result.status === 'skipped') {
          results.skipped++;
        } else {
          results.failed++;
        }
        
        // Add some delay between clients to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (clientError) {
        console.error(`[batch-process] Error processing client ${clientId}:`, clientError.message);
        results.failed++;
        results.clientResults[clientId] = { error: clientError.message };
      }
    }
    
    // Update the end time
    results.endTime = new Date().toISOString();
    
    // Save results to file
    try {
      const resultsDir = './batch-results';
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
      }
      fs.writeFileSync(`${resultsDir}/${masterRunId}.json`, JSON.stringify(results, null, 2));
    } catch (fsError) {
      console.error(`[batch-process] Error saving results:`, fsError.message);
    }
    
    return results;
  } catch (error) {
    console.error('[batch-process] Error processing clients in background:', error.message);
    return { error: error.message };
  }
}

/**
 * Handle batch processing for multiple clients
 */
async function batchProcessHandler(req, res) {
  const authHeader = req.headers['authorization'];
  const secret = process.env.PB_WEBHOOK_SECRET;
  
  // Validate auth token
  if (!secret) {
    return res.status(500).json({ error: 'Server missing PB_WEBHOOK_SECRET' });
  }
  
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Invalid authorization token' });
  }
  
  // Extract parameters
  const { clientIds } = req.body;
  const limit = parseInt(req.query.limit || '0', 10);
  
  if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid clientIds parameter' });
  }
  
  try {
    // Get clients from the service
    const allClients = [];
    
    for (const clientId of clientIds) {
      try {
        const client = await clientService.getClientById(clientId);
        if (client) {
          allClients.push({ id: clientId, ...client });
        }
      } catch (clientError) {
        console.warn(`[batch-process] Error fetching client ${clientId}:`, clientError.message);
      }
    }
    
    // Apply limit if specified
    const clientsToProcess = limit > 0 ? allClients.slice(0, limit) : allClients;
    
    if (clientsToProcess.length === 0) {
      return res.status(404).json({ error: 'No valid clients found' });
    }
    
    // Start processing in the background
    const processingPromise = processAllClientsInBackground(
      clientsToProcess,
      req.path,
      req.body.parentRunId
    );
    
    // Return immediately with basic status
    return res.json({
      status: 'processing',
      clientsSubmitted: clientsToProcess.length,
      clientIds: clientsToProcess.map(c => c.id)
    });
  } catch (error) {
    console.error('[batch-process] Error starting batch process:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Test endpoint to verify Apify integration is working
router.post('/api/apify/canary', async (req, res) => {
  res.json({
    status: 'success',
    message: 'Apify integration test endpoint is working',
    version: '2.0',
    timestamp: new Date().toISOString()
  });
});

// Main endpoint for processing a client
router.post('/api/apify/process-client', processClientHandler);

// Backward compatibility for smart-resume endpoint
router.post('/api/smart-resume/process-client', processClientHandler);

// Batch processing endpoint
router.post('/api/apify/batch', batchProcessHandler);
router.post('/api/smart-resume/batch', batchProcessHandler);

// Endpoint for getting Apify run details
router.get('/api/apify/run/:runId', getApifyRunDetails);

// Other level2 processing endpoint
router.post('/api/apify/process-level2-v2', async (req, res) => {
  res.status(410).json({
    status: 'deprecated',
    message: 'This endpoint is deprecated. Please use /api/apify/process-client instead.'
  });
});

module.exports = router;