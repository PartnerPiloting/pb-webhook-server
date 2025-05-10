console.log("<<<<< INDEX.JS - REFACTOR 4 - MOVED WEBHOOK ROUTES - TOP OF FILE >>>>>"); // Updated log
/***************************************************************
 Main Server File - LinkedIn → Airtable (Scoring + 1st-degree sync)
***************************************************************/
require("dotenv").config(); 

// --- CONFIGURATIONS LOADED FROM config/ FOLDER ---
const globalGeminiModel = require('./config/geminiClient.js');
const base = require('./config/airtableClient.js'); 

// --- NPM MODULES ---
const express = require("express");
const fs = require("fs"); 
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// --- LOCAL HELPER & SERVICE MODULES ---
const { buildPrompt, slimLead }    = require("./promptBuilder");
const { loadAttributes }          = require("./attributeLoader");
const { computeFinalScore }       = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");
const { scoreLeadNow }            = require("./singleScorer"); // Used by /score-lead and /api/test-score
const batchScorer                 = require("./batchScorer");   // Used by /run-batch-score
const { alertAdmin, getJsonUrl, canonicalUrl, isAustralian, safeDate, getLastTwoOrgs, isMissingCritical } = require('./utils/appHelpers.js');
const { upsertLead }              = require('./services/leadService.js'); // Used by /pb-pull/connections (and now by routes in webhookHandlers.js)

console.log("<<<<< INDEX.JS - REFACTOR 4 - AFTER ALL REQUIRES >>>>>");

// --- INITIALIZATION CHECKS ---
if (!globalGeminiModel) {
    console.error("FATAL ERROR in index.js: Gemini Model failed to initialize. Scoring will not work. Check logs in config/geminiClient.js.");
} else {
    console.log("index.js: Gemini Model loaded successfully from config.");
}
if (!base) {
    console.error("FATAL ERROR in index.js: Airtable Base failed to initialize. Airtable operations will fail. Check logs in config/airtableClient.js.");
} else {
    console.log("index.js: Airtable Base loaded successfully from config.");
}

/* ---------- ENV CONFIGURATION (App-level) --- */
const GPT_CHAT_URL = process.env.GPT_CHAT_URL; 

/* ------------------------------------------------------------------
    1)  Globals & Express App Setup
------------------------------------------------------------------*/
const app = express();
app.use(express.json({ limit: "10mb" }));

/* mount miscellaneous sub-APIs AND ROUTE HANDLERS */
require("./promptApi")(app); 
require("./recordApi")(app);
require("./scoreApi")(app); 
const mountQueue = require("./queueDispatcher");
mountQueue(app);

// Mount the new webhook handlers
const webhookRoutes = require('./routes/webhookHandlers.js'); // <-- ADDED THIS REQUIRE
app.use(webhookRoutes);                                         // <-- ADDED THIS TO USE THE ROUTES

// TODO: Re-add mountPointerApi, mountLatestLead, mountUpdateLead here

/* ------------------------------------------------------------------
    1.5) health check + manual batch route
------------------------------------------------------------------*/
app.get("/health", (_req, res) => res.send("ok"));

app.get("/run-batch-score", async (req, res) => {
    const limit = Number(req.query.limit) || 500;
    console.log(`▶︎ /run-batch-score (Gemini) hit – limit ${limit}`);
    
    if (!globalGeminiModel || !base) { 
        console.error("/run-batch-score: Cannot proceed, Gemini Model or Airtable Base not initialized.");
        return res.status(503).send("Service temporarily unavailable due to configuration issues.");
    }
    batchScorer.run(req, res) 
        .then(() => {
            console.log(`Invocation of batchScorer.run for up to ${limit} leads (Gemini) is complete.`);
        })
        .catch((err) => {
            console.error("Error from batchScorer.run invocation:", err);
            if (res && !res.headersSent) {
                res.status(500).send("Failed to properly initiate batch scoring due to an internal error.");
            }
        });
});

