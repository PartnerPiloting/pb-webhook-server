// routes/apiAndJobRoutes.js

const express = require('express');
const router = express.Router();
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// Luxon for reliable timezone math
const { DateTime } = require("luxon");

// --- Dependencies ---
const geminiConfig = require('../config/geminiClient.js');
const airtableBase = require('../config/airtableClient.js');
const syncPBPostsToAirtable = require("../utils/pbPostsSync.js"); // <-- Make sure this exists!

const vertexAIClient = geminiConfig ? geminiConfig.vertexAIClient : null;
const geminiModelId = geminiConfig ? geminiConfig.geminiModelId : null;
const globalGeminiModel = geminiConfig ? geminiConfig.geminiModel : null;

const { scoreLeadNow } = require('../singleScorer.js');
const batchScorer = require('../batchScorer.js');

const { loadAttributes } = require('../attributeLoader.js');
const { computeFinalScore } = require('../scoring.js');
const { buildAttributeBreakdown } = require('../breakdown.js');

const { alertAdmin, isMissingCritical } = require('../utils/appHelpers.js');

// The URL for your /enqueue endpoint (on the same server)
const ENQUEUE_URL = `${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + (process.env.PORT || 3000)}/enqueue`;

/* ------------------------------------------------------------------
    Route Definitions
------------------------------------------------------------------*/

// Health Check
router.get("/health", (_req, res) => {
    console.log("apiAndJobRoutes.js: /health endpoint hit");
    res.send("ok from apiAndJobRoutes");
});

