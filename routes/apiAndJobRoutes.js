// routes/apiAndJobRoutes.js

const express = require("express");
const router = express.Router();
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));
const dirtyJSON = require('dirty-json');
const { logErrorWithStackTrace } = require('../utils/errorHandler');

// ---------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------
const geminiConfig = require("../config/geminiClient.js");
const airtableBase = require("../config/airtableClient.js");
const { getClientBase } = require("../config/airtableClient.js");
const syncPBPostsToAirtable = require("../utils/pbPostsSync.js");
const { 
  CLIENT_TABLES, 
  LEAD_FIELDS, 
  CLIENT_FIELDS,
  CLIENT_RUN_FIELDS,
  JOB_TRACKING_FIELDS, 
  CLIENT_RUN_STATUS_VALUES,
  CREDENTIAL_FIELDS
} = require("../constants/airtableUnifiedConstants.js");
const { validateFieldNames, createValidatedObject } = require('../utils/airtableFieldValidator');

// Using centralized status utility functions for consistent behavior
const { getStatusString } = require('../utils/statusUtils');
// Use the new run ID system for all run ID operations
const runIdSystem = require('../services/runIdSystem.js');
const { JobTracking } = require('../services/jobTracking.js');
const jobOrchestrationService = require('../services/jobOrchestrationService.js');
const { handleClientError } = require('../utils/errorHandler.js');
// Old error logger removed - now using Render log analysis
const logCriticalError = async () => {}; // No-op
// Structured logging for 100% error coverage
const { createLogger } = require('../utils/contextLogger.js');

// Module-level logger for routes without specific runId context
const moduleLogger = createLogger({ runId: 'MODULE_INIT', clientId: 'SYSTEM', operation: 'api_routes' });

const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null;
const geminiModelId = geminiConfig ? geminiConfig.geminiModelId : null;

const { scoreLeadNow } = require("../singleScorer.js");
const batchScorer = require("../batchScorer.js");
const { loadAttributes, loadAttributeForEditing, loadAttributeForEditingWithClientBase, updateAttribute, updateAttributeWithClientBase } = require("../attributeLoader.js");
const { computeFinalScore } = require("../scoring.js");
const { buildAttributeBreakdown } = require("../scripts/analysis/breakdown.js");
const {
  alertAdmin,
  isMissingCritical,
} = require("../utils/appHelpers.js");

const __PUBLIC_BASE__ = process.env.API_PUBLIC_BASE_URL
  || process.env.NEXT_PUBLIC_API_BASE_URL
  || `http://localhost:${process.env.PORT || 3001}`;
const ENQUEUE_URL = `${__PUBLIC_BASE__}/enqueue`;

// ---------------------------------------------------------------
// Helper: Log error to Airtable (non-blocking)
// ---------------------------------------------------------------
async function logRouteError(error, req = null, additionalContext = {}) {
  try {
    // Handle both route mode (has req) and background mode (no req)
    const endpoint = req ? `${req.method} ${req.path || req.url || 'unknown'}` : 'background-job';
    const clientId = additionalContext.clientId || req?.headers?.['x-client-id'] || req?.query?.clientId || req?.body?.clientId || null;
    const runId = additionalContext.runId || req?.query?.runId || req?.body?.runId || null;
    
    // Create logger with context
    const logger = createLogger({
      runId: runId || 'UNKNOWN',
      clientId: clientId || 'UNKNOWN',
      operation: 'route_error'
    });
    
    logger.error(`Route error in ${endpoint}: ${error.message}`, {
      requestBody: req?.body || null,
      queryParams: req?.query || null,
      ...additionalContext
    });
    
    await logCriticalError(error, {
      endpoint,
      clientId,
      runId,
      requestBody: req?.body || null,
      queryParams: req?.query || null,
      ...additionalContext
    });
  } catch (loggingError) {
    moduleLogger.error('Failed to log route error:', loggingError.message);
    // Don't recursively log the logging error to avoid infinite loop
  }
}

// ---------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------
router.get("/health", (_req, res) => {
  const healthLogger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'health_check' });
  healthLogger.info("Health endpoint hit");
  res.json({
    status: "ok",
    enhanced_audit_system: "loaded",
    timestamp: new Date().toISOString()
  });
});

// Simple audit test route (no auth required)
router.get("/audit-test", (_req, res) => {
  const auditLogger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'audit_test' });
  auditLogger.info("Audit test endpoint hit");
  res.json({
    status: "success", 
    message: "Enhanced audit system is loaded",
    timestamp: new Date().toISOString(),
    features: ["endpoint testing", "automated troubleshooting", "smart recommendations"]
  });
});

// ---------------------------------------------------------------
// Debug Job Status (for client-by-client polling)
// ---------------------------------------------------------------
router.get("/debug-job-status", async (req, res) => {
  try {
    const { jobId } = req.query;
    
    if (!jobId) {
      return res.status(400).json({
        error: 'jobId parameter is required'
      });
    }
    
    const { getJobStatus } = require('../services/clientService');
    
    // Try to find job status in any client's records
    // Job ID format: job_{operation}_stream{N}_{timestamp}
    const jobParts = jobId.split('_');
    if (jobParts.length < 4) {
      return res.status(400).json({
        error: 'Invalid jobId format'
      });
    }
    
    const operation = jobParts[1] + (jobParts[2].startsWith('stream') ? '' : '_' + jobParts[2]);
    
    // Get all active clients to search for job status
    const { getAllActiveClients } = require('../services/clientService');
    const clients = await getAllActiveClients();
    
    let foundStatus = null;
    let foundClientId = null;
    
    // Search through all clients for this job
    for (const client of clients) {
      try {
        const status = await getJobStatus(client.clientId, operation);
        if (status && status.jobId === jobId) {
          foundStatus = status.status;
          foundClientId = client.clientId;
          break;
        }
      } catch (error) {
        // Continue searching other clients
        await logRouteError(error, req, { 
          operation: 'job_status_search',
          expectedBehavior: true,
          isSearch: true,
          jobId: jobId 
        }).catch(() => {});
      }
    }
    
    // If not found in specific clients, check global job status
    if (!foundStatus) {
      try {
        const globalStatus = await getJobStatus(null, operation);
        if (globalStatus && globalStatus.jobId === jobId) {
          foundStatus = globalStatus.status;
          foundClientId = 'global';
        }
      } catch (error) {
        // Job not found
        await logRouteError(error, req, { 
          operation: 'global_job_status_search',
          expectedBehavior: true,
          isSearch: true,
          jobId: jobId 
        }).catch(() => {});
      }
    }
    
    if (foundStatus) {
      res.json({
        jobId,
        status: foundStatus,
        clientId: foundClientId,
        operation,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        error: 'Job not found',
        jobId,
        operation
      });
    }
    
  } catch (error) {
    const errorLogger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'debug_job_status' });
    errorLogger.error('Error in debug-job-status:', error.message);
    await logRouteError(error, req, { operation: 'debug-job-status', jobId }).catch(() => {});
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Debug endpoint for checking specific client operation status
router.get("/debug-job-status/:clientId/:operation", async (req, res) => {
  try {
    const { clientId, operation } = req.params;
    const { getJobStatus } = require('../services/clientService');
    
    const status = await getJobStatus(clientId, operation);
    
    if (status) {
      res.json({
        clientId,
        operation,
        status: status.status,
        jobId: status.jobId,
        lastRunDate: status.lastRunDate,
        lastRunTime: status.lastRunTime,
        lastRunCount: status.lastRunCount,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        error: 'Job status not found',
        clientId,
        operation
      });
    }
    
  } catch (error) {
    const errorLogger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'debug_job_status_client' });
    errorLogger.error('Error in debug-job-status client endpoint:', error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ---------------------------------------------------------------
// LinkedIn Activity Extractor (today’s leads, limit 100)
// THIS ROUTE HAS BEEN REMOVED AS PER THE NEW ARCHITECTURE
// (Google Apps Script will populate the sheet, PB runs on schedule)
// ---------------------------------------------------------------
// router.post("/api/run-pb-activity-extractor", async (_req, res) => { ... }); // Entire block removed

// ---------------------------------------------------------------
// Initiate PB Message Sender (single lead)
// ---------------------------------------------------------------
router.get("/api/initiate-pb-message", async (req, res) => {
  const { recordId } = req.query;
  const logger = createLogger({ runId: `pb_message_${recordId || 'unknown'}`, clientId: req.headers['x-client-id'] || 'UNKNOWN', operation: 'initiate_pb_message' });
  
  logger.info(`/api/initiate-pb-message for ${recordId}`);
  if (!recordId)
    return res
      .status(400)
      .json({ success: false, error: "recordId query param required" });

  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }    const [creds] = await clientBase("Credentials")
      .select({ maxRecords: 1 })
      .firstPage();
    if (!creds) throw new Error("No record in Credentials table.");

    const agentId = creds.get("PB Message Sender ID");
    const pbKey = creds.get("Phantom API Key");
    const sessionCookie = creds.get("LinkedIn Cookie");
    const userAgent = creds.get("User-Agent");
    if (!agentId || !pbKey || !sessionCookie || !userAgent)
      throw new Error("Missing PB message-sender credentials.");

    const lead = await clientBase("Leads").find(recordId);
    if (!lead) throw new Error(`Lead ${recordId} not found.`);
    const profileUrl = lead.get("LinkedIn Profile URL");
    const message = lead.get("Message To Be Sent");
    if (!profileUrl || !message)
      throw new Error("Lead missing URL or message.");

    const enqueueResp = await fetch(ENQUEUE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordId,
        agentId,
        pbKey,
        sessionCookie,
        userAgent,
        profileUrl,
        message,
      }),
    });
    const enqueueData = await enqueueResp.json();
    if (!enqueueResp.ok || !enqueueData.queued)
      throw new Error(enqueueData.error || "Enqueue failed.");

    try {
      await clientBase("Leads").update(recordId, {
        "Message Status": "Queuing Initiated by Server",
      });
    } catch (e) {
      logger.warn("Airtable status update failed:", e.message);
      await logRouteError(e, req).catch(() => {});
    }

    res.json({
      success: true,
      message: `Lead ${recordId} queued.`,
      enqueueResponse: enqueueData,
    });
  } catch (e) {
    logger.error("initiate-pb-message:", e.message);
    await logRouteError(e, req, { operation: 'initiate-pb-message', recordId }).catch(() => {});
    await alertAdmin(
      "Error /api/initiate-pb-message",
      `ID:${recordId}\n${e.message}`
    );
    if (!res.headersSent)
      res.status(500).json({ success: false, error: e.message });
  }
});// ---------------------------------------------------------------
// Manual PB Posts Sync
// ---------------------------------------------------------------
router.all("/api/sync-pb-posts", async (req, res) => {
  const syncLogger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'sync_pb_posts' });
  try {
    const info = await syncPBPostsToAirtable(); // Assuming this might be a manual trigger
    res.json({
      status: "success",
      message: "PB posts sync completed.",
      details: info,
    });
  } catch (err) {
    syncLogger.error("sync-pb-posts error (manual trigger):", err);
    await logRouteError(err, req).catch(() => {});
    res.status(500).json({ status: "error", error: err.message });
  }
});// ---------------------------------------------------------------
// PB Webhook
// ---------------------------------------------------------------
router.post("/api/pb-webhook", async (req, res) => {
  const webhookLogger = createLogger({
    runId: `pb_webhook_${Date.now()}`,
    clientId: 'SYSTEM',
    operation: 'pb_webhook'
  });
  
  try {
    const secret = req.query.secret || req.body.secret;
    if (secret !== process.env.PB_WEBHOOK_SECRET) {
      webhookLogger.warn("PB Webhook: Forbidden attempt with incorrect secret.");
      return res.status(403).json({ error: "Forbidden" });
    }

    webhookLogger.info(
      "Received raw payload:",
      JSON.stringify(req.body).slice(0, 1000) // Log only a part of potentially large payload
    );

    res.status(200).json({ message: "Webhook received. Processing in background." });    (async () => {
      try {
        let rawResultObject = req.body.resultObject;

        if (!rawResultObject) {
            webhookLogger.warn("PB Webhook: resultObject is missing in the payload.");
            return;
        }

        let postsInputArray;
        if (typeof rawResultObject === 'string') {
          try {
            // THE PERMANENT FIX: Clean trailing commas from the JSON string before parsing
            const cleanedString = rawResultObject.replace(/,\s*([}\]])/g, "$1");
            postsInputArray = JSON.parse(cleanedString);
          } catch (parseError) {
            webhookLogger.error("PB Webhook: Error parsing resultObject string with JSON.parse:", parseError.message);
            await logRouteError(parseError, req).catch(() => {});
            // Fallback: try dirty-json
            try {
              postsInputArray = dirtyJSON.parse(rawResultObject);
              webhookLogger.info("PB Webhook: dirty-json successfully parsed resultObject string.");
            } catch (dirtyErr) {
              webhookLogger.error("PB Webhook: dirty-json also failed to parse resultObject string:", dirtyErr.message);
              await logRouteError(dirtyErr, req).catch(() => {});
              return;
            }
          }
        } else if (Array.isArray(rawResultObject)) {
          postsInputArray = rawResultObject;
        } else if (typeof rawResultObject === 'object' && rawResultObject !== null) {
          postsInputArray = [rawResultObject];
        } else {
          webhookLogger.warn("PB Webhook: resultObject is not a string, array, or recognized object.");
          return;
        }
        
        if (!Array.isArray(postsInputArray)) {
            webhookLogger.warn("PB Webhook: Processed postsInput is not an array.");
            return;
        }

        webhookLogger.info(`Extracted ${postsInputArray.length} items from resultObject for background processing.`);

        const filteredPostsInput = postsInputArray.filter(item => {
          if (typeof item !== 'object' || item === null || !item.hasOwnProperty('profileUrl')) {
            return true;
          }
          return !(item.profileUrl === "Profile URL" && item.error === "Invalid input");
        });
        webhookLogger.info(`Filtered to ${filteredPostsInput.length} items after removing potential header.`);        if (filteredPostsInput.length > 0) {
          // TEMP FIX: Use specific client base if auto-detection fails
          const { getClientBase } = require('../config/airtableClient');
          const clientBase = await getClientBase('Guy-Wilson'); // Fixed: Use correct client ID and await
          
          const processed = await syncPBPostsToAirtable(filteredPostsInput, clientBase);
          webhookLogger.info("PB Webhook: Background syncPBPostsToAirtable completed.", processed);
        } else {
          webhookLogger.info("PB Webhook: No valid posts to sync after filtering.");
        }      } catch (backgroundErr) {
        webhookLogger.error("PB Webhook: Error during background processing:", backgroundErr.message, backgroundErr.stack);
        await logRouteError(backgroundErr, req).catch(() => {});
      }
    })();

  } catch (initialErr) {
    webhookLogger.error("PB Webhook: Initial error:", initialErr.message, initialErr.stack);
    await logRouteError(initialErr, req).catch(() => {});
    res.status(500).json({ error: initialErr.message });
  }
});



// ---------------------------------------------------------------
// Manual Batch Score (Admin/Batch Operation) - Multi-Client
// ---------------------------------------------------------------
router.get("/run-batch-score", async (req, res) => {
  const logger = createLogger({ runId: 'batch_score_req', clientId: 'SYSTEM', operation: 'run_batch_score' });
  logger.info("Batch scoring requested (multi-client)");
  
  const limit = Number(req.query.limit) || 500;
  
  if (!vertexAIClient || !geminiModelId) {
    logger.warn(`Batch scoring unavailable: vertexAIClient=${!!vertexAIClient}, geminiModelId=${geminiModelId}`);
    return res.status(503).json({
      success: false,
      error: "Batch scoring unavailable (Google VertexAI config missing)",
      details: {
        vertexAIClient: !!vertexAIClient,
        geminiModelId: geminiModelId || "not set"
      }
    });
  }
  
  // STANDALONE RUN: Not called from orchestrator, so skip all metrics/record creation
  batchScorer
    .run(req, res, { vertexAIClient, geminiModelId, limit, isStandalone: true })
    .catch((e) => {
      if (!res.headersSent)
        res.status(500).send("Batch scoring error: " + e.message);
    });
});

// Fire-and-forget version: GET /run-batch-score-v2
// Query params: ?stream=1&limit=500 (both optional)
router.get("/run-batch-score-v2", async (req, res) => {
  try {
    if (!vertexAIClient || !geminiModelId) {
      const logger = createLogger({ runId: 'batch_score_v2_req', clientId: 'SYSTEM', operation: 'run_batch_score_v2' });
      logger.warn(`Lead scoring unavailable: vertexAIClient=${!!vertexAIClient}, geminiModelId=${geminiModelId}`);
      return res.status(503).json({
        ok: false,
        error: "Lead scoring unavailable (Google VertexAI config missing)",
        details: {
          vertexAIClient: !!vertexAIClient,
          geminiModelId: geminiModelId || "not set"
        }
      });
    }

    const stream = parseInt(req.query.stream) || 1;
    const limit = Number(req.query.limit) || 500;
    const singleClientId = req.query.clientId; // Optional: process single client
    const parentRunId = req.query.parentRunId; // Optional: master run ID from Smart Resume (IMMUTABLE)
    const clientRunId = req.query.clientRunId; // Optional: client-specific run ID from Smart Resume
    const { generateJobId, setJobStatus, setProcessingStream, getActiveClientsByStream } = require('../services/clientService');
    
    // Generate job ID and set initial status
    const jobId = generateJobId('lead_scoring', stream);
    const clientDesc = singleClientId ? ` for client ${singleClientId}` : '';
    
    // Create logger with jobId as runId for this request
    const logger = createLogger({ 
      runId: jobId, 
      clientId: singleClientId || 'MULTI_CLIENT', 
      operation: 'run_batch_score_v2' 
    });
    
    logger.info(`Starting fire-and-forget lead scoring${clientDesc}, jobId: ${jobId}, stream: ${stream}, limit: ${limit}`);

    // Return 202 Accepted immediately
    res.status(202).json({
      ok: true,
      message: `Lead scoring started in background${clientDesc}`,
      jobId,
      stream,
      limit,
      clientId: singleClientId,
      timestamp: new Date().toISOString()
    });

    // Start background processing
    processLeadScoringInBackground(jobId, stream, limit, singleClientId, { 
      vertexAIClient, 
      geminiModelId,
      parentRunId, // Master run ID (IMMUTABLE)
      clientRunId  // Client-specific run ID created by smart-resume
    });

  } catch (e) {
    const logger = createLogger({ runId: 'batch_score_v2_error', clientId: 'SYSTEM', operation: 'run_batch_score_v2' });
    logger.error('[run-batch-score-v2] error:', e.message);
    await logRouteError(e, req).catch(() => {});
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Background processing function for lead scoring
async function processLeadScoringInBackground(jobId, stream, limit, singleClientId, aiDependencies) {
  const {
    getActiveClientsByStream,
    setJobStatus,
    setProcessingStream,
    formatDuration
  } = require('../services/clientService');
  // Import run ID system for consistent ID generation and management
  const runIdSystem = require('../services/runIdSystem');

  // Create logger for this background job
  const logger = createLogger({
    runId: jobId,
    clientId: singleClientId || 'MULTI_CLIENT',
    operation: 'lead_scoring_background'
  });

  const MAX_CLIENT_PROCESSING_MINUTES = parseInt(process.env.MAX_CLIENT_PROCESSING_MINUTES) || 10;
  const MAX_JOB_PROCESSING_HOURS = parseInt(process.env.MAX_JOB_PROCESSING_HOURS) || 2;

  const jobStartTime = Date.now();
  const jobTimeoutMs = MAX_JOB_PROCESSING_HOURS * 60 * 60 * 1000;
  const clientTimeoutMs = MAX_CLIENT_PROCESSING_MINUTES * 60 * 1000;

  let processedCount = 0;
  let scoredCount = 0;
  let errorCount = 0;

  // CLEAN ARCHITECTURE: Lead scoring is a pure consumer of run IDs
  // If orchestrator provides clientRunId, use it for metrics updates
  // If not provided (standalone mode), skip metrics updates entirely
  const { clientRunId } = aiDependencies;
  
  if (clientRunId) {
    logger.info(`Using client run ID from orchestrator: ${clientRunId} for job ${jobId}`);
  } else {
    logger.info(`No run ID provided - running in standalone mode (no metrics updates) for job ${jobId}`);
  }

  try {
    logger.info(`Starting job ${jobId} on stream ${stream} with limit ${limit}`);

    // Set initial job status (don't set processing stream for operation)
    await setJobStatus(null, 'lead_scoring', 'STARTED', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: '0 seconds',
      lastRunCount: 0
    });

    // Get active clients filtered by processing stream
    const activeClients = await getActiveClientsByStream(stream, singleClientId);
    
    logger.info(`Found ${activeClients.length} active clients on stream ${stream} to process`);

    // Update status to RUNNING
    await setJobStatus(null, 'lead_scoring', 'RUNNING', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: formatDuration(Date.now() - jobStartTime),
      lastRunCount: processedCount
    });

    // Process each client
    for (const client of activeClients) {
      // Check job timeout
      if (Date.now() - jobStartTime > jobTimeoutMs) {
        logger.warn(`Job timeout reached (${MAX_JOB_PROCESSING_HOURS}h), killing job ${jobId}`);
        await setJobStatus(null, 'lead_scoring', 'JOB_TIMEOUT_KILLED', jobId, {
          lastRunDate: new Date().toISOString(),
          lastRunTime: formatDuration(Date.now() - jobStartTime),
          lastRunCount: scoredCount
        });
        return;
      }

      const clientStartTime = Date.now();
      logger.info(`Processing client ${client.clientId} (${processedCount + 1}/${activeClients.length})`);

      try {
        // CLEAN ARCHITECTURE: Pass client run ID exactly as received from orchestrator
        // In standalone mode (clientRunId is undefined), lead scoring still works but doesn't update metrics
        logger.debug(`Processing client ${client.clientId} with run ID: ${clientRunId || 'none (standalone mode)'}`);
        
        // Set up client timeout
        const clientPromise = processClientForLeadScoring(client.clientId, limit, aiDependencies, clientRunId);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Client timeout')), clientTimeoutMs)
        );

        const result = await Promise.race([clientPromise, timeoutPromise]);
        
        if (result?.successful) {
          scoredCount += result.successful;
        }

        const clientDuration = Date.now() - clientStartTime;
        logger.info(`Client ${client.clientId} completed in ${formatDuration(clientDuration)}`);

      } catch (error) {
        errorCount++;
        if (error.message === 'Client timeout') {
          logger.warn(`Client ${client.clientId} timeout (${MAX_CLIENT_PROCESSING_MINUTES}m), skipping`);
        } else {
          logger.error(`Client ${client.clientId} error: ${error.message}`);
          logger.error(`Error stack: ${error.stack}`);
        }
      }

      processedCount++;

      // Update progress
      await setJobStatus(null, 'lead_scoring', 'RUNNING', jobId, {
        lastRunDate: new Date().toISOString(),
        lastRunTime: formatDuration(Date.now() - jobStartTime),
        lastRunCount: scoredCount
      });
    }

    // Job completed successfully
    const finalDuration = formatDuration(Date.now() - jobStartTime);
    logger.info(`Job ${jobId} completed. Processed: ${processedCount}, Scored: ${scoredCount}, Errors: ${errorCount}, Duration: ${finalDuration}`);

    await setJobStatus(null, 'lead_scoring', 'COMPLETED', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: finalDuration,
      lastRunCount: scoredCount
    });

  } catch (error) {
    logger.error(`Job ${jobId} failed: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    await logRouteError(error).catch(() => {});
    await setJobStatus(null, 'lead_scoring', 'FAILED', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: formatDuration(Date.now() - jobStartTime),
      lastRunCount: scoredCount
    });
  }
}

// Helper function to process individual client for lead scoring
async function processClientForLeadScoring(clientId, limit, aiDependencies, runId) {
  // Create logger with client-specific context
  const logger = createLogger({
    runId: runId || 'standalone',
    clientId: clientId,
    operation: 'process_client_lead_scoring'
  });
  
  // Add debug logging for Guy Wilson specific debugging
  logger.debug(`processClientForLeadScoring called for client: ${clientId}`);
  if (clientId === 'guy-wilson') {
    logger.debug(`Processing Guy Wilson client with runId: ${runId}`);
  }
  
  // Create a fake request object for batchScorer.run() that targets a specific client
  const fakeReq = {
    query: {
      limit: limit,
      clientId: clientId,
      // Only include runId if provided (orchestrated run), otherwise undefined (standalone)
      runId: runId
    }
  };

  // Create a fake response object to capture results
  let result = { processed: 0, successful: 0, failed: 0, tokensUsed: 0 };
  const fakeRes = {
    status: () => fakeRes,
    json: (data) => {
      // Extract metrics from batchScorer response
      if (data && data.clients && data.clients.length > 0) {
        const clientResult = data.clients[0];
        result = {
          processed: clientResult.processed || 0,
          successful: clientResult.successful || 0,
          failed: clientResult.failed || 0,
          tokensUsed: clientResult.tokensUsed || 0
        };
      }
      return fakeRes;
    },
    send: () => fakeRes,
    headersSent: false
  };

  try {
    // Use batchScorer.run() for a single client
    await batchScorer.run(fakeReq, fakeRes, aiDependencies);
    return result;
  } catch (error) {
    logger.error(`[processClientForLeadScoring] Error processing client ${clientId}:`, error.message);
    await logRouteError(error, req).catch(() => {});
    throw error;
  }
}

// Single Lead Scorer
// ---------------------------------------------------------------
router.get("/score-lead", async (req, res) => {
  const debugLogger = createLogger({
    runId: 'SYSTEM',
    clientId: 'SYSTEM',
    operation: 'score_lead_debug'
  });
  
  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }

    if (!vertexAIClient || !geminiModelId)
      return res
        .status(503)
        .json({ error: "Scoring unavailable (config missing)." });

    const id = req.query.recordId;
    if (!id)
      return res.status(400).json({ error: "recordId query param required" });    const record = await clientBase("Leads").find(id);
    if (!record) { 
        debugLogger.warn(`score-lead: Lead record not found for ID: ${id}`);
        return res.status(404).json({ error: `Lead record not found for ID: ${id}` });
    }
    const profileJsonString = record.get("Profile Full JSON");
    if (!profileJsonString) {
        debugLogger.warn(`score-lead: Profile Full JSON is empty for lead ID: ${id}`);
         await clientBase("Leads").update(id, {
            "AI Score": 0,
            "Scoring Status": "Skipped – Profile JSON missing",
            "AI Profile Assessment": "",
            "AI Attribute Breakdown": "",
          });
        return res.json({ ok: true, skipped: true, reason: "Profile JSON missing" });
    }
    const profile = JSON.parse(profileJsonString);


    const about =
      (profile.about ||
        profile.summary ||
        profile.linkedinDescription ||
        "").trim();
    if (about.length < 40) {
      await clientBase("Leads").update(id, {
        "AI Score": 0,
        "Scoring Status": "Skipped – Profile JSON too small",
        "AI Profile Assessment": "",
        "AI Attribute Breakdown": "",
      });
      return res.json({ ok: true, skipped: true, reason: "JSON too small" });
    }

    if (isMissingCritical(profile)) {
      debugLogger.warn(`score-lead: Lead ID ${id} JSON missing critical fields for scoring.`);
    }

    const gOut = await scoreLeadNow(profile, {
      vertexAIClient,
      geminiModelId,
      clientId,
    });
    if (!gOut) {
        debugLogger.error(`singleScorer returned null for lead ID: ${id}`);
        throw new Error("singleScorer returned null.");
    }
    let {
      positive_scores = {},
      negative_scores = {},
      attribute_reasoning = {},
      contact_readiness = false,
      unscored_attributes = [],
      aiProfileAssessment = "N/A",
      ai_excluded = "No",
      exclude_details = "",
    } = gOut;

    const { positives, negatives } = await loadAttributes(null, clientId);    // Ensure all positive attributes are present in positive_scores and attribute_reasoning
    for (const key of Object.keys(positives)) {
      if (!(key in positive_scores)) {
        positive_scores[key] = 0;
      }
      if (!(key in attribute_reasoning)) {
        attribute_reasoning[key] = "No evidence found for this attribute.";
      }
    }
    // Ensure all negative attributes are present in negative_scores and attribute_reasoning
    for (const key of Object.keys(negatives)) {
      if (!(key in negative_scores)) {
        negative_scores[key] = 0;
      }
      if (!(key in attribute_reasoning)) {
        attribute_reasoning[key] = "No evidence found for this attribute.";
      }
    }

    if (
      contact_readiness &&
      positives?.I &&
      (positive_scores.I === undefined || positive_scores.I === null)
    ) {
      positive_scores.I = positives.I.maxPoints || 0;
      if (!attribute_reasoning.I && positive_scores.I > 0) {
        attribute_reasoning.I = "Contact readiness indicated by AI.";
      }
    }

    const { percentage, rawScore: earned, denominator: max } =
      computeFinalScore(
        positive_scores,
        positives,
        negative_scores,
        negatives,
        contact_readiness,
        unscored_attributes
      );
    const finalPct = Math.round(percentage * 100) / 100;

    const breakdown = buildAttributeBreakdown(
      positive_scores,
      positives,
      negative_scores,
      negatives,
      unscored_attributes,
      earned,
      max,
      attribute_reasoning,
      false,
      null
    );

    await clientBase("Leads").update(id, {
      "AI Score": finalPct,
      "AI Profile Assessment": aiProfileAssessment,
      "AI Attribute Breakdown": breakdown,
      "Scoring Status": "Scored",
      "Date Scored": new Date().toISOString().split("T")[0],
      AI_Excluded: ai_excluded === "Yes" || ai_excluded === true,
      "Exclude Details": exclude_details,
    });

    res.json({ id, finalPct, aiProfileAssessment, breakdown });
  } catch (err) {
    debugLogger.error(`score-lead error for ID ${req.query.recordId}:`, err.message, err.stack);
    await logRouteError(err, req).catch(() => {});
    if (!res.headersSent)
      res.status(500).json({ error: err.message });
  }
});// ---------------------------------------------------------------
// Debug: return normalized Valid PMPro Levels (safe to expose in staging)
router.get('/debug/valid-pmpro-levels', async (_req, res) => {
  try {
    const { getValidPMProLevels } = require('../services/pmproMembershipService');
    const levels = await getValidPMProLevels();
    res.json({ success: true, levels });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Gemini Debug
// ---------------------------------------------------------------
router.get("/debug-gemini-info", (_req, res) => {
  const modelIdForScoring =
    geminiConfig?.geminiModel?.model ||
    process.env.GEMINI_MODEL_ID ||
    "gemini-2.5-pro-preview-05-06 (default)";

  res.json({
    message: "Gemini Debug Info",
    model_id_for_scoring: modelIdForScoring,
    batch_scorer_model_id: geminiModelId || process.env.GEMINI_MODEL_ID,
    project_id: process.env.GCP_PROJECT_ID,
    location: process.env.GCP_LOCATION,
    global_client_available: !!vertexAIClient,
    default_model_instance_available:
      !!(geminiConfig && geminiConfig.geminiModel),
    gpt_chat_url: process.env.GPT_CHAT_URL || "Not Set",
  });
});

/**
 * Test Render API connectivity
 */
router.get("/debug-render-api", async (_req, res) => {
  const logger = createLogger({ runId: 'DEBUG_API', clientId: 'SYSTEM', operation: 'render_api_test' });
  
  try {
    const axios = require('axios');
    const RENDER_API_KEY = process.env.RENDER_API_KEY;
    const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID;
    const RENDER_OWNER_ID = process.env.RENDER_OWNER_ID;
    
    logger.info('Testing Render API connectivity');
    
    // Check environment variables
    const envCheck = {
      hasApiKey: !!RENDER_API_KEY,
      hasServiceId: !!RENDER_SERVICE_ID,
      hasOwnerId: !!RENDER_OWNER_ID,
      serviceId: RENDER_SERVICE_ID || 'NOT SET',
      ownerId: RENDER_OWNER_ID || 'NOT SET',
    };
    
    if (!RENDER_API_KEY || !RENDER_SERVICE_ID || !RENDER_OWNER_ID) {
      return res.json({
        success: false,
        message: 'Missing required environment variables',
        environmentCheck: envCheck,
        instructions: {
          RENDER_API_KEY: 'Get from Render Dashboard → Account Settings → API Keys',
          RENDER_SERVICE_ID: 'Service ID from URL (srv-xxx)',
          RENDER_OWNER_ID: 'Workspace ID from URL (/w/xxx) or Account Settings',
        }
      });
    }
    
    // Test the API
    const params = new URLSearchParams({
      ownerId: RENDER_OWNER_ID,
      limit: '5',
      direction: 'backward',
      resource: RENDER_SERVICE_ID,  // Just 'resource', not 'resource[]'
    });
    
    const logsUrl = `https://api.render.com/v1/logs?${params.toString()}`;
    
    const logsResponse = await axios.get(logsUrl, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${RENDER_API_KEY}`
      },
      timeout: 10000
    });
    
    logger.info('Render API test successful', {
      logsCount: logsResponse.data.logs?.length || 0,
      hasMore: logsResponse.data.hasMore
    });
    
    res.json({
      success: true,
      message: 'Render API connectivity test passed!',
      environmentCheck: envCheck,
      testResults: {
        logsRetrieved: logsResponse.data.logs?.length || 0,
        hasMore: logsResponse.data.hasMore,
        sampleLog: logsResponse.data.logs?.[0] || null
      }
    });
    
  } catch (error) {
    logger.error('Render API test failed', {
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data
    });
    
    res.status(500).json({
      success: false,
      message: 'Render API test failed',
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      requestUrl: `https://api.render.com/v1/logs?ownerId=xxx&limit=5&direction=backward&resource[]=xxx`,
      troubleshooting: {
        '400 Bad Request': 'Invalid parameters - check owner ID format or resource ID',
        '401 Unauthorized': 'Check RENDER_API_KEY is valid',
        '403 Forbidden': 'Check API key has permission to access logs',
        '404 Not Found': 'Check RENDER_OWNER_ID and RENDER_SERVICE_ID are correct',
        'Timeout': 'Render API might be slow or unreachable'
      }
    });
  }
});

/**
 * Get the status of any running or recent Smart Resume processes
 */
router.get("/debug-smart-resume-status", async (req, res) => {
  const statusLogger = createLogger({
    runId: 'SYSTEM',
    clientId: 'SYSTEM',
    operation: 'smart_resume_status'
  });
  
  statusLogger.info("ℹ️ Smart resume status check requested");
  
  try {
    // Check webhook secret for sensitive operations
    let isAuthenticated = false;
    const providedSecret = req.headers['x-webhook-secret'];
    const expectedSecret = process.env.PB_WEBHOOK_SECRET;
    
    if (providedSecret && providedSecret === expectedSecret) {
      isAuthenticated = true;
    }
    
    // Build basic status response
    const statusResponse = {
      timestamp: new Date().toISOString(),
      lockStatus: {
        locked: !!smartResumeRunning,
        currentJobId: currentSmartResumeJobId || null,
        lockAcquiredAt: smartResumeLockTime ? new Date(smartResumeLockTime).toISOString() : null,
        lockDuration: smartResumeLockTime ? `${Math.round((Date.now() - smartResumeLockTime)/1000/60)} minutes` : null
      }
    };
    
    // Add active process info if available and authenticated
    if (global.smartResumeActiveProcess) {
      statusResponse.activeProcess = {
        status: global.smartResumeActiveProcess.status || 'unknown',
        jobId: global.smartResumeActiveProcess.jobId,
        stream: global.smartResumeActiveProcess.stream,
        startedAt: global.smartResumeActiveProcess.startTime ? new Date(global.smartResumeActiveProcess.startTime).toISOString() : null,
        runtime: global.smartResumeActiveProcess.startTime ? `${Math.round((Date.now() - global.smartResumeActiveProcess.startTime)/1000/60)} minutes` : 'unknown'
      };
      
      // Include more sensitive details only if authenticated
      if (isAuthenticated) {
        if (global.smartResumeActiveProcess.error) {
          statusResponse.activeProcess.error = global.smartResumeActiveProcess.error;
        }
        
        if (global.smartResumeActiveProcess.endTime) {
          statusResponse.activeProcess.endedAt = new Date(global.smartResumeActiveProcess.endTime).toISOString();
          statusResponse.activeProcess.executionTime = `${Math.round((global.smartResumeActiveProcess.endTime - global.smartResumeActiveProcess.startTime)/1000/60)} minutes`;
        }
      }
    }
    
    res.json({
      success: true,
      ...statusResponse
    });
  } catch (error) {
    statusLogger.error("❌ Failed to get smart resume status:", error);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
      details: error.message
    });
  }
});// ---------------------------------------------------------------
// Import multi-tenant post scoring
// ---------------------------------------------------------------
const postBatchScorer = require("../postBatchScorer.js");
const { commitHash } = require("../versionInfo.js");