/* ------------------------------------------------------------------
    ONE-OFF LEAD SCORER – /score-lead?recordId=recXXXXXXXX
------------------------------------------------------------------*/
app.get("/score-lead", async (req, res) => {
    if (!globalGeminiModel || !base) {
        console.error("/score-lead: Cannot proceed, Gemini Model or Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        const id = req.query.recordId;
        if (!id) return res.status(400).json({ error: "recordId query param required" });

        console.log(`▶︎ /score-lead (Gemini) for recordId: ${id}`);
        const record = await base("Leads").find(id); 
        const profile = JSON.parse(record.get("Profile Full JSON") || "{}");

        const aboutText = (profile.about || profile.summary || profile.linkedinDescription || "").trim();
        if (aboutText.length < 40) {
            await base("Leads").update(record.id, {
                "AI Score": 0,
                "Scoring Status": "Skipped – Profile Full JSON Too Small",
                "AI Profile Assessment": "",
                "AI Attribute Breakdown": ""
            });
            console.log(`Lead ${id} skipped, profile too small.`);
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
        
        const geminiScoredOutput = await scoreLeadNow(profile, globalGeminiModel); 

        if (!geminiScoredOutput) { throw new Error("singleScorer (scoreLeadNow) did not return valid output."); }

        const {
            positive_scores = {}, negative_scores = {}, attribute_reasoning = {},
            contact_readiness = false, unscored_attributes = [], aiProfileAssessment = "N/A",
            ai_excluded = "No", exclude_details = ""
        } = geminiScoredOutput;

        const { positives, negatives } = await loadAttributes();
        const { percentage, rawScore: earned, denominator: max } = computeFinalScore( 
            positive_scores, positives,
            negative_scores, negatives,
            contact_readiness, unscored_attributes
        );
        const finalPct = Math.round(percentage * 100) / 100;

        const breakdown = buildAttributeBreakdown( 
            positive_scores, positives,
            negative_scores, negatives,
            unscored_attributes, earned, max,
            attribute_reasoning, true, null
        );

        await base("Leads").update(id, { 
            "AI Score": finalPct,
            "AI Profile Assessment": aiProfileAssessment,
            "AI Attribute Breakdown": breakdown,
            "Scoring Status": "Scored",
            "Date Scored": new Date().toISOString().split("T")[0],
            "AI_Excluded": (ai_excluded === "Yes" || ai_excluded === true),
            "Exclude Details": exclude_details
        });

        console.log(`Lead ${id} scored successfully. Final Pct: ${finalPct}`);
        res.json({ id, finalPct, aiProfileAssessment, breakdown });

    } catch (err) {
        console.error(`Error in /score-lead for ${req.query.recordId}:`, err.message, err.stack);
        await alertAdmin("Single Scoring Failed", `Record ID: ${req.query.recordId}\nError: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

/* ------------------------------------------------------------------
    6)  /api/test-score 
------------------------------------------------------------------*/
app.post("/api/test-score", async (req, res) => {
    if (!globalGeminiModel || !base) {
        console.error("/api/test-score: Cannot proceed, Gemini Model or Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        const leadProfileData = req.body || {};
        console.log("▶︎ /api/test-score (Gemini) hit with lead data.");

        if (typeof leadProfileData !== 'object' || leadProfileData === null || Object.keys(leadProfileData).length === 0) {
            return res.status(400).json({ error: "Request body must be a valid lead profile object." });
        }
        
        const geminiScoredOutput = await scoreLeadNow(leadProfileData, globalGeminiModel);

        if (!geminiScoredOutput) {
            throw new Error("scoreLeadNow (Gemini) did not return valid output for /api/test-score.");
        }
        
        const {
            positive_scores = {}, negative_scores = {}, attribute_reasoning = {},
            contact_readiness = false, unscored_attributes = [], aiProfileAssessment = "N/A"
        } = geminiScoredOutput;

        const { positives, negatives } = await loadAttributes();
        const { percentage, rawScore: earned, denominator: max } = computeFinalScore(
            positive_scores, positives,
            negative_scores, negatives,
            contact_readiness, unscored_attributes
        );
        const finalPct = Math.round(percentage * 100) / 100;

        const breakdown = buildAttributeBreakdown(
            positive_scores, positives,
            negative_scores, negatives,
            unscored_attributes, earned, max,
            attribute_reasoning, true, null
        );
        
        console.log(`/api/test-score (Gemini) result - Final Pct: ${finalPct}`);
        res.json({ finalPct, breakdown, assessment: aiProfileAssessment, rawGeminiOutput: geminiScoredOutput });

    } catch (err) {
        console.error("Error in /api/test-score (Gemini):", err.message, err.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

/*
    BLOCK REMOVED: /pb-webhook/scrapeLeads route handler
    (Now handled in routes/webhookHandlers.js)
*/

/*
    BLOCK REMOVED: /lh-webhook/upsertLeadOnly route handler
    (Now handled in routes/webhookHandlers.js)
*/

/* ------------------------------------------------------------------
    9)  /pb-pull/connections
------------------------------------------------------------------*/
let currentLastRunId = 0; 
const PB_LAST_RUN_ID_FILE = "pbLastRun.txt"; 
try {
    if (fs.existsSync(PB_LAST_RUN_ID_FILE)) {
        currentLastRunId = parseInt(fs.readFileSync(PB_LAST_RUN_ID_FILE, "utf8"), 10) || 0;
    }
    console.log("Initial currentLastRunId for Phantombuster pull:", currentLastRunId);
} catch (fileErr) {
    console.warn(`Could not read ${PB_LAST_RUN_ID_FILE}, starting with currentLastRunId = 0:`, fileErr.message);
}

app.get("/pb-pull/connections", async (req, res) => {
    if (!base) { 
        console.error("/pb-pull/connections: Cannot proceed, Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        const headers = { "X-Phantombuster-Key-1": process.env.PB_API_KEY };
        if (!process.env.PB_API_KEY || !process.env.PB_AGENT_ID) {
            throw new Error("Phantombuster API Key or Agent ID not configured.");
        }
        const listURL = `https://api.phantombuster.com/api/v1/agent/${process.env.PB_AGENT_ID}/containers?limit=25`;
        console.log(`▶︎ /pb-pull/connections: Fetching containers. Current recorded lastRunId for this job: ${currentLastRunId}`);

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
            console.log(`Processing Phantombuster run ID: ${phantombusterRunId}`);

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
            console.log(`Processing ${conns.length} connections from PB run ${phantombusterRunId}.`);

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
                    console.error(`Error upserting a lead in /pb-pull/connections (URL: ${c.profileUrl || 'N/A'}):`, upsertErr.message);
                }
            }
            newLastRunIdForThisJob = Math.max(newLastRunIdForThisJob, phantombusterRunId);
            console.log(`Finished processing PB run ${phantombusterRunId}. Updated lastRunId for this job to ${newLastRunIdForThisJob}.`);
        }

        if (newLastRunIdForThisJob > currentLastRunId) {
            try {
                fs.writeFileSync(PB_LAST_RUN_ID_FILE, String(newLastRunIdForThisJob));
                console.log(`Successfully wrote new lastRunId ${newLastRunIdForThisJob} to ${PB_LAST_RUN_ID_FILE}`);
                currentLastRunId = newLastRunIdForThisJob; 
            } catch (writeErr) {
                console.error(`Failed to write lastRunId ${newLastRunIdForThisJob} to file:`, writeErr.message);
                await alertAdmin("Failed to write PB lastRunId", `File: ${PB_LAST_RUN_ID_FILE}, ID: ${newLastRunIdForThisJob}. Error: ${writeErr.message}`);
            }
        }
        
        const finalMessage = `Upserted/updated ${totalUpsertedInThisRun} profiles from Phantombuster. Current lastRunId for this job is ${currentLastRunId}.`;
        console.log(finalMessage);
        if (!res.headersSent) {
             res.json({ message: finalMessage, newProfiles: totalUpsertedInThisRun });
        }
    } catch (err) {
        console.error("Critical error in /pb-pull/connections:", err.message, err.stack);
        await alertAdmin("Critical Error in /pb-pull/connections", `Error: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

/* ------------------------------------------------------------------
    10) DEBUG route
------------------------------------------------------------------*/
app.get("/debug-gemini-info", (_req, res) => {
    const modelIdForScoring = globalGeminiModel && globalGeminiModel.model 
        ? globalGeminiModel.model 
        : (process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06 (default, client not init)");

    res.json({
        message: "Gemini Scorer Debug Info",
        model_id_for_scoring: modelIdForScoring, 
        batch_scorer_model_id: process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06", 
        project_id: process.env.GCP_PROJECT_ID, 
        location: process.env.GCP_LOCATION,     
        global_client_initialized: !!globalGeminiModel, 
        gpt_chat_url_for_pointer_api: GPT_CHAT_URL || "Not Set"
    });
});

/* ------------------------------------------------------------------
    11) Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
    `▶︎ Server starting – Version: Gemini Integrated (Refactor 4) – Commit ${process.env.RENDER_GIT_COMMIT || "local"
    } – ${new Date().toISOString()}`
);
app.listen(port, () => {
    console.log(`Server running on port ${port}.`);
    if (!globalGeminiModel) {
        console.error("Final Check: Server started BUT Global Gemini Model is not available. Scoring will fail.");
    } else if (!base) {
        console.error("Final Check: Server started BUT Airtable Base is not available. Airtable operations will fail.");
    }else {
        console.log("Final Check: Server started and essential services (Gemini, Airtable) appear to be loaded.");
    }
});

/* ------------------------------------------------------------------
    SECTION 4) getScoringData & helpers (Legacy - Commented Out)
------------------------------------------------------------------*/
/*
async function getScoringData() {
  // ... (implementation from your file) ...
}
function parseMarkdownTables(markdown) {
  // ... (implementation from your file) ...
}
*/