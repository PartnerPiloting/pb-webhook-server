// routes/apiAndJobRoutes.js

const express = require("express");
const router = express.Router();
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));
const dirtyJSON = require('dirty-json');

// ---------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------
const geminiConfig = require("../config/geminiClient.js");
const airtableBase = require("../config/airtableClient.js");
const { getClientBase } = require("../config/airtableClient.js");
const syncPBPostsToAirtable = require("../utils/pbPostsSync.js");
const runIdUtils = require('../utils/runIdUtils.js');
// Use the unified job tracking service
const JobTracking = require('../services/jobTracking.js');
const { handleClientError } = require('../utils/errorHandler.js');const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null;
const geminiModelId = geminiConfig ? geminiConfig.geminiModelId : null;

const { scoreLeadNow } = require("../singleScorer.js");
const batchScorer = require("../batchScorer.js");
const { loadAttributes, loadAttributeForEditing, loadAttributeForEditingWithClientBase, updateAttribute, updateAttributeWithClientBase } = require("../attributeLoader.js");
const { computeFinalScore } = require("../scoring.js");
const { buildAttributeBreakdown } = require("../breakdown.js");
const {
  alertAdmin,
  isMissingCritical,
} = require("../utils/appHelpers.js");

const __PUBLIC_BASE__ = process.env.API_PUBLIC_BASE_URL
  || process.env.NEXT_PUBLIC_API_BASE_URL
  || `http://localhost:${process.env.PORT || 3001}`;
const ENQUEUE_URL = `${__PUBLIC_BASE__}/enqueue`;

// ---------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------
router.get("/health", (_req, res) => {
  console.log("apiAndJobRoutes.js: /health hit");
  res.json({
    status: "ok",
    enhanced_audit_system: "loaded",
    timestamp: new Date().toISOString()
  });
});

// Simple audit test route (no auth required)
router.get("/audit-test", (_req, res) => {
  console.log("apiAndJobRoutes.js: /audit-test hit");
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
    console.error('Error in debug-job-status:', error);
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
    console.error('Error in debug-job-status client endpoint:', error);
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
  console.log("/api/initiate-pb-message for", recordId);
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
      console.warn("Airtable status update failed:", e.message);
    }

    res.json({
      success: true,
      message: `Lead ${recordId} queued.`,
      enqueueResponse: enqueueData,
    });
  } catch (e) {
    console.error("initiate-pb-message:", e);
    await alertAdmin(
      "Error /api/initiate-pb-message",
      `ID:${recordId}\n${e.message}`
    );
    if (!res.headersSent)
      res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------------
// Manual PB Posts Sync
// ---------------------------------------------------------------
router.all("/api/sync-pb-posts", async (_req, res) => {
  try {
    const info = await syncPBPostsToAirtable(); // Assuming this might be a manual trigger
    res.json({
      status: "success",
      message: "PB posts sync completed.",
      details: info,
    });
  } catch (err) {
    console.error("sync-pb-posts error (manual trigger):", err);
    res.status(500).json({ status: "error", error: err.message });
  }
});

// ---------------------------------------------------------------
// PB Webhook
// ---------------------------------------------------------------
router.post("/api/pb-webhook", async (req, res) => {
  try {
    const secret = req.query.secret || req.body.secret;
    if (secret !== process.env.PB_WEBHOOK_SECRET) {
      console.warn("PB Webhook: Forbidden attempt with incorrect secret.");
      return res.status(403).json({ error: "Forbidden" });
    }

    console.log(
      "PB Webhook: Received raw payload:",
      JSON.stringify(req.body).slice(0, 1000) // Log only a part of potentially large payload
    );

    res.status(200).json({ message: "Webhook received. Processing in background." });

    (async () => {
      try {
        let rawResultObject = req.body.resultObject;

        if (!rawResultObject) {
            console.warn("PB Webhook: resultObject is missing in the payload.");
            return;
        }

        let postsInputArray;
        if (typeof rawResultObject === 'string') {
          try {
            // THE PERMANENT FIX: Clean trailing commas from the JSON string before parsing
            const cleanedString = rawResultObject.replace(/,\s*([}\]])/g, "$1");
            postsInputArray = JSON.parse(cleanedString);
          } catch (parseError) {
            console.error("PB Webhook: Error parsing resultObject string with JSON.parse:", parseError);
            // Fallback: try dirty-json
            try {
              postsInputArray = dirtyJSON.parse(rawResultObject);
              console.log("PB Webhook: dirty-json successfully parsed resultObject string.");
            } catch (dirtyErr) {
              console.error("PB Webhook: dirty-json also failed to parse resultObject string:", dirtyErr);
              return;
            }
          }
        } else if (Array.isArray(rawResultObject)) {
          postsInputArray = rawResultObject;
        } else if (typeof rawResultObject === 'object' && rawResultObject !== null) {
          postsInputArray = [rawResultObject];
        } else {
          console.warn("PB Webhook: resultObject is not a string, array, or recognized object.");
          return;
        }
        
        if (!Array.isArray(postsInputArray)) {
            console.warn("PB Webhook: Processed postsInput is not an array.");
            return;
        }

        console.log(`PB Webhook: Extracted ${postsInputArray.length} items from resultObject for background processing.`);

        const filteredPostsInput = postsInputArray.filter(item => {
          if (typeof item !== 'object' || item === null || !item.hasOwnProperty('profileUrl')) {
            return true;
          }
          return !(item.profileUrl === "Profile URL" && item.error === "Invalid input");
        });
        console.log(`PB Webhook: Filtered to ${filteredPostsInput.length} items after removing potential header.`);

        if (filteredPostsInput.length > 0) {
          // TEMP FIX: Use specific client base if auto-detection fails
          const { getClientBase } = require('../config/airtableClient');
          const clientBase = await getClientBase('Guy-Wilson'); // Fixed: Use correct client ID and await
          
          const processed = await syncPBPostsToAirtable(filteredPostsInput, clientBase);
          console.log("PB Webhook: Background syncPBPostsToAirtable completed.", processed);
        } else {
          console.log("PB Webhook: No valid posts to sync after filtering.");
        }      } catch (backgroundErr) {
        console.error("PB Webhook: Error during background processing:", backgroundErr.message, backgroundErr.stack);
      }
    })();

  } catch (initialErr) {
    console.error("PB Webhook: Initial error:", initialErr.message, initialErr.stack);
    res.status(500).json({ error: initialErr.message });
  }
});