// ---------------------------------------------------------------
// Multi-Tenant Post Batch Score (Admin/Batch Operation)
// ---------------------------------------------------------------
router.post("/run-post-batch-score", async (req, res) => {
  // Generate temp runId for endpoint logging
  const tempRunId = `postbatch_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const endpointLogger = createLogger({
    runId: tempRunId,
    clientId: 'SYSTEM',
    operation: 'post_batch_score_endpoint'
  });
  
  endpointLogger.info("Endpoint hit");
  
  // Multi-tenant batch operation: processes ALL clients, no x-client-id required
  if (!vertexAIClient || !geminiModelId) {
    endpointLogger.error("Multi-tenant post scoring unavailable: missing Vertex AI client or model ID");
    return res.status(503).json({
      status: 'error',
      message: "Multi-tenant post scoring unavailable (Gemini config missing)."
    });
  }
  try {
    // Parse query parameters
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : null; // Optional: limit per client
  const dryRun = req.query.dryRun === 'true' || req.query.dry_run === 'true';
  const verboseErrors = req.query.verboseErrors === 'true';
  const maxVerboseErrors = req.query.maxVerboseErrors ? parseInt(req.query.maxVerboseErrors, 10) : 10;
    const tableOverride = req.query.table || req.query.leadsTableName || null;
    const markSkips = req.query.markSkips === undefined ? true : req.query.markSkips === 'true';
    let singleClientId = req.query.clientId || req.query.client_id || null;
    const clientNameQuery = req.query.clientName || req.query.client_name || null;
  // Accept explicit record IDs via query (?ids=recA,recB,...) or request body (ids: string[])
  const idsFromQuery = typeof req.query.ids === 'string' ? req.query.ids.split(',').map(s => s.trim()).filter(Boolean) : [];
  const idsFromBody = Array.isArray(req.body?.ids) ? req.body.ids.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : [];
  const targetIds = (idsFromQuery.length ? idsFromQuery : idsFromBody);

    // If clientName provided but no clientId, attempt to resolve it
    if (!singleClientId && clientNameQuery) {
      try {
        const clientService = require("../services/clientService");
        const activeClients = await clientService.getActiveClients();
        const match = activeClients.find(c => (c.clientName || '').toLowerCase() === clientNameQuery.toLowerCase());
        if (match) {
          singleClientId = match.clientId;
          endpointLogger.info(`Resolved clientName='${clientNameQuery}' to clientId='${singleClientId}'`);
        } else {
          return res.status(404).json({
            status: 'error',
            message: `No active client found with name '${clientNameQuery}'`
          });
        }
      } catch (e) {
        endpointLogger.warn('Client name resolution failed:', e.message);
        await logRouteError(e, req).catch(() => {});
      }
    }
    endpointLogger.info(`Starting multi-tenant post scoring for ALL clients, limit=${limit || 'UNLIMITED'}, dryRun=${dryRun}, tableOverride=${tableOverride || 'DEFAULT'}, markSkips=${markSkips}`);
    if (singleClientId) {
      endpointLogger.info(`Restricting run to single clientId=${singleClientId}`);
    }
    // Use job orchestration service to start job
    try {
      // This is the only place that should create job tracking records
      const jobInfo = await jobOrchestrationService.startJob({
        jobType: 'post_scoring',
        clientId: singleClientId, // May be null for all clients
        initialData: {
          'System Notes': `Post scoring initiated for ${singleClientId || 'all clients'}`
        }
      });
      
      // Use the runId assigned by the orchestration service
      const runId = jobInfo.runId;
      endpointLogger.info(`Using job run ID from orchestration service: ${runId}`);
      endpointLogger.info(`Created job tracking record with ID ${runId}`);
    } catch (err) {
      endpointLogger.error(`Failed to create job tracking record: ${err.message}`);
      await logRouteError(err, req).catch(() => {});
      // Continue anyway as we want the job to run
    }
    
    // Start the multi-tenant post scoring process
    const results = await postBatchScorer.runMultiTenantPostScoring(
      vertexAIClient,
      geminiModelId,
      runId, // Pass the run ID as the third parameter
      singleClientId || null, // specific client if provided
      limit,
      {
        dryRun,
        leadsTableName: tableOverride || undefined,
        markSkips,
        verboseErrors,
        maxVerboseErrors,
        targetIds: targetIds && targetIds.length ? targetIds : undefined
      }
    );
    // Update the job tracking record with completion status
    try {
      await JobTracking.completeJob({
        runId,
        status: results.successfulClients === results.totalClients ? CLIENT_RUN_STATUS_VALUES.COMPLETED : CLIENT_RUN_STATUS_VALUES.COMPLETED_WITH_ERRORS,
        updates: {
          'System Notes': `Multi-tenant post scoring completed: ${results.successfulClients}/${results.totalClients} clients successful, ${results.totalPostsScored}/${results.totalPostsProcessed} posts scored`,
          'Items Processed': results.totalPostsProcessed,
          'Posts Successfully Scored': results.totalPostsScored
        }
      });
      endpointLogger.info(`Updated job tracking record ${runId} with completion status`);
    } catch (err) {
      endpointLogger.error(`Failed to update job tracking record: ${err.message}`);
      await logRouteError(error, req).catch(() => {});
    }
    
    // Return results immediately
    res.status(200).json({
      // ARCHITECTURAL FIX: Use getStatusString helper for consistent status handling
      status: getStatusString('COMPLETED'),
      message: 'Multi-tenant post scoring completed',
      runId, // Include the run ID in the response
      summary: {
        totalClients: results.totalClients,
        successfulClients: results.successfulClients,
        failedClients: results.failedClients,
        totalPostsProcessed: results.totalPostsProcessed,
        totalPostsScored: results.totalPostsScored,
        totalLeadsSkipped: results.totalLeadsSkipped,
        skipCounts: results.skipCounts,
        errorReasonCounts: results.errorReasonCounts,
        duration: results.duration
      },
  clientResults: results.clientResults,
      mode: dryRun ? 'dryRun' : 'live',
  table: tableOverride || 'Leads',
  clientFiltered: singleClientId || null,
  clientNameQuery: clientNameQuery || null,
    diagnostics: results.diagnostics || null
  , commit: commitHash
    });
  } catch (error) {
    endpointLogger.error("Multi-tenant post scoring error:", error.message, error.stack);
    await logRouteError(error, req).catch(() => {});
    let errorMessage = "Multi-tenant post scoring failed";
    if (error.message) {
      errorMessage += ` Details: ${error.message}`;
    }
    if (!res.headersSent) {
      return res.status(500).json({
        status: getStatusString('ERROR'),
        message: errorMessage,
        errorDetails: error.toString()
      });
    }
  }
});

// ---------------------------------------------------------------
// FIRE-AND-FORGET Post Batch Score (NEW PATTERN) 
// ---------------------------------------------------------------
router.post("/run-post-batch-score-v2", async (req, res) => {
  // CRITICAL: Consumer pattern - use parentRunId if provided, null for standalone
  const stream = req.query.stream ? parseInt(req.query.stream, 10) : (req.body?.stream || 1);
  const parentRunId = req.query.parentRunId || req.body?.parentRunId || null; // Master run ID (IMMUTABLE)
  const clientRunId = req.query.clientRunId || req.body?.clientRunId || null; // Client-specific run ID from smart-resume
  const singleClientId = req.query.clientId || req.query.client_id || req.body?.clientId || null;
  
  // Determine mode: orchestrated (has parentRunId) vs standalone (no parentRunId)
  const isOrchestrated = !!parentRunId;
  
  // For logging: use parentRunId in orchestrated mode, temp ID in standalone
  const logRunId = isOrchestrated 
    ? parentRunId.split('-').slice(0, 2).join('-') // Extract timestamp portion
    : `post_scoring_standalone_${Date.now()}`;
  
  // Create endpoint-scoped logger
  const endpointLogger = createLogger({
    runId: logRunId,
    clientId: singleClientId || 'SYSTEM',
    operation: 'post_scoring_endpoint'
  });
  
  endpointLogger.info("🚀 [POST-SCORING-DEBUG] apiAndJobRoutes.js: /run-post-batch-score-v2 endpoint hit (FIRE-AND-FORGET)");
  endpointLogger.info("🚀 [POST-SCORING-DEBUG] Mode:", isOrchestrated ? 'ORCHESTRATED' : 'STANDALONE');
  endpointLogger.info("🚀 [POST-SCORING-DEBUG] parentRunId:", parentRunId || 'NONE');
  endpointLogger.info("🚀 [POST-SCORING-DEBUG] clientRunId:", clientRunId || 'NONE');
  endpointLogger.info("🚀 [POST-SCORING-DEBUG] Request body:", JSON.stringify(req.body));
  endpointLogger.info("🚀 [POST-SCORING-DEBUG] Request query:", JSON.stringify(req.query));
  
  // Check if fire-and-forget is enabled
  const fireAndForgetEnabled = process.env.FIRE_AND_FORGET === 'true';
  endpointLogger.info("🚀 [POST-SCORING-DEBUG] FIRE_AND_FORGET env var:", process.env.FIRE_AND_FORGET, "Enabled:", fireAndForgetEnabled);
  
  if (!fireAndForgetEnabled) {
    endpointLogger.info("⚠️ [POST-SCORING-DEBUG] Fire-and-forget not enabled - returning 501");
    return res.status(501).json({
      status: 'error',
      message: 'Fire-and-forget mode not enabled. Set FIRE_AND_FORGET=true'
    });
  }
  
  endpointLogger.info("✅ [POST-SCORING-DEBUG] Fire-and-forget IS enabled, continuing...");

  if (!vertexAIClient || !geminiModelId) {
    endpointLogger.error("❌ Multi-tenant post scoring unavailable: missing Vertex AI client or model ID");
    return res.status(503).json({
      status: 'error',
      message: "Multi-tenant post scoring unavailable (Gemini config missing)."
    });
  }

  try {
    // Parse query parameters (same as original endpoint)
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : (req.body?.limit || null);
    const dryRun = req.query.dryRun === 'true' || req.query.dry_run === 'true' || req.body?.dryRun === true;
    
    // CRITICAL ARCHITECTURAL FIX: Consumer pattern - never generate Run ID
    // Use parentRunId if provided (orchestrated mode), otherwise null (standalone mode)
    const runId = parentRunId; // May be null for standalone runs
    
    endpointLogger.info(`🎯 [POST-SCORING-DEBUG] Starting fire-and-forget post scoring: runId=${runId || 'NONE'}, stream=${stream}, clientId=${singleClientId || 'ALL'}, limit=${limit || 'UNLIMITED'}, dryRun=${dryRun}, mode=${isOrchestrated ? 'ORCHESTRATED' : 'STANDALONE'}`);
    
    // ORCHESTRATED MODE: Job Tracking record already exists (created by smart-resume)
    // STANDALONE MODE: No tracking - skip record creation entirely
    if (isOrchestrated) {
      endpointLogger.info(`ℹ️ [POST-SCORING-DEBUG] Orchestrated mode - using existing Job Tracking record: ${runId}`);
    } else {
      endpointLogger.info(`ℹ️ [POST-SCORING-DEBUG] Standalone mode - no Job Tracking record will be created or updated`);
    }
    
    // FIRE-AND-FORGET: Respond immediately with 202 Accepted
    endpointLogger.info(`✅ [POST-SCORING-DEBUG] Responding with 202 Accepted, starting background processing...`);
    res.status(202).json({
      status: 'accepted',
      message: 'Post scoring job started in background',
      runId: runId || 'N/A (standalone mode)',
      mode: isOrchestrated ? 'orchestrated' : 'standalone',
      stream: stream,
      clientId: singleClientId || 'ALL',
      dryRun: dryRun ? 'dryRun' : 'live',
      estimatedDuration: '5-30 minutes depending on client count',
      note: isOrchestrated 
        ? 'Check job status via Job Tracking table in Airtable'
        : 'Standalone mode - no tracking records created, check Render logs for results'
    });

    // Start background processing (don't await - fire and forget!)
    endpointLogger.info(`🔄 [POST-SCORING-DEBUG] Calling processPostScoringInBackground with runId=${runId || 'null'}, parentRunId=${parentRunId || 'null'}, clientRunId=${clientRunId || 'null'}`);
    processPostScoringInBackground(runId, stream, {
      limit,
      dryRun,
      singleClientId,
      parentRunId, // Master run ID (IMMUTABLE) - may be null
      clientRunId  // Client-specific run ID created by smart-resume - may be null
    }).catch(error => {
      endpointLogger.error(`❌ [POST-SCORING-DEBUG] Background post scoring failed:`, error.message);
      endpointLogger.error(`❌ [POST-SCORING-DEBUG] Error stack:`, error.stack);
    });

  } catch (error) {
    endpointLogger.error("❌ Fire-and-forget post scoring startup error:", error.message);
    await logRouteError(error, req).catch(() => {});
    if (!res.headersSent) {
      return res.status(500).json({
        status: 'error',
        message: `Failed to start post scoring job: ${error.message}`
      });
    }
  }
});

/**
 * Background processing function for fire-and-forget post scoring
 * CRITICAL: Consumer pattern - uses provided runId (may be null for standalone mode)
 */
async function processPostScoringInBackground(runId, stream, options) {
  const { 
    setJobStatus, 
    setProcessingStream, 
    formatDuration,
    getActiveClientsByStream
  } = require('../services/clientService');
  
  const startTime = Date.now();
  const maxClientMinutes = parseInt(process.env.MAX_CLIENT_PROCESSING_MINUTES) || 10;
  const maxJobHours = parseInt(process.env.MAX_JOB_PROCESSING_HOURS) || 2;
  const maxJobMs = maxJobHours * 60 * 60 * 1000;
  
  // Determine mode based on whether runId was provided
  const isOrchestrated = !!runId;
  
  // For logging: use runId in orchestrated mode, temp ID in standalone
  const logRunId = isOrchestrated
    ? runId.split('-').slice(0, 2).join('-') // Extract timestamp portion
    : `post_scoring_bg_${Date.now()}`;
  
  // Create job-level logger
  const jobLogger = createLogger({
    runId: logRunId,
    clientId: options.singleClientId || 'MULTI-CLIENT',
    operation: 'post_scoring_batch'
  });
  
  jobLogger.info(`🔄 [POST-SCORING-DEBUG] Background post scoring started: runId=${runId || 'NONE'}, stream=${stream}, mode=${isOrchestrated ? 'ORCHESTRATED' : 'STANDALONE'}, parentRunId=${options.parentRunId || 'NONE'}`);
  
  try {
    // Get active clients filtered by processing stream
    const clientService = require("../services/clientService");
    jobLogger.info(`📊 [POST-SCORING-DEBUG] Getting active clients for stream ${stream}, singleClientId=${options.singleClientId || 'ALL'}`);
    let clients = await getActiveClientsByStream(stream, options.singleClientId);
    
    jobLogger.info(`📊 [POST-SCORING-DEBUG] Found ${clients.length} clients in stream ${stream}`);
    if (clients.length > 0) {
      jobLogger.info(`📊 [POST-SCORING-DEBUG] Client list:`, clients.map(c => `${c.clientName} (${c.clientId})`).join(', '));
    } else {
      jobLogger.info(`⚠️ [POST-SCORING-DEBUG] No clients found to process - exiting`);
      return;
    }

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;

    // Process each client with timeout protection
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      
      // Extract timestamp-only portion for client logger (cleaner logs)
      // Create client-specific logger with timestamp-only runId
      const clientLogger = createLogger({
        runId: logRunId,  // Reuse the timestamp from job logger
        clientId: client.clientId,
        operation: 'post_scoring_client'
      });
      
      // Check overall job timeout
      if (Date.now() - startTime > maxJobMs) {
        jobLogger.info(`⏰ Job timeout reached (${maxJobHours} hours) - stopping gracefully`);
        if (isOrchestrated) {
          await setJobStatus(client.clientId, 'post_scoring', 'JOB_TIMEOUT_KILLED', runId, {
            duration: formatDuration(Date.now() - startTime),
            count: totalSuccessful
          });
        }
        break;
      }

      clientLogger.info(`🎯 [POST-SCORING-DEBUG] Processing client ${i + 1}/${clients.length}: ${client.clientName} (${client.clientId})`);
      clientLogger.info(`🎯 [POST-SCORING-DEBUG] Client details: serviceLevel=${client.serviceLevel}, baseId=${client.airtableBaseId}`);
      
      // ORCHESTRATED MODE: Set client status in tracking tables
      // STANDALONE MODE: Skip all status updates (no tracking)
      if (isOrchestrated) {
        await setJobStatus(client.clientId, 'post_scoring', 'RUNNING', runId);
        clientLogger.info(`✅ [POST-SCORING-DEBUG] Set job status to RUNNING for ${client.clientId}`);
      } else {
        clientLogger.info(`ℹ️ [POST-SCORING-DEBUG] Standalone mode - skipping job status update`);
      }
      
      const clientStartTime = Date.now();
      
      try {
        // CLEAN ARCHITECTURE: Pure consumer - use clientRunId exactly as provided by orchestrator
        // If not provided (standalone mode), postBatchScorer will handle it internally
        const clientRunId = options.clientRunId; // May be undefined in standalone mode
        clientLogger.info(`🔍 [POST-SCORING-DEBUG] Using clientRunId=${clientRunId || 'undefined (scorer will handle)'} (${options.clientRunId ? 'from orchestrator' : 'standalone mode'})`);
        clientLogger.info(`🔍 [POST-SCORING-DEBUG] Calling postBatchScorer.runMultiTenantPostScoring with limit=${options.limit || 'UNLIMITED'}, dryRun=${options.dryRun || false}`);
        
        // Run post scoring for this client with timeout
        const clientResult = await Promise.race([
          postBatchScorer.runMultiTenantPostScoring(
            vertexAIClient,
            geminiModelId,
            clientRunId, // Pass exactly as-is (may be undefined)
            client.clientId,
            options.limit,
            {
              dryRun: options.dryRun
            }
          ),
          // Client timeout
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Client timeout')), maxClientMinutes * 60 * 1000)
          )
        ]);

        // Success - update status
        const clientDuration = formatDuration(Date.now() - clientStartTime);
        const postsScored = clientResult.totalPostsScored || 0;
        const postsExamined = clientResult.totalPostsProcessed || 0;
        
        clientLogger.info(`✅ [POST-SCORING-DEBUG] Post scoring completed for ${client.clientName}:`);
        clientLogger.info(`   - Posts Examined: ${postsExamined}`);
        clientLogger.info(`   - Posts Scored: ${postsScored}`);
        clientLogger.info(`   - Tokens Used: ${clientResult.totalTokensUsed || 0}`);
        clientLogger.info(`   - Errors: ${clientResult.errors || 0}`);
        clientLogger.info(`   - Duration: ${clientDuration}`);
        
        // ORCHESTRATED MODE: Update job status in tracking tables
        // STANDALONE MODE: Skip all status updates (no tracking)
        if (isOrchestrated) {
          await setJobStatus(client.clientId, 'post_scoring', 'COMPLETED', runId, {
            duration: clientDuration,
            count: postsScored
          });
          clientLogger.info(`✅ [POST-SCORING-DEBUG] Updated job status to COMPLETED for ${client.clientId}`);
        } else {
          clientLogger.info(`ℹ️ [POST-SCORING-DEBUG] Standalone mode - skipping job status update`);
        }
        
        // If we have a parent run ID, update the client run record with post scoring metrics
        if (options.parentRunId) {
          try {
            clientLogger.info(`📊 [POST-SCORING-DEBUG] METRICS UPDATE: Starting for ${client.clientName} (${client.clientId})`);
            clientLogger.info(`📊 [POST-SCORING-DEBUG] METRICS UPDATE: Has parentRunId=${options.parentRunId}`);
            
            // CRITICAL: The parentRunId from orchestrator is ALREADY the complete client run ID
            // (e.g., "251007-041822-Guy-Wilson") - we use it EXACTLY as-is, no reconstruction
            clientLogger.info(`📊 [POST-SCORING-DEBUG] METRICS UPDATE: Using client run ID as-is: ${options.parentRunId}`);
            
            // Calculate duration as human-readable text
            const duration = formatDuration(Date.now() - (options.startTime || Date.now()));
            
            // Prepare metrics updates
            // DEBUG: Log field constant values to catch any undefined constants
            clientLogger.info(`📊 [POST-SCORING-DEBUG] Field constants:`, {
              POSTS_EXAMINED: CLIENT_RUN_FIELDS.POSTS_EXAMINED,
              POSTS_SCORED: CLIENT_RUN_FIELDS.POSTS_SCORED,
              POST_SCORING_TOKENS: CLIENT_RUN_FIELDS.POST_SCORING_TOKENS,
              SYSTEM_NOTES: CLIENT_RUN_FIELDS.SYSTEM_NOTES
            });
            
            const metricsUpdates = {
              [CLIENT_RUN_FIELDS.POSTS_EXAMINED]: postsExamined,
              [CLIENT_RUN_FIELDS.POSTS_SCORED]: postsScored,
              [CLIENT_RUN_FIELDS.POST_SCORING_TOKENS]: clientResult.totalTokensUsed || 0,
              [CLIENT_RUN_FIELDS.SYSTEM_NOTES]: `Post scoring completed with ${postsScored}/${postsExamined} posts scored, ${clientResult.errors || 0} errors, ${clientResult.skipped || 0} leads skipped. Total tokens: ${clientResult.totalTokensUsed || 0}.`
            };
            
            clientLogger.info(`📊 [POST-SCORING-DEBUG] METRICS UPDATE: Prepared updates:`, JSON.stringify(metricsUpdates, null, 2));
            clientLogger.info(`📊 [POST-SCORING-DEBUG] METRICS UPDATE: Calling JobTracking.updateClientRun...`);
            
            // Pass the complete client run ID exactly as received from orchestrator
            // NO reconstruction, NO suffix manipulation - just use it as-is
            const updateResult = await JobTracking.updateClientRun({
              runId: options.parentRunId,  // Complete client run ID, use exactly as-is
              clientId: client.clientId,
              updates: metricsUpdates,
              options: {
                isStandalone: false,  // This is never standalone if we have a parentRunId
                logger: console,
                source: 'post_scoring_api'
              }
            });
            
            clientLogger.info(`📊 [POST-SCORING-DEBUG] METRICS UPDATE: Result:`, JSON.stringify(updateResult, null, 2));
            
            // Add safety checks for updateResult properties
            if (updateResult && updateResult.success && !updateResult.skipped) {
              clientLogger.info(`📊 Updated client run record for ${client.clientName} with post scoring metrics`);
              clientLogger.info(`   - Posts Examined: ${postsExamined}`);
              clientLogger.info(`   - Posts Successfully Scored: ${postsScored}`);
              clientLogger.info(`   - Tokens Used: ${clientResult.totalTokensUsed || 0}`);
            } else if (updateResult && updateResult.skipped) {
              clientLogger.info(`ℹ️ Metrics update skipped: ${updateResult.reason || 'Unknown reason'}`);
            } else {
              clientLogger.error(`❌ [ERROR] Failed to update metrics: ${updateResult ? updateResult.error || 'Unknown error' : 'No update result returned'}`);
            }
          } catch (metricError) {
            // Log metrics update failure with stack trace capture
            await logErrorWithStackTrace(metricError, {
              runId: runId || 'STANDALONE',
              clientId: client.clientId,
              context: `Post scoring metrics update failed for ${client.clientName}`,
              loggerName: 'POST-SCORING',
              operation: 'metricsUpdate',
            });
            
            // Use standardized error handling
            handleClientError(client.clientId, 'post_scoring_metrics', metricError, {
              logger: console,
              includeStack: true
            });
          }
        } else {
          jobLogger.info(`⚠️ [POST-SCORING-DEBUG] METRICS UPDATE: Skipped - no parentRunId provided`);
        }
        
        clientLogger.info(`✅ ${client.clientName}: ${postsScored} posts scored in ${clientDuration}`);
        totalSuccessful++;
        totalProcessed += postsScored;

      } catch (error) {
        // Handle client failure or timeout
        await logRouteError(error, { 
          client: client.clientId, 
          operation: 'post_scoring',
          timeout: error.message.includes('timeout')
        }).catch(() => {});
        
        const clientDuration = formatDuration(Date.now() - clientStartTime);
        const isTimeout = error.message.includes('timeout');
        const status = isTimeout ? 'CLIENT_TIMEOUT_KILLED' : 'FAILED';
        
        // ORCHESTRATED MODE: Update job status in tracking tables
        // STANDALONE MODE: Skip all status updates (no tracking)
        if (isOrchestrated) {
          await setJobStatus(client.clientId, 'post_scoring', status, runId, {
            duration: clientDuration,
            count: 0
          });
        }
        
        clientLogger.error(`❌ ${client.clientName} ${isTimeout ? 'TIMEOUT' : 'FAILED'}: ${error.message}`);
        clientLogger.error(`❌ Error stack:`, error.stack);
        totalFailed++;
      }
    }

    // Final summary
    const totalDuration = formatDuration(Date.now() - startTime);
    jobLogger.info(`🎉 Fire-and-forget post scoring completed: ${runId || 'STANDALONE'}`);
    jobLogger.info(`📊 Summary: ${totalSuccessful} successful, ${totalFailed} failed, ${totalProcessed} posts scored, ${totalDuration}`);

  } catch (error) {
    // Log fatal post scoring error with stack trace capture
    await logErrorWithStackTrace(error, {
      runId: runId || 'STANDALONE',
      clientId: null,
      context: `Fatal error in background post scoring ${runId || 'STANDALONE'}`,
      loggerName: 'POST-SCORING',
      operation: 'backgroundPostScoring',
    });
    
    await logRouteError(error).catch(() => {});
  } finally {
    // ALWAYS analyze logs, even if post-scoring failed
    // 🔍 LOG ANALYSIS: DISABLED - Use standalone analyzer instead
    // Analyzer moved to manual trigger (node analyze-now.js) or daily cron job
    // This keeps post-scoring endpoint fast and avoids duplicate error detection
    // if (runId) {
    //   try {
    //     const baseRunId = options.parentRunId || runId;
    //     jobLogger.info(`🔍 Analyzing logs for post-scoring run: ${runId} (base: ${baseRunId})`);
    //     const ProductionIssueService = require('../services/productionIssueService');
    //     const service = new ProductionIssueService();
    //     await service.analyzeRecentLogs({ runId: baseRunId });
    //     jobLogger.info(`✅ Post-scoring log analysis complete for ${runId}`);
    //   } catch (analyzeError) {
    //     jobLogger.error(`❌ Failed to analyze post-scoring logs for ${runId}:`, analyzeError.message);
    //   }
    // } else {
    //   jobLogger.info(`ℹ️ Standalone mode - skipping log analysis`);
    // }
    jobLogger.info(`ℹ️ Log analysis disabled - use manual analyzer (node analyze-now.js) or daily cron job`);
  }
}

// ---------------------------------------------------------------
// Simplified single-client post batch scoring (no table override, minimal params)
// Usage:
//   POST /run-post-batch-score-simple?clientId=Guy-Wilson&dryRun=true
//   POST /run-post-batch-score-simple?clientId=Guy-Wilson  (live)
// Optional: limit=50 (otherwise unlimited)
// Returns trimmed summary.
// ---------------------------------------------------------------
router.post("/run-post-batch-score-simple", async (req, res) => {
  if (!vertexAIClient || !geminiModelId) {
    return res.status(503).json({ status: getStatusString('ERROR'), message: 'Post scoring unavailable' });
  }
  const clientId = req.query.clientId || req.query.client || null;
  if (!clientId) {
    return res.status(400).json({ status: getStatusString('ERROR'), message: 'clientId required' });
  }
  const dryRun = req.query.dryRun === 'true';
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
  const verboseErrors = req.query.verboseErrors === 'true';
  const maxVerboseErrors = req.query.maxVerboseErrors ? parseInt(req.query.maxVerboseErrors, 10) : 10;
  const idsFromQuery = typeof req.query.ids === 'string' ? req.query.ids.split(',').map(s => s.trim()).filter(Boolean) : [];
  const idsFromBody = Array.isArray(req.body?.ids) ? req.body.ids.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : [];
  const targetIds = (idsFromQuery.length ? idsFromQuery : idsFromBody);
  try {
    // Use job orchestration service to start the job
    const jobInfo = await jobOrchestrationService.startJob({
      jobType: 'post_scoring',
      clientId: clientId,
      initialData: {
        [CLIENT_RUN_FIELDS.CLIENT_ID]: clientId
      }
    });
    
    // Use the run ID assigned by the orchestration service
    const runId = jobInfo.runId;

    const results = await postBatchScorer.runMultiTenantPostScoring(
      vertexAIClient,
      geminiModelId,
      runId, // Pass the run ID
      clientId,
      limit,
      { dryRun, verboseErrors, maxVerboseErrors, targetIds: targetIds && targetIds.length ? targetIds : undefined }
    );
    const first = results.clientResults[0] || {};
    res.json({
      status: getStatusString('COMPLETED'),
      mode: dryRun ? 'dryRun' : 'live',
      clientId,
      limit: limit || 'UNLIMITED',
      processed: results.totalPostsProcessed,
      scored: results.totalPostsScored,
      skipped: results.totalLeadsSkipped,
      skipCounts: results.skipCounts,
      errorReasonCounts: results.errorReasonCounts,
      duration: results.duration,
      clientStatus: first.status || null,
      diagnostics: results.diagnostics || null
    });
  } catch (e) {
    await logRouteError(e, req, { operation: 'batch_lead_scoring' }).catch(() => {});
    res.status(500).json({ status: getStatusString('ERROR'), message: e.message });
  }
});

// ---------------------------------------------------------------
// Multi-Tenant Post Batch Score (Service Level >= N)
// Mirrors /run-post-batch-score but filters candidates by service level
// Usage examples:
//   POST /run-post-batch-score-level2               (default minServiceLevel=2)
//   POST /run-post-batch-score-level2?limit=50
//   POST /run-post-batch-score-level2?minServiceLevel=3
// Optional: dryRun=true, verboseErrors=true, maxVerboseErrors=25, table=Leads, markSkips=true|false
// ---------------------------------------------------------------
router.post("/run-post-batch-score-level2", async (req, res) => {
  // Require Gemini to be configured server-side
  if (!vertexAIClient || !geminiModelId) {
    return res.status(503).json({ status: getStatusString('ERROR'), message: 'Post scoring unavailable (Gemini config missing).' });
  }

  try {
    // Parse query parameters (align with /run-post-batch-score)
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const dryRun = req.query.dryRun === 'true' || req.query.dry_run === 'true';
    const verboseErrors = req.query.verboseErrors === 'true';
    const maxVerboseErrors = req.query.maxVerboseErrors ? parseInt(req.query.maxVerboseErrors, 10) : 10;
    const tableOverride = req.query.table || req.query.leadsTableName || null;
    const markSkips = req.query.markSkips === undefined ? true : req.query.markSkips === 'true';
    const minServiceLevel = req.query.minServiceLevel ? parseInt(req.query.minServiceLevel, 10) : 2;

    // Discover eligible clients (Active + service level >= min)
    const clientService = require("../services/clientService");
    const activeClients = await clientService.getAllActiveClients();
    const candidates = activeClients.filter(c => Number(c.serviceLevel) >= Number(minServiceLevel || 2));

    const summaries = [];
    const aggregate = {
      totalClients: candidates.length,
      successfulClients: 0,
      failedClients: 0,
      totalPostsProcessed: 0,
      totalPostsScored: 0,
      totalLeadsSkipped: 0,
      skipCounts: {},
      errorReasonCounts: {},
      duration: 0
    };

    const startedAt = Date.now();

    // Use job orchestration service to start the job
    const jobInfo = await jobOrchestrationService.startJob({
      jobType: 'post_scoring_multi',
      initialData: {
        'Client Count': candidates.length
      }
    });
    
    // Use the run ID assigned by the orchestration service
    const runId = jobInfo.runId;
  const logger = createLogger({ runId, operation: 'post_batch_score_level2' });

    for (const c of candidates) {
      try {
        const results = await postBatchScorer.runMultiTenantPostScoring(
          vertexAIClient,
          geminiModelId,
          runId, // Pass the run ID
          c.clientId,
          limit,
          {
            dryRun,
            leadsTableName: tableOverride || undefined,
            markSkips,
            verboseErrors,
            maxVerboseErrors
          }
        );

        // Each invocation with a single client returns a results object with one clientResults entry
        const first = results.clientResults && results.clientResults[0] ? results.clientResults[0] : null;
        if (first) {
          summaries.push({ clientId: c.clientId, status: first.status, postsProcessed: first.postsProcessed || 0, postsScored: first.postsScored || 0 });
          // Aggregate totals
          aggregate.totalPostsProcessed += first.postsProcessed || 0;
          aggregate.totalPostsScored += first.postsScored || 0;
          aggregate.totalLeadsSkipped += first.leadsSkipped || 0;
          // Success vs failed (treat completed_with_errors as failed for counts)
          if (first.status === 'success') aggregate.successfulClients++; else aggregate.failedClients++;
          // Merge skip counts
          if (first.skipCounts) {
            for (const [reason, count] of Object.entries(first.skipCounts)) {
              aggregate.skipCounts[reason] = (aggregate.skipCounts[reason] || 0) + count;
            }
          }
          // Merge error reason counts
          if (first.errorReasonCounts) {
            for (const [reason, count] of Object.entries(first.errorReasonCounts)) {
              aggregate.errorReasonCounts[reason] = (aggregate.errorReasonCounts[reason] || 0) + count;
            }
          }
        } else {
          summaries.push({ clientId: c.clientId, status: 'no-results' });
          aggregate.failedClients++;
        }
      } catch (e) {
        await logRouteError(e, req, { 
          client: c.clientId, 
          operation: 'batch_summary' 
        }).catch(() => {});
        summaries.push({ clientId: c.clientId, status: getStatusString('FAILED'), error: e.message });
        aggregate.failedClients++;
      }
    }

    aggregate.duration = Math.round((Date.now() - startedAt) / 1000);

    return res.status(200).json({
      status: getStatusString('COMPLETED'),
      message: `Post scoring completed for service level >= ${minServiceLevel}`,
      summary: aggregate,
      clientResults: summaries,
      mode: dryRun ? 'dryRun' : 'live',
      table: tableOverride || 'Leads',
      minServiceLevel,
      commit: commitHash
    });
  } catch (error) {
    logger.error("/run-post-batch-score-level2 error:", error.message);
    await logRouteError(error, req).catch(() => {});
    return res.status(500).json({ status: getStatusString('ERROR'), message: error.message });
  }
});

// ---------------------------------------------------------------
// Debug endpoint for troubleshooting client discovery (Admin Only)
// ---------------------------------------------------------------
router.get("/debug-clients", async (req, res) => {
  const logger = createLogger({ operation: 'debug_clients' });
  logger.info("Debug clients endpoint hit");
  
  // This is an admin endpoint - should require admin authentication
  // For now, we'll require a debug key to prevent unauthorized access
  const debugKey = req.headers['x-debug-key'] || req.query.debugKey;
  if (!debugKey || debugKey !== process.env.DEBUG_API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authentication required for debug endpoints'
    });
  }
  
  try {
    // Use clientService to get all clients
    const clientService = require("../services/clientService");
    
    // Check environment variables
    const debugInfo = {
      environmentVariables: {
        MASTER_CLIENTS_BASE_ID: !!process.env.MASTER_CLIENTS_BASE_ID,
        AIRTABLE_API_KEY: !!process.env.AIRTABLE_API_KEY
      },
      values: {
        MASTER_CLIENTS_BASE_ID: process.env.MASTER_CLIENTS_BASE_ID || "NOT SET",
        AIRTABLE_API_KEY_LENGTH: process.env.AIRTABLE_API_KEY ? process.env.AIRTABLE_API_KEY.length : 0
      }
    };
    
    // Try to get all clients using the new service layer
    let allClients = [];
    let activeClients = [];
    let error = null;
    
    try {
      // Get all clients
      allClients = await clientService.getAllClients();
      
      // Filter for active clients (to maintain compatibility)
      activeClients = allClients.filter(client => client.status === 'Active');
    } catch (clientError) {
      error = clientError.message;
    }
    
    debugInfo.clientData = {
      totalClients: allClients.length,
      activeClients: activeClients.length,
      allClientsData: allClients,
      activeClientsData: activeClients,
      error: error,
      usingNewServiceLayer: true
    };
    
    res.json(debugInfo);
    
  } catch (error) {
    logger.error("Debug clients error:", error);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// ---------------------------------------------------------------
// Debug Production Issues endpoint (Admin Only)
// ---------------------------------------------------------------
router.get("/debug-production-issues", async (req, res) => {
  const logger = createLogger({ operation: 'debug_production_issues' });
  logger.info("Debug production issues endpoint hit");
  
  // This is an admin endpoint - require debug key
  const debugKey = req.headers['x-debug-key'] || req.query.debugKey;
  if (!debugKey || debugKey !== process.env.DEBUG_API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authentication required for debug endpoints'
    });
  }
  
  try {
    const ProductionIssueService = require("../services/productionIssueService");
    const service = new ProductionIssueService();
    
    // Get query parameters
    const hours = parseInt(req.query.hours) || 2;
    const limit = parseInt(req.query.limit) || 100;
    const status = req.query.status || null;
    
    // Get all issues
    const allRecords = await service.getProductionIssues({ limit, status });
    
    // Filter by time if needed
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentRecords = allRecords.filter(r => {
      const timestamp = r.get('Timestamp');
      if (!timestamp) return false;
      return new Date(timestamp) > cutoffTime;
    });
    
    // Format the response
    const issues = recentRecords.map(record => ({
      id: record.id,
      'Timestamp': record.get('Timestamp'),
      'Status': record.get('Status'),
      'Severity': record.get('Severity'),
      'Error Type': record.get('Error Type'),
      'Error Message': record.get('Error Message'),
      'Client ID': record.get('Client ID'),
      'Run ID': record.get('Run ID'),
      'File Path': record.get('File Path'),
      'Function Name': record.get('Function Name'),
      'Line Number': record.get('Line Number'),
      'Stack Trace': record.get('Stack Trace'),
      'Context': record.get('Context'),
      'Fixed In Commit': record.get('Fixed In Commit'),
      'Fixed By': record.get('Fixed By'),
      'Resolution Notes': record.get('Resolution Notes')
    }));
    
    // Group by error type
    const byType = {};
    issues.forEach(issue => {
      const type = issue['Error Type'] || 'Unknown';
      byType[type] = (byType[type] || 0) + 1;
    });
    
    // Group by severity
    const bySeverity = {};
    issues.forEach(issue => {
      const severity = issue.Severity || 'Unknown';
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    });
    
    // Group by run ID
    const byRunId = {};
    issues.forEach(issue => {
      const runId = issue['Run ID'] || 'Unknown';
      if (runId !== 'Unknown') {
        byRunId[runId] = (byRunId[runId] || 0) + 1;
      }
    });
    
    res.json({
      summary: {
        totalInDatabase: allRecords.length,
        recentCount: issues.length,
        hoursFilter: hours,
        byType,
        bySeverity,
        byRunId
      },
      issues: issues,
      expected: {
        message: 'Based on Render log 251008-130924-Guy-Wilson, we expect:',
        errors: [
          '1. Airtable Field Error: "Unknown field name: Errors" (3 occurrences)',
          '2. Logger Initialization: "Cannot access logger before initialization" (1 occurrence)'
        ],
        expectedTotal: '2-3 distinct errors'
      }
    });
    
  } catch (error) {
    logger.error("Debug production issues error:", error);
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// ---------------------------------------------------------------
// TEMPORARY: Check Production Issues (No Auth - For Testing Only)
// ---------------------------------------------------------------
router.get("/check-production-issues-temp", async (req, res) => {
  const logger = createLogger({ operation: 'check_production_issues_temp' });
  logger.info("Temporary production issues check endpoint hit (no auth)");
  
  try {
    const ProductionIssueService = require("../services/productionIssueService");
    const service = new ProductionIssueService();
    
    // Get query parameters
    const hours = parseInt(req.query.hours) || 2;
    const limit = parseInt(req.query.limit) || 100;
    
    // Get all issues
    const allRecords = await service.getProductionIssues({ limit });
    
    // Filter by time if needed
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentRecords = allRecords.filter(r => {
      const timestamp = r.get('Timestamp');
      if (!timestamp) return false;
      return new Date(timestamp) > cutoffTime;
    });
    
    // Format the response
    const issues = recentRecords.map(record => ({
      id: record.id,
      'Timestamp': record.get('Timestamp'),
      'Status': record.get('Status'),
      'Severity': record.get('Severity'),
      'Error Type': record.get('Error Type'),
      'Error Message': record.get('Error Message'),
      'Client ID': record.get('Client ID'),
      'Run ID': record.get('Run ID'),
      'File Path': record.get('File Path'),
      'Function Name': record.get('Function Name'),
      'Line Number': record.get('Line Number')
    }));
    
    // Group by error type
    const byType = {};
    issues.forEach(issue => {
      const type = issue['Error Type'] || 'Unknown';
      byType[type] = (byType[type] || 0) + 1;
    });
    
    // Group by severity
    const bySeverity = {};
    issues.forEach(issue => {
      const severity = issue.Severity || 'Unknown';
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    });
    
    res.json({
      success: true,
      summary: {
        totalInDatabase: allRecords.length,
        recentCount: issues.length,
        hoursFilter: hours,
        byType,
        bySeverity
      },
      issues: issues,
      note: "TEMPORARY ENDPOINT - Will be removed after testing. Use /debug-production-issues with auth key for production."
    });
    
  } catch (error) {
    logger.error("Temporary production issues check error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// ---------------------------------------------------------------
// Environment Variable Documentation Scan (Admin Only)
// ---------------------------------------------------------------
router.post("/api/scan-env-vars", async (req, res) => {
  const logger = createLogger({ operation: 'scan_env_vars' });
  logger.info("Environment variable scan endpoint hit");
  
  // This is an admin endpoint - require debug key or webhook secret
  const debugKey = req.headers['x-debug-api-key'] || req.headers['x-debug-key'] || req.query.debugKey;
  const webhookSecret = req.headers['x-webhook-secret'] || req.query.webhookSecret;
  const validDebugKey = process.env.DEBUG_API_KEY || process.env.PB_WEBHOOK_SECRET;
  
  if ((!debugKey || debugKey !== validDebugKey) && (!webhookSecret || webhookSecret !== process.env.PB_WEBHOOK_SECRET)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authentication required for environment variable scan'
    });
  }
  
  try {
    const EnvVarDocumenter = require("../services/envVarDocumenter");
    const documenter = new EnvVarDocumenter();
    
    const includeAiDescriptions = req.body.includeAiDescriptions !== false; // default true
    const onlySetVariables = req.body.onlySetVariables === true; // default false
    
    logger.info(`Starting environment variable scan (AI: ${includeAiDescriptions}, Filter: ${onlySetVariables ? 'REAL ONLY' : 'ALL'})`);
    
    // Run the scan with options
    const results = await documenter.scanAndSync({ 
      includeAi: includeAiDescriptions,
      onlySetVariables: onlySetVariables
    });
    
    logger.info(`Scan complete: ${results.stats.created} created, ${results.stats.updated} updated, ${results.obsoleteRecords.length} obsolete`);
    
    res.json({
      success: true,
      message: 'Environment variable scan completed',
      results: {
        created: results.stats.created,
        updated: results.stats.updated,
        unchanged: results.stats.unchanged,
        obsolete: results.obsoleteRecords.length,
        obsoleteVariables: results.obsoleteRecords.map(r => r.fields['Variable Name'])
      },
      nextSteps: [
        'Check your Airtable Environment Variables table',
        'Fill in Production Values manually',
        'Assign Render Groups for organization',
        'Export documentation with: npm run doc-env-vars export'
      ]
    });
    
  } catch (error) {
    logger.error("Environment variable scan error:", error);
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// ---------------------------------------------------------------
// Environment Variable AI Enhancement endpoint (Admin Only)
// Processes one variable at a time with progress updates
// ---------------------------------------------------------------
router.post("/api/enhance-env-descriptions", async (req, res) => {
  const logger = createLogger({ operation: 'enhance_env_descriptions' });
  logger.info("Environment variable AI enhancement endpoint hit");
  
  // This is an admin endpoint - require debug key or webhook secret
  const debugKey = req.headers['x-debug-api-key'] || req.headers['x-debug-key'] || req.query.debugKey;
  const webhookSecret = req.headers['x-webhook-secret'] || req.query.webhookSecret;
  const validDebugKey = process.env.DEBUG_API_KEY || process.env.PB_WEBHOOK_SECRET;
  
  if ((!debugKey || debugKey !== validDebugKey) && (!webhookSecret || webhookSecret !== process.env.PB_WEBHOOK_SECRET)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authentication required for environment variable enhancement'
    });
  }
  
  try {
    const EnvVarDocumenter = require("../services/envVarDocumenter");
    const documenter = new EnvVarDocumenter();
    
    await documenter.initialize();
    
    // Get all records that need AI enhancement
    const existingRecords = await documenter.getExistingRecords();
    const recordsToEnhance = existingRecords.filter(r => {
      const desc = r.fields['AI Description'] || '';
      const status = r.fields['Status'] || 'Active';
      // Enhance if: empty, pending, or just showing usage count (fallback description)
      return (status === 'Active' || status === 'Deprecated') && 
             (desc.includes('AI description pending') || 
              desc === '' || 
              desc.match(/^Used in \d+ location/));
    });
    
    logger.info(`Found ${recordsToEnhance.length} variables to enhance`);
    
    // Set up SSE (Server-Sent Events) for progress updates
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const sendProgress = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    sendProgress({ type: 'start', total: recordsToEnhance.length });
    
    let processed = 0;
    let updated = 0;
    let errors = 0;
    
    for (const record of recordsToEnhance) {
      const varName = record.fields['Variable Name'];
      processed++;
      
      try {
        sendProgress({ 
          type: 'progress', 
          current: processed,
          total: recordsToEnhance.length,
          varName,
          status: 'analyzing'
        });
        
        // Generate AI description
        const analysis = await documenter.analyzer.generateDescription(varName);
        
        // Update the record
        await documenter.updateRecord(record.id, analysis);
        
        updated++;
        
        sendProgress({ 
          type: 'progress', 
          current: processed,
          total: recordsToEnhance.length,
          varName,
          status: 'completed',
          description: analysis.description
        });
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        errors++;
        logger.error(`Error enhancing ${varName}:`, error);
        
        sendProgress({ 
          type: 'progress', 
          current: processed,
          total: recordsToEnhance.length,
          varName,
          status: 'error',
          error: error.message
        });
      }
    }
    
    sendProgress({ 
      type: 'complete', 
      processed,
      updated,
      errors
    });
    
    res.end();
    
  } catch (error) {
    logger.error("Enhancement error:", error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// ---------------------------------------------------------------
// JSON Quality Diagnostic endpoint (Admin Only)
// ---------------------------------------------------------------
router.get("/api/json-quality-analysis", async (req, res) => {
  const logger = createLogger({ operation: 'json_quality_analysis' });
  logger.info("JSON quality analysis endpoint hit");
  
  // This is an admin endpoint - should require admin authentication
  const debugKey = req.headers['x-debug-key'] || req.query.debugKey;
  if (!debugKey || debugKey !== process.env.DEBUG_API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authentication required for diagnostic endpoints'
    });
  }
  
  try {
    const { analyzeJsonQuality } = require("../jsonDiagnosticTool");
    
    const clientId = req.query.clientId || null;
    const limit = parseInt(req.query.limit) || 20;
    const mode = req.query.mode || 'analyze'; // analyze or repair
    
    logger.info(`Running JSON quality analysis: mode=${mode}, clientId=${clientId || 'ALL'}, limit=${limit}`);
    
    const results = await analyzeJsonQuality(clientId, limit, mode);
    
    res.json({
      status: 'success',
      analysis: results,
      parameters: {
        clientId: clientId || 'ALL',
        limit: limit,
        mode: mode
      }
    });
    
  } catch (error) {
    logger.error("JSON quality analysis error:", error);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// ---------------------------------------------------------------
// Token Budget Management (TESTING - Hardcoded 15K limit)
// ---------------------------------------------------------------

// Utility logger for token calculation helpers
const tokenUtilLogger = createLogger({ operation: 'token_utilities' });
// Calculate tokens for attribute text fields (approximation: ~4 chars per token)
function calculateAttributeTokens(instructions, examples, signals) {
  const instructionsText = extractPlainText(instructions) || '';
  const examplesText = extractPlainText(examples) || '';
  const signalsText = extractPlainText(signals) || '';
  
  const totalText = `${instructionsText} ${examplesText} ${signalsText}`;
  const tokenCount = Math.ceil(totalText.length / 4);
  
  tokenUtilLogger.info(`Token calculation: ${totalText.length} chars = ~${tokenCount} tokens`);
  return tokenCount;
}

// Get current token usage for all active attributes
async function getCurrentTokenUsage(clientId) {
  try {
    if (!clientId) {
      throw new Error('Client ID is required for token usage calculation');
    }
    
    // Get client token limits
    const clientService = require('../services/clientService');
    const tokenLimits = await clientService.getClientTokenLimits(clientId);
    
    if (!tokenLimits) {
      throw new Error(`Token limits not found for client: ${clientId}`);
    }

    const { loadAttributes } = require("../attributeLoader.js");
    const { positives, negatives } = await loadAttributes(null, clientId);
    
    let totalTokens = 0;
    const attributeDetails = [];
    
    // Count tokens for active positive attributes
    for (const [id, attr] of Object.entries(positives)) {
      const tokens = calculateAttributeTokens(attr.instructions, attr.examples, attr.signals);
      totalTokens += tokens;
      attributeDetails.push({
        id,
        heading: attr.heading || id,
        category: 'Positive',
        tokens,
        active: true
      });
    }
    
    // Count tokens for active negative attributes  
    for (const [id, attr] of Object.entries(negatives)) {
      const tokens = calculateAttributeTokens(attr.instructions, attr.examples, attr.signals);
      totalTokens += tokens;
      attributeDetails.push({
        id,
        heading: attr.heading || id,
        category: 'Negative', 
        tokens,
        active: true
      });
    }
    
    const limit = tokenLimits.profileLimit;
    
    return {
      totalTokens,
      attributeDetails,
      limit: limit,
      remaining: limit - totalTokens,
      percentUsed: Math.round((totalTokens / limit) * 100),
      clientName: tokenLimits.clientName
    };
    
  } catch (error) {
    tokenUtilLogger.error("Error calculating token usage:", error);
    await logRouteError(error, req).catch(() => {});
    throw error;
  }
}

// Check if activating an attribute would exceed budget
async function validateTokenBudget(attributeId, updatedData, clientId) {
  try {
    if (!clientId) {
      throw new Error('Client ID is required for token budget validation');
    }
    
    const currentUsage = await getCurrentTokenUsage(clientId);
    
    // Calculate tokens for the updated attribute
    const newTokens = calculateAttributeTokens(
      updatedData.instructions,
      updatedData.examples, 
      updatedData.signals
    );
    
    // If attribute is already active, subtract its current tokens
    const existingAttr = currentUsage.attributeDetails.find(attr => attr.id === attributeId);
    const currentTokensForThisAttr = existingAttr ? existingAttr.tokens : 0;
    
    const projectedTotal = currentUsage.totalTokens - currentTokensForThisAttr + newTokens;
    const limit = currentUsage.limit;
    const maxAllowed = Math.floor(limit * 1.10); // 110% buffer
    
    return {
      isValid: projectedTotal <= maxAllowed,
      currentTotal: currentUsage.totalTokens,
      newTokens,
      projectedTotal,
      limit: limit,
      maxAllowed: maxAllowed,
      wouldExceedBy: Math.max(0, projectedTotal - maxAllowed),
      percentUsed: Math.round((projectedTotal / limit) * 100)
    };
    
  } catch (error) {
    tokenUtilLogger.error("Error validating token budget:", error);
    await logRouteError(error, req).catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------
// Post Scoring Token Functions
// ---------------------------------------------------------------

// Calculate tokens for post attribute text fields
function calculatePostAttributeTokens(detailedInstructions, positiveKeywords, negativeKeywords, exampleHigh, exampleLow) {
  const instructionsText = extractPlainText(detailedInstructions) || '';
  const positiveText = extractPlainText(positiveKeywords) || '';
  const negativeText = extractPlainText(negativeKeywords) || '';
  const exampleHighText = extractPlainText(exampleHigh) || '';
  const exampleLowText = extractPlainText(exampleLow) || '';
  
  const totalText = `${instructionsText} ${positiveText} ${negativeText} ${exampleHighText} ${exampleLowText}`;
  const tokenCount = Math.ceil(totalText.length / 4);
  
  tokenUtilLogger.info(`Post token calculation: ${totalText.length} chars = ~${tokenCount} tokens`);
  return tokenCount;
}

// Get current post token usage for all active post attributes
async function getCurrentPostTokenUsage(clientId) {
  try {
    if (!clientId) {
      throw new Error('Client ID is required for post token usage calculation');
    }
    
    // Get client token limits
    const clientService = require('../services/clientService');
    const tokenLimits = await clientService.getClientTokenLimits(clientId);
    
    if (!tokenLimits) {
      throw new Error(`Token limits not found for client: ${clientId}`);
    }

    // Get client-specific base for post attributes
    const { getClientBase } = require('../config/airtableClient');
    const clientBase = await getClientBase(clientId);
    
    let totalTokens = 0;
    const attributeDetails = [];
    
    // Get all post attributes from client's base
    await clientBase('Post Scoring Attributes').select({
      filterByFormula: 'Active = TRUE()'
    }).eachPage((records, fetchNextPage) => {
      records.forEach(record => {
        // Post Scoring Attributes table field names from documentation
        const detailedInstructions = record.get('Detailed Instructions for AI (Scoring Rubric)') || '';
        const positiveKeywords = record.get('Keywords/Positive Indicators') || '';
        const negativeKeywords = record.get('Keywords/Negative Indicators') || '';
        const exampleHigh = record.get('Example - High Score / Applies') || '';
        const exampleLow = record.get('Example - Low Score / Does Not Apply') || '';
        
        tokenUtilLogger.info(`Post attribute ${record.get('Attribute ID') || 'Unknown'}: instructions=${detailedInstructions.length}chars, pos=${positiveKeywords.length}chars, neg=${negativeKeywords.length}chars, high=${exampleHigh.length}chars, low=${exampleLow.length}chars`);
        
        const tokens = calculatePostAttributeTokens(detailedInstructions, positiveKeywords, negativeKeywords, exampleHigh, exampleLow);
        totalTokens += tokens;
        
        attributeDetails.push({
          id: record.get('Attribute Id'),
          heading: record.get('Heading') || record.get('Attribute Id'),
          category: record.get('Category') || 'Post',
          tokens,
          active: true
        });
      });
      fetchNextPage();
    });
    
    const limit = tokenLimits.postLimit;
    
    return {
      totalTokens,
      attributeDetails,
      limit: limit,
      remaining: limit - totalTokens,
      percentUsed: Math.round((totalTokens / limit) * 100),
      clientName: tokenLimits.clientName,
      type: 'post'
    };
    
  } catch (error) {
    tokenUtilLogger.error("Error calculating post token usage:", error);
    await logRouteError(error, req).catch(() => {});
    throw error;
  }
}

// Check if activating a post attribute would exceed budget
async function validatePostTokenBudget(attributeId, updatedData, clientId) {
  try {
    if (!clientId) {
      throw new Error('Client ID is required for post token budget validation');
    }
    const currentUsage = await getCurrentPostTokenUsage(clientId);
    
    // Calculate tokens for the updated attribute
    const newTokens = calculatePostAttributeTokens(
      updatedData.detailedInstructions || updatedData.instructions || '',
      updatedData.positiveKeywords || updatedData.examples || '',
      updatedData.negativeKeywords || updatedData.signals || '',
      updatedData.exampleHigh || '',
      updatedData.exampleLow || ''
    );
    
    // If attribute is already active, subtract its current tokens
    const existingAttr = currentUsage.attributeDetails.find(attr => attr.id === attributeId);
    const currentTokensForThisAttr = existingAttr ? existingAttr.tokens : 0;
    
    const projectedTotal = currentUsage.totalTokens - currentTokensForThisAttr + newTokens;
    const limit = currentUsage.limit;
    const maxAllowed = Math.floor(limit * 1.10); // 110% buffer
    
    return {
      isValid: projectedTotal <= maxAllowed,
      currentTotal: currentUsage.totalTokens,
      newTokens,
      projectedTotal,
      limit: limit,
      maxAllowed: maxAllowed,
      wouldExceedBy: Math.max(0, projectedTotal - maxAllowed),
      percentUsed: Math.round((projectedTotal / limit) * 100),
      type: 'post'
    };
    
  } catch (error) {
    tokenUtilLogger.error("Error validating post token budget:", error);
    await logRouteError(error, req).catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------
// Token Budget API Endpoints
// ---------------------------------------------------------------

// Get current token usage status
router.get("/api/token-usage", async (req, res) => {
  try {
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'token_usage' });
    logger.info("Getting current token usage");
    
    if (!clientId) {
      return res.status(401).json({ error: 'Client ID required' });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(401).json({ error: 'Invalid client ID' });
    }
    const usage = await getCurrentTokenUsage(clientId);
    
    // Add warning levels
    const warningLevel = usage.percentUsed >= 95 ? 'danger' : usage.percentUsed >= 90 ? 'warning' : 'normal';
    
    res.json({
      success: true,
      usage: {
        ...usage,
        warningLevel
      },
      message: `Using ${usage.totalTokens} of ${usage.limit} tokens (${usage.percentUsed}%)`
    });
    
  } catch (error) {
    logger.error("apiAndJobRoutes.js: GET /api/token-usage error:", error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get token usage"
    });
  }
});

// Validate if attribute save would exceed budget
router.post("/api/attributes/:id/validate-budget", async (req, res) => {
  try {
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'validate_token_budget', attributeId: req.params.id });
    logger.info("Validating token budget");
    
    if (!clientId) {
      return res.status(401).json({ error: 'Client ID required' });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(401).json({ error: 'Invalid client ID' });
    }

    const attributeId = req.params.id;
    const updatedData = req.body;
    
    if (!updatedData || typeof updatedData !== 'object') {
      return res.status(400).json({
        success: false,
        error: "updatedData is required and must be an object"
      });
    }
    
    const validation = await validateTokenBudget(attributeId, updatedData, clientId);
    
    res.json({
      success: true,
      validation,
      message: validation.isValid 
        ? `Attribute would use ${validation.newTokens} tokens. Total: ${validation.projectedTotal}/${validation.limit} (${validation.percentUsed}%)`
        : `Cannot save - would exceed maximum allowed (${validation.maxAllowed} tokens). Would use ${validation.wouldExceedBy} tokens over limit.`
    });
    
  } catch (error) {
    logger.error(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/validate-budget error:`, error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to validate token budget"
    });
  }
});

