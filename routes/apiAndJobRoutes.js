// routes/apiAndJobRoutes.js
// REMOVED: /pb-pull/connections route and its top-level fs/Phantombuster file logic.

const express = require('express');
const router = express.Router();
// No longer need: const fs = require('fs'); 
// fetch is not used by any remaining routes in this file.
// const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args)); 

// --- Dependencies ---
const geminiConfig = require('../config/geminiClient.js'); 
const airtableBase = require('../config/airtableClient.js'); 

const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null;
const geminiModelId = geminiConfig ? geminiConfig.geminiModelId : null;  
const globalGeminiModel = geminiConfig ? geminiConfig.geminiModel : null; // Retained as /debug-gemini-info uses it

// upsertLead and getJsonUrl were only used by the removed /pb-pull/connections in this file.
// const { upsertLead } = require('../services/leadService.js'); 
const { scoreLeadNow } = require('../singleScorer.js');   // Expects { vertexAIClient, geminiModelId }
const batchScorer = require('../batchScorer.js');         

const { loadAttributes } = require('../attributeLoader.js'); 
const { computeFinalScore } = require('../scoring.js');       
const { buildAttributeBreakdown } = require('../breakdown.js'); 

// getJsonUrl was only used by the removed /pb-pull/connections route.
const { alertAdmin, isMissingCritical /*, getJsonUrl */ } = require('../utils/appHelpers.js'); 

/*
    BLOCK REMOVED: Phantombuster Logic for currentLastRunId and PB_LAST_RUN_ID_FILE
    (As the /pb-pull/connections route that used this has been removed)
*/

/* ------------------------------------------------------------------
    Route Definitions
------------------------------------------------------------------*/

// Health Check
router.get("/health", (_req, res) => {
    console.log("apiAndJobRoutes.js: /health endpoint hit");
    res.send("ok from apiAndJobRoutes");
});

// Manual Batch Score Trigger
router.get("/run-batch-score", async (req, res) => {
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

/*
    BLOCK REMOVED: The /api/test-score route handler that was previously here.
    This endpoint is now solely handled by scoreApi.js (mounted in index.js).
*/

/*
    BLOCK REMOVED: Phantombuster Pull Connections route handler (/pb-pull/connections)
    As this functionality is now considered obsolete.
*/

// Debug Gemini Info Route
router.get("/debug-gemini-info", (_req, res) => {
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