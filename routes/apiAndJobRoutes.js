// routes/apiAndJobRoutes.js
// This version assumes your singleScorer.scoreLeadNow expects { vertexAIClient, geminiModelId }

const express = require('express');
const router = express.Router();
const fs = require('fs'); 
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// --- Dependencies ---
const geminiConfig = require('../config/geminiClient.js'); 
const airtableBase = require('../config/airtableClient.js'); 

// Extract what's needed by this file
const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null;
const geminiModelId = geminiConfig ? geminiConfig.geminiModelId : null;  
// globalGeminiModel is also available via geminiConfig.geminiModel if needed by a route that doesn't use vertexAIClient directly

const { upsertLead } = require('../services/leadService.js');
const { scoreLeadNow } = require('../singleScorer.js');   // Expects { vertexAIClient, geminiModelId }
const batchScorer = require('../batchScorer.js');         

const { loadAttributes } = require('../attributeLoader.js'); 
const { computeFinalScore } = require('../scoring.js');       
const { buildAttributeBreakdown } = require('../breakdown.js'); 

const { alertAdmin, getJsonUrl, isMissingCritical } = require('../utils/appHelpers.js');

// --- Phantombuster Logic --- (This was correctly in your last full version)
const PB_LAST_RUN_ID_FILE = "pbLastRun.txt"; 
let currentLastRunId = 0;
try {
    if (fs.existsSync(PB_LAST_RUN_ID_FILE)) {
        currentLastRunId = parseInt(fs.readFileSync(PB_LAST_RUN_ID_FILE, "utf8"), 10) || 0;
    }
    console.log(`apiAndJobRoutes.js: Initial currentLastRunId for Phantombuster pull: ${currentLastRunId}`);
} catch (fileErr) {
    console.warn(`apiAndJobRoutes.js: Could not read ${PB_LAST_RUN_ID_FILE}, starting with currentLastRunId = 0:`, fileErr.message);
}

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
    // ***** MODIFICATION 1: Update dependency check *****
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
        
        // ***** MODIFICATION 2: Update call to scoreLeadNow *****
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

        // This "I" attribute logic is already in your current version - GOOD!
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

        // showZeros=false is already in your current version - GOOD!
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