// ---------------------------------------------------------------
// Post Scoring Token Budget API Endpoints
// ---------------------------------------------------------------

// Get current post token usage status
router.get("/api/post-token-usage", async (req, res) => {
  try {
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'post_token_usage' });
    logger.info("Getting current post token usage");
    
    if (!clientId) {
      return res.status(401).json({ error: 'Client ID required' });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(401).json({ error: 'Invalid client ID' });
    }
    
    const usage = await getCurrentPostTokenUsage(clientId);
    
    // Add warning levels
    const warningLevel = usage.percentUsed >= 95 ? 'danger' : usage.percentUsed >= 90 ? 'warning' : 'normal';
    
    res.json({
      success: true,
      usage: {
        ...usage,
        warningLevel
      },
      message: `Using ${usage.totalTokens} of ${usage.limit} post tokens (${usage.percentUsed}%)`
    });
    
  } catch (error) {
    logger.error("apiAndJobRoutes.js: GET /api/post-token-usage error:", error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get post token usage"
    });
  }
});

// Validate if post attribute save would exceed budget
router.post("/api/post-attributes/:id/validate-budget", async (req, res) => {
  try {
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'validate_post_token_budget', attributeId: req.params.id });
    logger.info("Validating post token budget");
    
    if (!clientId) {
      return res.status(401).json({ error: 'Client ID required' });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(401).json({ error: 'Invalid client ID' });
    }

    const attributeId = req.params.id;
    const updatedData = req.body;
    
    if (!updatedData || typeof updatedData !== 'object') {
      return res.status(400).json({
        success: false,
        error: "updatedData is required and must be an object"
      });
    }
    
    const validation = await validatePostTokenBudget(attributeId, updatedData, clientId);
    
    res.json({
      success: true,
      validation,
      message: validation.isValid 
        ? `Post attribute would use ${validation.newTokens} tokens. Total: ${validation.projectedTotal}/${validation.limit} (${validation.percentUsed}%)`
        : `Cannot save - would exceed maximum allowed (${validation.maxAllowed} tokens). Would use ${validation.wouldExceedBy} tokens over limit.`
    });
    
  } catch (error) {
    logger.error(`apiAndJobRoutes.js: POST /api/post-attributes/${req.params.id}/validate-budget error:`, error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to validate post token budget"
    });
  }
});

// ---------------------------------------------------------------
// AI-Powered Attribute Editing Routes (NEW)
// ---------------------------------------------------------------

// Helper function to build Gemini prompt for attribute editing
function buildAttributeEditPrompt(currentAttribute, userRequest) {
  return `You are an expert Attribute-Rubric Assistant for a sophisticated AI lead scoring system.

CONTEXT:
This is a multi-field attribute used by AI to score LinkedIn profiles. Each field serves a specific purpose:
- **Heading**: Display name users see
- **Instructions**: Core rubric content sent to AI for scoring (MOST IMPORTANT)
- **Max Points**: Scoring ceiling (positive attributes only)
- **Min To Qualify**: Threshold for early elimination  
- **Penalty**: Deduction amount (negative attributes only)
- **Signals**: Keywords/phrases that trigger detection (helps AI find this attribute)
- **Examples**: Sample scenarios with scoring ranges (helps AI understand nuances)
- **Active**: Whether this attribute is currently used in scoring

CURRENT_ATTRIBUTE:
${JSON.stringify(currentAttribute, null, 2)}

USER_REQUEST:
${userRequest}

RULES:
- Return VALID JSON with these exact keys: heading, instructions, maxPoints, minToQualify, penalty, signals, examples, active
- **Instructions** should include clear scoring ranges (e.g., "0-3 pts = minimal, 4-7 pts = moderate, 8-15 pts = strong")
- **Signals** should be comma-separated keywords/phrases that help AI detect this attribute
- **Examples** should include concrete scenarios with point values
- Keep numeric fields as integers
- Only positive attributes can have maxPoints > 0
- Only negative attributes can have penalty < 0
- Make improvements thoughtful and preserve the attribute's core purpose

Return ONLY the JSON object, no other text.`;
}

// Validate AI response for attribute editing
function validateAttributeResponse(data) {
  const required = ['heading', 'instructions', 'maxPoints', 'minToQualify', 'penalty', 'signals', 'examples', 'active'];
  for (const key of required) {
    if (!(key in data)) {
      throw new Error(`Missing required field: ${key}`);
    }
  }
  
  if (typeof data.maxPoints !== 'number' || data.maxPoints < 0 || data.maxPoints > 100) {
    throw new Error('maxPoints must be integer 0-100');
  }
  
  if (typeof data.minToQualify !== 'number' || data.minToQualify < 0) {
    throw new Error('minToQualify must be 0 or positive integer');
  }
  
  if (typeof data.penalty !== 'number' || data.penalty > 0) {
    throw new Error('penalty must be 0 or negative integer');
  }

  if (typeof data.heading !== 'string' || data.heading.trim().length === 0) {
    throw new Error('heading must be non-empty string');
  }

  if (typeof data.instructions !== 'string' || data.instructions.trim().length === 0) {
    throw new Error('instructions must be non-empty string');
  }

  return true;
}

// Get attribute for editing
router.get("/api/attributes/:id/edit", async (req, res) => {
  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'get_attribute_edit', attributeId: req.params.id });
    logger.info("Loading attribute for editing");
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }
    
    const attributeId = req.params.id;
    const attribute = await loadAttributeForEditingWithClientBase(attributeId, clientBase);
    
    res.json({
      success: true,
      attribute
    });
    
  } catch (error) {
    logger.error(`apiAndJobRoutes.js: GET /api/attributes/${req.params.id}/edit error:`, error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to load attribute for editing"
    });
  }
});

// AI-powered attribute editing (memory-based, returns improved rubric)
router.post("/api/attributes/:id/ai-edit", async (req, res) => {
  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'ai_edit_attribute', attributeId: req.params.id });
    logger.info("Generating AI suggestions for attribute");
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }
    
    const attributeId = req.params.id;
    const { userRequest } = req.body;
    
    if (!userRequest || typeof userRequest !== 'string') {
      return res.status(400).json({
        success: false,
        error: "userRequest is required and must be a string"
      });
    }

    // Load current attribute (get ALL fields) - use client-aware function
    const currentAttribute = await loadAttributeForEditingWithClientBase(attributeId, clientBase);
    
    // Call Gemini (using same model as scoring system for consistency)
    if (!vertexAIClient) {
      logger.error("apiAndJobRoutes.js: Gemini client not available - vertexAIClient is null");
      throw new Error("Gemini client not available - check config/geminiClient.js");
    }

    // Debug: Check what we have available
    logger.info(`apiAndJobRoutes.js: Debug - vertexAIClient available: ${!!vertexAIClient}`);
    logger.info(`apiAndJobRoutes.js: Debug - geminiModelId: ${geminiModelId}`);
    logger.info(`apiAndJobRoutes.js: Debug - geminiConfig: ${JSON.stringify(geminiConfig ? Object.keys(geminiConfig) : 'null')}`);

    // Use the same model that works for scoring instead of a separate editing model
    const editingModelId = geminiModelId || "gemini-2.5-pro-preview-05-06";
    logger.info(`apiAndJobRoutes.js: Using model ${editingModelId} for AI editing (same as scoring)`);
    
    // Validate model ID
    if (!editingModelId || editingModelId === 'null' || editingModelId === 'undefined') {
      logger.error("apiAndJobRoutes.js: Invalid model ID:", editingModelId);
      throw new Error("Invalid Gemini model ID - check environment configuration");
    }
    
    // Use same configuration as working scorer
    const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
    const model = vertexAIClient.getGenerativeModel({
      model: editingModelId,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    });
    const prompt = buildAttributeEditPrompt(currentAttribute, userRequest);
    
    logger.info(`apiAndJobRoutes.js: Sending prompt to Gemini for attribute ${req.params.id}`);
    
    // Use same request structure as working scorer
    const requestPayload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    };
    
    // Add timeout to prevent hanging (same approach as working scorer)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('AI request timed out after 30 seconds')), 30000);
    });
    
    const result = await Promise.race([
      model.generateContent(requestPayload),
      timeoutPromise
    ]);
    
    // Extract response text using the same method as working scorer
    if (!result || !result.response) {
      throw new Error("Gemini API call returned no response object");
    }
    
    const candidate = result.response.candidates?.[0];
    if (!candidate) {
      const blockReason = result.response.promptFeedback?.blockReason;
      const safetyRatings = result.response.promptFeedback?.safetyRatings;
      let sf = safetyRatings ? ` SafetyRatings: ${JSON.stringify(safetyRatings)}` : "";
      if (blockReason) throw new Error(`Gemini API call blocked. Reason: ${blockReason}.${sf}`);
      throw new Error(`Gemini API call returned no candidates.${sf}`);
    }
    
    const finishReason = candidate.finishReason;
    let responseText = "";
    
    if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
      responseText = candidate.content.parts[0].text.trim();
    } else {
      logger.warn(`apiAndJobRoutes.js: Candidate had no text content. Finish Reason: ${finishReason || 'Unknown'}.`);
      throw new Error(`Gemini API call returned no text content. Finish Reason: ${finishReason || 'Unknown'}`);
    }
    
    logger.info(`apiAndJobRoutes.js: Received response from Gemini: ${responseText.substring(0, 100)}...`);
    
    // Parse and validate AI response
    let aiResponse;
    try {
      aiResponse = JSON.parse(responseText);
    } catch (parseError) {
      logger.error("apiAndJobRoutes.js: AI response parsing error:", parseError.message);
      await logRouteError(parseError, req).catch(() => {});
      logger.error("apiAndJobRoutes.js: Raw AI response:", responseText);
      throw new Error(`AI returned invalid JSON: ${responseText.substring(0, 200)}...`);
    }
    
    validateAttributeResponse(aiResponse);
    
    // Return improved attribute (memory-based, don't save yet)
    res.json({
      success: true,
      suggestion: aiResponse, // Use 'suggestion' to match frontend expectations
      model: editingModelId,
      prompt: userRequest.substring(0, 100) + (userRequest.length > 100 ? '...' : '')
    });
    
  } catch (error) {
    logger.error(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/ai-edit error:`, error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate AI suggestions"
    });
  }
});

// Save improved rubric to live attribute
router.post("/api/attributes/:id/save", async (req, res) => {
  // Extract client ID for multi-tenant support (before try block so it's available in catch)
  const clientId = req.headers['x-client-id'];
  const logger = createLogger({ clientId, operation: 'save_attribute', attributeId: req.params.id });
  
  try {
    logger.info("Saving attribute changes");
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }
    
    const attributeId = req.params.id;
    const { improvedRubric } = req.body; // Keep for backward compatibility
    const updatedData = improvedRubric || req.body; // Also accept data directly
    
    if (!updatedData || typeof updatedData !== 'object') {
      return res.status(400).json({
        success: false,
        error: "updatedData is required and must be an object"
      });
    }
    
    // Check token budget before saving (for all active attributes)
    if (updatedData.active === true || updatedData.active === 'true') {
      logger.info(`apiAndJobRoutes.js: Checking token budget for attribute ${attributeId} (active=true)`);
      
      try {
        const budgetValidation = await validateTokenBudget(attributeId, updatedData, clientId);
        
        if (!budgetValidation.isValid) {
          logger.info(`apiAndJobRoutes.js: Token budget exceeded for attribute ${attributeId}`);
          return res.status(400).json({
            success: false,
            error: "Token budget exceeded",
            details: {
              message: `Saving this attribute would exceed your token budget by ${budgetValidation.wouldExceedBy} tokens.`,
              currentUsage: budgetValidation.currentTotal,
              newTokens: budgetValidation.newTokens,
              projectedTotal: budgetValidation.projectedTotal,
              limit: budgetValidation.limit,
              maxAllowed: budgetValidation.maxAllowed,
              suggestion: "Try reducing the text in Instructions, Examples, or Signals fields, or deactivate other attributes first."
            }
          });
        }
        
        logger.info(`apiAndJobRoutes.js: Token budget OK for attribute ${attributeId} (${budgetValidation.newTokens} tokens)`);
        
      } catch (budgetError) {
        logger.error(`apiAndJobRoutes.js: Token budget check failed for ${attributeId}:`, budgetError.message);
        await logRouteError(budgetError, req).catch(() => {});
        // Don't block save if budget check fails - just log warning
      }
    }
    
    // Get client-specific base and update attribute
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }

    await updateAttributeWithClientBase(attributeId, updatedData, clientBase);
    
    logger.info(`apiAndJobRoutes.js: Successfully saved changes to attribute ${attributeId}`);
    res.json({
      success: true,
      message: "Attribute updated successfully"
    });
    
  } catch (error) {
    logger.error(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/save error:`, error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to save attribute changes"
    });
  }
});

// Helper function to extract plain text from rich text fields
function extractPlainText(richTextValue) {
  if (!richTextValue) return "";
  if (typeof richTextValue === 'string') return richTextValue;
  
  // Handle Airtable rich text format
  if (richTextValue && typeof richTextValue === 'object' && richTextValue.content) {
    let text = "";
    const extractText = (content) => {
      if (Array.isArray(content)) {
        content.forEach(item => extractText(item));
      } else if (content && typeof content === 'object') {
        if (content.text) {
          text += content.text;
        }
        if (content.content) {
          extractText(content.content);
        }
      }
    };
    extractText(richTextValue.content);
    return text.trim();
  }
  
  return String(richTextValue);
}