// New Endpoint: Trigger PB LinkedIn Activity Extractor by API (today's leads, limit 100)
router.post("/api/run-pb-activity-extractor", async (req, res) => {
    try {
        // Fetch credentials from Airtable "Credentials"
        const credsRecords = await airtableBase("Credentials").select({ maxRecords: 1 }).firstPage();
        if (!credsRecords || credsRecords.length === 0) throw new Error("No records found in Credentials table.");
        const creds = credsRecords[0];

        const pbKey = creds.get("Phantom API Key");
        const sessionCookie = creds.get("LinkedIn Cookie");
        const userAgent = creds.get("User-Agent");
        const extractorAgentId = creds.get("PB Activity Extractor Agent ID"); // <-- The new field!

        if (!pbKey || !sessionCookie || !userAgent || !extractorAgentId) {
            throw new Error(`Missing credentials in Airtable (Phantom API Key, LinkedIn Cookie, User-Agent, or PB Activity Extractor Agent ID)`);
        }

        // ==== [TIMEZONE FIX] Get AEST midnight as UTC for Airtable filtering ====
        // Airtable "Date Created" is always UTC. We want records created since midnight AEST.
        // 1. Get now in AEST (Australia/Brisbane is UTC+10, no daylight savings)
        const nowAEST = DateTime.now().setZone("Australia/Brisbane");
        // 2. Get midnight in AEST, then convert to UTC ISO string (what Airtable expects)
        const midnightAEST_utc = nowAEST.startOf('day').toUTC().toISO();
        // 3. Use this for the Airtable filter:
        //    filterByFormula: IS_AFTER({Date Created}, '[midnightAEST_utc]')

        // Find leads created since AEST midnight (today)
        const leads = await airtableBase("Leads")
            .select({
                filterByFormula: `IS_AFTER({Date Created}, '${midnightAEST_utc}')`,
                maxRecords: 100
            })
            .firstPage();

        if (!leads || leads.length === 0) {
            return res.json({ ok: false, message: "No leads found created today." });
        }

        // 2. Build input array of LinkedIn Profile URLs (Phantom expects an array of { profileUrl } objects)
        const inputArr = leads
            .map(record => {
                const url = record.get("LinkedIn Profile URL");
                if (url) return { profileUrl: url.trim() };
                return null;
            })
            .filter(Boolean);

        if (inputArr.length === 0) {
            return res.json({ ok: false, message: "No leads with LinkedIn Profile URLs found." });
        }

        // 3. Trigger the Phantom by API
        const triggerUrl = `https://api.phantombuster.com/api/v2/agents/launch`;
        const body = {
            id: extractorAgentId,
            arguments: {
                spreadsheet: inputArr, // Pass array of objects as "spreadsheet" input param
            }
        };

        const response = await fetch(triggerUrl, {
            method: "POST",
            headers: {
                "X-Phantombuster-Key-1": pbKey,
                "Content-Type": "application/json",
                "User-Agent": userAgent,
                "cookie": sessionCookie
            },
            body: JSON.stringify(body)
        });

        const pbResult = await response.json();

        if (!response.ok) {
            return res.status(500).json({ ok: false, error: pbResult });
        }

        res.json({
            ok: true,
            message: `Triggered PB Activity Extractor with ${inputArr.length} profiles.`,
            result: pbResult
        });

    } catch (err) {
        console.error("Error in /api/run-pb-activity-extractor:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// (Rest of the file remains unchanged)
// --- Existing Endpoints follow below ---

// New Endpoint to Initiate Phantombuster Message Sending
router.get("/api/initiate-pb-message", async (req, res) => {
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
        const credsRecords = await airtableBase("Credentials").select({ maxRecords: 1 }).firstPage();
        if (!credsRecords || credsRecords.length === 0) {
            throw new Error("No records found in Credentials table.");
        }
        const creds = credsRecords[0];

        const agentId = creds.get("PB Message Sender ID");
        const pbKey = creds.get("Phantom API Key");
        const sessionCookie = creds.get("LinkedIn Cookie");
        const userAgent = creds.get("User-Agent");

        if (!agentId || !pbKey || !sessionCookie || !userAgent) {
            let missing = [];
            if (!agentId) missing.push("PB Message Sender ID");
            if (!pbKey) missing.push("Phantom API Key");
            if (!sessionCookie) missing.push("LinkedIn Cookie");
            if (!userAgent) missing.push("User-Agent");
            throw new Error(`Missing Phantombuster credentials in Airtable: ${missing.join(', ')}`);
        }

        // 2. Fetch Lead Details from Airtable "Leads" table
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

        // 3. Construct the job payload for /enqueue
        const jobPayload = {
            recordId: recordId,
            agentId: agentId,
            pbKey: pbKey,
            sessionCookie: sessionCookie,
            userAgent: userAgent,
            profileUrl: profileUrl,
            message: message
        };

        // 4. Make an HTTP POST request to the server's own /enqueue endpoint
        const enqueueResponse = await fetch(ENQUEUE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(jobPayload)
        });

        const enqueueResponseData = await enqueueResponse.json();

        if (!enqueueResponse.ok || !enqueueResponseData.queued) {
            throw new Error(`Failed to enqueue job: ${enqueueResponseData.error || `Status ${enqueueResponse.status}`}`);
        }

        // 5. Optionally, update the lead's status in Airtable here
        try {
            await airtableBase("Leads").update(recordId, {
                "Message Status": "Queuing Initiated by Server"
            });
        } catch (airtableUpdateError) {
            console.warn(`Could not update lead ${recordId} status after enqueue:`, airtableUpdateError.message);
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

// --- PB Posts Sync Endpoint (manual trigger for testing/debug) ---
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

// --- PHANTOMBUSTER WEBHOOK ENDPOINT ---
router.post("/api/pb-webhook", async (req, res) => {
    try {
        const secret = req.query.secret || req.body.secret;
        if (!secret || secret !== process.env.PB_WEBHOOK_SECRET) {
            console.warn("Invalid or missing PB webhook secret");
            return res.status(403).json({ error: "Forbidden" });
        }
        // Log received body for debug
        console.log("Received PB webhook:", JSON.stringify(req.body).substring(0, 1000));
        // If the webhook payload has a 'resultObject' property, parse it as JSON (PB's default format)
        let postsInput = req.body;
        if (postsInput && typeof postsInput === "object" && Array.isArray(postsInput.resultObject)) {
            postsInput = postsInput.resultObject;
        } else if (postsInput && typeof postsInput === "object" && typeof postsInput.resultObject === "string") {
            // Some PB agents send resultObject as a stringified array
            try {
                postsInput = JSON.parse(postsInput.resultObject);
            } catch (err) {
                console.error("Could not parse resultObject:", err);
                return res.status(400).json({ error: "Invalid resultObject format" });
            }
        } else if (postsInput && !Array.isArray(postsInput)) {
            // If it's a single post object, wrap in array
            postsInput = [postsInput];
        }
        // Pass only the array of post(s) to syncPBPostsToAirtable
        const result = await syncPBPostsToAirtable(postsInput);
        res.json({ ok: true, processed: result });
    } catch (err) {
        console.error("Error in /api/pb-webhook:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// Manual Batch Score Trigger
router.get("/run-batch-score", async (req, res) => {
    const limit = Number(req.query.limit) || 500;
    if (!vertexAIClient || !geminiModelId || !airtableBase) {
        return res.status(503).send("Service temporarily unavailable due to configuration issues preventing batch scoring.");
    }
    batchScorer.run(req, res, {
        vertexAIClient: vertexAIClient,
        geminiModelId: geminiModelId,
        airtableBase: airtableBase
    })
        .then(() => { })
        .catch((err) => {
            if (res && res.status && !res.headersSent) {
                res.status(500).send("Failed to properly initiate batch scoring due to an internal error (apiAndJobRoutes).");
            }
        });
});

// One-off Lead Scorer
router.get("/score-lead", async (req, res) => {
    if (!vertexAIClient || !geminiModelId || !airtableBase) {
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        const id = req.query.recordId;
        if (!id) return res.status(400).json({ error: "recordId query param required" });

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

        let temp_positive_scores = { ...positive_scores };
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

        res.json({ id, finalPct, aiProfileAssessment, breakdown });

    } catch (err) {
        await alertAdmin("Single Scoring Failed", `Record ID: ${req.query.recordId}\nError: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

// Debug Gemini Info Route
router.get("/debug-gemini-info", (_req, res) => {
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