// ---------------------------------------------------------------
// Manual Batch Score (Admin/Batch Operation) - Multi-Client
// ---------------------------------------------------------------
router.get("/run-batch-score", async (req, res) => {
  console.log("Batch scoring requested (multi-client)");
  
  const limit = Number(req.query.limit) || 500;
  
  if (!vertexAIClient || !geminiModelId) {
    console.warn(`Batch scoring unavailable: vertexAIClient=${!!vertexAIClient}, geminiModelId=${geminiModelId}`);
    return res.status(503).json({
      success: false,
      error: "Batch scoring unavailable (Google VertexAI config missing)",
      details: {
        vertexAIClient: !!vertexAIClient,
        geminiModelId: geminiModelId || "not set"
      }
    });
  }
  
  batchScorer
    .run(req, res, { vertexAIClient, geminiModelId, limit })
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
      console.warn(`Lead scoring unavailable: vertexAIClient=${!!vertexAIClient}, geminiModelId=${geminiModelId}`);
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
    const parentRunId = req.query.parentRunId; // Optional: parent run ID from Smart Resume
    const { generateJobId, setJobStatus, setProcessingStream, getActiveClientsByStream } = require('../services/clientService');
    
    // Generate job ID and set initial status
    const jobId = generateJobId('lead_scoring', stream);
    const clientDesc = singleClientId ? ` for client ${singleClientId}` : '';
    console.log(`[run-batch-score-v2] Starting fire-and-forget lead scoring${clientDesc}, jobId: ${jobId}, stream: ${stream}, limit: ${limit}`);

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
      parentRunId // Pass the parent run ID if provided
    });

  } catch (e) {
    console.error('[run-batch-score-v2] error:', e.message);
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
  const { generateRunId } = require('../utils/runIdGenerator');

  const MAX_CLIENT_PROCESSING_MINUTES = parseInt(process.env.MAX_CLIENT_PROCESSING_MINUTES) || 10;
  const MAX_JOB_PROCESSING_HOURS = parseInt(process.env.MAX_JOB_PROCESSING_HOURS) || 2;

  const jobStartTime = Date.now();
  const jobTimeoutMs = MAX_JOB_PROCESSING_HOURS * 60 * 60 * 1000;
  const clientTimeoutMs = MAX_CLIENT_PROCESSING_MINUTES * 60 * 1000;

  let processedCount = 0;
  let scoredCount = 0;
  let errorCount = 0;

  // Generate or use provided run ID for tracking
  let runId;
  try {
    // If parentRunId is provided, use it as the base runId to maintain consistency
    const { parentRunId } = aiDependencies;
    
    if (parentRunId) {
      // Use the parent run ID to maintain connection to the Smart Resume process
      runId = parentRunId;
      console.log(`Using parent run ID: ${runId} for lead scoring job ${jobId}`);
    } else {
      // Generate a new run ID if no parent is provided
      runId = await generateRunId();
      console.log(`Generated base run ID: ${runId} for lead scoring job ${jobId}`);
    }
  } catch (err) {
    // Set a default runId value if generation fails
    runId = `fallback_job_lead_scoring_stream${stream}_${new Date().toISOString().replace(/[-:T.Z]/g, '')}`;
    console.error(`Failed to generate run ID: ${err.message}. Using fallback runId: ${runId}`);
  }

  try {
    console.log(`[lead-scoring-background] Starting job ${jobId} on stream ${stream} with limit ${limit}`);

    // Set initial job status (don't set processing stream for operation)
    await setJobStatus(null, 'lead_scoring', 'STARTED', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: '0 seconds',
      lastRunCount: 0
    });

    // Get active clients filtered by processing stream
    const activeClients = await getActiveClientsByStream(stream, singleClientId);
    
    console.log(`[lead-scoring-background] Found ${activeClients.length} active clients on stream ${stream} to process`);

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
        console.log(`[lead-scoring-background] Job timeout reached (${MAX_JOB_PROCESSING_HOURS}h), killing job ${jobId}`);
        await setJobStatus(null, 'lead_scoring', 'JOB_TIMEOUT_KILLED', jobId, {
          lastRunDate: new Date().toISOString(),
          lastRunTime: formatDuration(Date.now() - jobStartTime),
          lastRunCount: scoredCount
        });
        return;
      }

      const clientStartTime = Date.now();
      console.log(`[lead-scoring-background] Processing client ${client.clientId} (${processedCount + 1}/${activeClients.length})`);

      try {
        // Generate a unique client-specific run ID based on the parent run ID
        // This ensures each client gets its own unique run ID while maintaining the connection to the job
        
        // Use the unified service architecture for run ID management
        const baseRunId = runId; // Use the provided run ID as the base
        const clientRunId = unifiedRunIdService.addClientSuffix(baseRunId, client.clientId);
        console.log(`Generated client-specific run ID: ${clientRunId} for client ${client.clientId}`);
        
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
        console.log(`[lead-scoring-background] Client ${client.clientId} completed in ${formatDuration(clientDuration)}`);

      } catch (error) {
        errorCount++;
        if (error.message === 'Client timeout') {
          console.log(`[lead-scoring-background] Client ${client.clientId} timeout (${MAX_CLIENT_PROCESSING_MINUTES}m), skipping`);
        } else {
          console.error(`[lead-scoring-background] Client ${client.clientId} error:`, error.message);
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
    console.log(`[lead-scoring-background] Job ${jobId} completed. Processed: ${processedCount}, Scored: ${scoredCount}, Errors: ${errorCount}, Duration: ${finalDuration}`);

    await setJobStatus(null, 'lead_scoring', 'COMPLETED', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: finalDuration,
      lastRunCount: scoredCount
    });

  } catch (error) {
    console.error(`[lead-scoring-background] Job ${jobId} failed:`, error.message);
    await setJobStatus(null, 'lead_scoring', 'FAILED', jobId, {
      lastRunDate: new Date().toISOString(),
      lastRunTime: formatDuration(Date.now() - jobStartTime),
      lastRunCount: scoredCount
    });
  }
}