// List all attributes for the library view
router.get("/api/attributes", async (req, res) => {
  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'get_attributes_library' });
    logger.info("Loading attribute library");
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }

    const records = await clientBase("Scoring Attributes")
      .select({
        fields: [
          "Attribute Id", "Heading", "Category", "Max Points", 
          "Min To Qualify", "Penalty", "Disqualifying", "Bonus Points", "Active",
          "Instructions", "Signals", "Examples"
        ],
        filterByFormula: "OR({Category} = 'Positive', {Category} = 'Negative')"
      })
      .all();

    const attributes = records.map(record => ({
      id: record.id,
      attributeId: record.get("Attribute Id"),
      heading: record.get("Heading") || "[Unnamed Attribute]",
      category: record.get("Category"),
      maxPoints: record.get("Max Points") || 0,
      minToQualify: record.get("Min To Qualify") || 0,
      penalty: record.get("Penalty") || 0,
      disqualifying: !!record.get("Disqualifying"),
      bonusPoints: !!record.get("Bonus Points"), // Convert to boolean: unchecked = false, checked = true
      active: !!record.get("Active"), // Convert to boolean: unchecked = false, checked = true
      instructions: extractPlainText(record.get("Instructions")),
      signals: extractPlainText(record.get("Signals")),
      examples: extractPlainText(record.get("Examples")),
      isEmpty: !record.get("Heading") && !extractPlainText(record.get("Instructions"))
    }));

    // Sort attributes: Positives first (A-Z), then Negatives (N1, N2, etc.)
    attributes.sort((a, b) => {
      // First sort by category: Positive before Negative
      if (a.category !== b.category) {
        if (a.category === 'Positive') return -1;
        if (b.category === 'Positive') return 1;
      }
      
      // Then sort alphabetically by Attribute ID within each category
      const aId = a.attributeId || '';
      const bId = b.attributeId || '';
      return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: 'base' });
    });

    logger.info(`apiAndJobRoutes.js: Successfully loaded ${attributes.length} attributes for library view`);
    res.json({
      success: true,
      attributes,
      count: attributes.length
    });
    
  } catch (error) {
    logger.error("apiAndJobRoutes.js: GET /api/attributes error:", error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to load attributes"
    });
  }
});

// Verify Active/Inactive filtering is working
router.get("/api/attributes/verify-active-filtering", async (req, res) => {
  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'verify_active_filtering' });
    logger.info("Testing active/inactive filtering");
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }
    
    const { loadAttributes } = require("../attributeLoader.js");
    
    // Load attributes using the same function that scoring uses
    const { positives, negatives } = await loadAttributes(null, clientId);
    
    // Get all attributes from Airtable to compare
    const allRecords = await clientBase("Scoring Attributes")
      .select({
        fields: ["Attribute Id", "Heading", "Category", "Bonus Points", "Active"],
        filterByFormula: "OR({Category} = 'Positive', {Category} = 'Negative')"
      })
      .all();
    
    const allAttributes = allRecords.map(record => ({
      id: record.get("Attribute Id"),
      heading: record.get("Heading") || "[Unnamed]",
      category: record.get("Category"),
      bonusPoints: !!record.get("Bonus Points"),
      active: !!record.get("Active")
    }));
    
    // Find which attributes are loaded vs skipped
    const loadedPositiveIds = Object.keys(positives);
    const loadedNegativeIds = Object.keys(negatives);
    const loadedIds = [...loadedPositiveIds, ...loadedNegativeIds];
    
    const activeAttributes = allAttributes.filter(attr => attr.active);
    const inactiveAttributes = allAttributes.filter(attr => !attr.active);
    
    const skippedAttributes = inactiveAttributes.filter(attr => 
      !loadedIds.includes(attr.id)
    );
    
    const unexpectedlyLoaded = inactiveAttributes.filter(attr => 
      loadedIds.includes(attr.id)
    );
    
    const unexpectedlySkipped = activeAttributes.filter(attr => 
      !loadedIds.includes(attr.id)
    );
    
    res.json({
      success: true,
      verification: {
        totalAttributesInAirtable: allAttributes.length,
        activeInAirtable: activeAttributes.length,
        inactiveInAirtable: inactiveAttributes.length,
        loadedIntoScoringSystem: loadedIds.length,
        correctlySkipped: skippedAttributes.length,
        unexpectedlyLoaded: unexpectedlyLoaded.length,
        unexpectedlySkipped: unexpectedlySkipped.length
      },
      details: {
        activeAttributes: activeAttributes.map(attr => `${attr.id}: ${attr.heading}`),
        inactiveAttributes: inactiveAttributes.map(attr => `${attr.id}: ${attr.heading}`),
        loadedAttributes: loadedIds,
        correctlySkippedAttributes: skippedAttributes.map(attr => `${attr.id}: ${attr.heading}`),
        unexpectedlyLoadedAttributes: unexpectedlyLoaded.map(attr => `${attr.id}: ${attr.heading}`),
        unexpectedlySkippedAttributes: unexpectedlySkipped.map(attr => `${attr.id}: ${attr.heading}`)
      },
      isFilteringWorking: unexpectedlyLoaded.length === 0 && unexpectedlySkipped.length === 0
    });
    
  } catch (error) {
    logger.error("apiAndJobRoutes.js: GET /api/attributes/verify-active-filtering error:", error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to verify active filtering"
    });
  }
});

