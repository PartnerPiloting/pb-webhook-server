// routes/apiAndJobRoutes.js

const express = require('express');
const router = express.Router();
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args)); // Needed for the new endpoint

// --- Dependencies ---
const geminiConfig = require('../config/geminiClient.js'); 
const airtableBase = require('../config/airtableClient.js'); 

const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null;
const geminiModelId = geminiConfig ? geminiConfig.geminiModelId : null;  
const globalGeminiModel = geminiConfig ? geminiConfig.geminiModel : null;

const { scoreLeadNow } = require('../singleScorer.js');   // Expects { vertexAIClient, geminiModelId }
const batchScorer = require('../batchScorer.js');           

const { loadAttributes } = require('../attributeLoader.js'); 
const { computeFinalScore } = require('../scoring.js');       
const { buildAttributeBreakdown } = require('../breakdown.js'); 

const { alertAdmin, isMissingCritical } = require('../utils/appHelpers.js'); 

// The URL for your /enqueue endpoint (on the same server)
const ENQUEUE_URL = `${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + (process.env.PORT || 3000)}/enqueue`;

// --- NEW: PB Posts Sync Helper ---
const syncPBPostsToAirtable = require("../utils/pbPostsSync.js");

/* ------------------------------------------------------------------
    Route Definitions
------------------------------------------------------------------*/

// Health Check
router.get("/health", (_req, res) => {
    console.log("apiAndJobRoutes.js: /health endpoint hit");
    res.send("ok from apiAndJobRoutes");
});

