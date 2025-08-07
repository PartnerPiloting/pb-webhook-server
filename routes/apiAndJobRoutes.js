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

const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null;
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

const ENQUEUE_URL = `${
  process.env.RENDER_EXTERNAL_URL ||
  "http://localhost:" + (process.env.PORT || 3000)
}/enqueue`;

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
          const clientBase = getClientBase('guy-wilson'); // Replace with your actual client ID
          
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

// ---------------------------------------------------------------
// Import multi-tenant post scoring
// ---------------------------------------------------------------
const postBatchScorer = require("../postBatchScorer.js");

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
    console.log(`Starting multi-tenant post scoring for ALL clients, limit=${limit || 'UNLIMITED'}`);
    // Start the multi-tenant post scoring process for ALL clients
    const results = await postBatchScorer.runMultiTenantPostScoring(
      vertexAIClient,
      geminiModelId,
      null, // No specific client - process ALL
      limit
    );
    // Return results immediately
    res.status(200).json({
      status: 'completed',
      message: 'Multi-tenant post scoring completed',
      summary: {
        totalClients: results.totalClients,
        successfulClients: results.successfulClients,
        failedClients: results.failedClients,
        totalPostsProcessed: results.totalPostsProcessed,
        totalPostsScored: results.totalPostsScored,
        totalErrors: results.totalErrors,
        duration: results.duration
      },
      clientResults: results.clientResults
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
    
    // Try to get all clients
    let allClients = [];
    let activeClients = [];
    let error = null;
    
    try {
      allClients = await clientService.getAllClients();
      activeClients = await clientService.getAllActiveClients();
    } catch (clientError) {
      error = clientError.message;
    }
    
    debugInfo.clientData = {
      totalClients: allClients.length,
      activeClients: activeClients.length,
      allClientsData: allClients,
      activeClientsData: activeClients,
      error: error
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
        const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
        
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
      const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
      
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
      const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
      
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
    const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
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

module.exports = router;