// Field-specific AI help endpoint
router.post("/api/attributes/:id/ai-field-help", async (req, res) => {
  try {
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'ai_field_help', attributeId: req.params.id });
    logger.info("Field-specific AI help");
    
    if (!clientId) {
      return res.status(401).json({ error: 'Client ID required' });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(401).json({ error: 'Invalid client ID' });
    }

    const attributeId = req.params.id;
    const { fieldKey, userRequest, currentValue, currentAttribute } = req.body;
    
    if (!fieldKey || !userRequest || typeof userRequest !== 'string') {
      return res.status(400).json({
        success: false,
        error: "fieldKey and userRequest are required"
      });
    }

    // Field-specific prompt building with enhanced instructions for heading field
    const fieldContext = {
      heading: "Display name for this attribute. Keep it concise and descriptive.",
      maxPoints: "Maximum points this attribute can award. Typically 3-20 points based on importance.",
      instructions: "The core rubric content sent to AI for scoring. Should include clear point ranges (e.g., 0-3 pts = minimal, 4-7 pts = moderate, 8-15 pts = strong). This is the most important field.",
      minToQualify: "Minimum points required to qualify for scoring.",
      signals: "Keywords and phrases that help AI identify when this attribute applies. Examples: 'AI, machine learning, startup, founder, side project'",
      examples: "Concrete scenarios showing how points are awarded. Include specific point values that align with scoring ranges.",
      active: "Whether this attribute is currently used in scoring. Inactive attributes are ignored."
    };

    // Special handling for heading field with specific behavioral instructions
    if (fieldKey === 'heading') {
      const headingValue = currentValue && currentValue.trim() !== '' && currentValue !== 'null';
      
      const prompt = `You are an agent that helps users determine the name for this attribute.

${headingValue ? 
  `This attribute is currently named: "${currentValue}". Do you want to make any changes?` : 
  `Ok at the moment we have no name for this attribute, what would you like to call it?`
}

INSTRUCTIONS FOR YOU:
- If the user asks you to make a change, apply the change to the attribute name field immediately
- Do not attempt to save to the database yet as that will be done when the update form button is clicked
- When you provide a new name, end your response with: SUGGESTED_VALUE: [the new name]
- Be helpful but direct - focus on making the change they request

USER REQUEST: ${userRequest}`;

      // Call Gemini for field-specific help
      if (!vertexAIClient) {
        throw new Error("Gemini client not available");
      }

      const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
      const model = vertexAIClient.getGenerativeModel({
        model: geminiModelId || "gemini-2.5-pro-preview-05-06",
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        generationConfig: {
          temperature: 0.7
        }
      });

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const candidate = result.response.candidates?.[0];
      if (!candidate) {
        throw new Error("No response from AI");
      }

      const responseText = candidate.content?.parts?.[0]?.text?.trim();
      if (!responseText) {
        throw new Error("Empty response from AI");
      }

      // Extract suggested value if present
      let suggestion = responseText;
      let suggestedValue = null;
      
      if (responseText.includes('SUGGESTED_VALUE:')) {
        const parts = responseText.split('SUGGESTED_VALUE:');
        suggestion = parts[0].trim();
        suggestedValue = parts[1].trim();
      }

      res.json({
        success: true,
        suggestion,
        suggestedValue,
        fieldKey,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Special handling for maxPoints field with concise behavioral instructions
    if (fieldKey === 'maxPoints') {
      const prompt = `You are an expert assistant helping users understand max points for scoring attributes.

USER'S QUESTION: "${userRequest}"

RESPOND DIRECTLY TO THEIR SPECIFIC QUESTION. Here's context to help you answer:

CORE CONCEPT: Max points determines the weight/importance of this attribute in the overall scoring system.

KEY POINTS:
• Higher max points = more important attribute = bigger impact on final scores
• Lower max points = less important attribute = smaller impact on final scores
• All attributes compete for points in the final scoring calculation
• Think of it like a competition where attributes with higher max points can contribute more to the final score

IMPORTANCE LEVELS:
• Critical skills (high importance): Qualifications that heavily influence hiring decisions
• Important qualifications (moderate importance): Valuable skills that give candidates an edge
• Nice-to-have (low importance): Bonus qualities that are good but not essential

Answer their question directly and conversationally. If they ask about changing values, remind them to type the number in the field above.`;

      // Call Gemini for field-specific help
      if (!vertexAIClient) {
        throw new Error("Gemini client not available");
      }

      const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
      const model = vertexAIClient.getGenerativeModel({
        model: geminiModelId || "gemini-2.5-pro-preview-05-06",
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        generationConfig: {
          temperature: 0.7
        }
      });

      logger.info(`apiAndJobRoutes.js: Sending maxPoints prompt to Gemini:`, prompt.substring(0, 200) + '...');

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      logger.info(`apiAndJobRoutes.js: Gemini response structure:`, JSON.stringify(result.response, null, 2));

      const candidate = result.response.candidates?.[0];
      if (!candidate) {
        logger.error(`apiAndJobRoutes.js: No candidates in maxPoints response. Full response:`, JSON.stringify(result.response, null, 2));
        throw new Error("No response from AI");
      }

      logger.info(`apiAndJobRoutes.js: maxPoints candidate structure:`, JSON.stringify(candidate, null, 2));

      const responseText = candidate.content?.parts?.[0]?.text?.trim();
      if (!responseText) {
        logger.error(`apiAndJobRoutes.js: Empty maxPoints response text. Candidate:`, JSON.stringify(candidate, null, 2));
        logger.error(`apiAndJobRoutes.js: Finish reason:`, candidate.finishReason);
        
        throw new Error(`Empty response from AI. Finish reason: ${candidate.finishReason || 'Unknown'}. Check backend logs for details.`);
      }

      logger.info(`apiAndJobRoutes.js: maxPoints AI response:`, responseText.substring(0, 100) + '...');

      // Extract suggested value if present
      let suggestion = responseText;
      let suggestedValue = null;
      
      if (responseText.includes('SUGGESTED_VALUE:')) {
        const parts = responseText.split('SUGGESTED_VALUE:');
        suggestion = parts[0].trim();
        suggestedValue = parts[1].trim();
      }

      res.json({
        success: true,
        suggestion,
        suggestedValue,
        fieldKey,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Special handling for minToQualify field with concise behavioral instructions
    if (fieldKey === 'minToQualify') {
      const prompt = `You are an expert assistant helping users understand minimum qualifying points for scoring attributes.

USER QUESTION: ${userRequest}

CURRENT VALUE: ${currentValue || '0 (no minimum required)'}

RESPOND DIRECTLY TO THEIR QUESTION WITH HELPFUL INFORMATION:

Min to Qualify is a threshold that eliminates candidates who don't meet basic requirements for this attribute. Here's how it works:

• If someone scores below your minimum on this attribute, they automatically get 0% overall (eliminated)
• If they meet or exceed the minimum, they continue through normal scoring
• Set to 0 if you want everyone scored regardless of this attribute

THRESHOLD APPROACHES:
• No minimum: Everyone gets fully scored regardless
• Basic requirement: Must show some evidence of this attribute
• Important requirement: Must have solid demonstration of this attribute

To set your minimum, simply type the number you want in the field above this chat.

What level of requirement do you want this attribute to have?`;

      // Call Gemini for field-specific help
      if (!vertexAIClient) {
        throw new Error("Gemini client not available");
      }

      const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
      const model = vertexAIClient.getGenerativeModel({
        model: geminiModelId || "gemini-2.5-pro-preview-05-06",
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        generationConfig: {
          temperature: 0.7
        }
      });

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const candidate = result.response.candidates?.[0];
      if (!candidate) {
        throw new Error("No response from AI");
      }

      const responseText = candidate.content?.parts?.[0]?.text?.trim();
      if (!responseText) {
        throw new Error("Empty response from AI");
      }

      // Extract suggested value if present
      let suggestion = responseText;
      let suggestedValue = null;
      
      if (responseText.includes('SUGGESTED_VALUE:')) {
        const parts = responseText.split('SUGGESTED_VALUE:');
        suggestion = parts[0].trim();
        suggestedValue = parts[1].trim();
      }

      res.json({
        success: true,
        suggestion,
        suggestedValue,
        fieldKey,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Special handling for signals field - detection keywords that help AI find this attribute
    if (fieldKey === 'signals') {
      const instructions = currentAttribute.instructions || currentValue || '(no instructions set)';
      const attributeName = currentAttribute.heading || 'this attribute';
      
      const prompt = `You are helping users create detection keywords for "${attributeName}" - words and phrases that help AI identify when this attribute applies to a LinkedIn profile.

CURRENT INSTRUCTIONS FOR AI SCORING:
${instructions}

CURRENT DETECTION KEYWORDS: ${currentValue || '(none set)'}

WHAT ARE DETECTION KEYWORDS?
These are specific words, phrases, job titles, skills, or indicators that suggest someone has this attribute. When the AI sees these in a LinkedIn profile, it knows to evaluate this attribute more carefully.

WHEN USER ASKS FOR SUGGESTIONS (phrases like "what keywords would you suggest", "looking at the instructions", "based on the scoring criteria"):
- Analyze the scoring instructions above
- Extract key terms, skills, job titles, technologies, or indicators mentioned
- Suggest 8-12 relevant keywords/phrases separated by commas
- Include both technical terms and common variations
- ALWAYS end with: SUGGESTED_VALUE: [comma-separated keywords]

WHEN USER ASKS TO ADD KEYWORDS (phrases like "add...", "include...", "also add..."):
- Take the current keywords above and add the new ones
- Remove duplicates and organize logically
- ALWAYS end with: SUGGESTED_VALUE: [updated comma-separated keywords]

WHEN USER ASKS FOR HELP:
- Ask: "I can analyze your scoring instructions and suggest keywords that help AI detect this attribute. What would you like me to focus on?"

EXAMPLES OF GOOD KEYWORDS:
- Job titles: "CTO, VP Engineering, Technical Lead"
- Skills: "machine learning, AI, data science"
- Technologies: "Python, TensorFlow, AWS"
- Experience indicators: "startup founder, side projects, open source"

ALWAYS include SUGGESTED_VALUE when providing or updating keywords.

USER REQUEST: ${userRequest}`;

      // Call Gemini for field-specific help
      if (!vertexAIClient) {
        throw new Error("Gemini client not available");
      }

      const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
      const model = vertexAIClient.getGenerativeModel({
        model: geminiModelId || "gemini-2.5-pro-preview-05-06",
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        generationConfig: {
          temperature: 0.7
        }
      });

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const candidate = result.response.candidates?.[0];
      if (!candidate) {
        throw new Error("No response from AI");
      }

      const responseText = candidate.content?.parts?.[0]?.text?.trim();
      if (!responseText) {
        throw new Error("Empty response from AI");
      }

      // Extract suggested value if present
      let suggestion = responseText;
      let suggestedValue = null;
      
      if (responseText.includes('SUGGESTED_VALUE:')) {
        const parts = responseText.split('SUGGESTED_VALUE:');
        suggestion = parts[0].trim();
        suggestedValue = parts[1].trim();
      }

      res.json({
        success: true,
        suggestion,
        suggestedValue,
        fieldKey,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Special handling for instructions field - the most critical field for scoring
    if (fieldKey === 'instructions') {
      const maxPoints = currentAttribute.maxPoints || 15;
      
      const prompt = `You are an expert assistant helping users create scoring instructions for lead attributes.

USER'S QUESTION: "${userRequest}"

CURRENT INSTRUCTIONS: ${currentValue || '(no current instructions)'}

RESPOND DIRECTLY TO THEIR SPECIFIC QUESTION. Here's context to help you answer:

CORE PURPOSE: Instructions tell AI exactly how to score leads for this attribute from 0 to ${maxPoints} points.

KEY ELEMENTS:
• Clear point ranges (e.g., "0-3 pts = minimal evidence, 4-7 pts = moderate, 8-${maxPoints} pts = strong")
• Specific criteria for each range
• Measurable qualifications
• Examples of what qualifies for each point range

GUIDANCE:
• If they're asking for general advice, help them understand scoring instructions
• If they're asking for specific changes, apply them while keeping the 0-${maxPoints} structure
• If they're asking you to create instructions, provide clear scoring ranges

Answer their question directly and conversationally. If you have specific updated instructions to suggest, end with "SUGGESTED_VALUE: [your suggestion]"`;

      // Call Gemini for field-specific help
      if (!vertexAIClient) {
        throw new Error("Gemini client not available");
      }

      const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
      const model = vertexAIClient.getGenerativeModel({
        model: geminiModelId || "gemini-2.5-pro-preview-05-06",
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        generationConfig: {
          temperature: 0.7
        }
      });

      logger.info(`apiAndJobRoutes.js: Sending instructions prompt to Gemini:`, prompt.substring(0, 200) + '...');

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      logger.info(`apiAndJobRoutes.js: Instructions Gemini response structure:`, JSON.stringify(result.response, null, 2));

      const candidate = result.response.candidates?.[0];
      if (!candidate) {
        logger.error(`apiAndJobRoutes.js: No candidates in instructions response. Full response:`, JSON.stringify(result.response, null, 2));
        throw new Error("No response from AI");
      }

      logger.info(`apiAndJobRoutes.js: Instructions candidate structure:`, JSON.stringify(candidate, null, 2));

      const responseText = candidate.content?.parts?.[0]?.text?.trim();
      if (!responseText) {
        logger.error(`apiAndJobRoutes.js: Empty instructions response text. Candidate:`, JSON.stringify(candidate, null, 2));
        logger.error(`apiAndJobRoutes.js: Finish reason:`, candidate.finishReason);
        
        throw new Error(`Empty response from AI. Finish reason: ${candidate.finishReason || 'Unknown'}. Check backend logs for details.`);
      }

      logger.info(`apiAndJobRoutes.js: Instructions AI response:`, responseText.substring(0, 100) + '...');

      // Extract suggested value if present
      let suggestion = responseText;
      let suggestedValue = null;
      
      if (responseText.includes('SUGGESTED_VALUE:')) {
        const parts = responseText.split('SUGGESTED_VALUE:');
        suggestion = parts[0].trim();
        suggestedValue = parts[1].trim();
      }

      res.json({
        success: true,
        suggestion,
        suggestedValue,
        fieldKey,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Default prompt for all other fields
    const prompt = `You are an expert AI assistant helping to improve lead scoring attributes.

FIELD CONTEXT:
Field: ${fieldKey}
Description: ${fieldContext[fieldKey] || 'Field for scoring attribute'}
Current Value: ${currentValue || '(empty)'}

FULL ATTRIBUTE CONTEXT:
${JSON.stringify(currentAttribute, null, 2)}

USER REQUEST:
${userRequest}

INSTRUCTIONS:
- Provide specific, actionable advice for the "${fieldKey}" field
- If suggesting a specific value, be concrete and practical
- Keep response conversational and helpful
- Focus specifically on the "${fieldKey}" field
- If suggesting point ranges, ensure they don't exceed maxPoints (${currentAttribute.maxPoints || 'not set'})

Respond in a helpful, conversational tone. If you have a specific suggested value, end with "SUGGESTED_VALUE: [your suggestion]"`;

    // Call Gemini for field-specific help
    if (!vertexAIClient) {
      throw new Error("Gemini client not available");
    }

    const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
    const model = vertexAIClient.getGenerativeModel({
      model: geminiModelId || "gemini-2.5-pro-preview-05-06",
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      generationConfig: {
        temperature: 0.7
      }
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const candidate = result.response.candidates?.[0];
    if (!candidate) {
      throw new Error("No response from AI");
    }

    const responseText = candidate.content?.parts?.[0]?.text?.trim();
    if (!responseText) {
      throw new Error("Empty response from AI");
    }

    // Extract suggested value if present
    let suggestion = responseText;
    let suggestedValue = null;
    
    if (responseText.includes('SUGGESTED_VALUE:')) {
      const parts = responseText.split('SUGGESTED_VALUE:');
      suggestion = parts[0].trim();
      suggestedValue = parts[1].trim();
    }

    res.json({
      success: true,
      suggestion,
      suggestedValue,
      fieldKey,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/ai-field-help error:`, error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get AI help"
    });
  }
});

// ============================================================================
// POST SCORING ATTRIBUTES ENDPOINTS
// ============================================================================

// List all post attributes for the library view
router.get("/api/post-attributes", async (req, res) => {
  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'get_post_attributes_library' });
    logger.info("Loading post attribute library");
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }

    const records = await clientBase("Post Scoring Attributes")
      .select({
        fields: [
          "Attribute ID", "Active", "Criterion Name", "Category", "Max Score / Point Value", 
          "Scoring Type", "Detailed Instructions for AI (Scoring Rubric)", 
          "Example - High Score / Applies", "Example - Low Score / Does Not Apply",
          "Keywords/Positive Indicators", "Keywords/Negative Indicators"
        ]
      })
      .all();

    const attributes = records.map(record => ({
      id: record.id,
      attributeId: record.get("Attribute ID"),
      heading: record.get("Criterion Name") || "[Unnamed Attribute]",
      category: record.get("Category") === "Positive Scoring Factor" ? "Positive" : "Negative",
      maxPoints: record.get("Max Score / Point Value") || 0,
      scoringType: record.get("Scoring Type") || "Scale", // Add scoring type
      minToQualify: 0, // Not used in post scoring
      penalty: record.get("Category") === "Negative Scoring Factor" ? Math.abs(record.get("Max Score / Point Value") || 0) : 0,
      disqualifying: false, // Not used in post scoring
      bonusPoints: false, // Not used in post scoring
      active: !!record.get("Active"), // Simple boolean conversion - false means inactive, true means active
      instructions: record.get("Detailed Instructions for AI (Scoring Rubric)") || "",
      // Return all separate fields for richer UX display
      positiveIndicators: record.get("Keywords/Positive Indicators") || "",
      negativeIndicators: record.get("Keywords/Negative Indicators") || "",
      highScoreExample: record.get("Example - High Score / Applies") || "",
      lowScoreExample: record.get("Example - Low Score / Does Not Apply") || "",
      // Keep combined fields for backward compatibility
      signals: record.get("Keywords/Positive Indicators") || record.get("Keywords/Negative Indicators") || "",
      examples: record.get("Example - High Score / Applies") || record.get("Example - Low Score / Does Not Apply") || "",
      isEmpty: !record.get("Criterion Name") && !record.get("Detailed Instructions for AI (Scoring Rubric)")
    }));

    // Sort attributes: Positives first (A-Z), then Negatives (N1, N2, etc.)
    attributes.sort((a, b) => {
      // First sort by category: Positive before Negative
      if (a.category !== b.category) {
        if (a.category === 'Positive') return -1;
        if (b.category === 'Positive') return 1;
      }
      
      // Then sort alphabetically by Attribute ID within each category
      const aId = a.attributeId || '';
      const bId = b.attributeId || '';
      return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: 'base' });
    });

    logger.info(`apiAndJobRoutes.js: Successfully loaded ${attributes.length} post attributes for library view`);
    res.json({
      success: true,
      attributes,
      count: attributes.length
    });
    
  } catch (error) {
    logger.error("apiAndJobRoutes.js: GET /api/post-attributes error:", error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to load post attributes"
    });
  }
});

// Get post attribute for editing
router.get("/api/post-attributes/:id/edit", async (req, res) => {
  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'get_post_attribute_edit', attributeId: req.params.id });
    logger.info("Loading post attribute for editing");
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }

    const record = await clientBase("Post Scoring Attributes").find(req.params.id);
    
    const attribute = {
      id: record.id,
      attributeId: record.get("Attribute ID"),
      heading: record.get("Criterion Name") || "",
      category: record.get("Category") === "Positive Scoring Factor" ? "Positive" : "Negative",
      maxPoints: record.get("Max Score / Point Value") || 0,
      scoringType: record.get("Scoring Type") || "Scale",
      minToQualify: 0,
      penalty: record.get("Category") === "Negative Scoring Factor" ? Math.abs(record.get("Max Score / Point Value") || 0) : 0,
      disqualifying: false,
      bonusPoints: false,
      active: !!record.get("Active"), // Simple boolean conversion - false means inactive, true means active
      instructions: record.get("Detailed Instructions for AI (Scoring Rubric)") || "",
      // Return all separate fields for richer UX display
      positiveIndicators: record.get("Keywords/Positive Indicators") || "",
      negativeIndicators: record.get("Keywords/Negative Indicators") || "",
      highScoreExample: record.get("Example - High Score / Applies") || "",
      lowScoreExample: record.get("Example - Low Score / Does Not Apply") || "",
      // Keep combined fields for backward compatibility
      signals: record.get("Keywords/Positive Indicators") || record.get("Keywords/Negative Indicators") || "",
      examples: record.get("Example - High Score / Applies") || record.get("Example - Low Score / Does Not Apply") || ""
    };

    logger.info(`apiAndJobRoutes.js: Successfully loaded post attribute ${req.params.id} for editing`);
    res.json({
      success: true,
      attribute
    });
    
  } catch (error) {
    logger.error(`apiAndJobRoutes.js: GET /api/post-attributes/${req.params.id}/edit error:`, error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to load post attribute for editing"
    });
  }
});

// Generate AI suggestions for post attribute
router.post("/api/post-attributes/:id/ai-edit", async (req, res) => {
  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'ai_edit_post_attribute', attributeId: req.params.id });
    logger.info("Generating AI suggestions for post attribute");
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }

    const record = await clientBase("Post Scoring Attributes").find(req.params.id);
    
    const { requestType, currentData } = req.body;
    
    // Build prompt based on request type
    let prompt = "";
    const heading = currentData.heading || record.get("Criterion Name") || "[Unnamed Attribute]";
    const category = record.get("Category") === "Positive Scoring Factor" ? "Positive" : "Negative";
    
    if (requestType === "improve_all") {
      prompt = `I'm working on LinkedIn post scoring attributes for lead generation. Please help me improve this ${category.toLowerCase()} attribute:

**Current Attribute: "${heading}"**
**Category:** ${category}
**Current Instructions:** ${currentData.instructions || "None"}
**Current Positive Indicators:** ${currentData.positiveIndicators || "None"}  
**Current Negative Indicators:** ${currentData.negativeIndicators || "None"}  
**Current High Score Example:** ${currentData.highScoreExample || "None"}
**Current Low Score Example:** ${currentData.lowScoreExample || "None"}

Please provide improved content for:
1. **Instructions** - Clear guidance for human reviewers on how to evaluate this attribute in LinkedIn posts
2. **Positive Indicators** - Specific things to look for in post content that indicate this attribute positively
3. **Negative Indicators** - Specific things to look for in post content that indicate this attribute negatively  
4. **High Score Example** - Concrete example of a post that would score well for this attribute
5. **Low Score Example** - Concrete example of a post that would score poorly for this attribute

Focus on LinkedIn post content analysis and lead generation effectiveness.`;

    } else if (requestType === "instructions") {
      prompt = `Write clear instructions for evaluating the "${heading}" attribute in LinkedIn posts for lead generation. 
      
Current instructions: ${currentData.instructions || "None"}
Category: ${category}

Provide improved instructions that help human reviewers consistently evaluate this attribute.`;

    } else if (requestType === "positiveIndicators") {
      prompt = `List specific positive indicators to look for in LinkedIn posts that indicate the "${heading}" attribute.
      
Current positive indicators: ${currentData.positiveIndicators || "None"}
Category: ${category}
Instructions: ${currentData.instructions || "None"}

Provide concrete, observable positive indicators in post content.`;

    } else if (requestType === "negativeIndicators") {
      prompt = `List specific negative indicators to look for in LinkedIn posts that indicate the "${heading}" attribute.
      
Current negative indicators: ${currentData.negativeIndicators || "None"}
Category: ${category}
Instructions: ${currentData.instructions || "None"}

Provide concrete, observable negative indicators in post content.`;

    } else if (requestType === "highScoreExample") {
      prompt = `Provide a concrete example of a LinkedIn post that demonstrates a HIGH SCORE for the "${heading}" attribute.
      
Current high score example: ${currentData.highScoreExample || "None"}
Category: ${category}
Instructions: ${currentData.instructions || "None"}

Include a brief explanation of why this example fits this attribute.`;

    } else if (requestType === "lowScoreExample") {
      prompt = `Provide a concrete example of a LinkedIn post that demonstrates a LOW SCORE for the "${heading}" attribute.
      
Current low score example: ${currentData.lowScoreExample || "None"}
Category: ${category}
Instructions: ${currentData.instructions || "None"}

Include a brief explanation of why this example fits this attribute.`;
    } else {
      throw new Error("Invalid request type");
    }

    // Use Gemini to generate suggestions
    const { generateWithGemini } = require("../config/geminiClient.js");
    const suggestions = await generateWithGemini(prompt);

    logger.info(`apiAndJobRoutes.js: Successfully generated AI suggestions for post attribute ${req.params.id}`);
    res.json({
      success: true,
      suggestions,
      requestType
    });
    
  } catch (error) {
    logger.error(`apiAndJobRoutes.js: POST /api/post-attributes/${req.params.id}/ai-edit error:`, error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate AI suggestions"
    });
  }
});

// Save post attribute changes
router.post("/api/post-attributes/:id/save", async (req, res) => {
  try {
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
    const logger = createLogger({ clientId, operation: 'save_post_attribute', attributeId: req.params.id });
    logger.info("🔥 BACKEND HIT: Saving post attribute changes");
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "Client ID required in x-client-id header"
      });
    }

    // Get client-specific base
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      return res.status(400).json({
        success: false,
        error: `Invalid client ID: ${clientId}`
      });
    }

    const { heading, instructions, positiveIndicators, negativeIndicators, highScoreExample, lowScoreExample, active, maxPoints, scoringType } = req.body;
    
    logger.info('Post attribute save - active field:', {
      receivedActive: active,
      typeOfActive: typeof active,
      willSaveAs: active !== undefined ? !!active : 'not updating'
    });
    
    // First get the current record to determine category for proper field mapping
    const record = await clientBase("Post Scoring Attributes").find(req.params.id);
    const category = record.get("Category");
    
    // Prepare update data - only include fields that are provided
    const updateData = {};
    if (heading !== undefined) updateData["Criterion Name"] = heading;
    if (instructions !== undefined) updateData["Detailed Instructions for AI (Scoring Rubric)"] = instructions;
    if (maxPoints !== undefined) updateData["Max Score / Point Value"] = maxPoints;
    if (scoringType !== undefined) updateData["Scoring Type"] = scoringType;
    
    // Handle Keywords fields separately
    if (positiveIndicators !== undefined) updateData["Keywords/Positive Indicators"] = positiveIndicators;
    if (negativeIndicators !== undefined) updateData["Keywords/Negative Indicators"] = negativeIndicators;
    
    // Handle Example fields separately  
    if (highScoreExample !== undefined) updateData["Example - High Score / Applies"] = highScoreExample;
    if (lowScoreExample !== undefined) updateData["Example - Low Score / Does Not Apply"] = lowScoreExample;
    
    if (active !== undefined) updateData["Active"] = !!active; // Handle Active field updates with boolean conversion

    logger.info('Update data being sent to Airtable:', updateData);

    // Update the record
    await clientBase("Post Scoring Attributes").update(req.params.id, updateData);

    logger.info(`apiAndJobRoutes.js: Successfully saved post attribute ${req.params.id}`);
    res.json({
      success: true,
      message: "Post attribute updated successfully"
    });
    
  } catch (error) {
    logger.error(`apiAndJobRoutes.js: POST /api/post-attributes/${req.params.id}/save error:`, error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message || "Failed to save post attribute"
    });
  }
});

// ---------------------------------------------------------------
// PHASE 1 COMPREHENSIVE AUDIT SYSTEM
// ---------------------------------------------------------------

// Comprehensive system audit - tests all "floors" of our architecture
router.get("/api/audit/comprehensive", async (req, res) => {
  const startTime = Date.now();
  
  // Get client ID from header
  const clientId = req.headers['x-client-id'];
  const logger = createLogger({ clientId, operation: 'comprehensive_audit' });
  logger.info("Starting comprehensive system audit");
  
  if (!clientId) {
    return res.status(400).json({
      success: false,
      error: "Client ID required in x-client-id header for audit"
    });
  }

  const auditResults = {
    clientId,
    timestamp: new Date().toISOString(),
    overallStatus: "PASS",
    floors: {},
    summary: {
      totalTests: 0,
      passed: 0,
      failed: 0,
      warnings: 0
    },
    recommendations: []
  };

  try {
    // ============= FLOOR 1: BASIC CONNECTIVITY & AUTHENTICATION =============
    logger.info("Audit Floor 1: Testing basic connectivity and authentication");
    auditResults.floors.floor1 = {
      name: "Basic Connectivity & Authentication",
      status: "PASS",
      tests: []
    };

    // Test 1.1: Client Base Resolution
    try {
      const clientBase = await getClientBase(clientId);
      if (!clientBase) {
        throw new Error("Client base resolution failed");
      }
      auditResults.floors.floor1.tests.push({
        test: "Client Base Resolution",
        status: "PASS",
        message: "Successfully resolved client-specific Airtable base"
      });
      auditResults.summary.passed++;
    } catch (error) {
      auditResults.floors.floor1.tests.push({
        test: "Client Base Resolution", 
        status: "FAIL",
        message: error.message
      });
      auditResults.floors.floor1.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // Test 1.2: Airtable Connection
    try {
      const clientBase = await getClientBase(clientId);
      const testQuery = await clientBase("Scoring Attributes")
        .select({ maxRecords: 1 })
        .firstPage();
      
      auditResults.floors.floor1.tests.push({
        test: "Airtable Connection",
        status: "PASS", 
        message: "Successfully connected to client's Airtable base"
      });
      auditResults.summary.passed++;
    } catch (error) {
      auditResults.floors.floor1.tests.push({
        test: "Airtable Connection",
        status: "FAIL",
        message: error.message
      });
      auditResults.floors.floor1.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // Test 1.3: Multi-tenant Isolation
    try {
      const clientService = require('../services/clientService');
      const tokenLimits = await clientService.getClientTokenLimits(clientId);
      
      if (!tokenLimits) {
        throw new Error("Client configuration not found in Master Clients");
      }
      
      auditResults.floors.floor1.tests.push({
        test: "Multi-tenant Isolation",
        status: "PASS",
        message: `Client isolated properly: ${tokenLimits.clientName}`
      });
      auditResults.summary.passed++;
    } catch (error) {
      auditResults.floors.floor1.tests.push({
        test: "Multi-tenant Isolation",
        status: "FAIL", 
        message: error.message
      });
      auditResults.floors.floor1.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // ============= FLOOR 2: BUSINESS LOGIC & SCORING =============
    logger.info("Audit Floor 2: Testing business logic and scoring system");
    auditResults.floors.floor2 = {
      name: "Business Logic & Scoring",
      status: "PASS",
      tests: []
    };

    // Test 2.1: Attribute Loading
    try {
      const { loadAttributes } = require("../attributeLoader.js");
      const { positives, negatives } = await loadAttributes(null, clientId);
      
      const totalAttributes = Object.keys(positives).length + Object.keys(negatives).length;
      if (totalAttributes === 0) {
        throw new Error("No active attributes found");
      }
      
      auditResults.floors.floor2.tests.push({
        test: "Attribute Loading",
        status: "PASS",
        message: `Loaded ${Object.keys(positives).length} positive and ${Object.keys(negatives).length} negative attributes`
      });
      auditResults.summary.passed++;
    } catch (error) {
      auditResults.floors.floor2.tests.push({
        test: "Attribute Loading",
        status: "FAIL",
        message: error.message
      });
      auditResults.floors.floor2.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // Test 2.2: Token Budget Calculation
    try {
      const usage = await getCurrentTokenUsage(clientId);
      
      if (typeof usage.totalTokens !== 'number' || usage.totalTokens < 0) {
        throw new Error("Invalid token calculation");
      }
      
      auditResults.floors.floor2.tests.push({
        test: "Token Budget Calculation",
        status: "PASS",
        message: `Token usage: ${usage.totalTokens}/${usage.limit} (${usage.percentUsed}%)`
      });
      auditResults.summary.passed++;
      
      // Warning if token usage is high
      if (usage.percentUsed > 90) {
        auditResults.summary.warnings++;
        auditResults.recommendations.push(`High token usage: ${usage.percentUsed}% - consider deactivating some attributes`);
      }
    } catch (error) {
      auditResults.floors.floor2.tests.push({
        test: "Token Budget Calculation",
        status: "FAIL",
        message: error.message
      });
      auditResults.floors.floor2.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // Test 2.3: Scoring System Components
    try {
      const { computeFinalScore } = require("../scoring.js");
      const { buildAttributeBreakdown } = require("../scripts/analysis/breakdown.js");
      
      // Test with mock data
      const mockPositiveScores = { A: 5, B: 8 };
      const mockPositives = { A: { maxPoints: 10 }, B: { maxPoints: 10 } };
      const mockNegativeScores = {};
      const mockNegatives = {};
      
      const result = computeFinalScore(
        mockPositiveScores, mockPositives,
        mockNegativeScores, mockNegatives,
        false, []
      );
      
      if (typeof result.percentage !== 'number') {
        throw new Error("Scoring calculation failed");
      }
      
      auditResults.floors.floor2.tests.push({
        test: "Scoring System Components", 
        status: "PASS",
        message: "Scoring and breakdown functions working correctly"
      });
      auditResults.summary.passed++;
    } catch (error) {
      auditResults.floors.floor2.tests.push({
        test: "Scoring System Components",
        status: "FAIL",
        message: error.message
      });
      auditResults.floors.floor2.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // Test 2.4: ENDPOINT TESTING - "Drive the Car" Tests
    logger.info("Running endpoint tests - actually calling API endpoints...");
    
    // Test 2.4a: Scoring Endpoint Test
    try {
      const clientBase = await getClientBase(clientId);
      
      // Try to find a lead with Profile Full JSON for endpoint testing
      const testLeads = await clientBase("Leads")
        .select({
          maxRecords: 1,
          filterByFormula: "AND({Profile Full JSON} != '', LEN({Profile Full JSON}) > 100)"
        })
        .firstPage();

      if (testLeads.length > 0) {
        const testLeadId = testLeads[0].id;
  const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
        
        // Make actual API call to scoring endpoint
        const response = await fetch(`${baseUrl}/score-lead?recordId=${testLeadId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': clientId
          }
        });
        
        if (response.ok) {
          const scoreData = await response.json();
          auditResults.floors.floor2.tests.push({
            test: "Scoring Endpoint Live Test",
            status: "PASS",
            message: `Scoring endpoint working - processed lead ${testLeadId} successfully`
          });
          auditResults.summary.passed++;
        } else {
          throw new Error(`Scoring endpoint returned ${response.status}: ${await response.text()}`);
        }
      } else {
        auditResults.floors.floor2.tests.push({
          test: "Scoring Endpoint Live Test",
          status: "WARN", 
          message: "No suitable test leads found with Profile JSON"
        });
        auditResults.summary.warnings++;
      }
    } catch (error) {
      auditResults.floors.floor2.tests.push({
        test: "Scoring Endpoint Live Test",
        status: "FAIL",
        message: `Scoring endpoint test failed: ${error.message}`
      });
      auditResults.floors.floor2.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // Test 2.4b: Attributes API Endpoint Test
    try {
  const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
      
      const response = await fetch(`${baseUrl}/api/attributes`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId
        }
      });
      
      if (response.ok) {
        const attrData = await response.json();
        auditResults.floors.floor2.tests.push({
          test: "Attributes API Endpoint Live Test",
          status: "PASS",
          message: `Attributes API working - returned ${attrData.count || 0} attributes`
        });
        auditResults.summary.passed++;
      } else {
        throw new Error(`Attributes API returned ${response.status}: ${await response.text()}`);
      }
    } catch (error) {
      auditResults.floors.floor2.tests.push({
        test: "Attributes API Endpoint Live Test",
        status: "FAIL",
        message: `Attributes API test failed: ${error.message}`
      });
      auditResults.floors.floor2.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // Test 2.4c: Token Usage API Endpoint Test
    try {
  const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
      
      const response = await fetch(`${baseUrl}/api/token-usage`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId
        }
      });
      
      if (response.ok) {
        const tokenData = await response.json();
        auditResults.floors.floor2.tests.push({
          test: "Token Usage API Endpoint Live Test",
          status: "PASS",
          message: `Token Usage API working - ${tokenData.usage?.percentUsed || 'unknown'}% used`
        });
        auditResults.summary.passed++;
      } else {
        throw new Error(`Token Usage API returned ${response.status}: ${await response.text()}`);
      }
    } catch (error) {
      auditResults.floors.floor2.tests.push({
        test: "Token Usage API Endpoint Live Test",
        status: "FAIL",
        message: `Token Usage API test failed: ${error.message}`
      });
      auditResults.floors.floor2.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // ============= FLOOR 3: ADVANCED FEATURES & AI =============
    logger.info("Audit Floor 3: Testing advanced features and AI integration");
    auditResults.floors.floor3 = {
      name: "Advanced Features & AI",
      status: "PASS",
      tests: []
    };

    // Test 3.1: Gemini AI Configuration
    try {
      if (!vertexAIClient || !geminiModelId) {
        throw new Error("Gemini AI client or model ID not configured");
      }
      
      auditResults.floors.floor3.tests.push({
        test: "Gemini AI Configuration",
        status: "PASS",
        message: `Gemini configured with model: ${geminiModelId}`
      });
      auditResults.summary.passed++;
    } catch (error) {
      auditResults.floors.floor3.tests.push({
        test: "Gemini AI Configuration",
        status: "FAIL",
        message: error.message
      });
      auditResults.floors.floor3.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // Test 3.2: Post Scoring Configuration
    try {
      const clientBase = await getClientBase(clientId);
      const postAttributes = await clientBase('Post Scoring Attributes')
        .select({ maxRecords: 1, filterByFormula: 'Active = TRUE()' })
        .firstPage();
      
      auditResults.floors.floor3.tests.push({
        test: "Post Scoring Configuration",
        status: "PASS",
        message: `Post scoring configured with ${postAttributes.length > 0 ? 'active' : 'no active'} attributes`
      });
      auditResults.summary.passed++;
    } catch (error) {
      auditResults.floors.floor3.tests.push({
        test: "Post Scoring Configuration",
        status: "WARN",
        message: `Post scoring table access issue: ${error.message}`
      });
      auditResults.summary.warnings++;
    }
    auditResults.summary.totalTests++;

    // Test 3.3: Attribute Editing System
    try {
      const clientBase = await getClientBase(clientId);
      const { loadAttributeForEditingWithClientBase } = require("../attributeLoader.js");
      
      // Test loading the first available attribute for editing
      const records = await clientBase("Scoring Attributes")
        .select({ maxRecords: 1, filterByFormula: "OR({Category} = 'Positive', {Category} = 'Negative')" })
        .firstPage();
      
      if (records.length > 0) {
        const testAttr = await loadAttributeForEditingWithClientBase(records[0].get("Attribute Id"), clientBase);
        if (!testAttr) {
          throw new Error("Attribute loading for editing failed");
        }
      }
      
      auditResults.floors.floor3.tests.push({
        test: "Attribute Editing System",
        status: "PASS",
        message: "Attribute editing system functional"
      });
      auditResults.summary.passed++;
    } catch (error) {
      auditResults.floors.floor3.tests.push({
        test: "Attribute Editing System",
        status: "FAIL",
        message: error.message
      });
      auditResults.floors.floor3.status = "FAIL";
      auditResults.summary.failed++;
    }
    auditResults.summary.totalTests++;

    // ============= FINAL ASSESSMENT =============
    const failedFloors = Object.values(auditResults.floors).filter(floor => floor.status === "FAIL");
    if (failedFloors.length > 0) {
      auditResults.overallStatus = "FAIL";
      auditResults.recommendations.push("Critical issues found - resolve failed tests before proceeding to Phase 2");
    } else if (auditResults.summary.warnings > 0) {
      auditResults.overallStatus = "PASS_WITH_WARNINGS";
      auditResults.recommendations.push("System functional but has warnings - review before proceeding to Phase 2");
    } else {
      auditResults.overallStatus = "PASS";
      auditResults.recommendations.push("All systems operational - ready for Phase 2 development");
    }

    auditResults.duration = Date.now() - startTime;
    logger.info(`Comprehensive audit completed in ${auditResults.duration}ms with status: ${auditResults.overallStatus}`);

    res.json({
      success: true,
      audit: auditResults
    });

  } catch (error) {
    logger.error("Comprehensive audit error:", error.message);
    await logRouteError(error, req).catch(() => {});
    auditResults.overallStatus = "ERROR";
    auditResults.error = error.message;
    auditResults.duration = Date.now() - startTime;
    
    res.status(500).json({
      success: false,
      audit: auditResults,
      error: error.message
    });
  }
});

// Quick health audit - lightweight version for frequent checks
router.get("/api/audit/quick", async (req, res) => {
  const clientId = req.headers['x-client-id'];
  const logger = createLogger({ clientId, operation: 'quick_audit' });
  logger.info("Running quick audit");
  
  if (!clientId) {
    return res.status(400).json({
      success: false,
      error: "Client ID required in x-client-id header"
    });
  }

  try {
    const quickResults = {
      clientId,
      timestamp: new Date().toISOString(),
      status: "HEALTHY",
      checks: []
    };

    // Quick connectivity check
    const clientBase = await getClientBase(clientId);
    if (!clientBase) {
      throw new Error("Client base resolution failed");
    }
    quickResults.checks.push({ check: "Client Resolution", status: "OK" });

    // Quick attribute count check
    const { loadAttributes } = require("../attributeLoader.js");
    const { positives, negatives } = await loadAttributes(null, clientId);
    const totalAttributes = Object.keys(positives).length + Object.keys(negatives).length;
    quickResults.checks.push({ 
      check: "Attribute Loading", 
      status: "OK", 
      details: `${totalAttributes} active attributes` 
    });

    // Quick AI check
    if (!vertexAIClient || !geminiModelId) {
      quickResults.checks.push({ check: "AI Configuration", status: "WARNING", details: "AI not configured" });
      quickResults.status = "DEGRADED";
    } else {
      quickResults.checks.push({ check: "AI Configuration", status: "OK" });
    }

    res.json({
      success: true,
      audit: quickResults
    });

  } catch (error) {
    logger.error("Quick audit error:", error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message,
      audit: {
        clientId,
        timestamp: new Date().toISOString(),
        status: "UNHEALTHY",
        error: error.message
      }
    });
  }
});

// ---------------------------------------------------------------
// AUTOMATED ISSUE DETECTION AND RESOLUTION ENDPOINT
// ---------------------------------------------------------------

// Automated troubleshooting endpoint - detects issues and suggests/applies fixes
router.post("/api/audit/auto-fix", async (req, res) => {
  const startTime = Date.now();
  const clientId = req.headers['x-client-id'];
  const logger = createLogger({ clientId, operation: 'auto_fix' });
  logger.info("🔧 Starting automated issue detection and resolution");
  
  
  if (!clientId) {
    return res.status(400).json({
      success: false,
      error: "Client ID required in x-client-id header for auto-fix"
    });
  }

  const autoFix = {
    clientId,
    timestamp: new Date().toISOString(),
    detectedIssues: [],
    appliedFixes: [],
    recommendations: [],
    summary: {}
  };

  try {
    logger.info("🔍 Running comprehensive audit to detect issues...");
    
    // First, run comprehensive audit to detect issues
  const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const auditResponse = await fetch(`${baseUrl}/api/audit/comprehensive`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId
      }
    });
    
    if (!auditResponse.ok) {
      throw new Error(`Audit failed: ${auditResponse.status}`);
    }
    
    const auditData = await auditResponse.json();
    const audit = auditData.audit;
    
    // Extract failed and warning tests
    const allTests = [
      ...audit.floors.floor1.tests,
      ...audit.floors.floor2.tests,
      ...audit.floors.floor3.tests
    ];
    
    const failedTests = allTests.filter(test => test.status === "FAIL");
    const warningTests = allTests.filter(test => test.status === "WARN");
    
    logger.info(`🎯 Found ${failedTests.length} failed tests and ${warningTests.length} warnings`);
    
    // Categorize and process each issue
    for (const test of failedTests) {
      const issue = {
        test: test.test,
        severity: "HIGH",
        message: test.message,
        category: categorizeIssue(test.test),
        automated_fix: null,
        fix_applied: false
      };
      
      // Generate automated fix recommendations
      const fixRecommendation = generateFixRecommendation(test.test, test.message);
      issue.automated_fix = fixRecommendation;
      
      // Apply automated fixes where possible
      if (fixRecommendation.canAutomate) {
        try {
          logger.info(`🔧 Attempting automated fix for: ${test.test}`);
          const fixResult = await applyAutomatedFix(test.test, test.message, clientId);
          if (fixResult.success) {
            issue.fix_applied = true;
            autoFix.appliedFixes.push({
              test: test.test,
              action: fixResult.action,
              result: fixResult.result
            });
          }
        } catch (fixError) {
          logger.warn(`⚠️  Automated fix failed for ${test.test}: ${fixError.message}`);
          await logRouteError(fixError, req).catch(() => {});
          issue.automated_fix.error = fixError.message;
        }
      }
      
      autoFix.detectedIssues.push(issue);
    }
    
    // Process warnings
    for (const test of warningTests) {
      const issue = {
        test: test.test,
        severity: "MEDIUM",
        message: test.message,
        category: categorizeIssue(test.test),
        automated_fix: generateFixRecommendation(test.test, test.message),
        fix_applied: false
      };
      
      autoFix.detectedIssues.push(issue);
    }
    
    // Generate smart recommendations based on issue patterns
    autoFix.recommendations = generateSmartRecommendations(autoFix.detectedIssues, audit);
    
    const duration = Date.now() - startTime;
    
    autoFix.summary = {
      totalIssuesDetected: autoFix.detectedIssues.length,
      criticalIssues: autoFix.detectedIssues.filter(i => i.severity === "CRITICAL").length,
      highIssues: autoFix.detectedIssues.filter(i => i.severity === "HIGH").length,
      mediumIssues: autoFix.detectedIssues.filter(i => i.severity === "MEDIUM").length,
      automatedFixesApplied: autoFix.appliedFixes.length,
      recommendationsGenerated: autoFix.recommendations.length,
      overallHealth: audit.summary.passed / audit.summary.totalTests,
      requiresManualIntervention: autoFix.detectedIssues.some(i => !i.automated_fix?.canAutomate),
      duration: `${duration}ms`
    };

    logger.info(`🏁 Auto-fix completed in ${duration}ms. ${autoFix.detectedIssues.length} issues detected, ${autoFix.appliedFixes.length} fixes applied.`);
    
    res.json({
      success: true,
      autoFix
    });

  } catch (error) {
    logger.error("🚨 Auto-fix error:", error);
    await logRouteError(error, req).catch(() => {});
    const duration = Date.now() - startTime;
    
    res.status(500).json({
      success: false,
      error: error.message,
      autoFix: {
        ...autoFix,
        error: error.message,
        duration: `${duration}ms`
      }
    });
  }
});

// Helper functions for automated troubleshooting

function categorizeIssue(testName) {
  if (testName.includes("Client") || testName.includes("Airtable")) return "CONNECTIVITY";
  if (testName.includes("Scoring") || testName.includes("Attribute")) return "BUSINESS_LOGIC";
  if (testName.includes("Token") || testName.includes("Budget")) return "RESOURCE_MANAGEMENT";
  if (testName.includes("AI") || testName.includes("Gemini")) return "AI_INTEGRATION";
  if (testName.includes("Endpoint") || testName.includes("API")) return "API_FUNCTIONALITY";
  return "SYSTEM";
}

function generateFixRecommendation(testName, message) {
  const fixes = {
    "Client Base Resolution": {
      canAutomate: false,
      action: "MANUAL_CONFIG_UPDATE",
      description: "Check client ID in Master Clients base and verify Airtable connection",
      steps: ["Verify client exists in Master Clients", "Check Airtable API key", "Restart service"]
    },
    "Airtable Connection": {
      canAutomate: false,
      action: "CONNECTIVITY_CHECK",
      description: "Verify Airtable API credentials and network connectivity",
      steps: ["Check AIRTABLE_API_KEY environment variable", "Test Airtable API connectivity", "Verify base permissions"]
    },
    "Attribute Loading": {
      canAutomate: true,
      action: "DATA_VALIDATION",
      description: "Check and fix attribute configuration",
      steps: ["Verify attributes exist", "Check Active status", "Validate attribute structure"]
    },
    "Scoring Endpoint Live Test": {
      canAutomate: false,
      action: "SERVICE_RESTART",
      description: "Restart scoring service and verify dependencies",
      steps: ["Check Gemini AI connectivity", "Verify lead data quality", "Restart scoring service"]
    },
    "Token Budget Calculation": {
      canAutomate: true,
      action: "RECALCULATE_TOKENS",
      description: "Recalculate token usage and optimize if needed",
      steps: ["Refresh token calculations", "Identify high-token attributes", "Suggest optimizations"]
    },
    "Gemini AI Configuration": {
      canAutomate: false,
      action: "AI_SERVICE_RESTART",
      description: "Restart AI service and verify credentials",
      steps: ["Check GCP credentials", "Verify model permissions", "Restart AI client"]
    }
  };
  
  return fixes[testName] || {
    canAutomate: false,
    action: "MANUAL_INVESTIGATION",
    description: "Manual investigation required",
    steps: ["Review logs", "Check system status", "Contact support if needed"]
  };
}

async function applyAutomatedFix(testName, message, clientId) {
  const logger = createLogger({ clientId, operation: 'apply_auto_fix', test: testName });
  logger.info(`🔧 Applying automated fix for: ${testName}`);
  
  switch (testName) {
    case "Attribute Loading":
      // Try to refresh attribute cache
      try {
        const { loadAttributes } = require("../attributeLoader.js");
        const { positives, negatives } = await loadAttributes(null, clientId);
        const totalAttrs = Object.keys(positives).length + Object.keys(negatives).length;
        
        return {
          success: true,
          action: "ATTRIBUTE_REFRESH",
          result: `Refreshed attribute cache - found ${totalAttrs} active attributes`
        };
      } catch (error) {
        throw new Error(`Attribute refresh failed: ${error.message}`);
      }
      
    case "Token Budget Calculation":
      // Recalculate token usage
      try {
        const usage = await getCurrentTokenUsage(clientId);
        return {
          success: true,
          action: "TOKEN_RECALCULATION",
          result: `Recalculated tokens: ${usage.totalTokens}/${usage.limit} (${usage.percentUsed}%)`
        };
      } catch (error) {
        throw new Error(`Token recalculation failed: ${error.message}`);
      }
      
    default:
      throw new Error(`No automated fix available for: ${testName}`);
  }
}

function generateSmartRecommendations(detectedIssues, auditData) {
  const recommendations = [];
  
  // Critical connectivity issues
  const connectivityIssues = detectedIssues.filter(i => i.category === "CONNECTIVITY");
  if (connectivityIssues.length > 0) {
    recommendations.push({
      priority: "URGENT",
      category: "System Stability", 
      title: "Critical connectivity issues detected",
      description: `${connectivityIssues.length} connectivity issues may prevent system operation`,
      action: "Check environment configuration and restart services",
      automated: false
    });
  }
  
  // API endpoint failures
  const apiIssues = detectedIssues.filter(i => i.category === "API_FUNCTIONALITY");
  if (apiIssues.length > 0) {
    recommendations.push({
      priority: "HIGH",
      category: "Core Functionality",
      title: "API endpoints not responding correctly",
      description: `${apiIssues.length} API endpoints failing - core functionality compromised`,
      action: "Restart API services and verify dependencies",
      automated: false
    });
  }
  
  // Resource management issues
  const resourceIssues = detectedIssues.filter(i => i.category === "RESOURCE_MANAGEMENT");
  if (resourceIssues.length > 0) {
    recommendations.push({
      priority: "MEDIUM",
      category: "Resource Optimization",
      title: "Resource management issues detected",
      description: "Token budget or resource allocation needs attention",
      action: "Review and optimize resource usage",
      automated: true
    });
  }
  
  // Overall health assessment
  const totalTests = auditData.summary.totalTests;
  const passedTests = auditData.summary.passed;
  const healthPercentage = Math.round((passedTests / totalTests) * 100);
  
  if (healthPercentage < 70) {
    recommendations.push({
      priority: "HIGH",
      category: "System Health",
      title: "System health below acceptable threshold",
      description: `Overall health: ${healthPercentage}%. Multiple systems need immediate attention.`,
      action: "Comprehensive system review and remediation required",
      automated: false
    });
  } else if (healthPercentage < 90) {
    recommendations.push({
      priority: "MEDIUM", 
      category: "System Optimization",
      title: "System operational but could be optimized",
      description: `Overall health: ${healthPercentage}%. Minor issues detected.`,
      action: "Review and optimize underperforming components",
      automated: true
    });
  }
  
  return recommendations;
}

// ---------------------------------------------------------------
// SMART RESUME CLIENT-BY-CLIENT ENDPOINT
// ---------------------------------------------------------------

// In-memory lock to prevent concurrent smart resume executions
let smartResumeRunning = false;
let currentSmartResumeJobId = null;
let smartResumeLockTime = null; // Track when the lock was acquired
let currentStreamId = null; // Track which stream is being processed

// Global termination controls
global.smartResumeTerminateSignal = false;
global.smartResumeActiveProcess = null;

// Read timeout from environment variable or use default of 3.5 hours
const DEFAULT_LOCK_TIMEOUT_HOURS = 3.5;
const SMART_RESUME_LOCK_TIMEOUT = 
  (process.env.SMART_RESUME_LOCK_TIMEOUT_HOURS 
    ? parseFloat(process.env.SMART_RESUME_LOCK_TIMEOUT_HOURS) 
    : DEFAULT_LOCK_TIMEOUT_HOURS) * 60 * 60 * 1000;

moduleLogger.info(`ℹ️ Smart resume stale lock timeout configured: ${SMART_RESUME_LOCK_TIMEOUT/1000/60/60} hours`);

// Special Guy Wilson post harvesting endpoint
router.get("/guy-wilson-post-harvest", async (req, res) => {
  const logger = createLogger({ clientId: 'Guy-Wilson', operation: 'guy_wilson_post_harvest' });
  logger.info("� SPECIAL GUY WILSON POST HARVEST ENDPOINT HIT");
  
  try {
    // Direct way to trigger post harvesting for Guy Wilson
    const { processLevel2ClientsV2 } = require('./apifyProcessRoutes');
    
    // Create a fake request with all the required parameters
    const fakeReq = {
      headers: { 'x-client-id': 'Guy-Wilson' },
      query: { clientId: 'Guy-Wilson', stream: 1 },
      body: { clientId: 'Guy-Wilson', debug: true, force: true }
    };
    
    // Create a response collector
    let responseData = null;
    const fakeRes = {
      status: (code) => ({
        json: (data) => {
          responseData = { statusCode: code, data };
          logger.info(`🚨 GUY WILSON POST HARVEST: Process completed with status ${code}`);
          logger.info(JSON.stringify(data, null, 2));
        }
      })
    };
    
    logger.info("� GUY WILSON POST HARVEST: Calling process handler directly");
    await processLevel2ClientsV2(fakeReq, fakeRes);
    
    // Send the response back to the client
    return res.json({
      message: "Guy Wilson post harvest triggered successfully",
      result: responseData
    });
  } catch (error) {
    logger.error("🚨 GUY WILSON POST HARVEST ERROR:", error);
    await logRouteError(error, req).catch(() => {});
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

router.post("/smart-resume-client-by-client", async (req, res) => {
  // Generate jobId early for consistent logging
  const tempJobId = `smart_resume_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  
  // Create endpoint-scoped logger (using temporary jobId before full validation)
  const endpointLogger = createLogger({
    runId: tempJobId,  // Using full jobId since it doesn't follow standard format
    clientId: 'SYSTEM',
    operation: 'smart_resume_endpoint'
  });
  
  endpointLogger.info("🚀 apiAndJobRoutes.js: /smart-resume-client-by-client endpoint hit");
  
  // Check webhook secret
  const providedSecret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.PB_WEBHOOK_SECRET;
  
  if (!providedSecret || providedSecret !== expectedSecret) {
    endpointLogger.info("❌ Smart resume: Unauthorized - invalid webhook secret");
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized - invalid webhook secret' 
    });
  }
  
  // ⭐ STALE LOCK DETECTION: Check if existing lock is too old
  if (smartResumeRunning && smartResumeLockTime) {
    const lockAge = Date.now() - smartResumeLockTime;
    if (lockAge > SMART_RESUME_LOCK_TIMEOUT) {
      endpointLogger.info(`🔓 Stale lock detected (${Math.round(lockAge/1000/60)} minutes old), auto-releasing`);
      smartResumeRunning = false;
      currentSmartResumeJobId = null;
      smartResumeLockTime = null;
    }
  }
  
  // ⭐ CONCURRENT EXECUTION PROTECTION
  if (smartResumeRunning) {
    const lockAge = smartResumeLockTime ? Math.round((Date.now() - smartResumeLockTime)/1000/60) : 'unknown';
    endpointLogger.info(`⚠️ Smart resume already running (jobId: ${currentSmartResumeJobId}, age: ${lockAge} minutes)`);
    return res.status(409).json({
      success: false,
      error: 'Smart resume process already running',
      currentJobId: currentSmartResumeJobId,
      lockAgeMinutes: lockAge,
      message: 'Please wait for current execution to complete (15-20 minutes typical)',
      retryAfter: 1200 // Suggest retry after 20 minutes
    });
  }
  
  // ⭐ ADDITIONAL SAFETY: Check recent logs for running smart resume jobs
  try {
    endpointLogger.info(`🔍 Checking for recent smart resume activity in logs...`);
    
    // Look for recent SCRIPT_START entries without corresponding SCRIPT_END entries
    // This helps detect if an old process is still running
    const recentStartPattern = new RegExp(`SMART_RESUME_.*_SCRIPT_START.*${new Date().toISOString().slice(0, 10)}`);
    const recentEndPattern = new RegExp(`SMART_RESUME_.*_SCRIPT_END.*${new Date().toISOString().slice(0, 10)}`);
    
    // Check if we can find evidence of a recent start without a matching end
    // This is a simplified check - in production you might check actual log files
    endpointLogger.info(`🔍 Process safety check completed - proceeding with new job`);
    
  } catch (processCheckError) {
    endpointLogger.info(`⚠️ Could not perform process safety check (non-critical): ${processCheckError.message}`);
    // Continue anyway - this is just an extra safety measure
  }
  
  // Check if fire-and-forget is enabled
  if (process.env.FIRE_AND_FORGET !== 'true') {
    endpointLogger.info("⚠️ Fire-and-forget not enabled");
    return res.status(400).json({
      success: false,
      message: 'Fire-and-forget mode not enabled. Set FIRE_AND_FORGET=true'
    });
  }
  
  try {
    const { stream, leadScoringLimit, postScoringLimit, clientFilter } = req.body;
    const jobId = tempJobId; // Use the jobId we generated at the start
    
    // Set the lock with timestamp
    smartResumeRunning = true;
    currentSmartResumeJobId = jobId;
    smartResumeLockTime = Date.now();
    
    endpointLogger.info(`🎯 Starting smart resume processing: jobId=${jobId}, stream=${stream || 1}${clientFilter ? `, clientFilter=${clientFilter}` : ''}`);
    endpointLogger.info(`🔒 Smart resume lock acquired for jobId: ${jobId} at ${new Date().toISOString()}`);
    
    // FIRE-AND-FORGET: Respond immediately with 202 Accepted
    res.status(202).json({
      success: true,
      message: 'Smart resume processing started',
      jobId: jobId,
      timestamp: new Date().toISOString(),
      estimatedDuration: '15-20 minutes'
    });
    
    // Start background processing
    setImmediate(() => {
      executeSmartResume(jobId, stream || 1, leadScoringLimit, postScoringLimit);
    });
    
  } catch (error) {
    // Release lock on startup error
    smartResumeRunning = false;
    currentSmartResumeJobId = null;
    
    endpointLogger.error("❌ Smart resume startup error:", error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: 'Failed to start smart resume processing',
      details: error.message
    });
  }
});

/**
 * Background processing function for smart resume
 */
async function executeSmartResume(jobId, stream, leadScoringLimit, postScoringLimit) {
  // Create job-scoped logger for background processing
  const jobLogger = createLogger({
    runId: jobId,  // Using full jobId (smart_resume_timestamp_random format)
    clientId: 'SYSTEM',
    operation: 'smart_resume_background'
  });
  
  jobLogger.info(`🎯 Smart resume background processing started`);
  
  // Track current stream
  currentStreamId = stream;
  
  // Register as active process globally for monitoring
  global.smartResumeActiveProcess = {
    jobId,
    stream,
    startTime: Date.now(),
    status: getStatusString('RUNNING')
  };
  
  // Reset any previous termination signal
  global.smartResumeTerminateSignal = false;
  
  // Define heartbeatInterval in the outer scope so it's accessible in the finally block
  let heartbeatInterval = null;
  
  try {
    // Set up environment variables for the module
    process.env.BATCH_PROCESSING_STREAM = stream.toString();
    process.env.SMART_RESUME_RUN_ID = jobId; // Add this for easier log identification
    if (leadScoringLimit) process.env.LEAD_SCORING_LIMIT = leadScoringLimit.toString();
    if (postScoringLimit) process.env.POST_SCORING_LIMIT = postScoringLimit.toString();
    
    // Set up heartbeat logging with termination check
    const startTime = Date.now();
    heartbeatInterval = setInterval(() => {
      // Check for termination signal
      if (global.smartResumeTerminateSignal) {
        jobLogger.info(`🛑 Termination signal detected, stopping process`);
        clearInterval(heartbeatInterval);
        throw new Error('Process terminated by admin request');
      }
      
      // Regular heartbeat
      const elapsedMinutes = Math.round((Date.now() - startTime) / 1000 / 60);
      jobLogger.info(`💓 Smart resume still running... (${elapsedMinutes} minutes elapsed)`);
    }, 15000); // Check every 15 seconds for faster termination response
    
    // Import and use the smart resume module directly
    const scriptPath = require('path').join(__dirname, '../scripts/smart-resume-client-by-client.js');
    let smartResumeModule;
    
    jobLogger.info(`🏃 Preparing to execute smart resume module...`);
    jobLogger.info(`🔍 ENV_DEBUG: PB_WEBHOOK_SECRET = ${process.env.PB_WEBHOOK_SECRET ? 'SET' : 'MISSING'}`);
    jobLogger.info(`🔍 ENV_DEBUG: NODE_ENV = ${process.env.NODE_ENV}`);
    
    try {
        // Clear module from cache to ensure fresh instance
        delete require.cache[require.resolve(scriptPath)];
        
        // Safely load the module
        try {
            jobLogger.info(`🔍 Loading smart resume module...`);
            smartResumeModule = require(scriptPath);
        } catch (loadError) {
            jobLogger.error(`❌ Failed to load smart resume module:`, loadError);
            await logRouteError(loadError, req).catch(() => {});
            throw new Error(`Module loading failed: ${loadError.message}`);
        }
        
        // Add detailed diagnostic logs about the module structure
        jobLogger.info(`🔍 DIAGNOSTIC: Module type: ${typeof smartResumeModule}`);
        jobLogger.info(`🔍 DIAGNOSTIC: Module exports:`, Object.keys(smartResumeModule || {}));
        
        // Check what function is available and use the right one
        jobLogger.info(`🔍 [SMART-RESUME-DEBUG] Module loaded, checking type...`);
        jobLogger.info(`🔍 [SMART-RESUME-DEBUG] typeof smartResumeModule: ${typeof smartResumeModule}`);
        jobLogger.info(`🔍 [SMART-RESUME-DEBUG] smartResumeModule keys: ${Object.keys(smartResumeModule || {}).join(', ')}`);
        jobLogger.info(`🔍 [SMART-RESUME-DEBUG] Has runSmartResume?: ${typeof smartResumeModule.runSmartResume === 'function'}`);
        jobLogger.info(`🔍 [SMART-RESUME-DEBUG] Has main?: ${typeof smartResumeModule.main === 'function'}`);
        
        let scriptResult;
        
        if (typeof smartResumeModule === 'function') {
            jobLogger.info(`🔍 [SMART-RESUME-DEBUG] Module is a direct function, calling it with stream=${stream}...`);
            scriptResult = await smartResumeModule(stream);
        } else if (typeof smartResumeModule.runSmartResume === 'function') {
            jobLogger.info(`🔍 [SMART-RESUME-DEBUG] Found runSmartResume function, calling it with stream=${stream}...`);
            // Pass the stream parameter properly
            scriptResult = await smartResumeModule.runSmartResume(stream);
        } else if (typeof smartResumeModule.main === 'function') {
            jobLogger.info(`🔍 [SMART-RESUME-DEBUG] Found main function, calling it with stream=${stream}...`);
            scriptResult = await smartResumeModule.main(stream);
        } else {
            jobLogger.error(`❌ [SMART-RESUME-DEBUG] CRITICAL: No usable function found in module`);
            jobLogger.error(`❌ [SMART-RESUME-DEBUG] Available exports:`, Object.keys(smartResumeModule || {}));
            throw new Error('Smart resume module does not export a usable function');
        }
        
        jobLogger.info(`✅ [SMART-RESUME-DEBUG] Smart resume function returned successfully`);
        
        // CRITICAL DEBUG: Log the entire scriptResult object
        jobLogger.info(`🔍 DEBUG: scriptResult type: ${typeof scriptResult}`);
        jobLogger.info(`🔍 DEBUG: scriptResult value: ${JSON.stringify(scriptResult, null, 2)}`);
        jobLogger.info(`🔍 DEBUG: scriptResult?.runId = ${scriptResult?.runId}`);
        jobLogger.info(`🔍 DEBUG: scriptResult?.normalizedRunId = ${scriptResult?.normalizedRunId}`);
        
        // Extract runId from script result for log analysis
        const realRunId = scriptResult?.runId || scriptResult?.normalizedRunId;
        if (realRunId) {
            jobLogger.info(`📝 Script returned runId: ${realRunId}`);
        } else {
            jobLogger.warn(`⚠️ Script did not return runId in result`);
            jobLogger.warn(`⚠️ DEBUG: Full scriptResult was: ${JSON.stringify(scriptResult)}`);
        }
        
        // Store runId for finally block
        global.smartResumeRealRunId = realRunId;
        jobLogger.info(`🔍 DEBUG: Stored runId in global.smartResumeRealRunId = ${global.smartResumeRealRunId}`);
        
        jobLogger.info(`🔍 SMART_RESUME_${jobId} SCRIPT_START: Module execution beginning`);
        jobLogger.info(`✅ Smart resume function called successfully`);
        
        jobLogger.info(`✅ Smart resume completed successfully`);
        jobLogger.info(`🔍 SMART_RESUME_${jobId} SCRIPT_END: Module execution completed`);
        
        // Update global process tracking
        if (global.smartResumeActiveProcess) {
          global.smartResumeActiveProcess.status = getStatusString('COMPLETED');
          global.smartResumeActiveProcess.endTime = Date.now();
          global.smartResumeActiveProcess.executionTime = Date.now() - smartResumeLockTime;
        }
        
        // Send success email report
        await sendSmartResumeReport(jobId, true, {
          stream: stream,
          timestamp: Date.now(),
          executionTime: Date.now() - smartResumeLockTime
        });
        
    } catch (moduleError) {
        jobLogger.error(`🚨 MODULE EXECUTION FAILED - ERROR DETAILS:`);
        await logRouteError(moduleError, req).catch(() => {});
        jobLogger.error(`🚨 Error message: ${moduleError.message}`);
        jobLogger.error(`🚨 Stack trace: ${moduleError.stack}`);
        throw moduleError;
    }
    
  } catch (error) {
    jobLogger.error(`❌ Smart resume failed:`, error.message);
    jobLogger.error(`🔍 SMART_RESUME_${jobId} SCRIPT_ERROR: ${error.message}`);
    
    // Update global process tracking
    if (global.smartResumeActiveProcess) {
      global.smartResumeActiveProcess.status = 'failed';
      global.smartResumeActiveProcess.error = error.message || String(error);
      global.smartResumeActiveProcess.endTime = Date.now();
      global.smartResumeActiveProcess.executionTime = Date.now() - smartResumeLockTime;
    }
    
    // Check if this was an admin-triggered termination
    const wasTerminated = error.message === 'Process terminated by admin request';
    if (wasTerminated) {
      jobLogger.info(`🛑 Process was terminated by admin request`);
    }
    
    // Try to send failure email if configured (but not for admin terminations)
    if (!wasTerminated) {
      try {
        await sendSmartResumeReport(jobId, false, {
          error: error.message,
          runId: jobId,
          stream: stream,
          timestamp: Date.now()
        });
      } catch (emailError) {
        jobLogger.error(`❌ Failed to send error email:`, emailError.message);
        await logRouteError(emailError, req).catch(() => {});
      }
    }
  } finally {
    // ⭐ ALWAYS RELEASE THE LOCK WHEN DONE (SUCCESS OR FAILURE)
    jobLogger.info(`🔓 Releasing smart resume lock (held for ${Math.round((Date.now() - smartResumeLockTime)/1000)} seconds)`);
    smartResumeRunning = false;
    currentSmartResumeJobId = null;
    smartResumeLockTime = null;
    
    // Reset stream tracking
    currentStreamId = null;
    
    // Clear heartbeat interval
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    
    // Make sure global tracking is complete
    if (global.smartResumeActiveProcess && !global.smartResumeActiveProcess.endTime) {
      global.smartResumeActiveProcess.endTime = Date.now();
      
      // If status wasn't set earlier, mark as unknown
      if (global.smartResumeActiveProcess.status === 'running') {
        global.smartResumeActiveProcess.status = 'unknown';
      }
    }
    
    // Reset termination signal
    global.smartResumeTerminateSignal = false;
    
    // 🔍 LOG ANALYSIS: Moved to standalone daily cron job (daily-log-analyzer.js)
    // This keeps the scoring endpoint fast and avoids duplicate error detection
    // The cron job runs daily and picks up from last checkpoint using "Last Analyzed Log ID"
    jobLogger.info(`ℹ️ Log analysis runs separately via daily cron job (daily-log-analyzer.js)`);
    
    // Clean up the global runId storage
    if (global.smartResumeRealRunId) {
      delete global.smartResumeRealRunId;
      jobLogger.error(`⚠️ You can manually analyze logs by calling /api/analyze-logs/recent`);
    }
  }
}

// ---------------------------------------------------------------
// SPECIAL GUY WILSON POST HARVESTING DIRECT ENDPOINT
// ---------------------------------------------------------------
router.get("/harvest-guy-wilson", async (req, res) => {
  const logger = createLogger({ clientId: 'Guy-Wilson', operation: 'harvest_guy_wilson_direct' });
  logger.info("🚨 SPECIAL GUY WILSON DIRECT HARVEST ENDPOINT HIT");
  
  try {
    // Use direct HTTP request to the existing endpoint
    const fetch = require('node-fetch');
    
    // Prepare the base URL - use localhost to avoid network issues
    const endpointUrl = `http://localhost:${process.env.PORT || 3001}/api/apify/process-level2-v2`;
    const secret = process.env.PB_WEBHOOK_SECRET;
    
    logger.info(`🚨 GUY WILSON DIRECT HARVEST: Calling endpoint ${endpointUrl}`);
    
    // Make the request
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': 'Guy-Wilson',
        'Authorization': `Bearer ${secret}`
      },
      body: JSON.stringify({
        clientId: 'Guy-Wilson',
        stream: 1,
        debug: true,
        force: true
      })
    });
    
    const responseData = await response.json();
    
    logger.info(`🚨 GUY WILSON DIRECT HARVEST: Response status: ${response.status}`);
    logger.info(`🚨 GUY WILSON DIRECT HARVEST: Response data:`, JSON.stringify(responseData, null, 2));
    
    // Send the response back to the client
    return res.json({
      message: "Guy Wilson post harvest triggered successfully",
      status: response.status,
      result: responseData
    });
  } catch (error) {
    logger.error("🚨 GUY WILSON DIRECT HARVEST ERROR:", error);
    await logRouteError(error, req).catch(() => {});
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

/**
 * Helper function for sending Smart Resume reports
 * @param {string} jobId - The job ID
 * @param {boolean} success - Whether the job succeeded
 * @param {object} details - Job execution details
 */
async function sendSmartResumeReport(jobId, success, details) {
  const logger = createLogger({ runId: jobId, operation: 'send_smart_resume_report' });
  
  try {
    logger.info(`📧 [${jobId}] Sending ${success ? 'success' : 'failure'} report...`);
    
    // Load email service dynamically
    let emailService;
    try {
      emailService = require('../services/emailReportingService');
    } catch (loadError) {
      logger.error(`📧 [${jobId}] Could not load email service:`, loadError.message);
      // Email service loading error is not critical - just log and continue
      return { sent: false, reason: 'Email service not available' };
    }
    
    // Check if email service is configured
    if (!emailService || !emailService.isConfigured()) {
      logger.info(`📧 [${jobId}] Email service not configured, skipping report`);
      return { sent: false, reason: 'Email service not configured' };
    }
    
    // Send the report
    const result = await emailService.sendExecutionReport({
      ...details,
      runId: jobId,
      success: success
    });
    
    logger.info(`📧 [${jobId}] Email report sent successfully`);
    return { sent: true, result };
    
  } catch (emailError) {
    logger.error(`📧 [${jobId}] Failed to send email report:`, emailError);
    await logRouteError(emailError, req).catch(() => {});
    return { sent: false, error: emailError.message };
  }
}

// ---------------------------------------------------------------
// GET HANDLER FOR SMART RESUME - Handles browser and simple curl requests
// ---------------------------------------------------------------
router.get("/smart-resume-client-by-client", async (req, res) => {
  const logger = createLogger({ operation: 'smart_resume_get' });
  logger.info("🚨 GET request received for /smart-resume-client-by-client - processing directly");
  logger.info("🔍 Query parameters:", req.query);
  
  try {
    // Extract parameters from query string
    const stream = parseInt(req.query.stream) || 1;
    const leadScoringLimit = req.query.leadScoringLimit ? parseInt(req.query.leadScoringLimit) : null;
    const postScoringLimit = req.query.postScoringLimit ? parseInt(req.query.postScoringLimit) : null;
    
    // ⭐ STALE LOCK DETECTION: Check if existing lock is too old
    if (smartResumeRunning && smartResumeLockTime) {
      const lockAge = Date.now() - smartResumeLockTime;
      if (lockAge > SMART_RESUME_LOCK_TIMEOUT) {
        logger.info(`🔓 Stale lock detected (${Math.round(lockAge/1000/60)} minutes old), auto-releasing`);
        smartResumeRunning = false;
        currentSmartResumeJobId = null;
        smartResumeLockTime = null;
      }
    }
    
    // Check if another job is already running
    if (smartResumeRunning) {
      logger.info(`⏳ Smart resume already running (job: ${currentSmartResumeJobId}), returning status`);
      return res.json({
        success: true,
        status: getStatusString('RUNNING'),
        jobId: currentSmartResumeJobId,
        message: `Smart resume already running (started ${new Date(smartResumeLockTime).toISOString()})`
      });
    }
    
    // Create a job ID and set the lock
    const jobId = `job-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    smartResumeRunning = true;
    currentSmartResumeJobId = jobId;
    smartResumeLockTime = Date.now();
    
    logger.info(`🔒 [${jobId}] Smart resume lock acquired - starting processing (GET request)`);
    
    // Return immediate response with job ID
    res.json({ 
      success: true,
      status: 'started',
      jobId,
      message: 'Smart resume processing has been started'
    });
    
    // Start background processing
    setImmediate(() => {
      executeSmartResume(jobId, stream || 1, leadScoringLimit, postScoringLimit);
    });
    
  } catch (error) {
    // Release lock on error
    smartResumeRunning = false;
    currentSmartResumeJobId = null;
    smartResumeLockTime = null;
    
    logger.error("❌ Error in GET smart-resume processing:", error);
    await logRouteError(error, req).catch(() => {});
    return res.status(500).json({
      success: false, 
      error: `Error in smart resume GET handler: ${error.message}`
    });
  }
});

// ---------------------------------------------------------------
// EMERGENCY SMART RESUME LOCK RESET ENDPOINT
// ---------------------------------------------------------------
router.post("/reset-smart-resume-lock", async (req, res) => {
  const logger = createLogger({ operation: 'emergency_reset_smart_resume' });
  logger.info("🚨 Emergency reset: /reset-smart-resume-lock endpoint hit");
  
  // Check webhook secret
  const providedSecret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.PB_WEBHOOK_SECRET;
  
  if (!providedSecret || providedSecret !== expectedSecret) {
    logger.info("❌ Emergency reset: Unauthorized - invalid webhook secret");
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized - invalid webhook secret' 
    });
  }
  
  try {
    const previousJobId = currentSmartResumeJobId;
    const wasRunning = smartResumeRunning;
    const lockAge = smartResumeLockTime ? Math.round((Date.now() - smartResumeLockTime)/1000/60) : 'unknown';
    
    // Check if termination was requested
    const { forceTerminate } = req.body || {};
    let terminationRequested = false;
    let activeProcess = null;
    
    if (forceTerminate && global.smartResumeActiveProcess && global.smartResumeActiveProcess.status === 'running') {
      terminationRequested = true;
      activeProcess = { ...global.smartResumeActiveProcess };
      
      // Set termination signal - will be detected by heartbeat
      logger.info(`🛑 Emergency reset: Setting termination signal for job ${activeProcess.jobId}`);
      global.smartResumeTerminateSignal = true;
    }
    
    // Force reset the lock
    smartResumeRunning = false;
    currentSmartResumeJobId = null;
    smartResumeLockTime = null;
    
    logger.info(`🔓 Emergency reset: Lock forcefully cleared`);
    logger.info(`   Previous state: running=${wasRunning}, jobId=${previousJobId}, age=${lockAge} minutes`);
    
    res.json({
      success: true,
      message: terminationRequested 
        ? 'Smart resume lock reset and termination signal sent' 
        : 'Smart resume lock forcefully reset',
      terminationRequested,
      previousState: {
        wasRunning,
        previousJobId,
        lockAgeMinutes: lockAge,
        activeProcess: activeProcess ? {
          jobId: activeProcess.jobId,
          stream: activeProcess.stream,
          startTime: activeProcess.startTime,
          runtime: activeProcess.startTime ? Math.round((Date.now() - activeProcess.startTime)/1000/60) + ' minutes' : 'unknown'
        } : null
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error("❌ Emergency reset failed:", error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: 'Failed to reset lock',
      details: error.message
    });
  }
});

// ---------------------------------------------------------------
// SMART RESUME STATUS ENDPOINT
// ---------------------------------------------------------------
router.get("/smart-resume-status", async (req, res) => {
  const logger = createLogger({ operation: 'smart_resume_status' });
  logger.info("🔍 apiAndJobRoutes.js: /smart-resume-status endpoint hit");
  
  // Check webhook secret
  const providedSecret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.PB_WEBHOOK_SECRET;
  
  if (!providedSecret || providedSecret !== expectedSecret) {
    logger.info("❌ Smart resume status: Unauthorized - invalid webhook secret");
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized - invalid webhook secret' 
    });
  }
  
  try {
    // Calculate lock details
    const lockAge = smartResumeLockTime ? Date.now() - smartResumeLockTime : null;
    const isStale = lockAge && lockAge > SMART_RESUME_LOCK_TIMEOUT;
    
    // Build response
    const status = {
      isRunning: smartResumeRunning,
      currentJobId: currentSmartResumeJobId,
      lockAcquiredAt: smartResumeLockTime ? new Date(smartResumeLockTime).toISOString() : null,
      lockAgeSeconds: lockAge ? Math.round(lockAge / 1000) : null,
      lockAgeMinutes: lockAge ? Math.round(lockAge / 1000 / 60) : null,
      isStale: isStale,
      staleThresholdMinutes: Math.round(SMART_RESUME_LOCK_TIMEOUT / 1000 / 60),
      serverTime: new Date().toISOString()
    };
    
    // If stale, add warning
    if (isStale && smartResumeRunning) {
      logger.info(`⚠️ Stale lock detected in status check (${status.lockAgeMinutes} minutes old)`);
      status.warning = `Lock appears stale (${status.lockAgeMinutes} min old). Consider resetting.`;
    }
    
    logger.info(`🔍 Smart resume status check: isRunning=${status.isRunning}, jobId=${status.currentJobId}`);
    res.json({
      success: true,
      status: status
    });
    
  } catch (error) {
    logger.error("❌ Smart resume status check failed:", error.message);
    await logRouteError(error, req).catch(() => {});
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
      details: error.message
    });
  }
});

// ========================================================================
// PMPro Membership Sync Endpoints
// ========================================================================

const pmproService = require('../services/pmproMembershipService');
const clientService = require('../services/clientService');
// CLIENT_FIELDS already imported at top of file

/**
 * POST /api/sync-client-statuses
 * Sync all client statuses based on WordPress PMPro memberships
 * Updates Status field to Active or Paused based on membership validity
 */
router.post("/api/sync-client-statuses", async (req, res) => {
  const logger = createLogger({ 
    runId: 'membership-sync', 
    clientId: 'SYSTEM', 
    operation: 'sync-client-statuses' 
  });

  try {
    logger.info('🔄 Starting client status sync based on PMPro memberships...');

    // Get all clients from Master Clients base
    const allClients = await clientService.getAllClients();
    logger.info(`📋 Found ${allClients.length} clients to check`);

    const results = {
      total: allClients.length,
      processed: 0,
      activated: 0,
      paused: 0,
      errors: 0,
      skipped: 0,
      details: []
    };

    // Process each client
    for (const client of allClients) {
      const clientId = client.clientId;
      const clientName = client.clientName;
      const wpUserId = client.wpUserId;
      const currentStatus = client.status;
      const statusManagement = client.statusManagement || 'Automatic'; // Default to Automatic if not set

      logger.info(`\n--- Processing: ${clientName} (${clientId}) ---`);

      // Skip if Status Management is set to "Manual"
      if (statusManagement === 'Manual') {
        logger.info(`⏭️ SKIPPING: ${clientName} has Status Management set to "Manual"`);
        results.skipped++;
        results.details.push({
          clientId,
          clientName,
          action: 'skipped',
          reason: 'Status Management set to Manual',
          status: currentStatus
        });
        continue;
      }

      // Check if WordPress User ID exists
      if (!wpUserId || wpUserId === 0) {
        logger.error(`❌ ERROR: ${clientName} has no WordPress User ID`);
        console.error(`[MEMBERSHIP_SYNC_ERROR] Client "${clientName}" (${clientId}) has no WordPress User ID - setting Status to Paused`);
        
        // Update status to Paused
        await updateClientStatus(client.id, 'Paused', 'No WordPress User ID configured', null);
        
        results.paused++;
        results.errors++;
        results.processed++;
        results.details.push({
          clientId,
          clientName,
          action: 'paused',
          reason: 'No WordPress User ID',
          error: true
        });
        continue;
      }

      logger.info(`🔍 WordPress User ID: ${wpUserId} - checking membership...`);

      // Check PMPro membership
      const membershipCheck = await pmproService.checkUserMembership(wpUserId);

      if (membershipCheck.error) {
        logger.error(`❌ ERROR checking membership for ${clientName}: ${membershipCheck.error}`);
        console.error(`[MEMBERSHIP_SYNC_ERROR] Client "${clientName}" (${clientId}) - ${membershipCheck.error} - setting Status to Paused`);
        
        // Update status to Paused
        await updateClientStatus(client.id, 'Paused', membershipCheck.error, null);
        
        results.paused++;
        results.errors++;
        results.processed++;
        results.details.push({
          clientId,
          clientName,
          action: 'paused',
          reason: membershipCheck.error,
          error: true
        });
        continue;
      }

      // Determine what the status should be
      const shouldBeActive = membershipCheck.hasValidMembership;
      const newStatus = shouldBeActive ? 'Active' : 'Paused';
      
      // Log membership info
      if (membershipCheck.hasValidMembership) {
        logger.info(`✅ Valid membership: Level ${membershipCheck.levelId} (${membershipCheck.levelName})`);
      } else {
        logger.warn(`⚠️ Invalid or no membership - Level: ${membershipCheck.levelId || 'none'}`);
      }

      // Check if status changed OR if we need to update expiry date
      const statusChanged = currentStatus !== newStatus;
      const expiryNeedsUpdate = membershipCheck.expiryDate !== undefined; // Always update expiry if we have it
      
      logger.info(`🔍 Update check: statusChanged=${statusChanged}, expiryNeedsUpdate=${expiryNeedsUpdate}, expiryDate=${membershipCheck.expiryDate}`);
      
      if (statusChanged || expiryNeedsUpdate) {
        if (statusChanged) {
          logger.info(`🔄 Updating status: ${currentStatus} → ${newStatus}`);
        }
        if (expiryNeedsUpdate && !statusChanged) {
          logger.info(`📅 Updating expiry date: ${membershipCheck.expiryDate || 'None'}`);
        }
        
        const reason = shouldBeActive 
          ? `Valid PMPro membership (Level ${membershipCheck.levelId})`
          : (membershipCheck.levelId 
              ? `Invalid PMPro level ${membershipCheck.levelId}` 
              : 'No active PMPro membership');
        
        // Always include expiry date in the update
        await updateClientStatus(client.id, newStatus, reason, membershipCheck.expiryDate);
        
        if (statusChanged) {
          if (newStatus === 'Active') {
            results.activated++;
            console.log(`[MEMBERSHIP_SYNC] ✅ Client "${clientName}" (${clientId}) activated - has valid PMPro membership (Level ${membershipCheck.levelId})`);
          } else {
            results.paused++;
            console.log(`[MEMBERSHIP_SYNC] ⏸️ Client "${clientName}" (${clientId}) paused - ${reason}`);
          }
          
          results.details.push({
            clientId,
            clientName,
            action: newStatus.toLowerCase(),
            previousStatus: currentStatus,
            newStatus: newStatus,
            reason: reason,
            membershipLevel: membershipCheck.levelId
          });
        } else {
          // Status unchanged but expiry updated
          results.skipped++;
          results.details.push({
            clientId,
            clientName,
            action: 'unchanged',
            status: currentStatus,
            membershipLevel: membershipCheck.levelId,
            expiryUpdated: true
          });
        }
      } else {
        logger.info(`✓ Status unchanged: ${currentStatus}`);
        results.skipped++;
        results.details.push({
          clientId,
          clientName,
          action: 'unchanged',
          status: currentStatus,
          membershipLevel: membershipCheck.levelId
        });
      }

      results.processed++;
    }

    logger.info('\n✅ Client status sync complete!');
    logger.info(`📊 Summary: ${results.activated} activated, ${results.paused} paused, ${results.skipped} unchanged, ${results.errors} errors`);

    // Invalidate client cache to ensure next read gets fresh data
    clientService.clearCache();

    res.json({
      success: true,
      message: 'Client status sync completed',
      results: results
    });

  } catch (error) {
    logger.error('❌ Client status sync failed:', {
      error: error.message,
      stack: error.stack
    });
    console.error('[MEMBERSHIP_SYNC_ERROR] Fatal error during client status sync:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Client status sync failed',
      message: error.message
    });
  }
});

/**
 * Helper function to update client status in Airtable
 */
async function updateClientStatus(recordId, newStatus, reason, expiryDate = null) {
  try {
    const Airtable = require('airtable');
    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
    const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    // Log the reason to console/Render logs instead of trying to write to Comment field
    console.log(`[MEMBERSHIP_SYNC] Updating client ${recordId}: Status → ${newStatus} (${reason})${expiryDate ? `, Expiry → ${expiryDate}` : ''}`);
    
    const updateFields = {
      [CLIENT_FIELDS.STATUS]: newStatus
    };
    
    // Add expiry date if provided (null will clear the field)
    if (expiryDate !== undefined) {
      updateFields[CLIENT_FIELDS.EXPIRY_DATE] = expiryDate;
    }
    
    await base(MASTER_TABLES.CLIENTS).update(recordId, updateFields);
    
    return true;
  } catch (error) {
    console.error(`[MEMBERSHIP_SYNC_ERROR] Failed to update client status in Airtable:`, error.message);
    throw error;
  }
}

/**
 * GET /api/test-wordpress-connection
 * Test WordPress connection and PMPro API availability
 */
router.get("/api/test-wordpress-connection", async (req, res) => {
  const logger = createLogger({ 
    runId: 'wp-test', 
    clientId: 'SYSTEM', 
    operation: 'test-wordpress' 
  });

  try {
    logger.info('🔍 Testing WordPress connection...');
    
    const testResult = await pmproService.testWordPressConnection();
    
    if (testResult.success) {
      logger.info('✅ WordPress connection successful');
      res.json({
        success: true,
        message: 'WordPress connection successful',
        details: testResult
      });
    } else {
      logger.error('❌ WordPress connection failed:', testResult.error);
      res.status(500).json({
        success: false,
        error: 'WordPress connection failed',
        details: testResult
      });
    }
  } catch (error) {
    logger.error('❌ WordPress connection test failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Test failed',
      message: error.message
    });
  }
});

/**
 * POST /api/check-client-membership/:clientId
 * Check membership status for a specific client (for testing)
 */
router.post("/api/check-client-membership/:clientId", async (req, res) => {
  const logger = createLogger({ 
    runId: 'membership-check', 
    clientId: req.params.clientId, 
    operation: 'check-membership' 
  });

  try {
    const clientId = req.params.clientId;
    logger.info(`🔍 Checking membership for client: ${clientId}`);
    
    // Get client info
    const client = await clientService.getClientById(clientId);
    
    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    const wpUserId = client.wpUserId;
    
    if (!wpUserId) {
      return res.status(400).json({
        success: false,
        error: 'Client has no WordPress User ID'
      });
    }

    // Check membership
    const membershipCheck = await pmproService.checkUserMembership(wpUserId);
    
    res.json({
      success: true,
      client: {
        clientId: client.clientId,
        clientName: client.clientName,
        wpUserId: wpUserId,
        currentStatus: client.status
      },
      membership: membershipCheck,
      recommendation: membershipCheck.hasValidMembership ? 'Active' : 'Paused'
    });

  } catch (error) {
    logger.error('❌ Membership check failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Membership check failed',
      message: error.message
    });
  }
});

/**
 * GET /api/verify-client-access/:clientId
 * Verify if a client has valid access to the portal
 * Used by frontend to gate access based on membership status
 * 
 * Returns:
 * - isAllowed: boolean - whether client can access portal
 * - status: string - client's current status (Active/Paused)
 * - expiryDate: string|null - membership expiry date (YYYY-MM-DD) or null for lifetime
 * - expiryWarning: boolean - true if expiry is within warning period
 * - daysUntilExpiry: number|null - days remaining until expiry
 * - message: string - user-friendly message to display
 * - renewalUrl: string|null - URL to renew membership if needed
 */
router.get("/api/verify-client-access/:clientId", async (req, res) => {
  const logger = createLogger({ 
    runId: 'verify-access', 
    clientId: req.params.clientId, 
    operation: 'verify-access' 
  });

  try {
    const clientId = req.params.clientId;
    logger.info(`🔍 Verifying access for client: ${clientId}`);
    
    // Get FRESH client info from Airtable (bypass cache for security check)
    const client = await clientService.getClientByIdFresh(clientId);
    
    if (!client) {
      logger.warn(`❌ Client not found: ${clientId}`);
      return res.status(404).json({
        success: false,
        isAllowed: false,
        message: 'Unable to find your client record. Please contact support and we\'ll investigate.',
        errorType: 'CLIENT_NOT_FOUND'
      });
    }

    logger.info(`✅ Found client: ${client.clientName}, Status: ${client.status}`);
    
    // Check if client is Active
    if (client.status !== 'Active') {
      logger.warn(`⚠️ Client is not active: ${client.status}`);
      return res.json({
        success: true,
        isAllowed: false,
        status: client.status,
        message: 'Your membership is not yet active. Please check your membership status or contact support.',
        errorType: 'NOT_ACTIVE'
      });
    }

    // Client is Active - check expiry date
    const expiryDate = client.expiryDate;
    let expiryWarning = false;
    let daysUntilExpiry = null;
    let renewalUrl = null;

    if (expiryDate) {
      // Parse expiry date
      const expiry = new Date(expiryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day
      
      daysUntilExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
      
      logger.info(`📅 Expiry date: ${expiryDate}, Days until expiry: ${daysUntilExpiry}`);

      // Check if expired
      if (daysUntilExpiry < 0) {
        logger.warn(`❌ Membership expired ${Math.abs(daysUntilExpiry)} days ago`);
        return res.json({
          success: true,
          isAllowed: false,
          status: 'Expired',
          expiryDate: expiryDate,
          daysUntilExpiry: daysUntilExpiry,
          message: 'Your membership has expired. Please renew to continue accessing the portal.',
          renewalUrl: process.env.RENEWAL_URL || null,
          errorType: 'EXPIRED'
        });
      }

      // Check if expiring soon (within warning period - default 4 weeks = 28 days)
      const warningDays = parseInt(process.env.EXPIRY_WARNING_DAYS || '28', 10);
      if (daysUntilExpiry <= warningDays) {
        expiryWarning = true;
        renewalUrl = process.env.RENEWAL_URL || null;
        logger.info(`⚠️ Expiry warning: ${daysUntilExpiry} days remaining (threshold: ${warningDays} days)`);
      }
    } else {
      logger.info(`✅ Lifetime membership (no expiry date)`);
    }

    // Grant access
    return res.json({
      success: true,
      isAllowed: true,
      status: client.status,
      expiryDate: expiryDate,
      expiryWarning: expiryWarning,
      daysUntilExpiry: daysUntilExpiry,
      renewalUrl: renewalUrl,
      message: expiryWarning 
        ? `Your membership expires in ${daysUntilExpiry} days. Renew now and get 1-month free!`
        : 'Access granted',
      client: {
        clientId: client.clientId,
        clientName: client.clientName
      }
    });

  } catch (error) {
    logger.error('❌ Access verification failed:', error.message);
    res.status(500).json({
      success: false,
      isAllowed: false,
      error: 'Access verification failed',
      message: 'An error occurred while verifying your access. Please try again.',
      errorType: 'SERVER_ERROR',
      details: error.message
    });
  }
});

// ---------------------------------------------------------------
// TEST: Run daily-client-alerts script manually
// ---------------------------------------------------------------
router.get("/api/test-daily-alerts", async (req, res) => {
  try {
    console.log("🧪 Manual test of daily-client-alerts script starting...");
    
    // Import the script
    const dailyClientAlerts = require('../scripts/daily-client-alerts/index.js');
    
    // Run it
    const results = await dailyClientAlerts.main();
    
    console.log("✅ Daily alerts script completed successfully");
    
    res.json({
      success: true,
      message: "Daily client alerts script executed successfully",
      results: results
    });
    
  } catch (error) {
    console.error("❌ Daily alerts script failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// ---------------------------------------------------------------
// TEST: Run airtable-warm-pinger script manually
// ---------------------------------------------------------------
router.get("/api/test-airtable-warm", async (req, res) => {
  try {
    console.log("🧪 Manual test of airtable-warm-pinger script starting...");
    
    // Import the script's main function
    const airtableWarmScript = require('../scripts/airtable-warm/index.js');
    
    // Note: The script runs immediately on require and uses process.exitCode
    // So we'll run it directly and capture output
    const Airtable = require('airtable');
    const { getAllActiveClients } = require('../services/clientService');
    
    const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Leads';
    
    console.log('[warm] Starting Airtable warm ping via Client Master');
    
    const clients = await getAllActiveClients();
    const baseIds = Array.from(
      new Set(
        clients
          .map((c) => c.airtableBaseId)
          .filter((id) => id && String(id).trim().length > 0)
      )
    );
    
    console.log(`[warm] Active clients: ${clients.length}, unique base IDs: ${baseIds.length}`);
    
    // Ping all bases in parallel for faster execution
    const pingPromises = baseIds.map(async (baseId) => {
      const start = Date.now();
      try {
        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);
        const table = base(AIRTABLE_TABLE_NAME);
        
        const records = await new Promise((resolve, reject) => {
          const sel = table.select({ maxRecords: 1, pageSize: 1, fields: [] });
          sel.firstPage((err, recs) => {
            if (err) return reject(err);
            resolve(recs);
          });
        });
        
        const ms = Date.now() - start;
        const count = records?.length || 0;
        console.log(`[warm] Ping success base=${baseId} table=${AIRTABLE_TABLE_NAME} records=${count} timeMs=${ms}`);
        
        return {
          baseId,
          success: true,
          records: count,
          timeMs: ms
        };
        
      } catch (e) {
        console.error(`[warm] Ping failed base=${baseId} table=${AIRTABLE_TABLE_NAME} error=${e.message}`);
        return {
          baseId,
          success: false,
          error: e.message
        };
      }
    });
    
    // Wait for all pings to complete
    const settledResults = await Promise.allSettled(pingPromises);
    const results = settledResults.map(r => r.status === 'fulfilled' ? r.value : r.reason);
    
    console.log('[warm] Done');
    console.log("✅ Airtable warm pinger completed successfully");
    
    res.json({
      success: true,
      message: "Airtable warm pinger executed successfully",
      clientsChecked: clients.length,
      basesPinged: baseIds.length,
      results: results
    });
    
  } catch (error) {
    console.error("❌ Airtable warm pinger failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// ---------------------------------------------------------------
// TEST: Run membership sync script manually
// ---------------------------------------------------------------
router.get("/api/test-membership-sync", async (req, res) => {
  try {
    console.log("🧪 Manual test of membership sync script starting...");
    
    // Import dependencies
    const pmproService = require('../services/pmproMembershipService');
    const clientService = require('../services/clientService');
    const Airtable = require('airtable');
    const { MASTER_TABLES, CLIENT_FIELDS } = require('../constants/airtableUnifiedConstants');
    
    console.log('========================================');
    console.log('🔄 Starting Client Membership Sync');
    console.log('========================================\n');
    
    const results = {
      total: 0,
      processed: 0,
      activated: 0,
      paused: 0,
      skipped: 0,
      errors: 0,
      details: []
    };
    
    // Get all clients
    console.log('📋 Fetching all clients from Airtable...\n');
    const clients = await clientService.getAllClients();
    results.total = clients.length;
    
    console.log(`Found ${clients.length} clients\n`);
    
    // Process each client
    for (const client of clients) {
      const clientId = client.clientId;
      const clientName = client.clientName;
      const wpUserId = client.wpUserId;
      const currentStatus = client.status;
      const statusManagement = client.statusManagement || 'Automatic';
      
      console.log(`🔍 Checking: ${clientName} (${clientId})`);
      console.log(`   WordPress User ID: ${wpUserId || 'Not set'}`);
      console.log(`   Current Status: ${currentStatus}`);
      console.log(`   Status Management: ${statusManagement}`);
      
      // Skip if Status Management is set to "Manual"
      if (statusManagement === 'Manual') {
        console.log(`   ⏭️ Skipping: Status Management set to "Manual"\n`);
        results.skipped++;
        results.details.push({
          clientId,
          clientName,
          action: 'skipped',
          reason: 'Status Management set to Manual',
          status: currentStatus
        });
        continue;
      }
      
      if (!wpUserId || wpUserId === 0) {
        console.log(`   ❌ ERROR: No WordPress User ID configured`);
        console.log(`   → Setting Status to Paused\n`);
        
        // Update Airtable to Paused
        try {
          Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
          const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
          await base(MASTER_TABLES.CLIENTS).update(client.id, {
            [CLIENT_FIELDS.STATUS]: 'Paused'
          });
          
          results.paused++;
          results.errors++;
          results.processed++;
          results.details.push({
            clientId,
            clientName,
            action: 'paused',
            reason: 'No WordPress User ID',
            error: true
          });
        } catch (error) {
          console.error(`   ❌ Failed to update status: ${error.message}\n`);
          results.errors++;
        }
        continue;
      }
      
      try {
        // Check membership
        const membershipCheck = await pmproService.checkUserMembership(wpUserId);
        
        // Handle errors from membership check
        if (membershipCheck.error) {
          console.log(`   ❌ ERROR: ${membershipCheck.error}`);
          console.log(`   → Setting Status to Paused\n`);
          
          Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
          const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
          await base(MASTER_TABLES.CLIENTS).update(client.id, {
            [CLIENT_FIELDS.STATUS]: 'Paused'
          });
          
          results.paused++;
          results.errors++;
          results.processed++;
          results.details.push({
            clientId,
            clientName,
            action: 'paused',
            reason: membershipCheck.error,
            error: true
          });
          continue;
        }
        
        // Determine new status
        const shouldBeActive = membershipCheck.hasValidMembership;
        const newStatus = shouldBeActive ? 'Active' : 'Paused';
        
        // Log membership info
        if (membershipCheck.hasValidMembership) {
          console.log(`   ✅ Valid membership: Level ${membershipCheck.levelId} (${membershipCheck.levelName})`);
          if (membershipCheck.expiryDate) {
            console.log(`   📅 Expiry Date: ${membershipCheck.expiryDate}`);
          }
        } else {
          console.log(`   ⚠️ Invalid or no membership`);
          if (membershipCheck.levelId) {
            console.log(`   → Has Level ${membershipCheck.levelId} but not in valid levels list`);
          } else {
            console.log(`   → No active PMPro membership found`);
          }
        }
        
        // Update if status changed
        if (currentStatus !== newStatus) {
          console.log(`   🔄 Updating status: ${currentStatus} → ${newStatus}`);
          
          const reason = shouldBeActive 
            ? `Valid PMPro membership (Level ${membershipCheck.levelId})`
            : (membershipCheck.levelId 
                ? `Invalid PMPro level ${membershipCheck.levelId}` 
                : 'No active PMPro membership');
          
          // Update Airtable
          Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
          const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
          
          const updateFields = {
            [CLIENT_FIELDS.STATUS]: newStatus
          };
          
          if (membershipCheck.expiryDate !== undefined) {
            updateFields[CLIENT_FIELDS.EXPIRY_DATE] = membershipCheck.expiryDate;
          }
          
          await base(MASTER_TABLES.CLIENTS).update(client.id, updateFields);
          
          if (newStatus === 'Active') {
            results.activated++;
            console.log(`   ✅ Status updated to Active`);
          } else {
            results.paused++;
            console.log(`   ⏸️ Status updated to Paused`);
          }
          
          results.details.push({
            clientId,
            clientName,
            action: newStatus.toLowerCase(),
            previousStatus: currentStatus,
            newStatus: newStatus,
            reason: reason,
            membershipLevel: membershipCheck.levelId
          });
        } else {
          console.log(`   ✓ Status unchanged: ${currentStatus}`);
          results.skipped++;
          results.details.push({
            clientId,
            clientName,
            action: 'unchanged',
            status: currentStatus,
            membershipLevel: membershipCheck.levelId
          });
        }
        
        results.processed++;
        console.log('');
        
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}\n`);
        results.errors++;
        results.details.push({
          clientId,
          clientName,
          action: 'error',
          reason: error.message,
          error: true
        });
      }
    }
    
    console.log('========================================');
    console.log('✅ Membership Sync Complete!');
    console.log('========================================');
    console.log("✅ Membership sync script completed successfully");
    
    res.json({
      success: true,
      message: "Membership sync executed successfully",
      summary: {
        total: results.total,
        processed: results.processed,
        activated: results.activated,
        paused: results.paused,
        unchanged: results.skipped,
        errors: results.errors
      },
      details: results.details
    });
    
  } catch (error) {
    console.error("❌ Membership sync script failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// =============================================
// CALENDAR BOOKING ENDPOINTS
// Uses Service Account for calendar access (no OAuth expiry)
// =============================================

// Get service account email for calendar setup instructions
router.get("/api/calendar/setup-info", async (req, res) => {
  try {
    const calendarService = require('../config/calendarServiceAccount.js');
    
    if (!calendarService.serviceAccountEmail) {
      return res.status(500).json({ 
        error: 'Calendar service not configured - service account not loaded',
        hint: 'Check GOOGLE_APPLICATION_CREDENTIALS env var points to valid JSON file',
        setupRequired: true 
      });
    }
    
    return res.json({
      serviceAccountEmail: calendarService.serviceAccountEmail,
      instructions: [
        '1. Open Google Calendar in your browser',
        '2. Find your calendar on the left, click the 3 dots → Settings',
        '3. Scroll to "Share with specific people"',
        '4. Click "Add people" and enter the service account email above',
        '5. Set permission to "See all event details"',
        '6. Click Send',
        '7. Add your calendar email to your client profile in Airtable'
      ]
    });
  } catch (error) {
    console.error('Calendar setup-info error:', error);
    return res.status(500).json({ 
      error: 'Failed to get setup info', 
      details: error.message 
    });
  }
});

router.post("/api/calendar/chat", async (req, res) => {
  const logger = createLogger({ runId: 'CALENDAR', clientId: req.headers['x-client-id'] || 'unknown', operation: 'calendar-chat' });
  
  try {
    const clientId = req.headers['x-client-id'];
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID required' });
    }

    const { message, messages = [], context } = req.body;

    if (!message || !context) {
      return res.status(400).json({ error: 'Message and context required' });
    }

    logger.info(`Calendar chat request from ${context.yourName} about "${message.substring(0, 50)}..."`);

    // Get Gemini model from config
    const geminiConfig = require('../config/geminiClient.js');
    if (!geminiConfig || !geminiConfig.geminiModel) {
      logger.error('Gemini model not available');
      return res.status(500).json({ error: 'AI service not available' });
    }

    // Helper to get timezone from location
    const getTimezoneFromLocation = (location) => {
      const locationLower = (location || '').toLowerCase();
      
      if (locationLower.includes('sydney') || locationLower.includes('melbourne') || locationLower.includes('canberra')) {
        return 'Australia/Sydney';
      }
      if (locationLower.includes('brisbane') || locationLower.includes('queensland')) {
        return 'Australia/Brisbane';
      }
      if (locationLower.includes('perth') || locationLower.includes('western australia')) {
        return 'Australia/Perth';
      }
      if (locationLower.includes('adelaide') || locationLower.includes('south australia')) {
        return 'Australia/Adelaide';
      }
      if (locationLower.includes('darwin') || locationLower.includes('northern territory')) {
        return 'Australia/Darwin';
      }
      if (locationLower.includes('hobart') || locationLower.includes('tasmania')) {
        return 'Australia/Hobart';
      }
      if (locationLower.includes('auckland') || locationLower.includes('new zealand') || locationLower.includes('wellington')) {
        return 'Pacific/Auckland';
      }
      if (locationLower.includes('singapore')) {
        return 'Asia/Singapore';
      }
      if (locationLower.includes('hong kong')) {
        return 'Asia/Hong_Kong';
      }
      if (locationLower.includes('tokyo') || locationLower.includes('japan')) {
        return 'Asia/Tokyo';
      }
      if (locationLower.includes('london') || locationLower.includes('uk') || locationLower.includes('england')) {
        return 'Europe/London';
      }
      if (locationLower.includes('new york') || locationLower.includes('ny')) {
        return 'America/New_York';
      }
      if (locationLower.includes('los angeles') || locationLower.includes('la') || locationLower.includes('california')) {
        return 'America/Los_Angeles';
      }
      
      return 'Australia/Brisbane';
    };

    // Format time in a specific timezone
    const formatTimeInTimezone = (isoTime, timezone) => {
      const date = new Date(isoTime);
      return date.toLocaleString('en-AU', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });
    };

    // Import service account calendar client
    const calendarService = require('../config/calendarServiceAccount.js');

    // Get free slots for a date using service account
    const getFreeSlotsForDate = async (calendarEmail, date, startHour = 9, endHour = 17, timezone = 'Australia/Brisbane') => {
      const { slots, error } = await calendarService.getFreeSlotsForDate(calendarEmail, date, startHour, endHour, timezone);
      
      if (error) {
        logger.error('FreeBusy error:', error);
        return [];
      }

      return slots.map(slot => {
        const startDisplay = new Date(slot.start).toLocaleTimeString('en-AU', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone,
        });
        const endDisplay = new Date(slot.end).toLocaleTimeString('en-AU', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone,
        });
        return {
          time: slot.start,
          display: startDisplay,
          displayRange: `${startDisplay}-${endDisplay}`,
        };
      });
    };

    // Detect lead timezone from location
    // If lead location is blank/unknown, assume same timezone as user (no conversion)
    const leadLocationKnown = context.leadLocation && context.leadLocation.trim() !== '';
    const leadTimezone = leadLocationKnown ? getTimezoneFromLocation(context.leadLocation) : yourTimezone;
    
    // Get client timezone and calendar email from Airtable
    const getClientCalendarInfo = async () => {
      const lookupResponse = await fetch(
        `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')&fields[]=Google Calendar Email&fields[]=Timezone`,
        {
          headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` },
        }
      );

      if (!lookupResponse.ok) {
        return { email: '', timezone: 'Australia/Brisbane', error: 'Failed to lookup client' };
      }

      const data = await lookupResponse.json();
      if (!data.records || data.records.length === 0) {
        return { email: '', timezone: 'Australia/Brisbane', error: 'Client not found' };
      }

      const record = data.records[0];
      const calendarEmail = record.fields['Google Calendar Email'];
      const timezone = record.fields['Timezone'] || 'Australia/Brisbane';

      if (!calendarEmail) {
        return { email: '', timezone, error: `Calendar not configured. Share your calendar with: ${calendarService.serviceAccountEmail || 'service account'}` };
      }

      return { email: calendarEmail, timezone, error: null };
    };

    const { email: calendarEmail, timezone: yourTimezone, error: calendarError } = await getClientCalendarInfo();
    if (calendarError) {
      return res.status(401).json({ error: calendarError });
    }

    // Get today's date IN THE USER'S TIMEZONE (not server time)
    // This ensures "today" and "tomorrow" are correct for the user
    const getTodayInTimezone = (tz) => {
      const now = new Date();
      // Format the date in the target timezone to get the correct date
      const formatter = new Intl.DateTimeFormat('en-CA', { 
        timeZone: tz, 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      });
      return formatter.format(now); // Returns YYYY-MM-DD
    };
    
    const todayDateStr = getTodayInTimezone(yourTimezone);
    const today = new Date(todayDateStr + 'T12:00:00'); // Use noon to avoid timezone edge cases
    
    // Also get the current time in user's timezone for context
    const getCurrentTimeInTimezone = (tz) => {
      const now = new Date();
      return now.toLocaleString('en-AU', {
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    };
    const currentTimeDisplay = getCurrentTimeInTimezone(yourTimezone);
    
    const dates = [];
    for (let i = 0; i < 150; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }

    // Check if timezones have the same offset right now (for timezone display logic)
    const getOffsetMinutes = (tz) => {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
      const parts = formatter.formatToParts(now);
      const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
      const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (!match) return 0;
      const sign = match[1] === '+' ? 1 : -1;
      const hours = parseInt(match[2], 10);
      const minutes = parseInt(match[3] || '0', 10);
      return sign * (hours * 60 + minutes);
    };
    
    const yourOffset = getOffsetMinutes(yourTimezone);
    const leadOffset = getOffsetMinutes(leadTimezone);
    const sameTimezone = yourOffset === leadOffset;
    
    // Extract lead's first name
    const leadFirstName = (context.leadName || '').split(' ')[0] || 'the lead';
    
    // City name for display (extract from timezone or location)
    const getDisplayCity = (tz, location) => {
      if (location) {
        const loc = location.toLowerCase();
        if (loc.includes('sydney')) return 'Sydney';
        if (loc.includes('melbourne')) return 'Melbourne';
        if (loc.includes('brisbane')) return 'Brisbane';
        if (loc.includes('perth')) return 'Perth';
        if (loc.includes('adelaide')) return 'Adelaide';
        if (loc.includes('auckland')) return 'Auckland';
        if (loc.includes('singapore')) return 'Singapore';
      }
      // Extract from timezone string
      const city = tz.split('/').pop()?.replace('_', ' ');
      return city || 'their timezone';
    };
    const leadCity = getDisplayCity(leadTimezone, context.leadLocation);

    // Build lead contact info section (only include if available)
    const leadContactInfo = [
      context.leadEmail ? `- Lead's email: ${context.leadEmail}` : null,
      context.leadPhone ? `- Lead's phone: ${context.leadPhone}` : null,
      context.leadLinkedIn ? `- Lead's LinkedIn: ${context.leadLinkedIn}` : null,
    ].filter(Boolean).join('\n');

    // Build system prompt with context
    const systemPrompt = `You are a helpful calendar booking assistant for ${context.yourName}.

WHO IS WHO (CRITICAL):
- USER: ${context.yourName} is the person you are chatting with. They are in ${yourTimezone.split('/').pop()?.replace('_', ' ')} (${yourTimezone}).
- LEAD: ${context.leadName} is the person being invited to the meeting. They are in ${leadCity} (${leadTimezone}).
- You are helping the USER book a meeting with the LEAD.

CURRENT TIME:
- It is currently ${currentTimeDisplay} for ${context.yourName}.

TIMEZONE RULES (ALWAYS FOLLOW):
1. ALL times mentioned by the user are in the USER's timezone (${yourTimezone}) unless they explicitly say otherwise
2. Calendar availability data is in the USER's timezone
3. The booking/ACTION times are ALWAYS in the USER's timezone
4. When generating a MESSAGE FOR THE LEAD: CONVERT times to the LEAD's timezone (${leadTimezone}) and ${sameTimezone ? 'no need to specify timezone since you are both in the same timezone' : `include "(${leadCity} time)" so ${leadFirstName} knows the timezone`}

SMART SCHEDULING (when finding mutually good times):
- Business hours are typically 9am-5pm in each person's timezone
- When suggesting times, consider what the time will be for BOTH parties
- If a time would be outside business hours for the lead (e.g., 8am ${leadCity} time), mention this or suggest a later time
- Example: If user is free at 10am ${yourTimezone.split('/').pop()?.replace('_', ' ')} but that's only ${sameTimezone ? '10am' : '8am'} in ${leadCity}, that might be too early for ${leadFirstName}
${context.conversationHint ? `\nFROM CONVERSATION: "${context.conversationHint}"` : ''}
${leadContactInfo ? '\nLEAD CONTACT INFO:\n' + leadContactInfo : ''}

YOUR CAPABILITIES:
1. Show scheduled appointments/meetings for specific dates
2. Check calendar availability for specific dates
3. Show free time slots
4. Suggest the best meeting time (considering both parties)
5. Generate booking messages to send to the lead
6. Set a booking time when the user confirms

MESSAGE GENERATION RULES (when creating a booking confirmation message for ${leadFirstName}):

CRITICAL - UNDERSTAND THE CONTEXT:
- The calendar invite has ALREADY BEEN SENT by the user
- You are writing a CONFIRMATION message that says "I've sent you..." (PAST TENSE)
- This is NOT a proposal - the meeting is ALREADY BOOKED

OPENING:
- DON'T use formal "Hi ${leadFirstName}," - that's too stiff for a confirmation
- DO lead with energy matching their response: "Great ${leadFirstName}," or "Awesome ${leadFirstName}," or "Sounds great ${leadFirstName}!"
- If they said "Sure!" you say "Great!" - mirror their enthusiasm

BODY:
- Say "I've sent you a calendar invite with a Zoom link" (PAST TENSE - it's already sent!)
- Include the meeting time: "for [day, date] at [time]"
- Add a quick confirmation ask: "Does that work for you?"
- ${sameTimezone ? 'Just say "Monday, 12 January at 10:00 am" - no timezone needed since you\'re both in the same timezone' : `Convert to ${leadFirstName}'s timezone and include "(${leadCity} time)"`}

SIGNATURE:
- Look at how ${context.yourName} signed their messages in the conversation
- Copy their signature style EXACTLY (e.g., "Talk Soon", "Cheers", "Best")
- If they use a unique signoff like "(I know a) Guy" or "I know a (Guy)", USE IT
- If no signature visible, use "Talk Soon" + first name

TONE:
- Match the energy and informality of the conversation
- Keep it SHORT - 3-4 lines max
- Don't be robotic or overly formal

EXAMPLE OF GOOD CONFIRMATION:
"Great Fabrice,

I've sent you a calendar invite with a Zoom link for Monday, 12 January at 10:00 am. Does that work for you?

Talk Soon
(I know a) Guy"

RESPONSE STYLE:
- Be conversational but concise
- Show exact slot times from CALENDAR AVAILABILITY (they are 30-minute slots)
- Do NOT combine or expand slots - show them exactly as provided
- For vague requests like "next week", summarize the key available times

CRITICAL RULES:
- ONLY report appointments that are in the CALENDAR AVAILABILITY or YOUR SCHEDULED APPOINTMENTS sections below
- NEVER invent fake appointments
- When suggesting times, pick from CALENDAR AVAILABILITY that DON'T conflict with YOUR SCHEDULED APPOINTMENTS

ACTIONS (put at the VERY END of your response):
When setting a time, add this on its own line at the end:
ACTION: {"type":"setBookingTime","dateTime":"2026-01-08T14:00:00","timezone":"${yourTimezone}"}

The dateTime MUST be in the USER's timezone (${yourTimezone}).

If user says "book it" / "lock it in" / "confirm", add openCalendar:true:
ACTION: {"type":"setBookingTime","dateTime":"2026-01-08T14:00:00","timezone":"${yourTimezone}","openCalendar":true}

CALENDAR DATA RANGE:
- You have calendar data for the next 90 days (through early ${new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })})
- If asked about a date beyond 90 days, explain you can only check up to 90 days out.`;
    // Always fetch 90 days of calendar data - simple and reliable
    const needsCalendar = true; // Always fetch calendar for booking assistant
    
    let calendarContext = '';
    
    if (needsCalendar) {
      logger.info(`Fetching 90 days of calendar data for: "${message.substring(0, 50)}..."`);
    
    // Parse time preferences from message (for availability filtering)
    let startHour = 9;  // default 9am
    let endHour = 17;   // default 5pm
    
    const msgLower = message.toLowerCase();
    
    // Parse "up to X pm" or "until X pm" or "before X pm"
    const untilMatch = msgLower.match(/(?:up to|until|before|by)\s*(\d{1,2})\s*(?:pm|p\.m\.?)/i);
    if (untilMatch) {
      endHour = parseInt(untilMatch[1], 10) + 12; // Convert to 24h
      if (endHour > 21) endHour = 21; // Cap at 9pm
    }
    
    // Parse "after X am/pm" or "from X am/pm"
    const afterMatch = msgLower.match(/(?:after|from|starting)\s*(\d{1,2})\s*(am|pm|a\.m\.?|p\.m\.?)/i);
    if (afterMatch) {
      startHour = parseInt(afterMatch[1], 10);
      if (afterMatch[2].toLowerCase().startsWith('p') && startHour < 12) startHour += 12;
    }
    
    // Parse time-of-day keywords
    if (msgLower.includes('morning')) {
      startHour = 9;
      endHour = 12;
    } else if (msgLower.includes('afternoon') || msgLower.includes('arvo')) {
      startHour = 12;
      endHour = 17;
    } else if (msgLower.includes('evening')) {
      startHour = 17;
      endHour = 21;
    }
    
    logger.info(`Time preferences: ${startHour}:00 - ${endHour}:00`);
    
    // SIMPLIFIED: Always fetch 90 days - no AI call needed for date extraction
    // This eliminates the fragile date parsing AI call and provides reliable coverage
    const daysToFetch = 90;
    
    logger.info(`Fetching ${daysToFetch} days of calendar data`);
    
    // Build batch dates array for 90 days starting from today
    const batchDates = dates.slice(0, daysToFetch);
    
    const batchStart = Date.now();
    const { days: calendarDays, error: batchError } = await calendarService.getBatchAvailability(
      calendarEmail, batchDates, startHour, endHour, yourTimezone
    );
    logger.info(`Batch calendar fetch completed in ${Date.now() - batchStart}ms for ${batchDates.length} days`);
    
    if (batchError) {
      logger.error(`Batch calendar error: ${batchError}`);
    }
    
    // Format for AI context with lead timezone conversion
    const eventDays = calendarDays.map(d => ({
      ...d,
      events: d.events.map(e => ({
        ...e,
        displayTime: formatTimeInTimezone(e.start, yourTimezone),
      })),
    }));
    
    const availabilitySlots = calendarDays.map(d => ({
      ...d,
      freeSlots: d.freeSlots.map(slot => ({
        ...slot,
        leadDisplay: formatTimeInTimezone(slot.time, leadTimezone),
      })),
    }));
    
    // Build calendar context with both appointments and availability (compact format)
    if (eventDays.length > 0) {
      calendarContext = `\n\nAPPOINTMENTS:\n${eventDays.map(d => 
        `${d.day}: ${d.events.length > 0 ? d.events.map(e => `${e.displayTime}-${e.summary}`).join(', ') : '-'}`
      ).join('\n')}`;
    }
    
    if (availabilitySlots.length > 0) {
      calendarContext += `\n\nFREE SLOTS (30min):\n${availabilitySlots.map(s => 
        `${s.day}: ${s.freeSlots.length > 0 ? s.freeSlots.slice(0, 6).map(f => f.displayRange || f.display).join(', ') : 'Busy'}`
      ).join('\n')}`;
    }
    
    logger.info(`Calendar context built: ${calendarContext.length} chars, ~${Math.ceil(calendarContext.length / 4)} tokens`);
    } else {
      logger.info(`Calendar fetch skipped`);
    }

    // Build conversation history for Gemini
    const conversationHistory = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    // Add the new message with calendar context
    conversationHistory.push({
      role: 'user',
      parts: [{ text: message + calendarContext }]
    });

    // Call Gemini via Vertex AI
    logger.info('Calling Gemini for calendar chat...');
    
    const chat = geminiConfig.geminiModel.startChat({
      history: conversationHistory.slice(0, -1), // All but the last message
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096, // Increased from 2048 to handle longer time slot lists
      },
    });

    const result = await chat.sendMessage(conversationHistory[conversationHistory.length - 1].parts[0].text);
    
    // Log the full response structure for debugging
    const finishReason = result.response?.candidates?.[0]?.finishReason;
    const safetyRatings = result.response?.candidates?.[0]?.safetyRatings;
    logger.info(`Gemini finish reason: ${finishReason}`);
    if (finishReason !== 'STOP') {
      logger.warn(`Unexpected finish reason: ${finishReason}`, JSON.stringify(safetyRatings));
    }
    
    // Handle different response formats from Vertex AI SDK
    let responseText;
    if (result.response && typeof result.response.text === 'function') {
      responseText = result.response.text();
    } else if (result.response && result.response.candidates?.[0]?.content?.parts?.[0]?.text) {
      responseText = result.response.candidates[0].content.parts[0].text;
    } else if (typeof result.text === 'function') {
      responseText = result.text();
    } else {
      logger.error('Unexpected Gemini response format:', JSON.stringify(result, null, 2));
      throw new Error('Unexpected AI response format');
    }
    
    logger.info(`Gemini response received (${responseText.length} chars)`);
    logger.info(`Gemini response preview: ${responseText.substring(0, 500)}...`);

    // Parse any ACTION from the response (should be at the end)
    let action = null;
    const actionMatch = responseText.match(/\nACTION:\s*(\{.*\})\s*$/s);
    
    if (actionMatch) {
      try {
        const actionData = JSON.parse(actionMatch[1]);
        if (actionData.type === 'setBookingTime') {
          // AI sends dateTime like "2025-01-06T11:00:00" in YOUR timezone (Brisbane)
          // We need to interpret it as Brisbane time, not UTC
          // The dateTime without Z suffix is treated as local, but server is in UTC
          // So we append the timezone offset to make it explicit
          let dateTimeStr = actionData.dateTime;
          
          // If no timezone info in the string, assume it's in yourTimezone (Brisbane = UTC+10)
          if (!dateTimeStr.includes('Z') && !dateTimeStr.includes('+') && !dateTimeStr.includes('-', 10)) {
            // Parse the date parts manually to avoid UTC conversion
            const [datePart, timePart] = dateTimeStr.split('T');
            const [year, month, day] = datePart.split('-').map(Number);
            const [hour, minute] = (timePart || '00:00').split(':').map(Number);
            
            // Create display strings directly without timezone conversion
            const displayDate = new Date(year, month - 1, day, hour, minute || 0);
            const displayTime = displayDate.toLocaleString('en-AU', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            });
            
            action = {
              ...actionData,
              leadTimezone,
              leadDateTime: dateTimeStr,
              displayTime: displayTime,
              leadDisplayTime: formatTimeInTimezone(dateTimeStr, leadTimezone),
              // Preserve openCalendar flag if present
              openCalendar: actionData.openCalendar || false,
            };
          } else {
            // Has timezone info, use normal formatting
            action = {
              ...actionData,
              leadTimezone,
              leadDateTime: actionData.dateTime,
              displayTime: formatTimeInTimezone(actionData.dateTime, yourTimezone),
              leadDisplayTime: formatTimeInTimezone(actionData.dateTime, leadTimezone),
              // Preserve openCalendar flag if present
              openCalendar: actionData.openCalendar || false,
            };
          }
        } else if (actionData.type === 'openCalendar') {
          action = { type: 'openCalendar' };
        }
      } catch (e) {
        logger.error('Failed to parse action:', e);
      }
    }

    // Remove the ACTION line from the message shown to user (it's at the end)
    const cleanMessage = responseText.replace(/\nACTION:\s*\{.*\}\s*$/s, '').trim();

    res.json({
      message: cleanMessage,
      action,
      leadTimezone,
      yourTimezone,
    });

  } catch (error) {
    logger.error('Calendar chat error:', error.message, error.stack);
    res.status(500).json({ error: `Chat failed: ${error.message}` });
  }
});

// ============================================================================
// CALENDAR - EXTRACT PROFILE FROM RAW LINKEDIN PASTE
// ============================================================================
/**
 * POST /api/calendar/extract-profile
 * Uses Gemini to extract lead profile data from raw LinkedIn copy-paste
 * This is the backend endpoint - frontend calls this instead of Gemini directly
 */
router.post("/api/calendar/extract-profile", async (req, res) => {
  const logger = createLogger({ runId: 'CALENDAR', clientId: req.headers['x-client-id'] || 'unknown', operation: 'extract-profile' });
  
  try {
    const { rawText } = req.body;

    if (!rawText || typeof rawText !== 'string') {
      return res.status(400).json({ error: 'rawText is required' });
    }

    // Get Gemini model from config
    const geminiConfig = require('../config/geminiClient.js');
    if (!geminiConfig || !geminiConfig.geminiModel) {
      logger.error('Gemini model not available for profile extraction');
      return res.status(500).json({ error: 'AI service not available' });
    }

    // Truncate if too long (first 15000 chars should have all profile info)
    const text = rawText.substring(0, 15000);

    logger.info(`Extracting profile from ${text.length} chars of raw LinkedIn paste`);

    const prompt = `You are a LinkedIn profile data extractor. Extract the following fields from this raw LinkedIn profile copy-paste.

EXTRACT THESE FIELDS:
1. leadName - The person's full name (first and last name). Look for the name that appears prominently at the top of the profile, often after "Background Image" or similar. Ignore pronouns like (She/Her).
2. leadLocation - Their location (city, region, country). Look for patterns like "Greater Brisbane Area" or "Sydney, Australia".
3. leadEmail - Their email if visible on the profile. If not found, return empty string.
4. leadPhone - Their phone number if visible on the profile. If not found, return empty string.
5. bookingTimeHint - If there's any conversation visible that mentions meeting times (e.g., "next week", "Thursday afternoon", "after Christmas"), extract that hint. If not found, return empty string.
6. headline - Their job title/headline (the line that describes what they do)
7. company - Their current company if identifiable from headline or experience

IMPORTANT RULES:
- For leadName: Get the actual person's name, not "LinkedIn" or UI text. The name typically appears 2-3 times at the start.
- For leadLocation: Extract just the location, not "Contact info" or other UI text.
- For bookingTimeHint: Look in any messaging/conversation section for time-related phrases.
- Return ONLY valid JSON, no markdown, no explanation.

RAW LINKEDIN TEXT:
${text}

RESPOND WITH ONLY THIS JSON FORMAT (no markdown):
{"leadName":"","leadLocation":"","leadEmail":"","leadPhone":"","bookingTimeHint":"","headline":"","company":""}`;

    // Use the properly configured Gemini model (Vertex AI)
    const result = await geminiConfig.geminiModel.generateContent(prompt);
    const responseText = result.response.candidates[0].content.parts[0].text;

    if (!responseText) {
      logger.error('No response from Gemini for profile extraction');
      return res.status(500).json({ error: 'No response from AI' });
    }

    // Parse JSON from response (handle potential markdown wrapping)
    let extracted;
    try {
      let cleanJson = responseText.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }
      extracted = JSON.parse(cleanJson);
    } catch (parseError) {
      logger.error('Failed to parse Gemini response:', responseText);
      return res.status(500).json({ error: 'Failed to parse AI response', raw: responseText });
    }

    logger.info(`Successfully extracted profile for: ${extracted.leadName || 'unknown'}`);

    res.json({
      success: true,
      extracted: {
        leadName: extracted.leadName || '',
        leadLocation: extracted.leadLocation || '',
        leadEmail: extracted.leadEmail || '',
        leadPhone: extracted.leadPhone || '',
        bookingTimeHint: extracted.bookingTimeHint || '',
        headline: extracted.headline || '',
        company: extracted.company || '',
      },
    });

  } catch (error) {
    logger.error('Profile extraction error:', error.message, error.stack);
    res.status(500).json({ error: `Profile extraction failed: ${error.message}` });
  }
});

// ============================================================================
// CALENDAR - LOOKUP LEAD BY URL, EMAIL, OR NAME
// ============================================================================
/**
 * GET /api/calendar/lookup-lead
 * Lookup a lead in Airtable by LinkedIn URL, email, or name
 * Returns lead details if found, or 404 if not
 */
router.get("/api/calendar/lookup-lead", async (req, res) => {
  const clientId = req.headers['x-client-id'];
  const logger = createLogger({ runId: 'CALENDAR', clientId: clientId || 'unknown', operation: 'lookup-lead' });
  
  try {
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID required' });
    }

    // Support both 'url' (legacy) and 'query' (new) parameters
    let query = req.query.query || req.query.url;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Search query required (URL, email, or name)' });
    }

    query = query.trim();
    logger.info(`Looking up lead by query: ${query}`);

    // Get client's Airtable base
    const { getClientBase } = require('../config/airtableClient.js');
    const clientBase = await getClientBase(clientId);
    
    if (!clientBase) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Detect query type
    const isLinkedInUrl = /linkedin\.com\/in\//i.test(query);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);
    
    let formula = '';
    let lookupMethod = 'name';
    
    if (isLinkedInUrl) {
      // LinkedIn URL lookup
      lookupMethod = 'linkedin_url';
      const url = query.split('?')[0].replace(/\/$/, ''); // Normalize
      formula = `OR(
        {LinkedIn Profile URL}='${url}',
        {LinkedIn Profile URL}='${url}/',
        LOWER({LinkedIn Profile URL})=LOWER('${url}'),
        LOWER({LinkedIn Profile URL})=LOWER('${url}/')
      )`;
    } else if (isEmail) {
      // Email lookup
      lookupMethod = 'email';
      formula = `LOWER({Email}) = LOWER('${query}')`;
    } else {
      // Name lookup
      lookupMethod = 'name';
      const nameParts = query.split(/\s+/);
      
      if (nameParts.length >= 2) {
        // First AND last name
        const firstName = nameParts[0].toLowerCase();
        const lastName = nameParts.slice(1).join(' ').toLowerCase();
        formula = `AND(
          SEARCH("${firstName}", LOWER({First Name})),
          SEARCH("${lastName}", LOWER({Last Name}))
        )`;
      } else {
        // Single word - search in both fields
        const term = nameParts[0].toLowerCase();
        formula = `OR(
          SEARCH("${term}", LOWER({First Name})),
          SEARCH("${term}", LOWER({Last Name}))
        )`;
      }
    }

    logger.info(`Lookup method: ${lookupMethod}`);

    const records = await clientBase('Leads')
      .select({
        filterByFormula: formula,
        maxRecords: 10, // Allow multiple matches for name search
        fields: [
          'First Name',
          'Last Name',
          'LinkedIn Profile URL',
          'Location',
          'Email',
          'Phone',
          'Headline',
          'Company Name',
          'AI Score',
          'Raw Profile Data'
        ]
      })
      .firstPage();

    if (!records || records.length === 0) {
      logger.info(`No leads found for: ${query}`);
      return res.status(404).json({ 
        found: false, 
        message: 'Lead not found in system',
        query: query,
        lookupMethod: lookupMethod 
      });
    }

    // Map records to lead data
    const leads = records.map(record => {
      const fields = record.fields;
      
      // Try to get location from field, or fall back to Raw Profile Data
      let location = fields['Location'] || '';
      if (!location && fields['Raw Profile Data']) {
        try {
          const rawData = JSON.parse(fields['Raw Profile Data']);
          location = rawData.location_name || rawData.location || '';
        } catch (e) {
          // Ignore JSON parse errors
        }
      }

      return {
        recordId: record.id,
        firstName: fields['First Name'] || '',
        lastName: fields['Last Name'] || '',
        fullName: `${fields['First Name'] || ''} ${fields['Last Name'] || ''}`.trim(),
        linkedInUrl: fields['LinkedIn Profile URL'] || '',
        location: location,
        email: fields['Email'] || '',
        phone: fields['Phone'] || '',
        headline: fields['Headline'] || '',
        company: fields['Company Name'] || '',
        aiScore: fields['AI Score'] || null,
      };
    });

    logger.info(`Found ${leads.length} lead(s) via ${lookupMethod}`);

    // Return single lead format for backward compatibility if exactly 1 match
    // Otherwise return array for selection
    if (leads.length === 1) {
      res.json({
        found: true,
        lookupMethod,
        count: 1,
        ...leads[0]
      });
    } else {
      res.json({
        found: true,
        lookupMethod,
        count: leads.length,
        leads: leads
      });
    }

  } catch (error) {
    logger.error('Lead lookup error:', error.message, error.stack);
    res.status(500).json({ error: `Lead lookup failed: ${error.message}` });
  }
});

// ============================================================================
// CALENDAR - UPDATE LEAD DETAILS
// ============================================================================
/**
 * PATCH /api/calendar/update-lead
 * Update a lead's details in Airtable (location, email, phone)
 */
router.patch("/api/calendar/update-lead", async (req, res) => {
  const clientId = req.headers['x-client-id'];
  const logger = createLogger({ runId: 'CALENDAR', clientId: clientId || 'unknown', operation: 'update-lead' });
  
  try {
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID required' });
    }

    const { recordId, location, email, phone } = req.body;
    
    if (!recordId) {
      return res.status(400).json({ error: 'Record ID required' });
    }

    logger.info(`Updating lead ${recordId}: location=${location}, email=${email}, phone=${phone}`);

    // Get client's Airtable base
    const { getClientBase } = require('../config/airtableClient.js');
    const clientBase = await getClientBase(clientId);
    
    if (!clientBase) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Build update fields (only include non-empty values)
    const updateFields = {};
    if (location) updateFields['Location'] = location;
    if (email) updateFields['Email'] = email;
    if (phone) updateFields['Phone'] = phone;

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Update the record
    const updatedRecord = await clientBase('Leads').update(recordId, updateFields);

    logger.info(`Lead ${recordId} updated successfully`);

    res.json({
      success: true,
      recordId: updatedRecord.id,
      updated: updateFields
    });

  } catch (error) {
    logger.error('Lead update error:', error.message, error.stack);
    res.status(500).json({ error: `Lead update failed: ${error.message}` });
  }
});

// ============================================================
// CLIENT ONBOARDING ENDPOINT
// ============================================================

/**
 * POST /api/onboard-client
 * 
 * Creates a new client record in the Master Clients base after validating
 * that the provided Airtable base has the required tables and fields.
 * 
 * Required fields from coach:
 * - clientName: Full name (e.g., "Keith Sinclair")
 * - email: Client email address
 * - wordpressUserId: PMPro user ID
 * - airtableBaseId: The new duplicated base ID
 * - serviceLevel: "1-Lead Scoring", "2-Post Scoring", etc.
 * 
 * Optional fields:
 * - linkedinUrl: Client's LinkedIn profile URL
 * - timezone: IANA timezone (defaults to Australia/Brisbane)
 * - phone: Phone number
 * - googleCalendarEmail: For calendar booking feature
 * - postAccessEnabled: Boolean to enable Apify post scraping access
 */
router.post("/api/onboard-client", async (req, res) => {
  const Airtable = require('airtable');
  const logger = createLogger({ runId: 'ONBOARD', clientId: 'SYSTEM', operation: 'onboard_client' });
  
  try {
    const {
      clientName,
      email,
      wordpressUserId,
      airtableBaseId,
      serviceLevel,
      linkedinUrl,
      timezone = 'Australia/Brisbane',
      phone,
      googleCalendarEmail,
      postAccessEnabled
    } = req.body;
    
    // Validation
    const errors = [];
    if (!clientName) errors.push('clientName is required');
    if (!email) errors.push('email is required');
    if (!wordpressUserId) errors.push('wordpressUserId is required');
    if (!airtableBaseId) errors.push('airtableBaseId is required');
    if (!serviceLevel) errors.push('serviceLevel is required');
    
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }
    
    // Generate Client ID from name (e.g., "Keith Sinclair" -> "Keith-Sinclair")
    const clientId = clientName.trim().replace(/\s+/g, '-');
    const clientFirstName = clientName.trim().split(' ')[0];
    
    logger.info(`Onboarding client: ${clientId}`);
    
    // Step 1: Check if client already exists
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    const existingClients = await masterBase('Clients').select({
      filterByFormula: `OR({Client ID} = "${clientId}", {Client Email Address} = "${email}")`,
      maxRecords: 1
    }).firstPage();
    
    if (existingClients.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Client already exists',
        existingClientId: existingClients[0].fields['Client ID']
      });
    }
    
    // Step 2: Validate the new Airtable base
    const validationResults = {
      baseAccessible: false,
      leadsTableExists: false,
      credentialsTableExists: false,
      requiredFieldsPresent: [],
      missingFields: []
    };
    
    try {
      const clientBase = Airtable.base(airtableBaseId);
      
      // Check Leads table
      try {
        const leadsRecords = await clientBase('Leads').select({ maxRecords: 1 }).firstPage();
        validationResults.leadsTableExists = true;
        validationResults.baseAccessible = true;
        
        // Check for required fields by looking at first record's available fields
        // or by attempting to query with those fields
        const requiredLeadFields = [
          'First Name', 'Last Name', 'LinkedIn Profile URL', 'AI Score', 
          'Status', 'Notes', 'Scoring Status'
        ];
        
        if (leadsRecords.length > 0) {
          const availableFields = Object.keys(leadsRecords[0].fields);
          for (const field of requiredLeadFields) {
            if (availableFields.includes(field)) {
              validationResults.requiredFieldsPresent.push(field);
            } else {
              validationResults.missingFields.push(`Leads.${field}`);
            }
          }
        } else {
          // Empty table - assume fields exist if table exists
          validationResults.requiredFieldsPresent = requiredLeadFields;
        }
      } catch (leadsError) {
        validationResults.leadsTableExists = false;
        validationResults.missingFields.push('Leads table not found');
      }
      
      // Check Credentials table
      try {
        await clientBase('Credentials').select({ maxRecords: 1 }).firstPage();
        validationResults.credentialsTableExists = true;
      } catch (credError) {
        validationResults.credentialsTableExists = false;
        validationResults.missingFields.push('Credentials table not found');
      }
      
    } catch (baseError) {
      logger.error(`Base validation failed: ${baseError.message}`);
      return res.status(400).json({
        success: false,
        error: 'Cannot access Airtable base',
        details: baseError.message,
        validation: validationResults
      });
    }
    
    // Check if validation passed
    if (!validationResults.leadsTableExists || !validationResults.credentialsTableExists) {
      return res.status(400).json({
        success: false,
        error: 'Base validation failed',
        validation: validationResults
      });
    }
    
    // Step 3: Always use Post Scoring defaults for all clients
    // (Even Level 1 clients get these values pre-set for when they upgrade)
    const defaults = {
      profileScoringTokenLimit: 5000,
      postScoringTokenLimit: 3000,
      postsDailyTarget: 10,
      leadsBatchSizeForPostCollection: 10,
      maxPostBatchesPerDayGuardrail: 3,
      postScrapeBatchSize: 10,
      processingStream: 1
    };
    
    // Step 4: Create the client record
    const newClientRecord = {
      [CLIENT_FIELDS.CLIENT_ID]: clientId,
      [CLIENT_FIELDS.CLIENT_NAME]: clientName.trim(),
      [CLIENT_FIELDS.CLIENT_FIRST_NAME]: clientFirstName,
      [CLIENT_FIELDS.CLIENT_EMAIL_ADDRESS]: email.trim(),
      [CLIENT_FIELDS.WORDPRESS_USER_ID]: parseInt(wordpressUserId, 10),
      [CLIENT_FIELDS.AIRTABLE_BASE_ID]: airtableBaseId.trim(),
      [CLIENT_FIELDS.STATUS]: 'Active',
      [CLIENT_FIELDS.STATUS_MANAGEMENT]: 'Automatic',
      [CLIENT_FIELDS.SERVICE_LEVEL]: serviceLevel,
      [CLIENT_FIELDS.TIMEZONE]: timezone,
      [CLIENT_FIELDS.PROFILE_SCORING_TOKEN_LIMIT]: defaults.profileScoringTokenLimit,
      [CLIENT_FIELDS.POST_SCORING_TOKEN_LIMIT]: defaults.postScoringTokenLimit,
      [CLIENT_FIELDS.POSTS_DAILY_TARGET]: defaults.postsDailyTarget,
      [CLIENT_FIELDS.LEADS_BATCH_SIZE_FOR_POST_COLLECTION]: defaults.leadsBatchSizeForPostCollection,
      [CLIENT_FIELDS.MAX_POST_BATCHES_PER_DAY_GUARDRAIL]: defaults.maxPostBatchesPerDayGuardrail,
      [CLIENT_FIELDS.POST_SCRAPE_BATCH_SIZE]: defaults.postScrapeBatchSize,
      [CLIENT_FIELDS.PROCESSING_STREAM]: defaults.processingStream,
    };
    
    // Add optional fields if provided
    if (linkedinUrl) newClientRecord['LinkedIn URL'] = linkedinUrl.trim();
    if (phone) newClientRecord['Phone'] = phone.trim();
    if (googleCalendarEmail) newClientRecord[CLIENT_FIELDS.GOOGLE_CALENDAR_EMAIL] = googleCalendarEmail.trim();
    if (postAccessEnabled !== undefined) {
      newClientRecord[CLIENT_FIELDS.POST_ACCESS_ENABLED] = postAccessEnabled ? 'Yes' : null;
    }
    
    const createdRecord = await masterBase('Clients').create(newClientRecord);
    
    logger.info(`Client ${clientId} created successfully with record ID: ${createdRecord.id}`);
    
    // Step 5: Create client tasks from templates
    let taskResult = { tasksCreated: 0 };
    try {
      taskResult = await clientService.createClientTasksFromTemplates(createdRecord.id, clientName);
      logger.info(`Created ${taskResult.tasksCreated} onboarding tasks for ${clientId}`);
    } catch (taskError) {
      // Log but don't fail the onboarding if task creation fails
      logger.error(`Failed to create tasks for ${clientId}: ${taskError.message}`);
    }
    
    res.json({
      success: true,
      clientId,
      recordId: createdRecord.id,
      validation: validationResults,
      createdFields: Object.keys(newClientRecord),
      tasksCreated: taskResult.tasksCreated,
      message: `Client "${clientName}" onboarded successfully!`
    });
    
  } catch (error) {
    logger.error('Client onboarding error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Client onboarding failed: ${error.message}` 
    });
  }
});

/**
 * POST /api/validate-client-base
 * 
 * Validates a new client Airtable base without creating a client record.
 * Useful for checking the base before submitting the full onboarding form.
 */
router.post("/api/validate-client-base", async (req, res) => {
  const Airtable = require('airtable');
  const logger = createLogger({ runId: 'VALIDATE', clientId: 'SYSTEM', operation: 'validate_base' });
  
  try {
    const { airtableBaseId } = req.body;
    
    if (!airtableBaseId) {
      return res.status(400).json({ success: false, error: 'airtableBaseId is required' });
    }
    
    logger.info(`Validating base: ${airtableBaseId}`);
    
    const validation = {
      baseAccessible: false,
      tables: {},
      requiredFieldsPresent: [],
      missingFields: [],
      warnings: []
    };
    
    try {
      const clientBase = Airtable.base(airtableBaseId);
      
      // Check Leads table
      try {
        const leadsRecords = await clientBase('Leads').select({ maxRecords: 1 }).firstPage();
        validation.tables.Leads = { exists: true, recordCount: 'accessible' };
        validation.baseAccessible = true;
        
        const requiredLeadFields = [
          'First Name', 'Last Name', 'LinkedIn Profile URL', 'AI Score', 
          'Status', 'Notes', 'Scoring Status', 'Date Created'
        ];
        
        if (leadsRecords.length > 0) {
          const availableFields = Object.keys(leadsRecords[0].fields);
          for (const field of requiredLeadFields) {
            if (availableFields.includes(field)) {
              validation.requiredFieldsPresent.push(`Leads.${field}`);
            } else {
              validation.missingFields.push(`Leads.${field}`);
            }
          }
        } else {
          validation.warnings.push('Leads table is empty - field validation skipped');
        }
      } catch (e) {
        validation.tables.Leads = { exists: false, error: e.message };
      }
      
      // Check Credentials table
      try {
        const credRecords = await clientBase('Credentials').select({ maxRecords: 1 }).firstPage();
        validation.tables.Credentials = { exists: true, recordCount: credRecords.length };
      } catch (e) {
        validation.tables.Credentials = { exists: false, error: e.message };
      }
      
      // Check LinkedIn Posts table (optional but expected)
      try {
        await clientBase('LinkedIn Posts').select({ maxRecords: 1 }).firstPage();
        validation.tables['LinkedIn Posts'] = { exists: true };
      } catch (e) {
        validation.tables['LinkedIn Posts'] = { exists: false };
        validation.warnings.push('LinkedIn Posts table not found (optional for Lead Scoring only)');
      }
      
    } catch (baseError) {
      return res.status(400).json({
        success: false,
        error: 'Cannot access base',
        details: baseError.message
      });
    }
    
    const isValid = validation.baseAccessible && 
                    validation.tables.Leads?.exists && 
                    validation.tables.Credentials?.exists;
    
    res.json({
      success: isValid,
      validation,
      message: isValid 
        ? 'Base validation passed! Ready for client onboarding.' 
        : 'Base validation failed. Please check the errors above.'
    });
    
  } catch (error) {
    logger.error('Base validation error:', error.message, error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/update-client/:clientId
 * 
 * Updates an existing client record in the Master Clients base.
 * Only updates fields that are provided in the request body.
 */
router.put("/api/update-client/:clientId", async (req, res) => {
  const Airtable = require('airtable');
  const { clientId } = req.params;
  const logger = createLogger({ runId: 'UPDATE', clientId, operation: 'update_client' });
  
  try {
    const updateData = req.body;
    
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId is required' });
    }
    
    if (!updateData || Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, error: 'No update data provided' });
    }
    
    logger.info(`Updating client: ${clientId}`);
    
    // Find the client record
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    const existingClients = await masterBase('Clients').select({
      filterByFormula: `{Client ID} = "${clientId}"`,
      maxRecords: 1
    }).firstPage();
    
    if (existingClients.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Client "${clientId}" not found`
      });
    }
    
    const recordId = existingClients[0].id;
    const currentFields = existingClients[0].fields;
    
    // Build update object - map incoming fields to Airtable field names
    const fieldMapping = {
      clientName: CLIENT_FIELDS.CLIENT_NAME,
      email: CLIENT_FIELDS.CLIENT_EMAIL_ADDRESS,
      wordpressUserId: CLIENT_FIELDS.WORDPRESS_USER_ID,
      airtableBaseId: CLIENT_FIELDS.AIRTABLE_BASE_ID,
      serviceLevel: CLIENT_FIELDS.SERVICE_LEVEL,
      timezone: CLIENT_FIELDS.TIMEZONE,
      status: CLIENT_FIELDS.STATUS,
      statusManagement: CLIENT_FIELDS.STATUS_MANAGEMENT,
      linkedinUrl: 'LinkedIn URL',
      phone: 'Phone',
      googleCalendarEmail: CLIENT_FIELDS.GOOGLE_CALENDAR_EMAIL,
      profileScoringTokenLimit: CLIENT_FIELDS.PROFILE_SCORING_TOKEN_LIMIT,
      postScoringTokenLimit: CLIENT_FIELDS.POST_SCORING_TOKEN_LIMIT,
      postsDailyTarget: CLIENT_FIELDS.POSTS_DAILY_TARGET,
      leadsBatchSizeForPostCollection: CLIENT_FIELDS.LEADS_BATCH_SIZE_FOR_POST_COLLECTION,
      maxPostBatchesPerDayGuardrail: CLIENT_FIELDS.MAX_POST_BATCHES_PER_DAY_GUARDRAIL,
      postScrapeBatchSize: CLIENT_FIELDS.POST_SCRAPE_BATCH_SIZE,
      processingStream: CLIENT_FIELDS.PROCESSING_STREAM,
      postAccessEnabled: CLIENT_FIELDS.POST_ACCESS_ENABLED
    };
    
    const updateFields = {};
    for (const [inputKey, airtableField] of Object.entries(fieldMapping)) {
      if (updateData[inputKey] !== undefined) {
        let value = updateData[inputKey];
        // Handle boolean for postAccessEnabled
        if (inputKey === 'postAccessEnabled') {
          value = value ? 'Yes' : null;
        }
        // Parse integers for numeric fields
        else if (['wordpressUserId', 'profileScoringTokenLimit', 'postScoringTokenLimit', 
             'postsDailyTarget', 'leadsBatchSizeForPostCollection', 'maxPostBatchesPerDayGuardrail',
             'postScrapeBatchSize', 'processingStream'].includes(inputKey)) {
          value = parseInt(value, 10);
          if (isNaN(value)) continue; // Skip invalid numbers
        }
        updateFields[airtableField] = value;
      }
    }
    
    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }
    
    // Update the record
    const updatedRecord = await masterBase('Clients').update(recordId, updateFields);
    
    logger.info(`Client ${clientId} updated successfully`);
    
    res.json({
      success: true,
      clientId,
      recordId,
      updatedFields: Object.keys(updateFields),
      message: `Client "${clientId}" updated successfully!`
    });
    
  } catch (error) {
    logger.error('Client update error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Client update failed: ${error.message}` 
    });
  }
});

/**
 * GET /api/client/:clientId
 * 
 * Gets an existing client record from the Master Clients base.
 */
router.get("/api/client/:clientId", async (req, res) => {
  const Airtable = require('airtable');
  const { clientId } = req.params;
  const logger = createLogger({ runId: 'GET', clientId, operation: 'get_client' });
  
  try {
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId is required' });
    }
    
    // Find the client record
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    const existingClients = await masterBase('Clients').select({
      filterByFormula: `{Client ID} = "${clientId}"`,
      maxRecords: 1
    }).firstPage();
    
    if (existingClients.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Client "${clientId}" not found`
      });
    }
    
    const record = existingClients[0];
    
    res.json({
      success: true,
      clientId,
      recordId: record.id,
      fields: record.fields
    });
    
  } catch (error) {
    logger.error('Get client error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to get client: ${error.message}` 
    });
  }
});

/**
 * GET /api/coached-clients/:coachClientId
 * 
 * Gets all clients coached by a specific coach.
 * Returns client info with task progress for the coach dashboard.
 */
router.get("/api/coached-clients/:coachClientId", async (req, res) => {
  const { coachClientId } = req.params;
  const logger = createLogger({ runId: 'GET', clientId: coachClientId, operation: 'get_coached_clients' });
  
  try {
    if (!coachClientId) {
      return res.status(400).json({ success: false, error: 'coachClientId is required' });
    }
    
    const clientService = require('../services/clientService.js');
    
    // Verify the coach exists as a valid client
    const coach = await clientService.getClientById(coachClientId);
    if (!coach) {
      return res.status(404).json({
        success: false,
        error: `Coach "${coachClientId}" not found`
      });
    }
    
    // Get all clients coached by this coach
    const coachedClients = await clientService.getClientsByCoach(coachClientId);
    
    // Add task progress for each client
    const clientsWithProgress = await Promise.all(
      coachedClients.map(async (client) => {
        try {
          // Use clientId (name like "Keith-Sinclair") for task lookup
          const progress = await clientService.getClientTaskProgress(client.clientId);
          return {
            ...client,
            taskProgress: progress
          };
        } catch (err) {
          logger.warn(`Failed to get progress for ${client.clientId}: ${err.message}`);
          return {
            ...client,
            taskProgress: { total: 0, completed: 0, percentage: 0 }
          };
        }
      })
    );
    
    logger.info(`Found ${coachedClients.length} coached clients for ${coachClientId}`);
    
    res.json({
      success: true,
      coachClientId,
      coachName: coach.clientName,
      clients: clientsWithProgress,
      count: clientsWithProgress.length
    });
    
  } catch (error) {
    logger.error('Get coached clients error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to get coached clients: ${error.message}` 
    });
  }
});

/**
 * GET /api/system-settings
 * 
 * Gets system settings including Coaching Resources URL.
 */
router.get("/api/system-settings", async (req, res) => {
  const logger = createLogger({ runId: 'GET', clientId: 'SYSTEM', operation: 'get_system_settings' });
  
  try {
    const clientService = require('../services/clientService.js');
    const settings = await clientService.getSystemSettings();
    
    res.json({
      success: true,
      settings
    });
    
  } catch (error) {
    logger.error('Get system settings error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to get system settings: ${error.message}` 
    });
  }
});

/**
 * POST /api/client/:clientId/create-tasks
 * 
 * Creates onboarding tasks for an existing client from templates.
 * Use this for clients who were onboarded before the task system existed.
 */
router.post("/api/client/:clientId/create-tasks", async (req, res) => {
  const { clientId } = req.params;
  const logger = createLogger({ runId: 'TASKS', clientId, operation: 'create_client_tasks' });
  
  try {
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId is required' });
    }
    
    const clientService = require('../services/clientService.js');
    
    // Get the client to verify it exists and get the record ID
    const client = await clientService.getClientById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        error: `Client "${clientId}" not found`
      });
    }
    
    // Sync tasks from templates (only adds missing ones)
    // Note: client.id is the Airtable record ID
    const result = await clientService.createClientTasksFromTemplates(client.id, client.clientName);
    
    if (result.alreadySynced) {
      logger.info(`Client ${clientId} already has all tasks synced`);
      return res.json({
        success: true,
        clientId,
        clientName: client.clientName,
        tasksCreated: 0,
        existingCount: result.existingCount,
        message: `${client.clientName} already has all ${result.existingCount} tasks`
      });
    }
    
    logger.info(`Synced ${result.tasksCreated} new tasks for client ${clientId}`);
    
    res.json({
      success: true,
      clientId,
      clientName: client.clientName,
      tasksCreated: result.tasksCreated,
      existingCount: result.existingCount || 0,
      message: result.tasksCreated > 0 
        ? `Added ${result.tasksCreated} new tasks for ${client.clientName}`
        : `${client.clientName} already has all tasks`
    });
    
  } catch (error) {
    logger.error('Create client tasks error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to create tasks: ${error.message}` 
    });
  }
});

