console.log("<<<<< INDEX.JS - REFACTOR 2 - MOVED CONFIG - TOP OF FILE >>>>>"); // Updated log
/***************************************************************
 Main Server File - LinkedIn → Airtable (Scoring + 1st-degree sync)
***************************************************************/
require("dotenv").config(); // Ensures environment variables are loaded first

// --- CONFIGURATIONS LOADED FROM config/ FOLDER ---
const globalGeminiModel = require('./config/geminiClient.js');
const base = require('./config/airtableClient.js'); // This is our Airtable base instance

// --- NPM MODULES ---
const express = require("express");
const fs = require("fs"); // Used for Phantombuster lastRunId file
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args)); // Used by alertAdmin (now in helpers) and PB pull

// --- LOCAL HELPER & SERVICE MODULES ---
const { buildPrompt, slimLead }    = require("./promptBuilder");
const { loadAttributes }          = require("./attributeLoader");
const { computeFinalScore }       = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");
const { scoreLeadNow }            = require("./singleScorer");
const batchScorer                 = require("./batchScorer");
const { alertAdmin, getJsonUrl, canonicalUrl, isAustralian, safeDate, getLastTwoOrgs, isMissingCritical } = require('./utils/appHelpers.js');

console.log("<<<<< INDEX.JS - REFACTOR 2 - AFTER ALL REQUIRES >>>>>");

// --- INITIALIZATION CHECKS ---
if (!globalGeminiModel) {
    console.error("FATAL ERROR in index.js: Gemini Model failed to initialize from config. Scoring will not work. Check logs in config/geminiClient.js.");
    // For a critical failure like this, you might consider exiting if the app cannot function:
    // process.exit(1); 
    // For now, we'll let it continue so server starts and logs this, but it's a critical state.
} else {
    console.log("index.js: Gemini Model loaded successfully from config.");
}

if (!base) {
    console.error("FATAL ERROR in index.js: Airtable Base failed to initialize from config. Airtable operations will fail. Check logs in config/airtableClient.js.");
    // process.exit(1);
} else {
    console.log("index.js: Airtable Base loaded successfully from config.");
}

/* ---------- ENV CONFIGURATION (App-level, distinct from client init) --- */
// MODEL_ID, GCP_PROJECT_ID, GCP_LOCATION, GCP_CREDENTIALS_JSON_STRING are now used within config/geminiClient.js
const TEST_MODE = process.env.TEST_MODE === "true";
const MIN_SCORE = Number(process.env.MIN_SCORE || 0);
const SAVE_FILTERED_ONLY = process.env.SAVE_FILTERED_ONLY === "true";
const GPT_CHAT_URL = process.env.GPT_CHAT_URL; // For pointerApi (to be re-added)

/*
    BLOCK REMOVED: GOOGLE GENERATIVE AI CLIENT INITIALIZATION 
    (Now handled in config/geminiClient.js)
*/

/*
    BLOCK REMOVED: AIRTABLE CONFIGURATION
    (Now handled in config/airtableClient.js)
*/

/* ------------------------------------------------------------------
    1)  Globals & Express App Setup
------------------------------------------------------------------*/
const app = express();
app.use(express.json({ limit: "10mb" }));

/* mount miscellaneous sub-APIs */
require("./promptApi")(app); // Assumes this and others below handle their own Airtable/Gemini needs or are passed them
require("./recordApi")(app);
require("./scoreApi")(app); 
const mountQueue = require("./queueDispatcher");
mountQueue(app);
// TODO: Re-add mountPointerApi, mountLatestLead, mountUpdateLead here, ensuring 'base' and 'GPT_CHAT_URL' are passed correctly.

/* ------------------------------------------------------------------
    1.5) health check + manual batch route
------------------------------------------------------------------*/
app.get("/health", (_req, res) => res.send("ok"));