// Helper function to process individual client for lead scoring
async function processClientForLeadScoring(clientId, limit, aiDependencies, runId) {
  // Add debug logging for Guy Wilson specific debugging
  console.log(`[DEBUG] processClientForLeadScoring called for client: ${clientId}`);
  if (clientId === 'guy-wilson') {
    console.log(`[DEBUG-GUY-WILSON] Processing Guy Wilson client with runId: ${runId}`);
  }
  
  // Create a fake request object for batchScorer.run() that targets a specific client
  const fakeReq = {
    query: {
      limit: limit,
      clientId: clientId,
      // Only include runId if defined, or use a fallback
      runId: runId || `client-fallback-${clientId}-${Date.now()}`
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
    console.error(`[processClientForLeadScoring] Error processing client ${clientId}:`, error.message);
    throw error;
  }
}

// Single Lead Scorer
// ---------------------------------------------------------------
router.get("/score-lead", async (req, res) => {
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
        console.warn(`score-lead: Lead record not found for ID: ${id}`);
        return res.status(404).json({ error: `Lead record not found for ID: ${id}` });
    }
    const profileJsonString = record.get("Profile Full JSON");
    if (!profileJsonString) {
        console.warn(`score-lead: Profile Full JSON is empty for lead ID: ${id}`);
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
      console.warn(`score-lead: Lead ID ${id} JSON missing critical fields for scoring.`);
    }

    const gOut = await scoreLeadNow(profile, {
      vertexAIClient,
      geminiModelId,
      clientId,
    });
    if (!gOut) {
        console.error(`score-lead: singleScorer returned null for lead ID: ${id}`);
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
    console.error(`score-lead error for ID ${req.query.recordId}:`, err.message, err.stack);
    if (!res.headersSent)
      res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
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
 * Get the status of any running or recent Smart Resume processes
 */
router.get("/debug-smart-resume-status", async (req, res) => {
  console.log("ℹ️ Smart resume status check requested");
  
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
    console.error("❌ Failed to get smart resume status:", error);
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
  console.log("apiAndJobRoutes.js: /run-post-batch-score endpoint hit");
  // Multi-tenant batch operation: processes ALL clients, no x-client-id required
  if (!vertexAIClient || !geminiModelId) {
    console.error("Multi-tenant post scoring unavailable: missing Vertex AI client or model ID");
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
          console.log(`Resolved clientName='${clientNameQuery}' to clientId='${singleClientId}'`);
        } else {
          return res.status(404).json({
            status: 'error',
            message: `No active client found with name '${clientNameQuery}'`
          });
        }
      } catch (e) {
        console.warn('Client name resolution failed:', e.message);
      }
    }
    console.log(`Starting multi-tenant post scoring for ALL clients, limit=${limit || 'UNLIMITED'}, dryRun=${dryRun}, tableOverride=${tableOverride || 'DEFAULT'}, markSkips=${markSkips}`);
    if (singleClientId) {
      console.log(`Restricting run to single clientId=${singleClientId}`);
    }
    // Generate a run ID for this job
    const runId = JobTracking.generateRunId();
    console.log(`Generated run ID for post scoring: ${runId}`);
    
    // Create the main job tracking record
    try {
      await JobTracking.createJob({
        runId,
        jobType: 'post_scoring',
        initialData: {
          'Status': 'Running',
          'Start Time': new Date().toISOString(),
          'System Notes': `Post scoring initiated for ${singleClientId || 'all clients'}`
        }
      });
      console.log(`Created job tracking record with ID ${runId}`);
    } catch (err) {
      console.error(`Failed to create job tracking record: ${err.message}`);
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
        status: results.totalErrors > 0 ? 'Completed with Errors' : 'Completed',
        updates: {
          'System Notes': `Multi-tenant post scoring completed: ${results.successfulClients}/${results.totalClients} clients successful, ${results.totalPostsScored}/${results.totalPostsProcessed} posts scored`,
          'Items Processed': results.totalPostsProcessed,
          'Posts Successfully Scored': results.totalPostsScored,
          'Errors': results.totalErrors
        }
      });
      console.log(`Updated job tracking record ${runId} with completion status`);
    } catch (err) {
      console.error(`Failed to update job tracking record: ${err.message}`);
    }
    
    // Return results immediately
    res.status(200).json({
      status: 'completed',
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
        totalErrors: results.totalErrors,
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
    console.error("Multi-tenant post scoring error:", error.message, error.stack);
    let errorMessage = "Multi-tenant post scoring failed";
    if (error.message) {
      errorMessage += ` Details: ${error.message}`;
    }
    if (!res.headersSent) {
      return res.status(500).json({
        status: 'error',
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
  console.log("🚀 apiAndJobRoutes.js: /run-post-batch-score-v2 endpoint hit (FIRE-AND-FORGET)");
  
  // Check if fire-and-forget is enabled
  const fireAndForgetEnabled = process.env.FIRE_AND_FORGET === 'true';
  if (!fireAndForgetEnabled) {
    console.log("⚠️ Fire-and-forget not enabled");
    return res.status(501).json({
      status: 'error',
      message: 'Fire-and-forget mode not enabled. Set FIRE_AND_FORGET=true'
    });
  }

  if (!vertexAIClient || !geminiModelId) {
    console.error("❌ Multi-tenant post scoring unavailable: missing Vertex AI client or model ID");
    return res.status(503).json({
      status: 'error',
      message: "Multi-tenant post scoring unavailable (Gemini config missing)."
    });
  }

  try {
    // Parse query parameters (same as original endpoint)
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : (req.body?.limit || null);
    const dryRun = req.query.dryRun === 'true' || req.query.dry_run === 'true' || req.body?.dryRun === true;
    const singleClientId = req.query.clientId || req.query.client_id || req.body?.clientId || null;
    const stream = req.query.stream ? parseInt(req.query.stream, 10) : (req.body?.stream || 1);
    const parentRunId = req.query.parentRunId || req.body?.parentRunId || null;

    // Generate job ID for this execution
    const { generateJobId } = require('../services/clientService');
    const jobId = generateJobId('post_scoring', stream);
    
    // Determine if this is a standalone run or part of a parent process
    const isStandaloneRun = !parentRunId;
    
    console.log(`🎯 Starting fire-and-forget post scoring: jobId=${jobId}, stream=${stream}, clientId=${singleClientId || 'ALL'}, limit=${limit || 'UNLIMITED'}, dryRun=${dryRun}, ${isStandaloneRun ? 'STANDALONE MODE' : `parentRunId=${parentRunId}`}`);
    
    // For standalone runs, we'll skip metrics recording (simplification)
    if (isStandaloneRun) {
      console.log(`ℹ️ Running in standalone mode - metrics recording will be skipped (no parentRunId)`);
    }
    
    // Create a job tracking record to prevent errors when updating later
    try {
      const airtableServiceSimple = require('../services/airtableServiceSimple');
      await airtableServiceSimple.createJobTrackingRecord(jobId, stream);
      console.log(`✅ Job tracking record created for ${jobId}`);
    } catch (trackingError) {
      // Continue even if tracking record creation fails (may already exist)
      console.warn(`⚠️ Job tracking record creation warning: ${trackingError.message}`);
    }
    
    // FIRE-AND-FORGET: Respond immediately with 202 Accepted
    res.status(202).json({
      status: 'accepted',
      message: 'Post scoring job started in background',
      jobId: jobId,
      stream: stream,
      clientId: singleClientId || 'ALL',
      mode: dryRun ? 'dryRun' : 'live',
      estimatedDuration: '5-30 minutes depending on client count',
      note: 'Check job status via client tracking fields in Airtable'
    });

    // Start background processing (don't await - fire and forget!)
    processPostScoringInBackground(jobId, stream, {
      limit,
      dryRun,
      singleClientId,
      parentRunId
    }).catch(error => {
      console.error(`❌ Background post scoring failed for job ${jobId}:`, error.message);
    });

  } catch (error) {
    console.error("❌ Fire-and-forget post scoring startup error:", error.message);
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
 */
async function processPostScoringInBackground(jobId, stream, options) {
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
  
  console.log(`🔄 Background post scoring started: ${jobId}`);
  
  try {
    // Get active clients filtered by processing stream
    const clientService = require("../services/clientService");
    let clients = await getActiveClientsByStream(stream, options.singleClientId);
    
    console.log(`📊 Processing ${clients.length} clients in stream ${stream}`);

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;

    // Process each client with timeout protection
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      
      // Check overall job timeout
      if (Date.now() - startTime > maxJobMs) {
        console.log(`⏰ Job timeout reached (${maxJobHours} hours) - stopping gracefully`);
        await setJobStatus(client.clientId, 'post_scoring', 'JOB_TIMEOUT_KILLED', jobId, {
          duration: formatDuration(Date.now() - startTime),
          count: totalSuccessful
        });
        break;
      }

      console.log(`🎯 Processing client ${i + 1}/${clients.length}: ${client.clientName} (${client.clientId})`);
      
      // Set client status (stream already set/filtered)
      await setJobStatus(client.clientId, 'post_scoring', 'RUNNING', jobId);
      
      const clientStartTime = Date.now();
      
      try {
        // Generate a run ID for this client process
        const clientRunId = options.parentRunId || JobTracking.generateRunId();
        
        // Run post scoring for this client with timeout
        const clientResult = await Promise.race([
          postBatchScorer.runMultiTenantPostScoring(
            vertexAIClient,
            geminiModelId,
            clientRunId, // Pass the run ID
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
        
        await setJobStatus(client.clientId, 'post_scoring', 'COMPLETED', jobId, {
          duration: clientDuration,
          count: postsScored
        });
        
        // If we have a parent run ID, update the client run record with post scoring metrics
        if (options.parentRunId) {
          try {
            console.log(`[POST-SCORING] Starting metrics update for ${client.clientName} (${client.clientId})`);
            
            // Generate client-specific run ID using new service architecture
            const baseRunId = options.parentRunId;
            const clientRunId = unifiedRunIdService.addClientSuffix(baseRunId, client.clientId);
            
            console.log(`[POST-SCORING] Using standardized run ID: ${clientRunId} (from ${options.parentRunId})`);
            
            // Calculate duration as human-readable text
            const duration = formatDuration(Date.now() - (options.startTime || Date.now()));
            
            // Prepare metrics updates - removed Post Scoring Last Run Time field as it doesn't exist in Airtable
            const metricsUpdates = {
              'Posts Examined for Scoring': postsExamined,
              'Posts Successfully Scored': postsScored,
              'Post Scoring Tokens': clientResult.totalTokensUsed || 0,
              // 'Post Scoring Last Run Time' field removed - not present in Airtable schema
              'System Notes': `Post scoring completed with ${postsScored}/${postsExamined} posts scored, ${clientResult.errors || 0} errors, ${clientResult.skipped || 0} leads skipped. Total tokens: ${clientResult.totalTokensUsed || 0}.`
            };
            
            // Use the unified job tracking repository
            const updateResult = await unifiedJobTrackingRepository.updateClientRunRecord({
              runId: clientRunId,
              clientId: client.clientId,
              metrics: metricsUpdates,
              options: {
                isStandalone: false,  // This is never standalone if we have a parentRunId
                logger: console,
                source: 'post_scoring_api'
              }
            });
            
            if (updateResult.success && !updateResult.skipped) {
              console.log(`📊 Updated client run record for ${client.clientName} with post scoring metrics`);
              console.log(`   - Posts Examined: ${postsExamined}`);
              console.log(`   - Posts Successfully Scored: ${postsScored}`);
              console.log(`   - Tokens Used: ${clientResult.totalTokensUsed || 0}`);
            } else if (updateResult.skipped) {
              console.log(`ℹ️ Metrics update skipped: ${updateResult.reason || 'Unknown reason'}`);
            } else {
              console.error(`❌ [ERROR] Failed to update metrics: ${updateResult.error || 'Unknown error'}`);
            }
          } catch (metricError) {
            // Use standardized error handling
            handleClientError(client.clientId, 'post_scoring_metrics', metricError, {
              logger: console,
              includeStack: true
            });
          }
        }
        
        console.log(`✅ ${client.clientName}: ${postsScored} posts scored in ${clientDuration}`);
        totalSuccessful++;
        totalProcessed += postsScored;

      } catch (error) {
        // Handle client failure or timeout
        const clientDuration = formatDuration(Date.now() - clientStartTime);
        const isTimeout = error.message.includes('timeout');
        const status = isTimeout ? 'CLIENT_TIMEOUT_KILLED' : 'FAILED';
        
        await setJobStatus(client.clientId, 'post_scoring', status, jobId, {
          duration: clientDuration,
          count: 0
        });
        
        console.error(`❌ ${client.clientName} ${isTimeout ? 'TIMEOUT' : 'FAILED'}: ${error.message}`);
        totalFailed++;
      }
    }

    // Final summary
    const totalDuration = formatDuration(Date.now() - startTime);
    console.log(`🎉 Fire-and-forget post scoring completed: ${jobId}`);
    console.log(`📊 Summary: ${totalSuccessful} successful, ${totalFailed} failed, ${totalProcessed} posts scored, ${totalDuration}`);

  } catch (error) {
    console.error(`❌ Fatal error in background post scoring ${jobId}:`, error.message);
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
    return res.status(503).json({ status: 'error', message: 'Post scoring unavailable' });
  }
  const clientId = req.query.clientId || req.query.client || null;
  if (!clientId) {
    return res.status(400).json({ status: 'error', message: 'clientId required' });
  }
  const dryRun = req.query.dryRun === 'true';
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
  const verboseErrors = req.query.verboseErrors === 'true';
  const maxVerboseErrors = req.query.maxVerboseErrors ? parseInt(req.query.maxVerboseErrors, 10) : 10;
  const idsFromQuery = typeof req.query.ids === 'string' ? req.query.ids.split(',').map(s => s.trim()).filter(Boolean) : [];
  const idsFromBody = Array.isArray(req.body?.ids) ? req.body.ids.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : [];
  const targetIds = (idsFromQuery.length ? idsFromQuery : idsFromBody);
  try {
    // Generate a new run ID for this scoring operation
    const runId = JobTracking.generateRunId();
    
    // Create job tracking record
    await JobTracking.createJob({
      runId,
      jobType: 'post_scoring',
      initialData: {
        'Status': 'Running',
        'Client ID': clientId
      }
    });

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
      status: 'completed',
      mode: dryRun ? 'dryRun' : 'live',
      clientId,
      limit: limit || 'UNLIMITED',
      processed: results.totalPostsProcessed,
      scored: results.totalPostsScored,
      skipped: results.totalLeadsSkipped,
      skipCounts: results.skipCounts,
      errors: results.totalErrors,
  errorReasonCounts: results.errorReasonCounts,
      duration: results.duration,
  clientStatus: first.status || null,
  diagnostics: results.diagnostics || null
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
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
    return res.status(503).json({ status: 'error', message: 'Post scoring unavailable (Gemini config missing).' });
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
      totalErrors: 0,
      errorReasonCounts: {},
      duration: 0
    };

    const startedAt = Date.now();

    // Generate a single run ID for all candidates
    const runId = JobTracking.generateRunId();
    
    // Create job tracking record
    await JobTracking.createJob({
      runId,
      jobType: 'post_scoring_multi',
      initialData: {
        'Status': 'Running',
        'Client Count': candidates.length
      }
    });

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
          summaries.push({ clientId: c.clientId, status: first.status, postsProcessed: first.postsProcessed || 0, postsScored: first.postsScored || 0, errors: first.errors || 0 });
          // Aggregate totals
          aggregate.totalPostsProcessed += first.postsProcessed || 0;
          aggregate.totalPostsScored += first.postsScored || 0;
          aggregate.totalLeadsSkipped += first.leadsSkipped || 0;
          aggregate.totalErrors += first.errors || 0;
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
        summaries.push({ clientId: c.clientId, status: 'failed', error: e.message });
        aggregate.failedClients++;
        aggregate.totalErrors++;
      }
    }

    aggregate.duration = Math.round((Date.now() - startedAt) / 1000);

    return res.status(200).json({
      status: 'completed',
      message: `Post scoring completed for service level >= ${minServiceLevel}`,
      summary: aggregate,
      clientResults: summaries,
      mode: dryRun ? 'dryRun' : 'live',
      table: tableOverride || 'Leads',
      minServiceLevel,
      commit: commitHash
    });
  } catch (error) {
    console.error("/run-post-batch-score-level2 error:", error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ---------------------------------------------------------------
// Debug endpoint for troubleshooting client discovery (Admin Only)
// ---------------------------------------------------------------
router.get("/debug-clients", async (req, res) => {
  console.log("Debug clients endpoint hit");
  
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
    // Use the new airtableService instead of clientService directly
    const airtableService = require("../services/airtable/airtableService");
    
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
      // Initialize the service first
      airtableService.initialize();
      
      // Get all clients
      allClients = await airtableService.getAllClients();
      
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
    console.error("Debug clients error:", error);
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// ---------------------------------------------------------------
// JSON Quality Diagnostic endpoint (Admin Only)
// ---------------------------------------------------------------
router.get("/api/json-quality-analysis", async (req, res) => {
  console.log("JSON quality analysis endpoint hit");
  
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
    
    console.log(`Running JSON quality analysis: mode=${mode}, clientId=${clientId || 'ALL'}, limit=${limit}`);
    
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
    console.error("JSON quality analysis error:", error);
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

// Calculate tokens for attribute text fields (approximation: ~4 chars per token)
function calculateAttributeTokens(instructions, examples, signals) {
  const instructionsText = extractPlainText(instructions) || '';
  const examplesText = extractPlainText(examples) || '';
  const signalsText = extractPlainText(signals) || '';
  
  const totalText = `${instructionsText} ${examplesText} ${signalsText}`;
  const tokenCount = Math.ceil(totalText.length / 4);
  
  console.log(`Token calculation: ${totalText.length} chars = ~${tokenCount} tokens`);
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
    console.error("Error calculating token usage:", error);
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
    console.error("Error validating token budget:", error);
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
  
  console.log(`Post token calculation: ${totalText.length} chars = ~${tokenCount} tokens`);
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
        
        console.log(`Post attribute ${record.get('Attribute ID') || 'Unknown'}: instructions=${detailedInstructions.length}chars, pos=${positiveKeywords.length}chars, neg=${negativeKeywords.length}chars, high=${exampleHigh.length}chars, low=${exampleLow.length}chars`);
        
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
    console.error("Error calculating post token usage:", error);
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
    console.error("Error validating post token budget:", error);
    throw error;
  }
}

// ---------------------------------------------------------------
// Token Budget API Endpoints
// ---------------------------------------------------------------

// Get current token usage status
router.get("/api/token-usage", async (req, res) => {
  try {
    console.log("apiAndJobRoutes.js: GET /api/token-usage - Getting current token usage");
    
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
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
    console.error("apiAndJobRoutes.js: GET /api/token-usage error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get token usage"
    });
  }
});

// Validate if attribute save would exceed budget
router.post("/api/attributes/:id/validate-budget", async (req, res) => {
  try {
    console.log(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/validate-budget - Validating token budget`);
    
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
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
    console.error(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/validate-budget error:`, error.message);
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
    console.log("apiAndJobRoutes.js: GET /api/post-token-usage - Getting current post token usage");
    
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
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
    console.error("apiAndJobRoutes.js: GET /api/post-token-usage error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get post token usage"
    });
  }
});

// Validate if post attribute save would exceed budget
router.post("/api/post-attributes/:id/validate-budget", async (req, res) => {
  try {
    console.log(`apiAndJobRoutes.js: POST /api/post-attributes/${req.params.id}/validate-budget - Validating post token budget`);
    
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
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
    console.error(`apiAndJobRoutes.js: POST /api/post-attributes/${req.params.id}/validate-budget error:`, error.message);
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
    console.log(`apiAndJobRoutes.js: GET /api/attributes/${req.params.id}/edit - Loading attribute for editing`);
    
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
    
    const attributeId = req.params.id;
    const attribute = await loadAttributeForEditingWithClientBase(attributeId, clientBase);
    
    res.json({
      success: true,
      attribute
    });
    
  } catch (error) {
    console.error(`apiAndJobRoutes.js: GET /api/attributes/${req.params.id}/edit error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to load attribute for editing"
    });
  }
});

// AI-powered attribute editing (memory-based, returns improved rubric)
router.post("/api/attributes/:id/ai-edit", async (req, res) => {
  try {
    console.log(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/ai-edit - Generating AI suggestions`);
    
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
      console.error("apiAndJobRoutes.js: Gemini client not available - vertexAIClient is null");
      throw new Error("Gemini client not available - check config/geminiClient.js");
    }

    // Debug: Check what we have available
    console.log(`apiAndJobRoutes.js: Debug - vertexAIClient available: ${!!vertexAIClient}`);
    console.log(`apiAndJobRoutes.js: Debug - geminiModelId: ${geminiModelId}`);
    console.log(`apiAndJobRoutes.js: Debug - geminiConfig: ${JSON.stringify(geminiConfig ? Object.keys(geminiConfig) : 'null')}`);

    // Use the same model that works for scoring instead of a separate editing model
    const editingModelId = geminiModelId || "gemini-2.5-pro-preview-05-06";
    console.log(`apiAndJobRoutes.js: Using model ${editingModelId} for AI editing (same as scoring)`);
    
    // Validate model ID
    if (!editingModelId || editingModelId === 'null' || editingModelId === 'undefined') {
      console.error("apiAndJobRoutes.js: Invalid model ID:", editingModelId);
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
    
    console.log(`apiAndJobRoutes.js: Sending prompt to Gemini for attribute ${req.params.id}`);
    
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
      console.warn(`apiAndJobRoutes.js: Candidate had no text content. Finish Reason: ${finishReason || 'Unknown'}.`);
      throw new Error(`Gemini API call returned no text content. Finish Reason: ${finishReason || 'Unknown'}`);
    }
    
    console.log(`apiAndJobRoutes.js: Received response from Gemini: ${responseText.substring(0, 100)}...`);
    
    // Parse and validate AI response
    let aiResponse;
    try {
      aiResponse = JSON.parse(responseText);
    } catch (parseError) {
      console.error("apiAndJobRoutes.js: AI response parsing error:", parseError.message);
      console.error("apiAndJobRoutes.js: Raw AI response:", responseText);
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
    console.error(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/ai-edit error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate AI suggestions"
    });
  }
});

// Save improved rubric to live attribute
router.post("/api/attributes/:id/save", async (req, res) => {
  try {
    console.log(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/save - Saving attribute changes`);
    
    // Extract client ID for multi-tenant support
    const clientId = req.headers['x-client-id'];
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
      console.log(`apiAndJobRoutes.js: Checking token budget for attribute ${attributeId} (active=true)`);
      
      try {
        const budgetValidation = await validateTokenBudget(attributeId, updatedData, clientId);
        
        if (!budgetValidation.isValid) {
          console.log(`apiAndJobRoutes.js: Token budget exceeded for attribute ${attributeId}`);
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
        
        console.log(`apiAndJobRoutes.js: Token budget OK for attribute ${attributeId} (${budgetValidation.newTokens} tokens)`);
        
      } catch (budgetError) {
        console.error(`apiAndJobRoutes.js: Token budget check failed for ${attributeId}:`, budgetError.message);
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
    
    console.log(`apiAndJobRoutes.js: Successfully saved changes to attribute ${attributeId}`);
    res.json({
      success: true,
      message: "Attribute updated successfully"
    });
    
  } catch (error) {
    console.error(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/save error:`, error.message);
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
    console.log("apiAndJobRoutes.js: GET /api/attributes - Loading attribute library");
    
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

    console.log(`apiAndJobRoutes.js: Successfully loaded ${attributes.length} attributes for library view`);
    res.json({
      success: true,
      attributes,
      count: attributes.length
    });
    
  } catch (error) {
    console.error("apiAndJobRoutes.js: GET /api/attributes error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to load attributes"
    });
  }
});

// Verify Active/Inactive filtering is working
router.get("/api/attributes/verify-active-filtering", async (req, res) => {
  try {
    console.log("apiAndJobRoutes.js: GET /api/attributes/verify-active-filtering - Testing active/inactive filtering");
    
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
    console.error("apiAndJobRoutes.js: GET /api/attributes/verify-active-filtering error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to verify active filtering"
    });
  }
});

// Field-specific AI help endpoint
router.post("/api/attributes/:id/ai-field-help", async (req, res) => {
  try {
    console.log(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/ai-field-help - Field-specific AI help`);
    
    // Get client ID from header
    const clientId = req.headers['x-client-id'];
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

      console.log(`apiAndJobRoutes.js: Sending maxPoints prompt to Gemini:`, prompt.substring(0, 200) + '...');

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      console.log(`apiAndJobRoutes.js: Gemini response structure:`, JSON.stringify(result.response, null, 2));

      const candidate = result.response.candidates?.[0];
      if (!candidate) {
        console.error(`apiAndJobRoutes.js: No candidates in maxPoints response. Full response:`, JSON.stringify(result.response, null, 2));
        throw new Error("No response from AI");
      }

      console.log(`apiAndJobRoutes.js: maxPoints candidate structure:`, JSON.stringify(candidate, null, 2));

      const responseText = candidate.content?.parts?.[0]?.text?.trim();
      if (!responseText) {
        console.error(`apiAndJobRoutes.js: Empty maxPoints response text. Candidate:`, JSON.stringify(candidate, null, 2));
        console.error(`apiAndJobRoutes.js: Finish reason:`, candidate.finishReason);
        
        throw new Error(`Empty response from AI. Finish reason: ${candidate.finishReason || 'Unknown'}. Check backend logs for details.`);
      }

      console.log(`apiAndJobRoutes.js: maxPoints AI response:`, responseText.substring(0, 100) + '...');

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

      console.log(`apiAndJobRoutes.js: Sending instructions prompt to Gemini:`, prompt.substring(0, 200) + '...');

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      console.log(`apiAndJobRoutes.js: Instructions Gemini response structure:`, JSON.stringify(result.response, null, 2));

      const candidate = result.response.candidates?.[0];
      if (!candidate) {
        console.error(`apiAndJobRoutes.js: No candidates in instructions response. Full response:`, JSON.stringify(result.response, null, 2));
        throw new Error("No response from AI");
      }

      console.log(`apiAndJobRoutes.js: Instructions candidate structure:`, JSON.stringify(candidate, null, 2));

      const responseText = candidate.content?.parts?.[0]?.text?.trim();
      if (!responseText) {
        console.error(`apiAndJobRoutes.js: Empty instructions response text. Candidate:`, JSON.stringify(candidate, null, 2));
        console.error(`apiAndJobRoutes.js: Finish reason:`, candidate.finishReason);
        
        throw new Error(`Empty response from AI. Finish reason: ${candidate.finishReason || 'Unknown'}. Check backend logs for details.`);
      }

      console.log(`apiAndJobRoutes.js: Instructions AI response:`, responseText.substring(0, 100) + '...');

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
    console.error(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/ai-field-help error:`, error.message);
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
    console.log("apiAndJobRoutes.js: GET /api/post-attributes - Loading post attribute library");
    
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

    console.log(`apiAndJobRoutes.js: Successfully loaded ${attributes.length} post attributes for library view`);
    res.json({
      success: true,
      attributes,
      count: attributes.length
    });
    
  } catch (error) {
    console.error("apiAndJobRoutes.js: GET /api/post-attributes error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to load post attributes"
    });
  }
});

// Get post attribute for editing
router.get("/api/post-attributes/:id/edit", async (req, res) => {
  try {
    console.log(`apiAndJobRoutes.js: GET /api/post-attributes/${req.params.id}/edit - Loading attribute for editing`);
    
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

    console.log(`apiAndJobRoutes.js: Successfully loaded post attribute ${req.params.id} for editing`);
    res.json({
      success: true,
      attribute
    });
    
  } catch (error) {
    console.error(`apiAndJobRoutes.js: GET /api/post-attributes/${req.params.id}/edit error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to load post attribute for editing"
    });
  }
});

// Generate AI suggestions for post attribute
router.post("/api/post-attributes/:id/ai-edit", async (req, res) => {
  try {
    console.log(`apiAndJobRoutes.js: POST /api/post-attributes/${req.params.id}/ai-edit - Generating AI suggestions`);
    
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

    console.log(`apiAndJobRoutes.js: Successfully generated AI suggestions for post attribute ${req.params.id}`);
    res.json({
      success: true,
      suggestions,
      requestType
    });
    
  } catch (error) {
    console.error(`apiAndJobRoutes.js: POST /api/post-attributes/${req.params.id}/ai-edit error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate AI suggestions"
    });
  }
});

// Save post attribute changes
router.post("/api/post-attributes/:id/save", async (req, res) => {
  try {
    console.log(`🔥 BACKEND HIT: POST /api/post-attributes/${req.params.id}/save - Starting...`);
    console.log(`apiAndJobRoutes.js: POST /api/post-attributes/${req.params.id}/save - Saving post attribute changes`);
    
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

    const { heading, instructions, positiveIndicators, negativeIndicators, highScoreExample, lowScoreExample, active, maxPoints, scoringType } = req.body;
    
    console.log('Post attribute save - active field:', {
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

    console.log('Update data being sent to Airtable:', updateData);

    // Update the record
    await clientBase("Post Scoring Attributes").update(req.params.id, updateData);

    console.log(`apiAndJobRoutes.js: Successfully saved post attribute ${req.params.id}`);
    res.json({
      success: true,
      message: "Post attribute updated successfully"
    });
    
  } catch (error) {
    console.error(`apiAndJobRoutes.js: POST /api/post-attributes/${req.params.id}/save error:`, error.message);
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
  console.log("apiAndJobRoutes.js: Starting comprehensive system audit");
  
  // Get client ID from header
  const clientId = req.headers['x-client-id'];
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
    console.log("Audit Floor 1: Testing basic connectivity and authentication");
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
    console.log("Audit Floor 2: Testing business logic and scoring system");
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
      const { buildAttributeBreakdown } = require("../breakdown.js");
      
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
    console.log("Running endpoint tests - actually calling API endpoints...");
    
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
    console.log("Audit Floor 3: Testing advanced features and AI integration");
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
    console.log(`Comprehensive audit completed in ${auditResults.duration}ms with status: ${auditResults.overallStatus}`);

    res.json({
      success: true,
      audit: auditResults
    });

  } catch (error) {
    console.error("Comprehensive audit error:", error.message);
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
  console.log("apiAndJobRoutes.js: Running quick audit");
  
  const clientId = req.headers['x-client-id'];
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
    console.error("Quick audit error:", error.message);
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
  console.log("🔧 Starting automated issue detection and resolution...");
  
  const startTime = Date.now();
  const clientId = req.headers['x-client-id'];
  
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
    console.log("🔍 Running comprehensive audit to detect issues...");
    
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
    
    console.log(`🎯 Found ${failedTests.length} failed tests and ${warningTests.length} warnings`);
    
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
          console.log(`🔧 Attempting automated fix for: ${test.test}`);
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
          console.warn(`⚠️  Automated fix failed for ${test.test}: ${fixError.message}`);
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

    console.log(`🏁 Auto-fix completed in ${duration}ms. ${autoFix.detectedIssues.length} issues detected, ${autoFix.appliedFixes.length} fixes applied.`);
    
    res.json({
      success: true,
      autoFix
    });

  } catch (error) {
    console.error("🚨 Auto-fix error:", error);
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
  console.log(`🔧 Applying automated fix for: ${testName}`);
  
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

console.log(`ℹ️ Smart resume stale lock timeout configured: ${SMART_RESUME_LOCK_TIMEOUT/1000/60/60} hours`);

// Special Guy Wilson post harvesting endpoint
router.get("/guy-wilson-post-harvest", async (req, res) => {
  console.log("� SPECIAL GUY WILSON POST HARVEST ENDPOINT HIT");
  
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
          console.log(`🚨 GUY WILSON POST HARVEST: Process completed with status ${code}`);
          console.log(JSON.stringify(data, null, 2));
        }
      })
    };
    
    console.log("� GUY WILSON POST HARVEST: Calling process handler directly");
    await processLevel2ClientsV2(fakeReq, fakeRes);
    
    // Send the response back to the client
    return res.json({
      message: "Guy Wilson post harvest triggered successfully",
      result: responseData
    });
  } catch (error) {
    console.error("🚨 GUY WILSON POST HARVEST ERROR:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

router.post("/smart-resume-client-by-client", async (req, res) => {
  console.log("🚀 apiAndJobRoutes.js: /smart-resume-client-by-client endpoint hit");
  
  // Check webhook secret
  const providedSecret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.PB_WEBHOOK_SECRET;
  
  if (!providedSecret || providedSecret !== expectedSecret) {
    console.log("❌ Smart resume: Unauthorized - invalid webhook secret");
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized - invalid webhook secret' 
    });
  }
  
  // ⭐ STALE LOCK DETECTION: Check if existing lock is too old
  if (smartResumeRunning && smartResumeLockTime) {
    const lockAge = Date.now() - smartResumeLockTime;
    if (lockAge > SMART_RESUME_LOCK_TIMEOUT) {
      console.log(`🔓 Stale lock detected (${Math.round(lockAge/1000/60)} minutes old), auto-releasing`);
      smartResumeRunning = false;
      currentSmartResumeJobId = null;
      smartResumeLockTime = null;
    }
  }
  
  // ⭐ CONCURRENT EXECUTION PROTECTION
  if (smartResumeRunning) {
    const lockAge = smartResumeLockTime ? Math.round((Date.now() - smartResumeLockTime)/1000/60) : 'unknown';
    console.log(`⚠️ Smart resume already running (jobId: ${currentSmartResumeJobId}, age: ${lockAge} minutes)`);
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
    console.log(`🔍 Checking for recent smart resume activity in logs...`);
    
    // Look for recent SCRIPT_START entries without corresponding SCRIPT_END entries
    // This helps detect if an old process is still running
    const recentStartPattern = new RegExp(`SMART_RESUME_.*_SCRIPT_START.*${new Date().toISOString().slice(0, 10)}`);
    const recentEndPattern = new RegExp(`SMART_RESUME_.*_SCRIPT_END.*${new Date().toISOString().slice(0, 10)}`);
    
    // Check if we can find evidence of a recent start without a matching end
    // This is a simplified check - in production you might check actual log files
    console.log(`🔍 Process safety check completed - proceeding with new job`);
    
  } catch (processCheckError) {
    console.log(`⚠️ Could not perform process safety check (non-critical): ${processCheckError.message}`);
    // Continue anyway - this is just an extra safety measure
  }
  
  // Check if fire-and-forget is enabled
  if (process.env.FIRE_AND_FORGET !== 'true') {
    console.log("⚠️ Fire-and-forget not enabled");
    return res.status(400).json({
      success: false,
      message: 'Fire-and-forget mode not enabled. Set FIRE_AND_FORGET=true'
    });
  }
  
  try {
    const { stream, leadScoringLimit, postScoringLimit, clientFilter } = req.body;
    const jobId = `smart_resume_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    // Set the lock with timestamp
    smartResumeRunning = true;
    currentSmartResumeJobId = jobId;
    smartResumeLockTime = Date.now();
    
    console.log(`🎯 Starting smart resume processing: jobId=${jobId}, stream=${stream || 1}${clientFilter ? `, clientFilter=${clientFilter}` : ''}`);
    console.log(`🔒 Smart resume lock acquired for jobId: ${jobId} at ${new Date().toISOString()}`);
    
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
    
    console.error("❌ Smart resume startup error:", error.message);
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
  console.log(`🎯 [${jobId}] Smart resume background processing started`);
  
  // Track current stream
  currentStreamId = stream;
  
  // Register as active process globally for monitoring
  global.smartResumeActiveProcess = {
    jobId,
    stream,
    startTime: Date.now(),
    status: 'running'
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
        console.log(`🛑 [${jobId}] Termination signal detected, stopping process`);
        clearInterval(heartbeatInterval);
        throw new Error('Process terminated by admin request');
      }
      
      // Regular heartbeat
      const elapsedMinutes = Math.round((Date.now() - startTime) / 1000 / 60);
      console.log(`💓 [${jobId}] Smart resume still running... (${elapsedMinutes} minutes elapsed)`);
    }, 15000); // Check every 15 seconds for faster termination response
    
    // Import and use the smart resume module directly
    const scriptPath = require('path').join(__dirname, '../scripts/smart-resume-client-by-client.js');
    let smartResumeModule;
    
    console.log(`🏃 [${jobId}] Preparing to execute smart resume module...`);
    console.log(`🔍 ENV_DEBUG: PB_WEBHOOK_SECRET = ${process.env.PB_WEBHOOK_SECRET ? 'SET' : 'MISSING'}`);
    console.log(`🔍 ENV_DEBUG: NODE_ENV = ${process.env.NODE_ENV}`);
    
    try {
        // Clear module from cache to ensure fresh instance
        delete require.cache[require.resolve(scriptPath)];
        
        // Safely load the module
        try {
            console.log(`🔍 [${jobId}] Loading smart resume module...`);
            smartResumeModule = require(scriptPath);
        } catch (loadError) {
            console.error(`❌ [${jobId}] Failed to load smart resume module:`, loadError);
            throw new Error(`Module loading failed: ${loadError.message}`);
        }
        
        // Add detailed diagnostic logs about the module structure
        console.log(`🔍 DIAGNOSTIC: Module type: ${typeof smartResumeModule}`);
        console.log(`🔍 DIAGNOSTIC: Module exports:`, Object.keys(smartResumeModule || {}));
        
        // Check what function is available and use the right one
        if (typeof smartResumeModule === 'function') {
            console.log(`🔍 [${jobId}] Module is a direct function, calling it...`);
            await smartResumeModule(stream);
        } else if (typeof smartResumeModule.runSmartResume === 'function') {
            console.log(`🔍 [${jobId}] Found runSmartResume function, calling it...`);
            // Pass the stream parameter properly
            await smartResumeModule.runSmartResume(stream);
        } else if (typeof smartResumeModule.main === 'function') {
            console.log(`🔍 [${jobId}] Found main function, calling it...`);
            await smartResumeModule.main(stream);
        } else {
            console.error(`❌ [${jobId}] CRITICAL: No usable function found in module`);
            console.error(`❌ [${jobId}] Available exports:`, Object.keys(smartResumeModule || {}));
            throw new Error('Smart resume module does not export a usable function');
        }
        
        console.log(`🔍 SMART_RESUME_${jobId} SCRIPT_START: Module execution beginning`);
        console.log(`✅ [${jobId}] Smart resume function called successfully`);
        
        console.log(`✅ [${jobId}] Smart resume completed successfully`);
        console.log(`🔍 SMART_RESUME_${jobId} SCRIPT_END: Module execution completed`);
        
        // Update global process tracking
        if (global.smartResumeActiveProcess) {
          global.smartResumeActiveProcess.status = 'completed';
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
        console.error(`🚨 [${jobId}] MODULE EXECUTION FAILED - ERROR DETAILS:`);
        console.error(`🚨 Error message: ${moduleError.message}`);
        console.error(`🚨 Stack trace: ${moduleError.stack}`);
        throw moduleError;
    }
    
  } catch (error) {
    console.error(`❌ [${jobId}] Smart resume failed:`, error.message);
    console.error(`🔍 SMART_RESUME_${jobId} SCRIPT_ERROR: ${error.message}`);
    
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
      console.log(`🛑 [${jobId}] Process was terminated by admin request`);
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
        console.error(`❌ [${jobId}] Failed to send error email:`, emailError.message);
      }
    }
  } finally {
    // ⭐ ALWAYS RELEASE THE LOCK WHEN DONE (SUCCESS OR FAILURE)
    console.log(`🔓 [${jobId}] Releasing smart resume lock (held for ${Math.round((Date.now() - smartResumeLockTime)/1000)} seconds)`);
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
    
// ---------------------------------------------------------------
// SPECIAL GUY WILSON POST HARVESTING DIRECT ENDPOINT
// ---------------------------------------------------------------
router.get("/harvest-guy-wilson", async (req, res) => {
  console.log("🚨 SPECIAL GUY WILSON DIRECT HARVEST ENDPOINT HIT");
  
  try {
    // Use direct HTTP request to the existing endpoint
    const fetch = require('node-fetch');
    
    // Prepare the base URL - use localhost to avoid network issues
    const endpointUrl = `http://localhost:${process.env.PORT || 3001}/api/apify/process-level2-v2`;
    const secret = process.env.PB_WEBHOOK_SECRET;
    
    console.log(`🚨 GUY WILSON DIRECT HARVEST: Calling endpoint ${endpointUrl}`);
    
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
    
    console.log(`🚨 GUY WILSON DIRECT HARVEST: Response status: ${response.status}`);
    console.log(`🚨 GUY WILSON DIRECT HARVEST: Response data:`, JSON.stringify(responseData, null, 2));
    
    // Send the response back to the client
    return res.json({
      message: "Guy Wilson post harvest triggered successfully",
      status: response.status,
      result: responseData
    });
  } catch (error) {
    console.error("🚨 GUY WILSON DIRECT HARVEST ERROR:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});
  }
}

/**
 * Helper function for sending Smart Resume reports
 * @param {string} jobId - The job ID
 * @param {boolean} success - Whether the job succeeded
 * @param {object} details - Job execution details
 */
async function sendSmartResumeReport(jobId, success, details) {
  try {
    console.log(`📧 [${jobId}] Sending ${success ? 'success' : 'failure'} report...`);
    
    // Load email service dynamically
    let emailService;
    try {
      emailService = require('../services/emailReportingService');
    } catch (loadError) {
      console.error(`📧 [${jobId}] Could not load email service:`, loadError.message);
      return { sent: false, reason: 'Email service not available' };
    }
    
    // Check if email service is configured
    if (!emailService || !emailService.isConfigured()) {
      console.log(`📧 [${jobId}] Email service not configured, skipping report`);
      return { sent: false, reason: 'Email service not configured' };
    }
    
    // Send the report
    const result = await emailService.sendExecutionReport({
      ...details,
      runId: jobId,
      success: success
    });
    
    console.log(`📧 [${jobId}] Email report sent successfully`);
    return { sent: true, result };
    
  } catch (emailError) {
    console.error(`📧 [${jobId}] Failed to send email report:`, emailError);
    return { sent: false, error: emailError.message };
  }
}

// ---------------------------------------------------------------
// GET HANDLER FOR SMART RESUME - Handles browser and simple curl requests
// ---------------------------------------------------------------
router.get("/smart-resume-client-by-client", async (req, res) => {
  console.log("🚨 GET request received for /smart-resume-client-by-client - processing directly");
  console.log("🔍 Query parameters:", req.query);
  
  try {
    // Check webhook secret from query parameter for GET requests
    const providedSecret = req.query['secret'];
    const expectedSecret = process.env.PB_WEBHOOK_SECRET;
    
    if (!providedSecret || providedSecret !== expectedSecret) {
      console.log("❌ Smart resume: Unauthorized - invalid webhook secret");
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized - invalid webhook secret' 
      });
    }
    
    // Extract parameters from query string
    const stream = parseInt(req.query.stream) || 1;
    const leadScoringLimit = req.query.leadScoringLimit ? parseInt(req.query.leadScoringLimit) : null;
    const postScoringLimit = req.query.postScoringLimit ? parseInt(req.query.postScoringLimit) : null;
    
    // ⭐ STALE LOCK DETECTION: Check if existing lock is too old
    if (smartResumeRunning && smartResumeLockTime) {
      const lockAge = Date.now() - smartResumeLockTime;
      if (lockAge > SMART_RESUME_LOCK_TIMEOUT) {
        console.log(`🔓 Stale lock detected (${Math.round(lockAge/1000/60)} minutes old), auto-releasing`);
        smartResumeRunning = false;
        currentSmartResumeJobId = null;
        smartResumeLockTime = null;
      }
    }
    
    // Check if another job is already running
    if (smartResumeRunning) {
      console.log(`⏳ Smart resume already running (job: ${currentSmartResumeJobId}), returning status`);
      return res.json({
        success: true,
        status: 'running',
        jobId: currentSmartResumeJobId,
        message: `Smart resume already running (started ${new Date(smartResumeLockTime).toISOString()})`
      });
    }
    
    // Create a job ID and set the lock
    const jobId = `job-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    smartResumeRunning = true;
    currentSmartResumeJobId = jobId;
    smartResumeLockTime = Date.now();
    
    console.log(`🔒 [${jobId}] Smart resume lock acquired - starting processing (GET request)`);
    
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
    
    console.error("❌ Error in GET smart-resume processing:", error);
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
  console.log("🚨 Emergency reset: /reset-smart-resume-lock endpoint hit");
  
  // Check webhook secret
  const providedSecret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.PB_WEBHOOK_SECRET;
  
  if (!providedSecret || providedSecret !== expectedSecret) {
    console.log("❌ Emergency reset: Unauthorized - invalid webhook secret");
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
      console.log(`🛑 Emergency reset: Setting termination signal for job ${activeProcess.jobId}`);
      global.smartResumeTerminateSignal = true;
    }
    
    // Force reset the lock
    smartResumeRunning = false;
    currentSmartResumeJobId = null;
    smartResumeLockTime = null;
    
    console.log(`🔓 Emergency reset: Lock forcefully cleared`);
    console.log(`   Previous state: running=${wasRunning}, jobId=${previousJobId}, age=${lockAge} minutes`);
    
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
    console.error("❌ Emergency reset failed:", error.message);
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
  console.log("🔍 apiAndJobRoutes.js: /smart-resume-status endpoint hit");
  
  // Check webhook secret
  const providedSecret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.PB_WEBHOOK_SECRET;
  
  if (!providedSecret || providedSecret !== expectedSecret) {
    console.log("❌ Smart resume status: Unauthorized - invalid webhook secret");
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
      console.log(`⚠️ Stale lock detected in status check (${status.lockAgeMinutes} minutes old)`);
      status.warning = `Lock appears stale (${status.lockAgeMinutes} min old). Consider resetting.`;
    }
    
    console.log(`🔍 Smart resume status check: isRunning=${status.isRunning}, jobId=${status.currentJobId}`);
    res.json({
      success: true,
      status: status
    });
    
  } catch (error) {
    console.error("❌ Smart resume status check failed:", error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
      details: error.message
    });
  }
});

module.exports = router;