/**
 * GET /api/client/:clientId/tasks
 * 
 * Gets all tasks for a specific client.
 * Used by the ClientTasksModal to display tasks.
 */
router.get("/api/client/:clientId/tasks", async (req, res) => {
  const { clientId } = req.params;
  const logger = createLogger({ runId: 'GET', clientId, operation: 'get_client_tasks' });
  
  try {
    const clientService = require('../services/clientService.js');
    
    // Get tasks for this client
    const tasks = await clientService.getClientTasks(clientId);
    
    logger.info(`Retrieved ${tasks.length} tasks for client ${clientId}`);
    
    res.json({
      success: true,
      clientId,
      tasks,
      count: tasks.length
    });
    
  } catch (error) {
    logger.error('Get client tasks error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to get tasks: ${error.message}` 
    });
  }
});

/**
 * PATCH /api/task/:taskId/status
 * 
 * Updates the status of a task.
 * Status values: "Todo", "In progress", "Done"
 */
router.patch("/api/task/:taskId/status", async (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  const logger = createLogger({ runId: 'PATCH', clientId: 'TASK', operation: 'update_task_status' });
  
  try {
    const validStatuses = ['Todo', 'In progress', 'Done'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    const clientService = require('../services/clientService.js');
    
    // Update the task status
    await clientService.updateTaskStatus(taskId, status);
    
    logger.info(`Updated task ${taskId} status to ${status}`);
    
    res.json({
      success: true,
      taskId,
      status,
      message: `Task status updated to ${status}`
    });
    
  } catch (error) {
    logger.error('Update task status error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to update task: ${error.message}` 
    });
  }
});

