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
const { loadAttributes, loadAttributeForEditing, updateAttribute } = require("../attributeLoader.js");
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
    const attributeId = req.params.id;
    const attribute = await loadAttributeForEditing(attributeId);
    
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
    const attributeId = req.params.id;
    const { userRequest } = req.body;
    
    if (!userRequest || typeof userRequest !== 'string') {
      return res.status(400).json({
        success: false,
        error: "userRequest is required and must be a string"
      });
    }

    // Load current attribute (get ALL fields)
    const currentAttribute = await loadAttributeForEditing(attributeId);
    
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
        responseMimeType: "application/json",
        maxOutputTokens: 8192
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
    const attributeId = req.params.id;
    const { improvedRubric } = req.body; // Keep for backward compatibility
    const updatedData = improvedRubric || req.body; // Also accept data directly
    
    if (!updatedData || typeof updatedData !== 'object') {
      return res.status(400).json({
        success: false,
        error: "updatedData is required and must be an object"
      });
    }
    
    await updateAttribute(attributeId, updatedData);
    
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
    
    if (!airtableBase) {
      throw new Error("Airtable not available - check config/airtableClient.js");
    }

    const records = await airtableBase("Scoring Attributes")
      .select({
        fields: [
          "Attribute Id", "Heading", "Category", "Max Points", 
          "Min To Qualify", "Penalty", "Disqualifying", "Active",
          "Instructions", "Signals", "Examples"
        ]
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
      active: record.get("Active") !== false, // Default to true if field doesn't exist
      instructions: extractPlainText(record.get("Instructions")),
      signals: extractPlainText(record.get("Signals")),
      examples: extractPlainText(record.get("Examples")),
      isEmpty: !record.get("Heading") && !extractPlainText(record.get("Instructions"))
    }));

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

// Field-specific AI help endpoint
router.post("/api/attributes/:id/ai-field-help", async (req, res) => {
  try {
    console.log(`apiAndJobRoutes.js: POST /api/attributes/${req.params.id}/ai-field-help - Field-specific AI help`);
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
          temperature: 0.7,
          maxOutputTokens: 1000
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

USER QUESTION: ${userRequest}

ANSWER THEIR SPECIFIC QUESTION DIRECTLY AND HELPFULLY:

Max points determines the weight/importance of this attribute in the overall scoring system. Here's how it works:

• Higher max points = more important attribute = bigger impact on final scores
• Lower max points = less important attribute = smaller impact on final scores
• All attributes compete for points in the final scoring calculation

Think of it like a competition where attributes with higher max points can contribute more to the final score, making them more influential in hiring decisions.

IMPORTANCE LEVELS:
• Critical skills (high importance): Qualifications that heavily influence hiring decisions
• Important qualifications (moderate importance): Valuable skills that give candidates an edge  
• Nice-to-have (low importance): Bonus qualities that are good but not essential

To set your max points, simply type the number you want in the field above this chat.

Is there anything specific about max points you'd like me to explain further?`;

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
          temperature: 0.7,
          maxOutputTokens: 1000
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
          temperature: 0.7,
          maxOutputTokens: 1000
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
          temperature: 0.7,
          maxOutputTokens: 1000
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
      // Use the current max points from the form, not the database
      const maxPoints = currentAttribute.maxPoints || 15;
      const lowRange = Math.floor(maxPoints * 0.2);
      const midRange = Math.floor(maxPoints * 0.6);
      
      const prompt = `You are helping users create AI scoring instructions - the core rubric that determines how leads are scored. This is the MOST IMPORTANT field in the entire system.

CURRENT INSTRUCTIONS: ${currentValue || '(no current instructions)'}

WHAT ARE SCORING INSTRUCTIONS?
These are detailed criteria that tell the AI exactly how to evaluate and score leads for this attribute. They must include specific point ranges from 0 to ${maxPoints} points with clear criteria for each range.

WHEN USER PROVIDES THEIR CRITERIA (phrases like "I am looking for people who...", "I want to find...", "I need people with...", or describes specific qualities/skills):
- IMMEDIATELY translate it into clear point ranges 0-${maxPoints}
- Make criteria specific and measurable
- Ensure each range has distinct, actionable criteria
- Format each scoring range on its own line for readability
- ALWAYS end with: SUGGESTED_VALUE: [the complete scoring instructions]

WHEN USER ASKS FOR MODIFICATIONS (phrases like "add something about...", "include...", "change the top range to..."):
- Take the current instructions above and apply the requested changes
- Maintain the 0-${maxPoints} point range structure
- Keep the format with each range on its own line
- ALWAYS end with: SUGGESTED_VALUE: [the updated scoring instructions]

WHEN USER ASKS FOR HELP (phrases like "help me", "what should I do", "how does this work", "I don't know"):
Ask: "Tell me what you're looking for in this attribute, and together we can create killer instructions for AI scoring!"
Then help them build instructions with clear ranges formatted on separate lines like:
"0-${lowRange} pts = minimal/no [criteria]
${lowRange + 1}-${midRange} pts = moderate [criteria]  
${midRange + 1}-${maxPoints} pts = strong/excellent [criteria]"

CRITICAL: ALWAYS include SUGGESTED_VALUE in your response when providing or updating instructions.

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
          temperature: 0.7,
          maxOutputTokens: 1000
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
        temperature: 0.7,
        maxOutputTokens: 1000
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

module.exports = router;