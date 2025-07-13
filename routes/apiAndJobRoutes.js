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
const syncPBPostsToAirtable = require("../utils/pbPostsSync.js");

const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null;
const geminiModelId = geminiConfig ? geminiConfig.geminiModelId : null;

const { scoreLeadNow } = require("../singleScorer.js");
const batchScorer = require("../batchScorer.js");
const { loadAttributes } = require("../attributeLoader.js");
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
  res.send("ok");
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
    const [creds] = await airtableBase("Credentials")
      .select({ maxRecords: 1 })
      .firstPage();
    if (!creds) throw new Error("No record in Credentials table.");

    const agentId = creds.get("PB Message Sender ID");
    const pbKey = creds.get("Phantom API Key");
    const sessionCookie = creds.get("LinkedIn Cookie");
    const userAgent = creds.get("User-Agent");
    if (!agentId || !pbKey || !sessionCookie || !userAgent)
      throw new Error("Missing PB message-sender credentials.");

    const lead = await airtableBase("Leads").find(recordId);
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
      await airtableBase("Leads").update(recordId, {
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
          const processed = await syncPBPostsToAirtable(filteredPostsInput);
          console.log("PB Webhook: Background syncPBPostsToAirtable completed.", processed);
        } else {
          console.log("PB Webhook: No valid posts to sync after filtering.");
        }

      } catch (backgroundErr) {
        console.error("PB Webhook: Error during background processing:", backgroundErr.message, backgroundErr.stack);
      }
    })();

  } catch (initialErr) {
    console.error("PB Webhook: Initial error:", initialErr.message, initialErr.stack);
    res.status(500).json({ error: initialErr.message });
  }
});


// ---------------------------------------------------------------
// Manual Batch Score
// ---------------------------------------------------------------
router.get("/run-batch-score", async (req, res) => {
  const limit = Number(req.query.limit) || 500;
  if (!vertexAIClient || !geminiModelId || !airtableBase)
    return res
      .status(503)
      .send("Batch scoring unavailable (config missing).");

  batchScorer
    .run(req, res, { vertexAIClient, geminiModelId, airtableBase, limit })
    .catch((e) => {
      if (!res.headersSent)
        res.status(500).send("Batch scoring error: " + e.message);
    });
});