// API Test Score
router.post("/api/test-score", async (req, res) => {
    console.log("apiAndJobRoutes.js: /api/test-score endpoint hit");
    // ***** MODIFICATION 1: Update dependency check *****
    if (!vertexAIClient || !geminiModelId || !airtableBase ) { 
        console.error("apiAndJobRoutes.js - /api/test-score: Cannot proceed, core dependencies (VertexAI Client, Model ID, or Airtable Base) not initialized for single scoring.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        const leadProfileData = req.body || {};
        console.log("apiAndJobRoutes.js: ▶︎ /api/test-score (Gemini) hit with lead data.");

        if (typeof leadProfileData !== 'object' || leadProfileData === null || Object.keys(leadProfileData).length === 0) {
            return res.status(400).json({ error: "Request body must be a valid lead profile object." });
        }
        
        // ***** MODIFICATION 2: Update call to scoreLeadNow *****
        const geminiScoredOutput = await scoreLeadNow(leadProfileData, { vertexAIClient, geminiModelId });

        if (!geminiScoredOutput) { throw new Error("scoreLeadNow (Gemini) did not return valid output for /api/test-score."); }
        
        let { 
            positive_scores = {}, 
            negative_scores = {}, 
            attribute_reasoning = {},
            contact_readiness = false, 
            unscored_attributes = [], 
            aiProfileAssessment = "N/A"
        } = geminiScoredOutput;

        const { positives, negatives } = await loadAttributes();

        // This "I" attribute logic is already in your current version - GOOD!
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

        // showZeros=false is already in your current version - GOOD!
        const breakdown = buildAttributeBreakdown(
            temp_positive_scores, 
            positives, 
            negative_scores, negatives,
            unscored_attributes, earned, max,
            attribute_reasoning, 
            false, 
            null
        );
        
        console.log(`apiAndJobRoutes.js: /api/test-score (Gemini) result - Final Pct: ${finalPct}`);
        res.json({ finalPct, breakdown, assessment: aiProfileAssessment, rawGeminiOutput: geminiScoredOutput });

    } catch (err) {
        console.error("apiAndJobRoutes.js - Error in /api/test-score (Gemini):", err.message, err.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

// Phantombuster Pull Connections
router.get("/pb-pull/connections", async (req, res) => {
    console.log("apiAndJobRoutes.js: /pb-pull/connections endpoint hit");
    if (!airtableBase) { 
        console.error("apiAndJobRoutes.js - /pb-pull/connections: Cannot proceed, Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        const headers = { "X-Phantombuster-Key-1": process.env.PB_API_KEY };
        if (!process.env.PB_API_KEY || !process.env.PB_AGENT_ID) {
            throw new Error("Phantombuster API Key or Agent ID not configured.");
        }
        const listURL = `https://api.phantombuster.com/api/v1/agent/${process.env.PB_AGENT_ID}/containers?limit=25`;
        console.log(`apiAndJobRoutes.js: ▶︎ /pb-pull/connections: Fetching containers. Current recorded lastRunId: ${currentLastRunId}`);

        const listResp = await fetch(listURL, { headers });
        if (!listResp.ok) throw new Error(`Phantombuster API error (list containers): ${listResp.status} ${await listResp.text()}`);
        const listJson = await listResp.json();
        
        const runs = (listJson.data || [])
            .filter((r) => r.lastEndStatus === "success")
            .sort((a, b) => Number(a.id) - Number(b.id));

        let totalUpsertedInThisRun = 0;
        let newLastRunIdForThisJob = currentLastRunId;

        for (const run of runs) {
            const phantombusterRunId = Number(run.id); 
            if (phantombusterRunId <= currentLastRunId) continue;
            console.log(`apiAndJobRoutes.js: Processing Phantombuster run ID: ${phantombusterRunId}`);
            const resultResp = await fetch(`https://api.phantombuster.com/api/v2/containers/fetch-result-object?id=${run.id}`, { headers });
            if (!resultResp.ok) { console.error(`PB API error (fetch result ${run.id}): ${resultResp.status} ${await resultResp.text()}`); continue; }
            const resultObj = await resultResp.json();
            const jsonUrl = getJsonUrl(resultObj); 
            let conns;
            if (jsonUrl) {
                const connResp = await fetch(jsonUrl);
                if (!connResp.ok) { console.error(`Error fetching JSON from URL for run ${run.id}: ${connResp.status}`); continue; }
                conns = await connResp.json();
            } else if (Array.isArray(resultObj.resultObject)) conns = resultObj.resultObject;
            else if (Array.isArray(resultObj.data?.resultObject)) conns = resultObj.data.resultObject;
            else { console.error(`No parsable results for PB run ${run.id}`); newLastRunIdForThisJob = Math.max(newLastRunIdForThisJob, phantombusterRunId); continue; }
            if (!Array.isArray(conns)) { console.error(`Connections data for run ${run.id} not an array.`); newLastRunIdForThisJob = Math.max(newLastRunIdForThisJob, phantombusterRunId); continue; }
            const testLimit = req.query.limit ? Number(req.query.limit) : null;
            if (testLimit) conns = conns.slice(0, testLimit);
            console.log(`apiAndJobRoutes.js: Processing ${conns.length} connections from PB run ${phantombusterRunId}.`);
            for (const c of conns) {
                try {
                    const leadDataForUpsert = {
                        ...c, raw: c, connectionDegree: "1st",
                        linkedinProfileUrl: (c.profileUrl || c.linkedinProfileUrl || "").replace(/\/$/, ""),
                        scoringStatus: "To Be Scored" 
                    };
                    await upsertLead(leadDataForUpsert); 
                    totalUpsertedInThisRun++;
                } catch (upsertErr) {
                    console.error(`apiAndJobRoutes.js - Error upserting a lead in /pb-pull/connections (URL: ${c.profileUrl || 'N/A'}):`, upsertErr.message);
                }
            }
            newLastRunIdForThisJob = Math.max(newLastRunIdForThisJob, phantombusterRunId);
            console.log(`apiAndJobRoutes.js: Finished processing PB run ${phantombusterRunId}. Updated lastRunId for this job to ${newLastRunIdForThisJob}.`);
        }

        if (newLastRunIdForThisJob > currentLastRunId) {
            try {
                fs.writeFileSync(PB_LAST_RUN_ID_FILE, String(newLastRunIdForThisJob));
                console.log(`apiAndJobRoutes.js: Successfully wrote new lastRunId ${newLastRunIdForThisJob} to ${PB_LAST_RUN_ID_FILE}`);
                currentLastRunId = newLastRunIdForThisJob; 
            } catch (writeErr) {
                console.error(`apiAndJobRoutes.js - Failed to write lastRunId ${newLastRunIdForThisJob} to file:`, writeErr.message);
                await alertAdmin("Failed to write PB lastRunId", `File: ${PB_LAST_RUN_ID_FILE}, ID: ${newLastRunIdForThisJob}. Error: ${writeErr.message}`);
             }
        }
        
        const finalMessage = `Upserted/updated ${totalUpsertedInThisRun} profiles from Phantombuster. Current lastRunId for this job is ${currentLastRunId}.`;
        console.log(finalMessage);
        if (!res.headersSent) {
             res.json({ message: finalMessage, newProfiles: totalUpsertedInThisRun });
        }
    } catch (err) {
        console.error("apiAndJobRoutes.js - Critical error in /pb-pull/connections:", err.message, err.stack);
        await alertAdmin("Critical Error in /pb-pull/connections", `Error: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

// Debug Gemini Info Route
router.get("/debug-gemini-info", (_req, res) => {
    console.log("apiAndJobRoutes.js: /debug-gemini-info endpoint hit");
    // Use globalGeminiModel available in this file's scope (which comes from geminiConfig)
    const modelIdForScoring = geminiConfig?.geminiModel?.model // Check geminiConfig and geminiModel before accessing model
        ? geminiConfig.geminiModel.model 
        : (process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06 (default, client not init)");

    res.json({
        message: "Gemini Scorer Debug Info (from apiAndJobRoutes.js)",
        model_id_for_scoring: modelIdForScoring, 
        batch_scorer_model_id: geminiModelId || process.env.GEMINI_MODEL_ID, 
        project_id: process.env.GCP_PROJECT_ID, 
        location: process.env.GCP_LOCATION,     
        global_client_available_in_routes_file: !!vertexAIClient, 
        default_model_instance_available_in_routes_file: !!(geminiConfig && geminiConfig.geminiModel), // Check the actual default model instance
        gpt_chat_url_for_pointer_api: process.env.GPT_CHAT_URL || "Not Set"
    });
});

module.exports = router;