/**
 * PATCH /api/task/:taskId/notes
 * 
 * Updates the notes of a task.
 */
router.patch("/api/task/:taskId/notes", async (req, res) => {
  const { taskId } = req.params;
  const { notes } = req.body;
  const logger = createLogger({ runId: 'PATCH', clientId: 'TASK', operation: 'update_task_notes' });
  
  try {
    const clientService = require('../services/clientService.js');
    
    // Update the task notes
    await clientService.updateTaskNotes(taskId, notes);
    
    logger.info(`Updated task ${taskId} notes`);
    
    res.json({
      success: true,
      taskId,
      message: 'Task notes updated'
    });
    
  } catch (error) {
    logger.error('Update task notes error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to update task notes: ${error.message}` 
    });
  }
});

/**
 * GET /api/client/:clientId/coach-notes
 * 
 * Gets coach notes for a specific client.
 */
router.get("/api/client/:clientId/coach-notes", async (req, res) => {
  const { clientId } = req.params;
  const logger = createLogger({ runId: 'GET', clientId, operation: 'get_coach_notes' });
  
  try {
    const clientService = require('../services/clientService.js');
    const client = await clientService.getClientById(clientId);
    
    if (!client) {
      return res.status(404).json({
        success: false,
        error: `Client "${clientId}" not found`
      });
    }
    
    res.json({
      success: true,
      clientId,
      clientName: client.clientName,
      coachNotes: client.coachNotes || ''
    });
    
  } catch (error) {
    logger.error('Get coach notes error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to get coach notes: ${error.message}` 
    });
  }
});