app.get("/run-batch-score", async (req, res) => {
    const limit = Number(req.query.limit) || 500;
    console.log(`▶︎ /run-batch-score (Gemini) hit – limit ${limit}`);
    
    if (!globalGeminiModel || !base) { // Check if critical services are available
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
        const record = await base("Leads").find(id); // Uses 'base' from config
        const profile = JSON.parse(record.get("Profile Full JSON") || "{}");

        const aboutText = (profile.about || profile.summary || profile.linkedinDescription || "").trim();
        if (aboutText.length < 40) {
            await base("Leads").update(record.id, { /* ... */ });
            console.log(`Lead ${id} skipped, profile too small.`);
            return res.json({ ok: true, skipped: true, reason: "Profile JSON too small" });
        }

        if (isMissingCritical(profile)) {
            // ... alertAdmin call ...
        }
        
        // Pass the required globalGeminiModel
        const geminiScoredOutput = await scoreLeadNow(profile, globalGeminiModel); 

        if (!geminiScoredOutput) { /* ... */ }
        const { /* ... */ } = geminiScoredOutput;
        const { positives, negatives } = await loadAttributes();
        const { percentage, rawScore: earned, denominator: max } = computeFinalScore( /* ... */ );
        const finalPct = Math.round(percentage * 100) / 100;
        const breakdown = buildAttributeBreakdown( /* ... */ );
        await base("Leads").update(id, { /* ... */ });
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
    5)  upsertLead 
------------------------------------------------------------------*/
async function upsertLead( /* ... parameters ... */ ) {
    if (!base) { // Added check for base
        console.error("upsertLead: Cannot proceed, Airtable Base not initialized.");
        throw new Error("Airtable service not available for upsertLead."); 
    }
    // ... existing upsertLead logic using 'base', 'getLastTwoOrgs', 'canonicalUrl', 'slimLead', 'safeDate' ...
    // (For brevity, I'm not reproducing the full upsertLead body here, assume it's the same as before)
    const {
        firstName = "", lastName = "", headline: lhHeadline = "",
        linkedinHeadline = "", linkedinJobTitle = "", linkedinCompanyName = "", linkedinDescription = "",
        linkedinProfileUrl = "", connectionDegree = "",
        linkedinJobDateRange = "", linkedinJobDescription = "",
        linkedinPreviousJobDateRange = "", linkedinPreviousJobDescription = "",
        refreshedAt = "", profileUrl: fallbackProfileUrl = "",
        emailAddress = "", phoneNumber = "", locationName = "",
        connectionSince, scoringStatus = undefined, 
        raw, 
        ...rest 
    } = lead;

    let jobHistory = [
        linkedinJobDateRange ? `Current:\n${linkedinJobDateRange} — ${linkedinJobDescription}` : "",
        linkedinPreviousJobDateRange ? `Previous:\n${linkedinPreviousJobDateRange} — ${linkedinPreviousJobDescription}` : ""
    ].filter(Boolean).join("\n");

    const originalLeadData = raw || lead; 

    if (!jobHistory && originalLeadData) {
        const hist = getLastTwoOrgs(originalLeadData); 
        if (hist) jobHistory = hist;
    }

    let finalUrl = (linkedinProfileUrl || fallbackProfileUrl || "").replace(/\/$/, "");
    if (!finalUrl) {
        const slug = originalLeadData.publicId || originalLeadData.publicIdentifier;
        const mid = originalLeadData.memberId || originalLeadData.profileId;
        if (slug) finalUrl = `https://www.linkedin.com/in/${slug}/`;
        else if (mid) finalUrl = `https://www.linkedin.com/profile/view?id=${mid}`;
    }
    if (!finalUrl && originalLeadData.profile_url) {
         finalUrl = originalLeadData.profile_url.trim().replace(/\/$/, "");
    }

    if (!finalUrl) {
        console.warn("Skipping upsertLead: No finalUrl could be determined for lead:", firstName, lastName);
        return;
    }
    const profileKey = canonicalUrl(finalUrl); 

    let currentConnectionStatus = "Candidate";
    if (connectionDegree === "1st") currentConnectionStatus = "Connected";
    else if (lead.linkedinConnectionStatus === "Pending") currentConnectionStatus = "Pending"; 
    else if (originalLeadData.connectionStatus) currentConnectionStatus = originalLeadData.connectionStatus;

    const profileForJsonField = slimLead(originalLeadData); 

    const fields = {
        "LinkedIn Profile URL": finalUrl, "First Name": firstName, "Last Name": lastName,
        "Headline": linkedinHeadline || lhHeadline || originalLeadData.headline || "",
        "Job Title": linkedinJobTitle || originalLeadData.occupation || originalLeadData.position || "",
        "Company Name": linkedinCompanyName || (originalLeadData.company ? originalLeadData.company.name : "") || originalLeadData.organization_1 || "",
        "About": linkedinDescription || originalLeadData.summary || originalLeadData.bio || "",
        "Job History": jobHistory,
        "LinkedIn Connection Status": currentConnectionStatus,
        "Status": "In Process",
        "Scoring Status": scoringStatus,
        "Location": locationName || originalLeadData.location || "",
        "Date Connected": safeDate(connectionSince) || safeDate(originalLeadData.connectedAt) || safeDate(originalLeadData.connectionDate) || null, 
        "Email": emailAddress || originalLeadData.email || originalLeadData.workEmail || "",
        "Phone": phoneNumber || originalLeadData.phone || (originalLeadData.phoneNumbers || [])[0]?.value || "",
        "Refreshed At": refreshedAt ? new Date(refreshedAt) : (originalLeadData.lastRefreshed ? new Date(originalLeadData.lastRefreshed) : null),
        "Profile Full JSON": JSON.stringify(profileForJsonField),
        "Raw Profile Data": JSON.stringify(originalLeadData)
    };

    if (finalScore !== null) fields["AI Score"] = Math.round(finalScore * 100) / 100;
    if (aiProfileAssessment !== null) fields["AI Profile Assessment"] = String(aiProfileAssessment || "");
    if (attributeBreakdown !== null) fields["AI Attribute Breakdown"] = attributeBreakdown;
    if (auFlag !== null) fields["AU"] = !!auFlag;
    if (ai_excluded_val !== null) fields["AI_Excluded"] = (ai_excluded_val === "Yes" || ai_excluded_val === true);
    if (exclude_details_val !== null) fields["Exclude Details"] = exclude_details_val;

    const existing = await base("Leads").select({ filterByFormula: `{Profile Key} = "${profileKey}"`, maxRecords: 1 }).firstPage();

    if (existing.length) {
        console.log(`Upsert: Updating existing lead ${finalUrl} (ID: ${existing[0].id})`);
        await base("Leads").update(existing[0].id, fields);
    } else {
        fields["Source"] = connectionDegree === "1st" ? "Existing Connection Added by PB" : "SalesNav + LH Scrape";
        if (fields["Scoring Status"] === undefined) fields["Scoring Status"] = "To Be Scored";
        console.log(`Upsert: Creating new lead ${finalUrl}`);
        await base("Leads").create([{ fields }]);
    }
}


/* ------------------------------------------------------------------
    6)  /api/test-score 
------------------------------------------------------------------*/
app.post("/api/test-score", async (req, res) => {
    if (!globalGeminiModel || !base) {
        console.error("/api/test-score: Cannot proceed, Gemini Model or Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        // ... existing /api/test-score logic using 'scoreLeadNow', 'globalGeminiModel', 'loadAttributes', 'computeFinalScore', 'buildAttributeBreakdown' ...
        // (For brevity, assuming it's the same as before)
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

/* ------------------------------------------------------------------
    7)  /pb-webhook/scrapeLeads
------------------------------------------------------------------*/
app.post("/pb-webhook/scrapeLeads", async (req, res) => {
    if (!globalGeminiModel || !base) {
        console.error("/pb-webhook/scrapeLeads: Cannot proceed, Gemini Model or Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        // ... existing /pb-webhook/scrapeLeads logic ...
        // (For brevity, assuming it's the same as before)
        const leadsFromWebhook = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
        console.log(`▶︎ /pb-webhook/scrapeLeads (Gemini) received ${leadsFromWebhook.length} leads.`);

        if (leadsFromWebhook.length === 0) {
            return res.json({ message: "No leads provided in webhook payload." });
        }

        const { positives, negatives } = await loadAttributes();
        let processedCount = 0;
        let failedCount = 0;

        for (const leadDataFromWebhook of leadsFromWebhook) {
            let currentLeadIdentifier = leadDataFromWebhook.profileUrl || leadDataFromWebhook.linkedinProfileUrl || JSON.stringify(leadDataFromWebhook).substring(0,100);
            try {
                const leadForUpsertPreScore = { ...leadDataFromWebhook, raw: leadDataFromWebhook, scoringStatus: "To Be Scored"};
                await upsertLead(leadForUpsertPreScore); 

                const aboutText = (leadDataFromWebhook.summary || leadDataFromWebhook.bio || leadDataFromWebhook.linkedinDescription || "").trim();
                if (aboutText.length < 40) {
                    console.log(`Lead (${currentLeadIdentifier}) profile too thin for /pb-webhook/scrapeLeads, skipping AI call.`);
                    continue; 
                }
                
                const geminiScoredOutput = await scoreLeadNow(leadDataFromWebhook, globalGeminiModel);

                if (!geminiScoredOutput) {
                    console.warn(`No scoring output from Gemini for lead: ${currentLeadIdentifier}`);
                    failedCount++;
                    continue;
                }

                const {
                    positive_scores = {}, negative_scores = {}, attribute_reasoning = {},
                    contact_readiness = false, unscored_attributes = [], aiProfileAssessment = "N/A",
                    ai_excluded: scored_ai_excluded = "No", 
                    exclude_details: scored_exclude_details = "" 
                } = geminiScoredOutput;
                
                let temp_positive_scores = {...positive_scores};
                if (contact_readiness && positives?.I && (temp_positive_scores.I === undefined || temp_positive_scores.I === null) ) {
                     temp_positive_scores.I = positives.I.maxPoints || 0; 
                     if(!attribute_reasoning.I && temp_positive_scores.I > 0) { 
                          attribute_reasoning.I = "Contact readiness indicated by AI, points awarded for attribute I.";
                     }
                }

                const { percentage, rawScore: earned, denominator: max } = computeFinalScore(
                    temp_positive_scores, positives,
                    negative_scores, negatives,
                    contact_readiness, unscored_attributes
                );
                const finalPct = Math.round(percentage * 100) / 100;

                const auFlag = isAustralian(leadDataFromWebhook.locationName || leadDataFromWebhook.location || "");
                const passesScore = finalPct >= MIN_SCORE;
                const passesFilters = auFlag && passesScore; 

                const final_ai_excluded = passesFilters ? "No" : "Yes";
                let final_exclude_details = "";
                if (!passesFilters) {
                    if (!auFlag) final_exclude_details = `Non-AU location: "${leadDataFromWebhook.locationName || leadDataFromWebhook.location || ""}"`;
                    else if (!passesScore) final_exclude_details = `Score ${finalPct} < ${MIN_SCORE}`;
                }
                
                if (!passesFilters && SAVE_FILTERED_ONLY) {
                    console.log(`Lead ${currentLeadIdentifier} did not pass filters. Skipping save of score details.`);
                    continue;
                }

                const breakdown = buildAttributeBreakdown(
                    temp_positive_scores, positives,
                    negative_scores, negatives,
                    unscored_attributes, earned, max,
                    attribute_reasoning, true, null
                );
                
                await upsertLead( 
                    leadDataFromWebhook, finalPct, aiProfileAssessment, attribute_reasoning,
                    breakdown, auFlag, final_ai_excluded, final_exclude_details
                );
                processedCount++;

            } catch (leadErr) {
                failedCount++;
                console.error(`Error processing a lead in /pb-webhook/scrapeLeads (Identifier: ${currentLeadIdentifier}):`, leadErr.message, leadErr.stack);
                await alertAdmin("Lead Processing Error in /pb-webhook/scrapeLeads", `Identifier: ${currentLeadIdentifier}\nError: ${leadErr.message}`);
            }
        }
        console.log(`/pb-webhook/scrapeLeads (Gemini) finished. Processed: ${processedCount}, Failed: ${failedCount}`);
        if (!res.headersSent) {
            res.json({ message: `Processed ${processedCount} leads, Failed: ${failedCount}` });
        }

    } catch (err) {
        console.error("Critical error in /pb-webhook/scrapeLeads (Gemini) main try-catch:", err.message, err.stack);
        await alertAdmin("Critical Error in /pb-webhook/scrapeLeads", `Error: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

/* ------------------------------------------------------------------
    8)  /lh-webhook/upsertLeadOnly
------------------------------------------------------------------*/
app.post("/lh-webhook/upsertLeadOnly", async (req, res) => {
    if (!base) { // Added check for base
        console.error("/lh-webhook/upsertLeadOnly: Cannot proceed, Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        // ... existing /lh-webhook/upsertLeadOnly logic ...
        // (For brevity, assuming it's the same as before)
        const rawLeadsFromWebhook = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
        console.log(`▶︎ /lh-webhook/upsertLeadOnly received ${rawLeadsFromWebhook.length} leads.`);
        
        if (rawLeadsFromWebhook.length === 0) {
            return res.json({ message: "No leads provided in /lh-webhook/upsertLeadOnly payload." });
        }
        let processedCount = 0; let errorCount = 0;

        for (const lh of rawLeadsFromWebhook) {
            try {
                const rawUrl = lh.profileUrl || lh.linkedinProfileUrl ||
                                 (lh.publicId ? `https://www.linkedin.com/in/${lh.publicId}/` : null) ||
                                 (lh.memberId ? `https://www.linkedin.com/profile/view?id=${lh.memberId}` : null);

                if (!rawUrl) {
                    console.warn("Skipping lead in /lh-webhook/upsertLeadOnly due to missing URL identifier:", lh.firstName, lh.lastName);
                    errorCount++; continue;
                }

                const exp = Array.isArray(lh.experience) ? lh.experience : [];
                const current = exp[0] || {}; const previous = exp[1] || {};
                const numericDist = ((typeof lh.distance === "string" && lh.distance.endsWith("_1")) || (typeof lh.member_distance === "string" && lh.member_distance.endsWith("_1"))) ? 1 : lh.distance;

                const leadForUpsert = {
                    firstName: lh.firstName || lh.first_name || "", lastName: lh.lastName || lh.last_name || "",
                    headline: lh.headline || "", locationName: lh.locationName || lh.location_name || lh.location || "",
                    phone: (lh.phoneNumbers || [])[0]?.value || lh.phone_1 || lh.phone_2 || "",
                    email: lh.email || lh.workEmail || "",
                    linkedinProfileUrl: rawUrl.replace(/\/$/, ""),
                    linkedinJobTitle: lh.headline || lh.occupation || lh.position || current.title || "",
                    linkedinCompanyName: lh.companyName || (lh.company ? lh.company.name : "") || current.company || lh.organization_1 || "",
                    linkedinDescription: lh.summary || lh.bio || "",
                    linkedinJobDateRange: current.dateRange || current.dates || "",
                    linkedinJobDescription: current.description || "",
                    linkedinPreviousJobDateRange: previous.dateRange || previous.dates || "",
                    linkedinPreviousJobDescription: previous.description || "",
                    connectionDegree: lh.connectionDegree || (lh.degree === 1 || numericDist === 1 ? "1st" : lh.degree ? String(lh.degree) : ""),
                    connectionSince: lh.connectionDate || lh.connected_at_iso || lh.connected_at || lh.invited_date_iso || null,
                    refreshedAt: lh.lastRefreshed || lh.profileLastRefreshedDate || new Date().toISOString(),
                    raw: lh, scoringStatus: "To Be Scored",
                    linkedinConnectionStatus: lh.connectionStatus || lh.linkedinConnectionStatus || (numericDist === 1 ? "Connected" : "Candidate")
                };
                
                await upsertLead(leadForUpsert);
                processedCount++;
            } catch (upsertError) {
                errorCount++;
                console.error(`Error upserting a lead in /lh-webhook/upsertLeadOnly (URL: ${lh.profileUrl || 'N/A'}):`, upsertError.message);
                await alertAdmin("Lead Upsert Error in /lh-webhook/upsertLeadOnly", `URL: ${lh.profileUrl || 'N/A'}\nError: ${upsertError.message}`);
            }
        }
        console.log(`/lh-webhook/upsertLeadOnly finished. Upserted/Updated: ${processedCount}, Failed: ${errorCount}`);
        if (!res.headersSent) {
            res.json({ message: `Upserted/Updated ${processedCount} LH profiles, Failed: ${errorCount}` });
        }
    } catch (err) {
        console.error("Critical error in /lh-webhook/upsertLeadOnly:", err.message, err.stack);
        await alertAdmin("Critical Error in /lh-webhook/upsertLeadOnly", `Error: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

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
    if (!base) { // Added check for base
        console.error("/pb-pull/connections: Cannot proceed, Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        // ... existing /pb-pull/connections logic using 'getJsonUrl', 'upsertLead', 'alertAdmin' ...
        // (For brevity, assuming it's the same as before)
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
    res.json({
        message: "Gemini Scorer Debug Info",
        model_id_for_scoring: globalGeminiModel ? globalGeminiModel.model : "Gemini Model Not Initialized", 
        batch_scorer_model_id: process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06", 
        project_id: process.env.GCP_PROJECT_ID, // Pulled from env for display
        location: process.env.GCP_LOCATION,     // Pulled from env for display
        global_client_initialized: !!globalGeminiModel, // Check if the instance from config is truthy
        gpt_chat_url_for_pointer_api: GPT_CHAT_URL || "Not Set"
    });
});

/* ------------------------------------------------------------------
    11) Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
    `▶︎ Server starting – Version: Gemini Integrated (Refactor 2) – Commit ${process.env.RENDER_GIT_COMMIT || "local"
    } – ${new Date().toISOString()}`
);
app.listen(port, () => {
    console.log(`Server running on port ${port}.`);
    // Initial checks are now done near the top after requires.
    // This can be a final confirmation or removed if redundant.
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