// ---------------------------------------------------------------
// Single Lead Scorer
// ---------------------------------------------------------------
router.get("/score-lead", async (req, res) => {
  if (!vertexAIClient || !geminiModelId || !airtableBase)
    return res
      .status(503)
      .json({ error: "Scoring unavailable (config missing)." });

  try {
    const id = req.query.recordId;
    if (!id)
      return res.status(400).json({ error: "recordId query param required" });

    const record = await airtableBase("Leads").find(id);
    if (!record) { 
        console.warn(`score-lead: Lead record not found for ID: ${id}`);
        return res.status(404).json({ error: `Lead record not found for ID: ${id}` });
    }
    const profileJsonString = record.get("Profile Full JSON");
    if (!profileJsonString) {
        console.warn(`score-lead: Profile Full JSON is empty for lead ID: ${id}`);
         await airtableBase("Leads").update(id, {
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
      await airtableBase("Leads").update(id, {
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

    const { positives, negatives } = await loadAttributes();

    // Ensure all positive attributes are present in positive_scores and attribute_reasoning
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

    await airtableBase("Leads").update(id, {
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
// Multi-Tenant Post Batch Score
// ---------------------------------------------------------------
router.post("/run-post-batch-score", async (req, res) => {
  console.log("apiAndJobRoutes.js: /run-post-batch-score endpoint hit");
  
  if (!vertexAIClient || !geminiModelId) {
    console.error("Multi-tenant post scoring unavailable: missing Vertex AI client or model ID");
    return res.status(503).json({
      status: 'error',
      message: "Multi-tenant post scoring unavailable (Gemini config missing)."
    });
  }

  try {
    // Parse query parameters
    const clientId = req.query.clientId || null; // Optional: specific client
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null; // Optional: limit per client
    
    console.log(`Starting multi-tenant post scoring with clientId=${clientId || 'ALL'}, limit=${limit || 'UNLIMITED'}`);
    
    // Start the multi-tenant post scoring process
    const results = await postBatchScorer.runMultiTenantPostScoring(
      vertexAIClient,
      geminiModelId,
      clientId,
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
// Debug endpoint for troubleshooting client discovery
// ---------------------------------------------------------------
router.get("/debug-clients", async (req, res) => {
  console.log("Debug clients endpoint hit");
  
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
// JSON Quality Diagnostic endpoint
// ---------------------------------------------------------------
router.get("/api/json-quality-analysis", async (req, res) => {
  console.log("JSON quality analysis endpoint hit");
  
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
// AI-Powered Attribute Editing Endpoints
// ---------------------------------------------------------------

const { getOpenAIClient } = require("../config/openaiClient.js");
const { buildAttributeEditPrompt, validateRubricDraft, getAISuggestions } = require("../utils/attributePrompts.js");
const { getClientBase } = require("../config/airtableClient.js");

// Chat endpoint for AI-powered attribute editing
router.post("/api/attributes/chat", async (req, res) => {
  console.log("AI Attribute Chat endpoint hit");
  
  try {
    const { attributeId, userText, client } = req.body;
    
    if (!attributeId || !userText) {
      return res.status(400).json({
        error: "Missing required fields: attributeId and userText"
      });
    }

    // Get the appropriate Airtable base (multi-tenant)
    const base = client ? getClientBase(client) : airtableBase;
    
    // Fetch current attribute from Airtable
    console.log(`Fetching attribute ${attributeId} for editing`);
    const record = await base("Scoring Attributes").find(attributeId);
    
    if (!record) {
      return res.status(404).json({
        error: `Attribute not found: ${attributeId}`
      });
    }

    // Build current rubric object
    const currentRubric = {
      heading: record.get("Label") || "",
      maxPoints: record.get("Max Points") || 0,
      minToQualify: record.get("Min To Qualify") || 0,
      penalty: record.get("Penalty") || 0,
      instructionsMarkdown: record.get("Instructions") || ""
    };

    console.log("Current rubric:", currentRubric);
    console.log("User request:", userText);

    // Build OpenAI prompt
    const messages = buildAttributeEditPrompt(currentRubric, userText);
    
    // Call OpenAI
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Using mini for cost efficiency
      temperature: 0.2,
      max_tokens: 800,
      messages: messages
    });

    const aiResponse = completion.choices[0].message.content;
    console.log("AI response:", aiResponse);

    // Parse and validate AI response
    let draft;
    try {
      draft = JSON.parse(aiResponse);
      validateRubricDraft(draft);
    } catch (parseError) {
      console.error("AI response parsing/validation error:", parseError);
      return res.status(500).json({
        error: "AI generated invalid response format",
        details: parseError.message
      });
    }

    // Save draft to Airtable draft fields
    const updateFields = {
      "Draft Label": draft.heading,
      "Draft Max Points": draft.maxPoints,
      "Draft Min To Qualify": draft.minToQualify,
      "Draft Penalty": draft.penalty,
      "Draft Instructions": draft.instructionsMarkdown,
      "Draft Updated At": new Date().toISOString()
    };

    await base("Scoring Attributes").update(attributeId, updateFields);
    
    console.log("Draft saved successfully");

    res.json({
      success: true,
      draft: draft,
      message: "AI suggestion generated and saved as draft"
    });

  } catch (error) {
    console.error("Attribute chat error:", error);
    res.status(500).json({
      error: "Failed to process AI attribute edit",
      details: error.message
    });
  }
});

// Publish draft attribute changes
router.patch("/api/attributes/:id/publish", async (req, res) => {
  console.log("Publish attribute changes endpoint hit");
  
  try {
    const { id } = req.params;
    const { client } = req.body;

    // Get the appropriate Airtable base (multi-tenant)
    const base = client ? getClientBase(client) : airtableBase;

    // Fetch current record with draft fields
    const record = await base("Scoring Attributes").find(id);
    
    if (!record) {
      return res.status(404).json({
        error: `Attribute not found: ${id}`
      });
    }

    // Check if there are draft changes to publish
    const draftHeading = record.get("Draft Label");
    if (!draftHeading) {
      return res.status(400).json({
        error: "No draft changes to publish"
      });
    }

    // Copy draft fields to live fields and clear drafts
    const updateFields = {
      "Label": record.get("Draft Label"),
      "Max Points": record.get("Draft Max Points"),
      "Min To Qualify": record.get("Draft Min To Qualify"),
      "Penalty": record.get("Draft Penalty"),
      "Instructions": record.get("Draft Instructions"),
      // Clear draft fields
      "Draft Label": null,
      "Draft Max Points": null,
      "Draft Min To Qualify": null,
      "Draft Penalty": null,
      "Draft Instructions": null,
      "Draft Updated At": null
    };

    await base("Scoring Attributes").update(id, updateFields);

    console.log(`Attribute ${id} published successfully`);

    res.json({
      success: true,
      message: "Attribute changes published successfully"
    });

  } catch (error) {
    console.error("Publish attribute error:", error);
    res.status(500).json({
      error: "Failed to publish attribute changes",
      details: error.message
    });
  }
});

// Discard draft attribute changes
router.patch("/api/attributes/:id/discard", async (req, res) => {
  console.log("Discard attribute draft endpoint hit");
  
  try {
    const { id } = req.params;
    const { client } = req.body;

    // Get the appropriate Airtable base (multi-tenant)
    const base = client ? getClientBase(client) : airtableBase;

    // Clear all draft fields
    const updateFields = {
      "Draft Label": null,
      "Draft Max Points": null,
      "Draft Min To Qualify": null,
      "Draft Penalty": null,
      "Draft Instructions": null,
      "Draft Updated At": null
    };

    await base("Scoring Attributes").update(id, updateFields);

    console.log(`Attribute ${id} draft discarded successfully`);

    res.json({
      success: true,
      message: "Draft changes discarded successfully"
    });

  } catch (error) {
    console.error("Discard attribute draft error:", error);
    res.status(500).json({
      error: "Failed to discard draft changes",
      details: error.message
    });
  }
});

// Get AI suggestions for attribute editing
router.get("/api/attributes/suggestions", (req, res) => {
  try {
    const suggestions = getAISuggestions();
    res.json({
      success: true,
      suggestions: suggestions
    });
  } catch (error) {
    console.error("Get AI suggestions error:", error);
    res.status(500).json({
      error: "Failed to get AI suggestions",
      details: error.message
    });
  }
});

// Test endpoint to verify OpenAI and Airtable connections
router.get("/api/attributes/test", async (req, res) => {
  console.log("Testing attribute editing setup");
  
  try {
    const { client } = req.query;
    
    // Test Airtable connection
    const base = client ? getClientBase(client) : airtableBase;
    
    // Try to fetch one attribute record
    const records = await base("Scoring Attributes")
      .select({
        maxRecords: 1,
        fields: ["Label", "Instructions", "Max Points", "Min To Qualify", "Penalty"]
      })
      .firstPage();
    
    if (records.length === 0) {
      return res.json({
        success: false,
        message: "No attributes found in Scoring Attributes table",
        airtableConnection: true,
        openaiConnection: !!getOpenAIClient()
      });
    }

    const testRecord = records[0];
    const currentRubric = {
      heading: testRecord.get("Label") || "",
      maxPoints: testRecord.get("Max Points") || 0,
      minToQualify: testRecord.get("Min To Qualify") || 0,
      penalty: testRecord.get("Penalty") || 0,
      instructionsMarkdown: testRecord.get("Instructions") || ""
    };

    res.json({
      success: true,
      message: "Attribute editing setup working correctly",
      airtableConnection: true,
      openaiConnection: !!getOpenAIClient(),
      sampleAttribute: {
        id: testRecord.id,
        ...currentRubric
      },
      fieldsAvailable: {
        hasLabel: !!testRecord.get("Label"),
        hasInstructions: !!testRecord.get("Instructions"),
        hasMaxPoints: testRecord.get("Max Points") !== undefined,
        hasMinToQualify: testRecord.get("Min To Qualify") !== undefined,
        hasPenalty: testRecord.get("Penalty") !== undefined
      }
    });

  } catch (error) {
    console.error("Attribute test error:", error);
    res.status(500).json({
      success: false,
      error: "Setup test failed",
      details: error.message,
      airtableConnection: false,
      openaiConnection: !!getOpenAIClient()
    });
  }
});

module.exports = router;