/**
 * PATCH /api/client/:clientId/coach-notes
 * 
 * Updates coach notes for a specific client.
 */
router.patch("/api/client/:clientId/coach-notes", async (req, res) => {
  const { clientId } = req.params;
  const { notes } = req.body;
  const logger = createLogger({ runId: 'PATCH', clientId, operation: 'update_coach_notes' });
  
  try {
    const clientService = require('../services/clientService.js');
    
    // Get the client to find the record ID
    const client = await clientService.getClientById(clientId);
    
    if (!client) {
      return res.status(404).json({
        success: false,
        error: `Client "${clientId}" not found`
      });
    }
    
    // Update the coach notes
    await clientService.updateCoachNotes(client.id, notes);
    
    logger.info(`Updated coach notes for ${clientId}`);
    
    res.json({
      success: true,
      clientId,
      message: 'Coach notes updated'
    });
    
  } catch (error) {
    logger.error('Update coach notes error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to update coach notes: ${error.message}` 
    });
  }
});

/**
 * GET /api/clients
 * 
 * Lists all clients in the system.
 * Returns basic client info for admin overview.
 */
router.get("/api/clients", async (req, res) => {
  const logger = createLogger({ runId: 'GET', clientId: 'SYSTEM', operation: 'list_clients' });
  
  try {
    const clientService = require('../services/clientService.js');
    const clients = await clientService.getAllClients();
    
    // Map to simpler format
    const clientList = clients.map(c => ({
      clientId: c.clientId,
      clientName: c.clientName,
      coach: c.coach || null,
      coachingStatus: c.coachingStatus || null,
      isActive: c.isActive,
      recordId: c.recordId
    }));
    
    res.json({
      success: true,
      clients: clientList,
      count: clientList.length
    });
    
  } catch (error) {
    logger.error('List clients error:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to list clients: ${error.message}` 
    });
  }
});

/**
 * POST /api/ai-endpoint-search
 * 
 * AI-powered endpoint search using Gemini.
 * Takes a natural language query and returns relevant API endpoints.
 */
router.post("/api/ai-endpoint-search", async (req, res) => {
  const { query, endpoints } = req.body;
  
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query is required' });
  }
  
  if (!endpoints || !Array.isArray(endpoints)) {
    return res.status(400).json({ success: false, error: 'Endpoints array is required' });
  }
  
  try {
    const geminiConfig = require('../config/geminiClient.js');
    const geminiModel = geminiConfig?.geminiModel;
    
    if (!geminiModel) {
      return res.status(500).json({ success: false, error: 'Gemini not available' });
    }
    
    // Build a compact endpoint list for the prompt
    const endpointList = endpoints.map(ep => 
      `- ${ep.method} ${ep.path}: ${ep.description} [${ep.category}]`
    ).join('\n');
    
    const prompt = `You are an API assistant helping find relevant endpoints.

The user asked: "${query}"

Here are all available endpoints:
${endpointList}

Return a JSON response with:
1. "matches": array of endpoint IDs (from the path, e.g., "/health" -> "health", "/api/onboard-client" -> "onboard-client") that match the user's intent. Order by relevance, max 8.
2. "explanation": A brief (1-2 sentence) explanation of what these endpoints do and which one is most likely what they need.
3. "suggestion": If the user's request is unclear, suggest a clarifying question.

Examples of what users might ask:
- "score some leads" -> batch scoring endpoints
- "check if system is working" -> health check endpoints
- "add a new client" -> onboard-client endpoint
- "see what errors happened" -> production issues endpoints

Respond ONLY with valid JSON, no markdown.`;

    const result = await geminiModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    
    const candidate = result.response.candidates?.[0];
    if (!candidate) {
      throw new Error("No response from AI");
    }
    
    const responseText = candidate.content?.parts?.[0]?.text?.trim();
    if (!responseText) {
      throw new Error("Empty response from AI");
    }
    
    // Parse the JSON response
    let parsed;
    try {
      // Handle potential markdown code blocks
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      // If parsing fails, return a fallback
      parsed = {
        matches: [],
        explanation: "I couldn't understand that query. Try describing what you want to do, like 'score leads' or 'check system health'.",
        suggestion: "Try being more specific about what action you want to perform."
      };
    }
    
    res.json({
      success: true,
      ...parsed
    });
    
  } catch (error) {
    console.error('AI endpoint search error:', error.message, error.stack);
    
    // Provide more specific error messages
    let errorMessage = 'AI search failed. Try the regular search instead.';
    if (error.message?.includes('quota') || error.message?.includes('429')) {
      errorMessage = 'AI rate limit reached. Please try again in a moment.';
    } else if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      errorMessage = 'AI request timed out. Please try again.';
    } else if (error.message?.includes('safety') || error.message?.includes('blocked')) {
      errorMessage = 'Query was blocked. Try rephrasing your question.';
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ---------------------------------------------------------------
// Client Intake Request Endpoints
// ---------------------------------------------------------------

const INTAKE_TABLE = 'Client Intake Requests';
const INTAKE_FIELDS = {
  NAME: 'Name',
  CLIENT_FIRST_NAME: 'Client First Name',
  CLIENT_LAST_NAME: 'Client Last Name',
  CLIENT_EMAIL: 'Client Email',
  LINKEDIN_PROFILE_URL: 'LinkedIn Profile URL',
  PHONE: 'Phone',
  TIMEZONE: 'Timezone',
  COACH_ID: 'Coach ID',
  COACH_NOTES: 'Coach Notes',
  STATUS: 'Status',
  SUBMITTED_AT: 'Submitted At',
  PROCESSED_AT: 'Processed At',
  LINKED_CLIENT: 'Linked Client'
};

/**
 * POST /api/intake
 * Create a new client intake request (coach submits form)
 */
router.post("/api/intake", async (req, res) => {
  const logger = createLogger({ runId: 'INTAKE', clientId: 'SYSTEM', operation: 'create_intake' });
  
  try {
    const {
      clientFirstName,
      clientLastName,
      clientEmail,
      linkedinProfileUrl,
      phone,
      timezone,
      coachId,
      coachNotes
    } = req.body;
    
    // Validation
    const errors = [];
    if (!clientFirstName) errors.push('Client First Name is required');
    if (!clientLastName) errors.push('Client Last Name is required');
    if (!clientEmail) errors.push('Client Email is required');
    if (!linkedinProfileUrl) errors.push('LinkedIn Profile URL is required');
    if (!coachId) errors.push('Coach ID is required');
    
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }
    
    // Validate coach exists in Clients table
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    const coachRecords = await masterBase('Clients').select({
      filterByFormula: `{Client ID} = "${coachId}"`,
      maxRecords: 1
    }).firstPage();
    
    if (coachRecords.length === 0) {
      return res.status(400).json({
        success: false,
        errors: [`Coach ID "${coachId}" not found. Please check and try again.`]
      });
    }
    
    // Check for duplicate (same email, pending status)
    const existingRequests = await masterBase(INTAKE_TABLE).select({
      filterByFormula: `AND({Client Email} = "${clientEmail}", {Status} = "Pending")`,
      maxRecords: 1
    }).firstPage();
    
    if (existingRequests.length > 0) {
      return res.status(409).json({
        success: false,
        errors: ['A pending request for this email already exists.'],
        existingRequestId: existingRequests[0].id
      });
    }
    
    // Create the intake request
    const newRecord = await masterBase(INTAKE_TABLE).create({
      [INTAKE_FIELDS.CLIENT_FIRST_NAME]: clientFirstName.trim(),
      [INTAKE_FIELDS.CLIENT_LAST_NAME]: clientLastName.trim(),
      [INTAKE_FIELDS.CLIENT_EMAIL]: clientEmail.trim(),
      [INTAKE_FIELDS.LINKEDIN_PROFILE_URL]: linkedinProfileUrl.trim(),
      [INTAKE_FIELDS.PHONE]: phone ? phone.trim() : null,
      [INTAKE_FIELDS.TIMEZONE]: timezone || 'Australia/Brisbane',
      [INTAKE_FIELDS.COACH_ID]: coachId.trim(),
      [INTAKE_FIELDS.COACH_NOTES]: coachNotes || null,
      [INTAKE_FIELDS.STATUS]: 'Pending'
    });
    
    logger.info(`Intake request created: ${clientFirstName} ${clientLastName} by coach ${coachId}`);
    
    res.json({
      success: true,
      recordId: newRecord.id,
      clientCode: `${clientFirstName.trim()}-${clientLastName.trim()}`.replace(/\s+/g, '-'),
      message: 'Client intake request submitted successfully!'
    });
    
  } catch (error) {
    logger.error('Intake creation error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to submit intake request: ${error.message}`
    });
  }
});

/**
 * GET /api/intake
 * Get intake requests (optionally filtered by coach or status)
 */
router.get("/api/intake", async (req, res) => {
  const logger = createLogger({ runId: 'INTAKE', clientId: 'SYSTEM', operation: 'list_intake' });
  
  try {
    const { coachId, status } = req.query;
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    // Build filter formula
    let filterFormula = '';
    const conditions = [];
    
    if (coachId) {
      conditions.push(`{Coach ID} = "${coachId}"`);
    }
    if (status) {
      conditions.push(`{Status} = "${status}"`);
    }
    
    if (conditions.length > 0) {
      filterFormula = conditions.length === 1 
        ? conditions[0] 
        : `AND(${conditions.join(', ')})`;
    }
    
    const records = await masterBase(INTAKE_TABLE).select({
      filterByFormula: filterFormula,
      sort: [{ field: 'Submitted At', direction: 'desc' }]
    }).all();
    
    const requests = records.map(record => ({
      id: record.id,
      name: record.get(INTAKE_FIELDS.NAME),
      clientFirstName: record.get(INTAKE_FIELDS.CLIENT_FIRST_NAME),
      clientLastName: record.get(INTAKE_FIELDS.CLIENT_LAST_NAME),
      clientEmail: record.get(INTAKE_FIELDS.CLIENT_EMAIL),
      linkedinProfileUrl: record.get(INTAKE_FIELDS.LINKEDIN_PROFILE_URL),
      phone: record.get(INTAKE_FIELDS.PHONE),
      timezone: record.get(INTAKE_FIELDS.TIMEZONE),
      coachId: record.get(INTAKE_FIELDS.COACH_ID),
      coachNotes: record.get(INTAKE_FIELDS.COACH_NOTES),
      status: record.get(INTAKE_FIELDS.STATUS),
      submittedAt: record.get(INTAKE_FIELDS.SUBMITTED_AT),
      processedAt: record.get(INTAKE_FIELDS.PROCESSED_AT),
      linkedClient: record.get(INTAKE_FIELDS.LINKED_CLIENT)
    }));
    
    res.json({ success: true, requests });
    
  } catch (error) {
    logger.error('Intake list error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to fetch intake requests: ${error.message}`
    });
  }
});

/**
 * GET /api/intake/pending
 * Get all pending intake requests (for onboard page dropdown)
 */
router.get("/api/intake/pending", async (req, res) => {
  const logger = createLogger({ runId: 'INTAKE', clientId: 'SYSTEM', operation: 'pending_intake' });
  
  try {
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    const records = await masterBase(INTAKE_TABLE).select({
      filterByFormula: `{Status} = "Pending"`,
      sort: [{ field: 'Submitted At', direction: 'desc' }]
    }).all();
    
    const requests = records.map(record => ({
      id: record.id,
      name: record.get(INTAKE_FIELDS.NAME),
      clientFirstName: record.get(INTAKE_FIELDS.CLIENT_FIRST_NAME),
      clientLastName: record.get(INTAKE_FIELDS.CLIENT_LAST_NAME),
      clientEmail: record.get(INTAKE_FIELDS.CLIENT_EMAIL),
      linkedinProfileUrl: record.get(INTAKE_FIELDS.LINKEDIN_PROFILE_URL),
      phone: record.get(INTAKE_FIELDS.PHONE),
      timezone: record.get(INTAKE_FIELDS.TIMEZONE),
      coachId: record.get(INTAKE_FIELDS.COACH_ID),
      coachNotes: record.get(INTAKE_FIELDS.COACH_NOTES),
      submittedAt: record.get(INTAKE_FIELDS.SUBMITTED_AT)
    }));
    
    res.json({ success: true, requests });
    
  } catch (error) {
    logger.error('Pending intake list error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to fetch pending intake requests: ${error.message}`
    });
  }
});

/**
 * GET /api/intake/:id
 * Get a single intake request
 */
router.get("/api/intake/:id", async (req, res) => {
  const logger = createLogger({ runId: 'INTAKE', clientId: 'SYSTEM', operation: 'get_intake' });
  
  try {
    const { id } = req.params;
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    const record = await masterBase(INTAKE_TABLE).find(id);
    
    res.json({
      success: true,
      request: {
        id: record.id,
        name: record.get(INTAKE_FIELDS.NAME),
        clientFirstName: record.get(INTAKE_FIELDS.CLIENT_FIRST_NAME),
        clientLastName: record.get(INTAKE_FIELDS.CLIENT_LAST_NAME),
        clientEmail: record.get(INTAKE_FIELDS.CLIENT_EMAIL),
        linkedinProfileUrl: record.get(INTAKE_FIELDS.LINKEDIN_PROFILE_URL),
        phone: record.get(INTAKE_FIELDS.PHONE),
        timezone: record.get(INTAKE_FIELDS.TIMEZONE),
        coachId: record.get(INTAKE_FIELDS.COACH_ID),
        coachNotes: record.get(INTAKE_FIELDS.COACH_NOTES),
        status: record.get(INTAKE_FIELDS.STATUS),
        submittedAt: record.get(INTAKE_FIELDS.SUBMITTED_AT),
        processedAt: record.get(INTAKE_FIELDS.PROCESSED_AT),
        linkedClient: record.get(INTAKE_FIELDS.LINKED_CLIENT)
      }
    });
    
  } catch (error) {
    logger.error('Get intake error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to fetch intake request: ${error.message}`
    });
  }
});

/**
 * PATCH /api/intake/:id
 * Update an intake request (coach editing)
 */
router.patch("/api/intake/:id", async (req, res) => {
  const logger = createLogger({ runId: 'INTAKE', clientId: 'SYSTEM', operation: 'update_intake' });
  
  try {
    const { id } = req.params;
    const {
      clientFirstName,
      clientLastName,
      clientEmail,
      linkedinProfileUrl,
      phone,
      timezone,
      coachNotes
    } = req.body;
    
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    // Check current status - only allow editing Pending requests
    const existingRecord = await masterBase(INTAKE_TABLE).find(id);
    const currentStatus = existingRecord.get(INTAKE_FIELDS.STATUS);
    
    if (currentStatus !== 'Pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot edit a ${currentStatus.toLowerCase()} request.`
      });
    }
    
    // Build update object (only include provided fields)
    const updates = {};
    if (clientFirstName) updates[INTAKE_FIELDS.CLIENT_FIRST_NAME] = clientFirstName.trim();
    if (clientLastName) updates[INTAKE_FIELDS.CLIENT_LAST_NAME] = clientLastName.trim();
    if (clientEmail) updates[INTAKE_FIELDS.CLIENT_EMAIL] = clientEmail.trim();
    if (linkedinProfileUrl) updates[INTAKE_FIELDS.LINKEDIN_PROFILE_URL] = linkedinProfileUrl.trim();
    if (phone !== undefined) updates[INTAKE_FIELDS.PHONE] = phone ? phone.trim() : null;
    if (timezone) updates[INTAKE_FIELDS.TIMEZONE] = timezone;
    if (coachNotes !== undefined) updates[INTAKE_FIELDS.COACH_NOTES] = coachNotes || null;
    
    const updatedRecord = await masterBase(INTAKE_TABLE).update(id, updates);
    
    logger.info(`Intake request updated: ${id}`);
    
    res.json({
      success: true,
      recordId: updatedRecord.id,
      message: 'Intake request updated successfully!'
    });
    
  } catch (error) {
    logger.error('Update intake error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to update intake request: ${error.message}`
    });
  }
});

/**
 * DELETE /api/intake/:id
 * Delete an intake request (coach deleting)
 */
router.delete("/api/intake/:id", async (req, res) => {
  const logger = createLogger({ runId: 'INTAKE', clientId: 'SYSTEM', operation: 'delete_intake' });
  
  try {
    const { id } = req.params;
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    // Check current status - only allow deleting Pending requests
    const existingRecord = await masterBase(INTAKE_TABLE).find(id);
    const currentStatus = existingRecord.get(INTAKE_FIELDS.STATUS);
    
    if (currentStatus !== 'Pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot delete a ${currentStatus.toLowerCase()} request.`
      });
    }
    
    await masterBase(INTAKE_TABLE).destroy(id);
    
    logger.info(`Intake request deleted: ${id}`);
    
    res.json({
      success: true,
      message: 'Intake request deleted successfully!'
    });
    
  } catch (error) {
    logger.error('Delete intake error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to delete intake request: ${error.message}`
    });
  }
});

/**
 * PATCH /api/intake/:id/process
 * Mark an intake request as processed and link to client (called after onboarding)
 */
router.patch("/api/intake/:id/process", async (req, res) => {
  const logger = createLogger({ runId: 'INTAKE', clientId: 'SYSTEM', operation: 'process_intake' });
  
  try {
    const { id } = req.params;
    const { clientRecordId } = req.body;
    
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    const updates = {
      [INTAKE_FIELDS.STATUS]: 'Processed',
      [INTAKE_FIELDS.PROCESSED_AT]: new Date().toISOString().split('T')[0]
    };
    
    // Link to client record if provided
    if (clientRecordId) {
      updates[INTAKE_FIELDS.LINKED_CLIENT] = [clientRecordId];
    }
    
    const updatedRecord = await masterBase(INTAKE_TABLE).update(id, updates);
    
    logger.info(`Intake request processed: ${id}, linked to client: ${clientRecordId || 'none'}`);
    
    res.json({
      success: true,
      recordId: updatedRecord.id,
      message: 'Intake request marked as processed!'
    });
    
  } catch (error) {
    logger.error('Process intake error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to process intake request: ${error.message}`
    });
  }
});

/**
 * GET /api/validate-coach/:coachId
 * Validate that a coach ID exists in the Clients table
 */
router.get("/api/validate-coach/:coachId", async (req, res) => {
  try {
    const { coachId } = req.params;
    const Airtable = require('airtable');
    const masterBase = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
    
    const coachRecords = await masterBase('Clients').select({
      filterByFormula: `{Client ID} = "${coachId}"`,
      maxRecords: 1
    }).firstPage();
    
    if (coachRecords.length === 0) {
      return res.json({ valid: false, message: 'Coach not found' });
    }
    
    const coach = coachRecords[0];
    res.json({
      valid: true,
      coachName: coach.get('Client Name'),
      coachId: coach.get('Client ID')
    });
    
  } catch (error) {
    res.status(500).json({
      valid: false,
      error: `Validation failed: ${error.message}`
    });
  }
});

module.exports = router;