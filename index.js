console.log("<<<<< INDEX.JS - REFACTOR 1 - MOVED HELPERS - TOP OF FILE >>>>>"); // Updated log
/***************************************************************
 Main Server File - LinkedIn → Airtable (Scoring + 1st-degree sync)
 UPDATED FOR GEMINI 2.5 PRO (Corrected Imports)
***************************************************************/
require("dotenv").config();
const express = require("express");
const Airtable = require("airtable");
const fs = require("fs");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// --- CORRECTED Google AI Client Setup ---
const { VertexAI, HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');

console.log("<<<<< INDEX.JS - REFACTOR 1 - BEFORE LOCAL REQUIRES >>>>>");
// Your existing helper modules - ensure these are updated or compatible
const { buildPrompt, slimLead }    = require("./promptBuilder");
const { loadAttributes }          = require("./attributeLoader");
const { computeFinalScore }       = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");
const { scoreLeadNow }            = require("./singleScorer");
const batchScorer                 = require("./batchScorer");

// --- REQUIRE FOR NEWLY MOVED HELPERS ---
const { alertAdmin, getJsonUrl, canonicalUrl, isAustralian, safeDate, getLastTwoOrgs, isMissingCritical } = require('./utils/appHelpers.js');


/* ---------- ENV CONFIGURATION ------------------------------------ */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";
const TEST_MODE = process.env.TEST_MODE === "true";
const MIN_SCORE = Number(process.env.MIN_SCORE || 0);
const SAVE_FILTERED_ONLY = process.env.SAVE_FILTERED_ONLY === "true";

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;
const GCP_CREDENTIALS_JSON_STRING = process.env.GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON;

/* ---------- GOOGLE GENERATIVE AI CLIENT INITIALIZATION ----------- */
let globalVertexAIClient;
let globalGeminiModel;

try {
    if (!GCP_PROJECT_ID || !GCP_LOCATION) {
        throw new Error("GCP_PROJECT_ID and GCP_LOCATION environment variables are required for global Gemini client.");
    }
    if (!GCP_CREDENTIALS_JSON_STRING) {
        throw new Error("GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON environment variable is not set for global Gemini client.");
    }
    const credentials = JSON.parse(GCP_CREDENTIALS_JSON_STRING);
    globalVertexAIClient = new VertexAI({ project: GCP_PROJECT_ID, location: GCP_LOCATION, credentials });
    
    globalGeminiModel = globalVertexAIClient.getGenerativeModel({ model: MODEL_ID });
    console.log(`Global Google Vertex AI Client Initialized. Default Model: ${MODEL_ID}`);
} catch (error) {
    console.error("CRITICAL: Failed to initialize Global Google Vertex AI Client:", error.message);
    globalGeminiModel = null;
}

/* ---------- AIRTABLE CONFIGURATION ------------------------------- */
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ------------------------------------------------------------------
    HELPER FUNCTIONS MOVED TO utils/appHelpers.js
    - alertAdmin
    - getJsonUrl
    - canonicalUrl
    - isAustralian
    - safeDate
    - getLastTwoOrgs
    - isMissingCritical
------------------------------------------------------------------*/

/* ------------------------------------------------------------------
    1)  Globals & Express App Setup
------------------------------------------------------------------*/
const app = express();
app.use(express.json({ limit: "10mb" }));

/* mount miscellaneous sub-APIs */
require("./promptApi")(app);
require("./recordApi")(app);
require("./scoreApi")(app); 
const mountQueue = require("./queueDispatcher");
mountQueue(app);

/* ------------------------------------------------------------------
    1.5) health check + manual batch route
------------------------------------------------------------------*/
app.get("/health", (_req, res) => res.send("ok"));

app.get("/run-batch-score", async (req, res) => {
    const limit = Number(req.query.limit) || 500;
    console.log(`▶︎ /run-batch-score (Gemini) hit – limit ${limit}`);
    
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

        if (isMissingCritical(profile)) { // Still uses isMissingCritical from appHelpers.js
            let hasExp = Array.isArray(profile.experience) && profile.experience.length > 0;
            if (!hasExp) for (let i = 1; i <= 5; i++) if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) { hasExp = true; break; }
            await alertAdmin( // Still uses alertAdmin from appHelpers.js
                "Incomplete lead for single scoring",
                `Rec ID: ${record.id}\nURL: ${profile.linkedinProfileUrl || profile.profile_url || "unknown"}\nHeadline: ${!!profile.headline}, About: ${aboutText.length >= 40}, Job info: ${hasExp}`
            );
        }
        
        const geminiScoredOutput = await scoreLeadNow(profile, globalGeminiModel);

        if (!geminiScoredOutput) {
            throw new Error("singleScorer (scoreLeadNow) did not return valid output.");
        }

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
    5)  upsertLead (Largely unchanged, ensures data consistency for Airtable)
    This function uses getLastTwoOrgs, canonicalUrl, slimLead (imported), safeDate
------------------------------------------------------------------*/
async function upsertLead(
    lead, finalScore = null, aiProfileAssessment = null,
    attribute_reasoning_obj = null, attributeBreakdown = null,
    auFlag = null, ai_excluded_val = null, exclude_details_val = null
) {
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
        const hist = getLastTwoOrgs(originalLeadData); // Uses helper
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
    const profileKey = canonicalUrl(finalUrl); // Uses helper

    let currentConnectionStatus = "Candidate";
    if (connectionDegree === "1st") currentConnectionStatus = "Connected";
    else if (lead.linkedinConnectionStatus === "Pending") currentConnectionStatus = "Pending"; 
    else if (originalLeadData.connectionStatus) currentConnectionStatus = originalLeadData.connectionStatus;

    const profileForJsonField = slimLead(originalLeadData); // Uses imported slimLead

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
        "Date Connected": safeDate(connectionSince) || safeDate(originalLeadData.connectedAt) || safeDate(originalLeadData.connectionDate) || null, // Uses helper
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
    6)  /api/test-score (returns JSON only) 
------------------------------------------------------------------*/
app.post("/api/test-score", async (req, res) => {
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

/* ------------------------------------------------------------------
    7)  /pb-webhook/scrapeLeads – Phantombuster array
    Uses isAustralian helper
------------------------------------------------------------------*/
app.post("/pb-webhook/scrapeLeads", async (req, res) => {
    try {
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

                const auFlag = isAustralian(leadDataFromWebhook.locationName || leadDataFromWebhook.location || ""); // Uses helper
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
    8)  /lh-webhook/upsertLeadOnly (Linked Helper Webhook)
------------------------------------------------------------------*/
app.post("/lh-webhook/upsertLeadOnly", async (req, res) => {
    try {
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
    9)  /pb-pull/connections (Phantombuster Connections Pull)
    Uses getJsonUrl helper
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
            const jsonUrl = getJsonUrl(resultObj); // Uses helper
            
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
    10) DEBUG route (Updated for Gemini)
------------------------------------------------------------------*/
const GPT_CHAT_URL = process.env.GPT_CHAT_URL; 
app.get("/debug-gemini-info", (_req, res) => {
    res.json({
        message: "Gemini Scorer Debug Info",
        model_id_for_scoring: MODEL_ID, 
        batch_scorer_model_id: process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06", 
        project_id: GCP_PROJECT_ID,
        location: GCP_LOCATION,
        global_client_initialized: !!globalGeminiModel,
        gpt_chat_url_for_pointer_api: GPT_CHAT_URL || "Not Set"
    });
});

/* ------------------------------------------------------------------
    11) Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
    `▶︎ Server starting – Version: Gemini Integrated – Commit ${process.env.RENDER_GIT_COMMIT || "local"
    } – ${new Date().toISOString()}`
);
app.listen(port, () => {
    console.log(`Server running on port ${port}.`);
    if (!globalGeminiModel && (!GCP_PROJECT_ID || !GCP_LOCATION || !GCP_CREDENTIALS_JSON_STRING)) {
        console.error("FATAL: Global Gemini Model Client cannot initialize due to missing GCP environment variables.");
        alertAdmin("Server Started with FATAL Gemini Init Failure", "Global Gemini client cannot init due to missing GCP env vars. Scoring will fail.");
    } else if (!globalGeminiModel) {
        console.error("WARNING: Global Gemini Model Client failed to initialize at startup (check logs for specifics). Endpoints using it directly may fail.");
        alertAdmin("Server Started with Gemini Init Failure", "The global Gemini model client failed to initialize. Scoring may fail. Check server logs.");
    } else {
        console.log("Global Gemini Model Client initialized successfully.");
    }
});

/* ------------------------------------------------------------------
    SECTION 4) getScoringData & helpers (Legacy - Commented Out)
------------------------------------------------------------------*/
/*
async function getScoringData() {
  // ... (implementation from your file) ...
  console.warn("getScoringData function is likely obsolete and called unexpectedly.");
  return { truncatedInstructions: "", passMark: 0, positives: {}, negatives: {} };
}

function parseMarkdownTables(markdown) {
  // ... (implementation from your file) ...
  console.warn("parseMarkdownTables function is likely obsolete and called unexpectedly.");
  return { positives: {}, negatives: {} };
}
*/