// New Endpoint to Initiate Phantombuster Message Sending
router.get("/api/initiate-pb-message", async (req, res) => {
    // ... (existing code unchanged)
    const { recordId } = req.query;
    console.log(`apiAndJobRoutes.js: /api/initiate-pb-message hit for recordId: ${recordId}`);

    if (!recordId) {
        return res.status(400).json({ success: false, error: "recordId query parameter is required" });
    }

    if (!airtableBase) {
        console.error("apiAndJobRoutes.js - /api/initiate-pb-message: Airtable Base not initialized.");
        return res.status(503).json({ success: false, error: "Service temporarily unavailable (Airtable config)." });
    }

    try {
        // 1. Fetch Phantombuster Credentials from Airtable "Credentials" table
        console.log(`apiAndJobRoutes.js: Fetching PB credentials from Airtable "Credentials" table.`);
        const credsRecords = await airtableBase("Credentials").select({ maxRecords: 1 }).firstPage();
        if (!credsRecords || credsRecords.length === 0) {
            throw new Error("No records found in Credentials table.");
        }
        const creds = credsRecords[0];

        const agentId = creds.get("PB Message Sender ID");
        const pbKey = creds.get("Phantom API Key");
        const sessionCookie = creds.get("LinkedIn Cookie");
        const userAgent = creds.get("User-Agent"); // Using the hyphenated version as confirmed

        if (!agentId || !pbKey || !sessionCookie || !userAgent) {
            let missing = [];
            if (!agentId) missing.push("PB Message Sender ID");
            if (!pbKey) missing.push("Phantom API Key");
            if (!sessionCookie) missing.push("LinkedIn Cookie");
            if (!userAgent) missing.push("User-Agent");
            console.error(`apiAndJobRoutes.js: Missing one or more Phantombuster credentials from Airtable: ${missing.join(', ')}`);
            throw new Error(`Missing Phantombuster credentials in Airtable: ${missing.join(', ')}`);
        }
        console.log(`apiAndJobRoutes.js: Successfully fetched PB credentials. Agent ID: ${agentId}`);

        // 2. Fetch Lead Details from Airtable "Leads" table
        console.log(`apiAndJobRoutes.js: Fetching lead details for recordId: ${recordId}`);
        const leadRecord = await airtableBase("Leads").find(recordId);
        if (!leadRecord) {
            throw new Error(`Lead record with ID ${recordId} not found.`);
        }

        const profileUrl = leadRecord.get("LinkedIn Profile URL");
        const message = leadRecord.get("Message To Be Sent");

        if (!profileUrl) {
            throw new Error(`Missing 'LinkedIn Profile URL' for lead ${recordId}.`);
        }
        if (!message) {
            throw new Error(`Missing 'Message To Be Sent' for lead ${recordId}.`);
        }
        console.log(`apiAndJobRoutes.js: Successfully fetched lead details. Profile URL: ${profileUrl}`);

        // 3. Construct the job payload for /enqueue
        const jobPayload = {
            recordId: recordId, // The lead's recordId for status updates
            agentId: agentId,
            pbKey: pbKey,
            sessionCookie: sessionCookie,
            userAgent: userAgent,
            profileUrl: profileUrl,
            message: message
        };
        console.log("apiAndJobRoutes.js: Constructed job payload for /enqueue:", JSON.stringify(jobPayload, null, 2).substring(0, 500) + "..."); // Log part of it

        // 4. Make an HTTP POST request to the server's own /enqueue endpoint
        console.log(`apiAndJobRoutes.js: Sending job to /enqueue endpoint: ${ENQUEUE_URL}`);
        const enqueueResponse = await fetch(ENQUEUE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(jobPayload)
        });

        const enqueueResponseData = await enqueueResponse.json();

        if (!enqueueResponse.ok || !enqueueResponseData.queued) {
            console.error("apiAndJobRoutes.js: Call to /enqueue failed or job not queued.", enqueueResponseData);
            throw new Error(`Failed to enqueue job: ${enqueueResponseData.error || `Status ${enqueueResponse.status}`}`);
        }

        console.log(`apiAndJobRoutes.js: Successfully enqueued job for recordId ${recordId}. Response from /enqueue:`, enqueueResponseData);
        
        // 5. Optionally, update the lead's status in Airtable here to "Queuing Initiated" or similar
        //    This is similar to what your Airtable Automation script does.
        try {
            await airtableBase("Leads").update(recordId, {
                "Message Status": "Queuing Initiated by Server" // Or your preferred status
            });
            console.log(`apiAndJobRoutes.js: Updated lead ${recordId} status to 'Queuing Initiated by Server'.`);
        } catch (airtableUpdateError) {
            console.warn(`apiAndJobRoutes.js: Could not update lead ${recordId} status after enqueue:`, airtableUpdateError.message);
            // Non-fatal for the main operation, but good to log.
        }

        res.json({ success: true, message: `Message for lead ${recordId} successfully initiated for queuing.`, enqueueResponse: enqueueResponseData });

    } catch (error) {
        console.error(`apiAndJobRoutes.js - Error in /api/initiate-pb-message for recordId ${recordId}:`, error.message, error.stack);
        await alertAdmin("Error in /api/initiate-pb-message", `Record ID: ${recordId}\nError: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// NEW: PB Posts Sync Endpoint (POST or GET)
router.all("/api/sync-pb-posts", async (req, res) => {
    try {
        const result = await syncPBPostsToAirtable();
        res.json({
            status: "success",
            message: `PB posts sync completed.`,
            details: result
        });
    } catch (err) {
        console.error("Error in /api/sync-pb-posts:", err);
        res.status(500).json({ status: "error", error: err.message });
    }
});

// Manual Batch Score Trigger
router.get("/run-batch-score", async (req, res) => {
    // ... (this route remains the same as you provided)
    const limit = Number(req.query.limit) || 500; 
    console.log(`apiAndJobRoutes.js: ▶︎ /run-batch-score (Gemini) hit – limit ${limit}`);
    
    if (!vertexAIClient || !geminiModelId || !airtableBase) { 
        console.error("apiAndJobRoutes.js - /run-batch-score: Cannot proceed, core dependencies not initialized/available for batchScorer.");
        return res.status(503).send("Service temporarily unavailable due to configuration issues preventing batch scoring.");
    }

    batchScorer.run(req, res, { 
        vertexAIClient: vertexAIClient, 
        geminiModelId: geminiModelId, 
        airtableBase: airtableBase 
    })
        .then(() => {
            console.log(`apiAndJobRoutes.js: Invocation of batchScorer.run for up to ${limit} leads (Gemini) has completed its initiation.`);
        })
        .catch((err) => {
            console.error("apiAndJobRoutes.js - Error from batchScorer.run invocation:", err.message, err.stack);
            if (res && res.status && !res.headersSent) { 
                res.status(500).send("Failed to properly initiate batch scoring due to an internal error (apiAndJobRoutes).");
            }
        });
});

// One-off Lead Scorer
router.get("/score-lead", async (req, res) => {
    // ... (this route remains the same as you provided)
    console.log("apiAndJobRoutes.js: /score-lead endpoint hit");
    if (!vertexAIClient || !geminiModelId || !airtableBase) {
        console.error("apiAndJobRoutes.js - /score-lead: Cannot proceed, core dependencies (VertexAI Client, Model ID, or Airtable Base) not initialized for single scoring.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        const id = req.query.recordId;
        if (!id) return res.status(400).json({ error: "recordId query param required" });

        console.log(`apiAndJobRoutes.js: ▶︎ /score-lead (Gemini) for recordId: ${id}`);
        const record = await airtableBase("Leads").find(id); 
        const profile = JSON.parse(record.get("Profile Full JSON") || "{}");

        const aboutText = (profile.about || profile.summary || profile.linkedinDescription || "").trim();
        if (aboutText.length < 40) {
            await airtableBase("Leads").update(record.id, { 
                "AI Score": 0,
                "Scoring Status": "Skipped – Profile Full JSON Too Small",
                "AI Profile Assessment": "",
                "AI Attribute Breakdown": ""
            });
            console.log(`apiAndJobRoutes.js: Lead ${id} skipped, profile too small.`);
            return res.json({ ok: true, skipped: true, reason: "Profile JSON too small" });
        }

        if (isMissingCritical(profile)) { 
            let hasExp = Array.isArray(profile.experience) && profile.experience.length > 0;
            if (!hasExp) for (let i = 1; i <= 5; i++) if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) { hasExp = true; break; }
            await alertAdmin( 
                "Incomplete lead for single scoring",
                `Rec ID: ${record.id}\nURL: ${profile.linkedinProfileUrl || profile.profile_url || "unknown"}\nHeadline: ${!!profile.headline}, About: ${aboutText.length >= 40}, Job info: ${hasExp}`
            );
        }
        
        const geminiScoredOutput = await scoreLeadNow(profile, { vertexAIClient, geminiModelId }); 

        if (!geminiScoredOutput) { throw new Error("singleScorer (scoreLeadNow) did not return valid output."); }

        let { 
            positive_scores = {}, 
            negative_scores = {}, 
            attribute_reasoning = {},
            contact_readiness = false, 
            unscored_attributes = [], 
            aiProfileAssessment = "N/A",
            ai_excluded = "No", 
            exclude_details = ""
        } = geminiScoredOutput;
        
        const { positives, negatives } = await loadAttributes();

        let temp_positive_scores = {...positive_scores};
        if (contact_readiness && positives?.I && (temp_positive_scores.I === undefined || temp_positive_scores.I === null)) {
            temp_positive_scores.I = positives.I.maxPoints || 0; 
            if (!attribute_reasoning.I && temp_positive_scores.I > 0) { 
                attribute_reasoning.I = "Contact readiness indicated by AI, points awarded for attribute I.";
            }
        }

        const { percentage, rawScore: earned, denominator: max } = computeFinalScore( 
            temp_positive_scores, 
            positives, 
            negative_scores, negatives,
            contact_readiness, unscored_attributes
        );
        const finalPct = Math.round(percentage * 100) / 100;

        const breakdown = buildAttributeBreakdown( 
            temp_positive_scores, 
            positives, 
            negative_scores, negatives,
            unscored_attributes, earned, max,
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
            "AI_Excluded": (ai_excluded === "Yes" || ai_excluded === true),
            "Exclude Details": exclude_details
        });

        console.log(`apiAndJobRoutes.js: Lead ${id} scored successfully. Final Pct: ${finalPct}`);
        res.json({ id, finalPct, aiProfileAssessment, breakdown });

    } catch (err) {
        console.error(`apiAndJobRoutes.js - Error in /score-lead for ${req.query.recordId}:`, err.message, err.stack);
        await alertAdmin("Single Scoring Failed", `Record ID: ${req.query.recordId}\nError: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

// Debug Gemini Info Route
router.get("/debug-gemini-info", (_req, res) => {
    // ... (this route remains the same as you provided)
    console.log("apiAndJobRoutes.js: /debug-gemini-info endpoint hit");
    const modelIdForScoring = geminiConfig?.geminiModel?.model 
        ? geminiConfig.geminiModel.model 
        : (process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06 (default, client not init)");

    res.json({
        message: "Gemini Scorer Debug Info (from apiAndJobRoutes.js)",
        model_id_for_scoring: modelIdForScoring, 
        batch_scorer_model_id: geminiModelId || process.env.GEMINI_MODEL_ID, 
        project_id: process.env.GCP_PROJECT_ID, 
        location: process.env.GCP_LOCATION,       
        global_client_available_in_routes_file: !!vertexAIClient, 
        default_model_instance_available_in_routes_file: !!(geminiConfig && geminiConfig.geminiModel),
        gpt_chat_url_for_pointer_api: process.env.GPT_CHAT_URL || "Not Set"
    });
});

module.exports = router;