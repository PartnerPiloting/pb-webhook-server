/***************************************************************
  Main Server File - LinkedIn → Airtable (Scoring + 1st-degree sync)
  UPDATED FOR GEMINI 2.5 PRO
***************************************************************/
require("dotenv").config();
const express = require("express");
const Airtable = require("airtable");
const fs = require("fs");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// --- NEW: Google AI Client Setup ---
const { VertexAI } = require('@google-cloud/vertexai');
const { HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

// Your existing helper modules - ensure these are updated or compatible
const { buildPrompt, slimLead }   = require("./promptBuilder");     // You have the updated Gemini version of this
const { loadAttributes }          = require("./attributeLoader");  // You have this
const { computeFinalScore }       = require("./scoring");          // You have this
const { buildAttributeBreakdown } = require("./breakdown");        // You have this
const { scoreLeadNow }            = require("./singleScorer");     // IMPORTANT: This file will need to be updated to use Gemini
const batchScorer                 = require("./batchScorer");      // You have the updated Gemini version of this

const mountPointerApi  = require("./pointerApi");
const mountLatestLead  = require("./latestLeadApi");
const mountUpdateLead  = require("./updateLeadApi");
const mountQueue       = require("./queueDispatcher");
// const { callGptScoring }          = require("./callGptScoring"); // This will be removed/obsoleted

/* ---------- ENV CONFIGURATION ------------------------------------ */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06"; // For singleScorer, if it uses it directly
const TEST_MODE = process.env.TEST_MODE === "true";
const MIN_SCORE = Number(process.env.MIN_SCORE || 0);
const SAVE_FILTERED_ONLY = process.env.SAVE_FILTERED_ONLY === "true";

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;
const GCP_CREDENTIALS_JSON_STRING = process.env.GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON;

/* ---------- GOOGLE GENERATIVE AI CLIENT INITIALIZATION ----------- */
// This global client might be used by singleScorer or other parts if they don't initialize their own.
// The batchScorer.js I provided initializes its own. singleScorer.js might also do so.
// For now, let's initialize one here; specific modules can decide to use it or their own instance.
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
    globalGeminiModel = globalVertexAIClient.getGenerativeModel({ model: MODEL_ID }); // Default model
    console.log(`Global Google Vertex AI Client Initialized. Default Model: ${MODEL_ID}`);
} catch (error) {
    console.error("CRITICAL: Failed to initialize Global Google Vertex AI Client:", error.message);
    globalGeminiModel = null;
    // alertAdmin is defined later, so can't call it here directly during init phase easily
}

/* ---------- AIRTABLE CONFIGURATION ------------------------------- */
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ------------------------------------------------------------------
   helper: alertAdmin  (Mailgun) - Unchanged from your version
------------------------------------------------------------------*/
async function alertAdmin(subject, text) {
    try {
        if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN || !process.env.ALERT_EMAIL) {
            console.warn("Mailgun not configured, admin alert skipped for:", subject);
            return;
        }
        const mgUrl = `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`;
        // Using URLSearchParams as per your original main file version
        const body = new URLSearchParams({
            from: `PB Server <alerts@${process.env.MAILGUN_DOMAIN}>`,
            to: process.env.ALERT_EMAIL,
            subject: `[LeadScorer-GeminiApp] ${subject}`, // Added prefix
            text
        });
        const auth = Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64");
        await fetch(mgUrl, {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body
        });
        console.log("Admin alert sent:", subject);
    } catch (err) {
        console.error("alertAdmin error:", err.message);
    }
}

/* ------------------------------------------------------------------
   helper: getJsonUrl (Unchanged)
------------------------------------------------------------------*/
function getJsonUrl(obj = {}) {
    return (
        obj?.data?.output?.jsonUrl ||
        obj?.data?.resultObject?.jsonUrl ||
        obj?.data?.resultObject?.output?.jsonUrl ||
        obj?.output?.jsonUrl ||
        obj?.resultObject?.jsonUrl ||
        (() => {
            const m = JSON.stringify(obj).match(/https?:\/\/[^"'\s]+\/result\.json/i);
            return m ? m[0] : null;
        })()
    );
}

/* ------------------------------------------------------------------
   helper: canonicalUrl (Unchanged)
------------------------------------------------------------------*/
function canonicalUrl(url = "") {
    return url.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
}

/* ------------------------------------------------------------------
   helper: isAustralian (Unchanged)
------------------------------------------------------------------*/
function isAustralian(loc = "") {
    return /\b(australia|aus|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|nsw|vic|qld|wa|sa|tas|act|nt)\b/i.test(
        loc
    );
}

/* ------------------------------------------------------------------
   helper: safeDate (Unchanged)
------------------------------------------------------------------*/
function safeDate(d) {
    if (!d) return null;
    if (d instanceof Date) return isNaN(d) ? null : d;
    if (/^\d{4}\.\d{2}\.\d{2}$/.test(d)) {
        const iso = d.replace(/\./g, "-");
        return new Date(iso + "T00:00:00Z");
    }
    const dt = new Date(d);
    return isNaN(dt) ? null : dt;
}

/* ------------------------------------------------------------------
   helper: getLastTwoOrgs (Unchanged)
------------------------------------------------------------------*/
function getLastTwoOrgs(lh = {}) {
    const out = [];
    for (let i = 1; i <= 2; i++) {
        const org = lh[`organization_${i}`];
        const title = lh[`organization_title_${i}`];
        const sr = lh[`organization_start_${i}`];
        const er = lh[`organization_end_${i}`];
        if (!org && !title) continue;
        const range = sr || er ? `(${sr || "?"} – ${er || "Present"})` : "";
        out.push(`${title || "Unknown Role"} at ${org || "Unknown"} ${range}`);
    }
    return out.join("\n");
}

/* ------------------------------------------------------------------
   helper: isMissingCritical (bio ≥40, headline, job-history) (Unchanged)
------------------------------------------------------------------*/
function isMissingCritical(profile = {}) {
    const about = (
        profile.about ||
        profile.summary ||
        profile.linkedinDescription ||
        ""
    ).trim();
    const hasBio = about.length >= 40;
    const hasHeadline = !!profile.headline?.trim();
    let hasJob = Array.isArray(profile.experience) && profile.experience.length;
    if (!hasJob) {
        for (let i = 1; i <= 5; i++) {
            if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) {
                hasJob = true;
                break;
            }
        }
    }
    return !(hasBio && hasHeadline && hasJob);
}

/* ------------------------------------------------------------------
   1)  Globals & Express App Setup
------------------------------------------------------------------*/
const app = express();
app.use(express.json({ limit: "10mb" })); // Existing middleware

/* mount miscellaneous sub-APIs (Unchanged) */
require("./promptApi")(app);
require("./recordApi")(app);
require("./scoreApi")(app);
mountQueue(app);

/* ------------------------------------------------------------------
   1.5) health check + manual batch route
------------------------------------------------------------------*/
app.get("/health", (_req, res) => res.send("ok"));

app.get("/run-batch-score", async (req, res) => {
    const limit = Number(req.query.limit) || 500; // Default limit from your code
    console.log(`▶︎ /run-batch-score (Gemini) hit – limit ${limit}`);

    // batchScorer.run is now asynchronous and handles its own console logging/alerts
    batchScorer.run({ query: { limit } }, res) // Pass res for initial response
        .then(() => {
            // The batchScorer.run function now sends an initial response.
            // Further completion console logs are within batchScorer itself.
            console.log(`Batch scoring initiation for up to ${limit} leads (Gemini) is complete. Check queue processing.`);
        })
        .catch((err) => {
            console.error("Error invoking batchScorer.run:", err);
            // batchScorer.run should ideally handle its own response on error too
            if (!res.headersSent) {
                res.status(500).send("Failed to start batch scoring.");
            }
        });
    // Initial response moved into batchScorer or handled by its promise if not sending res
    // For now, let's assume batchScorer.run sends an immediate ack if res is passed.
    // If batchScorer.run is fully async without using res, then:
    // res.send(`Batch scoring for up to ${limit} leads has been initiated with Gemini.`);
    // batchScorer.run({ query: { limit }}); // Fire and forget style if it handles its own errors/alerts
});

/* ------------------------------------------------------------------
   ONE-OFF LEAD SCORER – /score-lead?recordId=recXXXXXXXX
   (Updated for Gemini)
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

        if (isMissingCritical(profile)) {
            // Alerting logic (copied from your original, can be kept)
            let hasExp = Array.isArray(profile.experience) && profile.experience.length > 0;
            if (!hasExp) for (let i = 1; i <= 5; i++) if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) { hasExp = true; break; }
            await alertAdmin(
                "Incomplete lead for single scoring",
                `Rec ID: ${record.id}\nURL: ${profile.linkedinProfileUrl || profile.profile_url || "unknown"}\nHeadline: ${!!profile.headline}, About: ${aboutText.length >= 40}, Job info: ${hasExp}`
            );
        }

        // Call the updated scoreLeadNow (from singleScorer.js, which needs to use Gemini)
        // scoreLeadNow should return the parsed JSON object directly.
        const geminiScoredOutput = await scoreLeadNow(profile, globalGeminiModel); // Pass model if singleScorer expects it

        if (!geminiScoredOutput) {
            throw new Error("singleScorer (scoreLeadNow) did not return valid output.");
        }

        // Destructure directly from what scoreLeadNow (Gemini version) should return
        // This structure should match the verboseSchemaDefinition in your promptBuilder.js
        const {
            positive_scores = {},
            negative_scores = {},
            attribute_reasoning = {}, // This should be the object of reasons for attributes
            contact_readiness = false,
            unscored_attributes = [],
            aiProfileAssessment = "N/A",
            ai_excluded = "No",
            exclude_details = ""
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
            attribute_reasoning, // Pass the object of reasons
            true, // showZeros = true for single score view
            null
        );

        await base("Leads").update(id, {
            "AI Score": finalPct,
            "AI Profile Assessment": aiProfileAssessment,
            "AI Attribute Breakdown": breakdown,
            "Scoring Status": "Scored",
            "Date Scored": new Date().toISOString().split("T")[0],
            "AI_Excluded": (ai_excluded === "Yes" || ai_excluded === true), // Handle string or boolean
            "Exclude Details": exclude_details
        });

        console.log(`Lead ${id} scored successfully. Final Pct: ${finalPct}`);
        res.json({ id, finalPct, aiProfileAssessment, breakdown });

    } catch (err) {
        console.error(`Error in /score-lead for ${req.query.recordId}:`, err.message, err.stack);
        await alertAdmin("Single Scoring Failed", `Record ID: ${req.query.recordId}\nError: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});


/* ------------------------------------------------------------------
   5)  upsertLead  (AI fields written only if argument ≠ null)
       (No direct AI calls here, so largely unchanged unless field names from AI output differ)
       This function is called by /pb-webhook/scrapeLeads and /pb-pull/connections
------------------------------------------------------------------*/
async function upsertLead(
    lead,
    finalScore = null,
    aiProfileAssessment = null,
    attribute_reasoning_obj = null, // Renamed to match expected object of reasons for clarity
    attributeBreakdown = null,      // This is the pre-built string
    auFlag = null,
    ai_excluded_val = null,         // Renamed for clarity
    exclude_details_val = null      // Renamed for clarity
) {
    const {
        firstName = "", lastName = "",
        headline: lhHeadline = "",
        linkedinHeadline = "", linkedinJobTitle = "", linkedinCompanyName = "", linkedinDescription = "",
        linkedinProfileUrl = "", connectionDegree = "",
        linkedinJobDateRange = "", linkedinJobDescription = "",
        linkedinPreviousJobDateRange = "", linkedinPreviousJobDescription = "",
        refreshedAt = "", profileUrl: fallbackProfileUrl = "",
        linkedinConnectionStatus,
        emailAddress = "", phoneNumber = "", locationName = "",
        connectionSince,
        scoringStatus = undefined, // Will be set to "To Be Scored" if new lead for scoring
        ...rest
    } = lead;

    let jobHistory = [
        linkedinJobDateRange ? `Current:\n${linkedinJobDateRange} — ${linkedinJobDescription}` : "",
        linkedinPreviousJobDateRange ? `Previous:\n${linkedinPreviousJobDateRange} — ${linkedinPreviousJobDescription}` : ""
    ].filter(Boolean).join("\n");

    if (!jobHistory && lead.raw) {
        const hist = getLastTwoOrgs(lead.raw);
        if (hist) jobHistory = hist;
    }

    let finalUrl = (linkedinProfileUrl || fallbackProfileUrl || "").replace(/\/$/, "");
    if (!finalUrl) {
        const slug = lead.publicId || lead.publicIdentifier;
        const mid = lead.memberId || lead.profileId;
        if (slug) finalUrl = `https://www.linkedin.com/in/${slug}/`;
        else if (mid) finalUrl = `https://www.linkedin.com/profile/view?id=${mid}`;
    }
    if (!finalUrl && lead.raw) {
        const r = lead.raw;
        if (typeof r.profile_url === "string" && r.profile_url.trim()) finalUrl = r.profile_url.trim().replace(/\/$/, "");
        else if (r.public_id) finalUrl = `https://www.linkedin.com/in/${r.public_id}/`;
        else if (r.member_id) finalUrl = `https://www.linkedin.com/profile/view?id=${r.member_id}`;
    }
    if (!finalUrl) {
        console.warn("Skipping upsertLead: No finalUrl could be determined for lead:", lead.firstName, lead.lastName);
        return; // Cannot proceed without a URL to key off
    }

    const profileKey = canonicalUrl(finalUrl);

    let currentConnectionStatus = "Candidate"; // Default for new leads
    if (connectionDegree === "1st") currentConnectionStatus = "Connected";
    else if (linkedinConnectionStatus === "Pending") currentConnectionStatus = "Pending";
    else if (lead.linkedinConnectionStatus) currentConnectionStatus = lead.linkedinConnectionStatus; // Preserve if already set

    // Prepare a slimmed version of the profile for "Profile Full JSON"
    const profileForJsonField = slimLead(lead.raw || lead); // Pass raw if available, else the lead itself

    const fields = {
        "LinkedIn Profile URL": finalUrl,
        "First Name": firstName,
        "Last Name": lastName,
        "Headline": linkedinHeadline || lhHeadline,
        "Job Title": linkedinJobTitle,
        "Company Name": linkedinCompanyName,
        "About": linkedinDescription || "", // Use the main description field
        "Job History": jobHistory,
        "LinkedIn Connection Status": currentConnectionStatus,
        "Status": "In Process", // Default status for new/updated leads needing processing
        "Scoring Status": scoringStatus, // This might be "To Be Scored" or an existing status
        "Location": locationName || "",
        "Date Connected": safeDate(connectionSince) || safeDate(lead.connectedAt) || null,
        "Email": emailAddress || lead.email || lead.workEmail || "",
        "Phone": phoneNumber || lead.phone || (lead.phoneNumbers || [])[0]?.value || "",
        "Refreshed At": refreshedAt ? new Date(refreshedAt) : null,
        "Profile Full JSON": JSON.stringify(profileForJsonField), // Store the slimmed version
        "Raw Profile Data": JSON.stringify(rest) // Store rest of the unknown fields
    };
    
    // Conditionally add AI scoring fields ONLY if they are explicitly passed (not null)
    if (finalScore !== null) fields["AI Score"] = Math.round(finalScore * 100) / 100;
    if (aiProfileAssessment !== null) fields["AI Profile Assessment"] = String(aiProfileAssessment || "");
    if (attributeBreakdown !== null) fields["AI Attribute Breakdown"] = attributeBreakdown; // This is the pre-formatted string
    if (auFlag !== null) fields["AU"] = !!auFlag;
    if (ai_excluded_val !== null) fields["AI_Excluded"] = (ai_excluded_val === "Yes" || ai_excluded_val === true);
    if (exclude_details_val !== null) fields["Exclude Details"] = exclude_details_val;

    const filter = `{Profile Key} = "${profileKey}"`;
    const existing = await base("Leads").select({ filterByFormula: filter, maxRecords: 1 }).firstPage();

    if (existing.length) {
        console.log(`Updating existing lead in Airtable: ${finalUrl} (Record ID: ${existing[0].id})`);
        await base("Leads").update(existing[0].id, fields);
    } else {
        fields["Source"] = connectionDegree === "1st" ? "Existing Connection Added by PB" : "SalesNav + LH Scrape";
        // If it's a brand new lead being upserted by webhooks that don't score, ensure Scoring Status is set
        if (scoringStatus === undefined) fields["Scoring Status"] = "To Be Scored";
        console.log(`Creating new lead in Airtable: ${finalUrl}`);
        await base("Leads").create([{ fields }]); // create expects an array of records
    }
}


/* ------------------------------------------------------------------
   6)  /api/test-score (returns JSON only) - (Updated for Gemini)
------------------------------------------------------------------*/
app.post("/api/test-score", async (req, res) => {
    try {
        const leadProfileData = req.body; // Assuming req.body is the lead profile object
        console.log("▶︎ /api/test-score (Gemini) hit with lead data.");

        if (typeof leadProfileData !== 'object' || leadProfileData === null || Object.keys(leadProfileData).length === 0) {
            return res.status(400).json({ error: "Request body must be a valid lead profile object." });
        }

        // We need the full profile structure that slimLead would normally get from "Profile Full JSON"
        // If leadProfileData is already the "raw" profile, slimLead can process it.
        // If it's already slimmed, we might pass it differently or adapt.
        // For now, assume leadProfileData is a profile object that scoreLeadNow can handle.
        // scoreLeadNow will call slimLead internally if needed by its structure.

        const geminiScoredOutput = await scoreLeadNow(leadProfileData, globalGeminiModel); // Pass model

        if (!geminiScoredOutput) {
            throw new Error("scoreLeadNow (Gemini) did not return valid output for /api/test-score.");
        }
        
        const {
            positive_scores = {},
            negative_scores = {},
            attribute_reasoning = {}, // Object of reasons
            contact_readiness = false,
            unscored_attributes = [],
            aiProfileAssessment = "N/A"
            // ai_excluded and exclude_details are not typically returned by just scoring, but by filter logic
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
            attribute_reasoning, // Pass the object of reasons
            true, null
        );
        
        console.log(`/api/test-score (Gemini) result - Final Pct: ${finalPct}`);
        res.json({ finalPct, breakdown, assessment: aiProfileAssessment, rawGeminiOutput: geminiScoredOutput });

    } catch (err) {
        console.error("Error in /api/test-score (Gemini):", err.message, err.stack);
        res.status(500).json({ error: err.message });
    }
});

/* ------------------------------------------------------------------
   7)  /pb-webhook/scrapeLeads – Phantombuster array (Updated for Gemini)
       Processes leads one by one via singleScorer. Consider batchScorer for true batching.
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
            try {
                // Construct the 'lead' object for upsertLead, similar to /lh-webhook/upsertLeadOnly
                // This part needs to map Phantombuster's output to your expected 'lead' structure
                // For now, assuming leadDataFromWebhook is largely the "raw" profile data
                const leadForUpsert = {
                    ...leadDataFromWebhook, // Spread all fields from webhook
                    raw: leadDataFromWebhook, // Ensure 'raw' field exists for upsertLead & slimLead
                    scoringStatus: "To Be Scored" // Set for scoring
                };
                
                // First, upsert the lead to get it into Airtable with "To Be Scored"
                // or update it if it exists. This ensures Profile Full JSON is populated.
                await upsertLead(leadForUpsert); // This sets Scoring Status to "To Be Scored"
                
                // Now, fetch the potentially merged/cleaned profile as stored in Airtable
                // to ensure consistency with how batchScorer gets its profiles.
                // This step is optional if leadDataFromWebhook is already the full profile needed.
                // For simplicity here, we'll score based on leadDataFromWebhook directly.
                // A more robust flow might fetch the record from Airtable AFTER upsert to get its ID and clean JSON.

                // Check for skippable conditions before calling AI
                const aboutText = (leadDataFromWebhook.summary || leadDataFromWebhook.bio || leadDataFromWebhook.linkedinDescription || "").trim();
                if (aboutText.length < 40) {
                    console.log(`Lead (URL: ${leadDataFromWebhook.profileUrl || 'N/A'}) profile too thin, skipping AI call.`);
                    // upsertLead would have already set it to "To Be Scored", now update to "Skipped"
                    // We need the Airtable record ID to update it. This is a limitation of not fetching after upsert.
                    // For now, we'll let it be "To Be Scored" and batchScorer might skip it.
                    // Or, upsertLead could be smarter to directly skip if aboutText is short.
                    continue;
                }
                
                const geminiScoredOutput = await scoreLeadNow(leadDataFromWebhook, globalGeminiModel); // Pass model

                if (!geminiScoredOutput) {
                    console.warn(`No scoring output from Gemini for lead: ${leadDataFromWebhook.profileUrl || JSON.stringify(leadDataFromWebhook).substring(0,100)}`);
                    failedCount++;
                    continue;
                }

                const {
                    positive_scores = {}, negative_scores = {}, attribute_reasoning = {},
                    contact_readiness = false, unscored_attributes = [], aiProfileAssessment = "N/A",
                    ai_excluded: scored_ai_excluded = "No", // from AI
                    exclude_details: scored_exclude_details = "" // from AI
                } = geminiScoredOutput;
                
                // Auto-award "I" based on contact_readiness from AI, if not already scored by AI
                // This logic was in your original file for this endpoint.
                let temp_positive_scores = {...positive_scores};
                if (contact_readiness && positives?.I && (temp_positive_scores.I === undefined || temp_positive_scores.I === null) ) {
                    temp_positive_scores.I = positives.I.maxPoints || 0; // Use maxPoints from dict
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

                // Filter logic from your original endpoint
                const auFlag = isAustralian(leadDataFromWebhook.locationName || leadDataFromWebhook.location || "");
                const passesScore = finalPct >= MIN_SCORE;
                // const positiveChat  = true; // This was hardcoded, assuming it's still relevant or handled elsewhere
                const passesFilters = auFlag && passesScore; // Simplified, add positiveChat if needed

                const final_ai_excluded = passesFilters ? "No" : "Yes";
                let final_exclude_details = "";
                if (!passesFilters) {
                    if (!auFlag) final_exclude_details = `Non-AU location: "${leadDataFromWebhook.locationName || leadDataFromWebhook.location || ""}"`;
                    else if (!passesScore) final_exclude_details = `Score ${finalPct} < ${MIN_SCORE}`;
                } else {
                    // If passes filters but AI suggested exclusion, use AI's reason
                    if (scored_ai_excluded === "Yes") {
                        // This case is tricky: local filters pass, but AI wants to exclude.
                        // For now, local filter takes precedence. If AI exclusion is strong, incorporate it.
                        // Let's assume if local filters pass, we don't use AI's exclusion.
                        // final_ai_excluded = scored_ai_excluded; // Uncomment to allow AI to override pass
                        // final_exclude_details = scored_exclude_details;
                    }
                }
                
                if (!passesFilters && SAVE_FILTERED_ONLY) {
                    console.log(`Lead ${leadDataFromWebhook.profileUrl || 'N/A'} did not pass filters (AU: ${auFlag}, Score: ${finalPct} vs ${MIN_SCORE}). Skipping save.`);
                    continue;
                }

                const breakdown = buildAttributeBreakdown(
                    temp_positive_scores, positives,
                    negative_scores, negatives,
                    unscored_attributes, earned, max,
                    attribute_reasoning, // Pass the object of reasons
                    true, null
                );

                // Upsert again, this time with all the AI scoring data
                await upsertLead(
                    leadDataFromWebhook, // original lead data from webhook
                    finalPct,
                    aiProfileAssessment,
                    attribute_reasoning, // Pass the object of reasons if upsertLead expects it for other uses
                    breakdown,           // Pass the generated breakdown string
                    auFlag,
                    final_ai_excluded,   // Use the exclusion status determined by local filters
                    final_exclude_details // Use the exclusion reason from local filters
                );
                processedCount++;

            } catch (leadErr) {
                failedCount++;
                console.error(`Error processing a lead in /pb-webhook/scrapeLeads (URL: ${leadDataFromWebhook.profileUrl || 'N/A'}):`, leadErr.message);
                await alertAdmin("Lead Processing Error in /pb-webhook/scrapeLeads", `URL: ${leadDataFromWebhook.profileUrl || 'N/A'}\nError: ${leadErr.message}`);
            }
        }
        console.log(`/pb-webhook/scrapeLeads (Gemini) finished. Processed: ${processedCount}, Failed: ${failedCount}`);
        res.json({ message: `Processed ${processedCount} leads, Failed: ${failedCount}` });

    } catch (err) {
        console.error("Error in /pb-webhook/scrapeLeads (Gemini) main try-catch:", err.message, err.stack);
        await alertAdmin("Critical Error in /pb-webhook/scrapeLeads", `Error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});


/* ------------------------------------------------------------------
   8)  /lh-webhook/upsertLeadOnly (Linked Helper Webhook)
       This endpoint primarily upserts lead data and sets it "To Be Scored".
       It does not perform AI scoring itself. So, minimal changes needed here
       other than ensuring it correctly prepares data for batchScorer.
------------------------------------------------------------------*/
app.post("/lh-webhook/upsertLeadOnly", async (req, res) => {
    try {
        const rawLeadsFromWebhook = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
        console.log(`▶︎ /lh-webhook/upsertLeadOnly received ${rawLeadsFromWebhook.length} leads. Full payload (first 2k chars): ${JSON.stringify(req.body).slice(0, 2000)}`);
        
        if (rawLeadsFromWebhook.length === 0) {
            return res.json({ message: "No leads provided in webhook payload." });
        }

        let processedCount = 0;
        let errorCount = 0;

        for (const lh of rawLeadsFromWebhook) {
            try {
                const rawUrl = lh.profileUrl ||
                             (lh.publicId ? `https://www.linkedin.com/in/${lh.publicId}/` : null) ||
                             (lh.memberId ? `https://www.linkedin.com/profile/view?id=${lh.memberId}` : null) ||
                             lh.linkedinProfileUrl; // Adding another common variant

                if (!rawUrl) {
                    console.warn("Skipping lead due to missing profileUrl, publicId, or memberId:", lh.firstName, lh.lastName);
                    errorCount++;
                    continue;
                }

                const exp = Array.isArray(lh.experience) ? lh.experience : [];
                const current = exp[0] || {};
                const previous = exp[1] || {};

                const numericDist =
                    (typeof lh.distance === "string" && lh.distance.endsWith("_1")) ||
                    (typeof lh.member_distance === "string" && lh.member_distance.endsWith("_1"))
                        ? 1 : lh.distance;

                const leadForUpsert = {
                    firstName: lh.firstName || lh.first_name || "",
                    lastName: lh.lastName || lh.last_name || "",
                    headline: lh.headline || "",
                    locationName: lh.locationName || lh.location_name || lh.location || "",
                    phone: (lh.phoneNumbers || [])[0]?.value || lh.phone_1 || lh.phone_2 || "",
                    email: lh.email || lh.workEmail || "",
                    linkedinProfileUrl: rawUrl.replace(/\/$/, ""), // Ensure no trailing slash
                    linkedinJobTitle: lh.headline || lh.occupation || lh.position || current.title || "",
                    linkedinCompanyName: lh.companyName || (lh.company ? lh.company.name : "") || current.company || lh.organization_1 || "",
                    linkedinDescription: lh.summary || lh.bio || "", // This will become "About" in Airtable
                    linkedinJobDateRange: current.dateRange || current.dates || "",
                    linkedinJobDescription: current.description || "",
                    linkedinPreviousJobDateRange: previous.dateRange || previous.dates || "",
                    linkedinPreviousJobDescription: previous.description || "",
                    connectionDegree: lh.connectionDegree || (lh.degree === 1 || numericDist === 1 ? "1st" : lh.degree ? String(lh.degree) : ""),
                    connectionSince: lh.connectionDate || lh.connected_at_iso || lh.connected_at || lh.invited_date_iso || null,
                    refreshedAt: lh.lastRefreshed || lh.profileLastRefreshedDate || new Date().toISOString(), // Add a refresh date
                    raw: lh, // Store the whole original LH payload in 'raw' for slimLead
                    scoringStatus: "To Be Scored", // Critical: Set for batch scorer
                    linkedinConnectionStatus: lh.connectionStatus || lh.linkedinConnectionStatus || "Candidate" // Get from LH if available
                };
                
                await upsertLead(leadForUpsert, null, null, null, null, null, null, null); // Pass null for AI fields
                processedCount++;
            } catch (upsertError) {
                errorCount++;
                console.error(`Error upserting a lead in /lh-webhook/upsertLeadOnly (URL: ${lh.profileUrl || 'N/A'}):`, upsertError.message);
                await alertAdmin("Lead Upsert Error in /lh-webhook/upsertLeadOnly", `URL: ${lh.profileUrl || 'N/A'}\nError: ${upsertError.message}`);
            }
        }
        console.log(`/lh-webhook/upsertLeadOnly finished. Upserted/Updated: ${processedCount}, Failed: ${errorCount}`);
        res.json({ message: `Upserted/Updated ${processedCount} LH profiles, Failed: ${errorCount}` });

    } catch (err) {
        console.error("Critical error in /lh-webhook/upsertLeadOnly:", err.message, err.stack);
        await alertAdmin("Critical Error in /lh-webhook/upsertLeadOnly", `Error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});


/* ------------------------------------------------------------------
   9)  /pb-pull/connections (Phantombuster Connections Pull)
       This endpoint also upserts leads and should set them "To Be Scored"
       if they are new or need re-scoring. It does not do AI scoring itself.
------------------------------------------------------------------*/
let lastRunId = 0; // This should persist if the server restarts, e.g., in a file or small DB.
const LAST_RUN_ID_FILE = "lastRun.txt";
try {
    if (fs.existsSync(LAST_RUN_ID_FILE)) {
        lastRunId = parseInt(fs.readFileSync(LAST_RUN_ID_FILE, "utf8"), 10) || 0;
    }
    console.log("Initial lastRunId from file:", lastRunId);
} catch (fileErr) {
    console.warn("Could not read lastRun.txt, starting with lastRunId = 0:", fileErr.message);
}

app.get("/pb-pull/connections", async (req, res) => {
    try {
        const headers = { "X-Phantombuster-Key-1": process.env.PB_API_KEY };
        if (!process.env.PB_API_KEY || !process.env.PB_AGENT_ID) {
            throw new Error("Phantombuster API Key or Agent ID not configured.");
        }
        const listURL = `https://api.phantombuster.com/api/v1/agent/${process.env.PB_AGENT_ID}/containers?limit=25`;
        console.log(`▶︎ /pb-pull/connections: Fetching containers from Phantombuster. Current lastRunId: ${lastRunId}`);

        const listResp = await fetch(listURL, { headers });
        if (!listResp.ok) throw new Error(`Phantombuster API error (list containers): ${listResp.status} ${await listResp.text()}`);
        const listJson = await listResp.json();
        
        const runs = (listJson.data || [])
            .filter((r) => r.lastEndStatus === "success")
            .sort((a, b) => Number(a.id) - Number(b.id));

        let totalUpsertedInThisRun = 0;
        let newLastRunId = lastRunId;

        for (const run of runs) {
            const currentRunId = Number(run.id);
            if (currentRunId <= lastRunId) continue;
            console.log(`Processing Phantombuster run ID: ${currentRunId}`);

            const resultResp = await fetch(
                `https://api.phantombuster.com/api/v2/containers/fetch-result-object?id=${run.id}`,
                { headers }
            );
            if (!resultResp.ok) {
                console.error(`Phantombuster API error (fetch result for run ${run.id}): ${resultResp.status} ${await resultResp.text()}`);
                continue; // Skip this run
            }
            const resultObj = await resultResp.json();
            const jsonUrl = getJsonUrl(resultObj);
            
            let conns;
            if (jsonUrl) {
                console.log(`Workspaceing results from jsonUrl for run ${run.id}: ${jsonUrl}`);
                const connResp = await fetch(jsonUrl);
                if (!connResp.ok) {
                     console.error(`Error fetching result JSON from URL for run ${run.id}: ${connResp.status} ${await connResp.text()}`);
                     continue;
                }
                conns = await connResp.json();
            } else if (Array.isArray(resultObj.resultObject)) {
                conns = resultObj.resultObject;
            } else if (Array.isArray(resultObj.data?.resultObject)) {
                conns = resultObj.data.resultObject;
            } else {
                console.error(`No jsonUrl and no inline resultObject array for Phantombuster run ${run.id}. Result Object:`, JSON.stringify(resultObj).substring(0,500));
                newLastRunId = Math.max(newLastRunId, currentRunId); // Still advance run ID to not retry this problematic one
                continue;
            }
            
            if (!Array.isArray(conns)) {
                console.error(`Connections data for run ${run.id} is not an array. Skipping. Data:`, JSON.stringify(conns).substring(0,500));
                newLastRunId = Math.max(newLastRunId, currentRunId);
                continue;
            }

            const testLimit = req.query.limit ? Number(req.query.limit) : null;
            if (testLimit) conns = conns.slice(0, testLimit);
            console.log(`Processing ${conns.length} connections from run ${run.id}.`);

            for (const c of conns) {
                try {
                    await upsertLead(
                        {
                            ...c, // Spread all fields from Phantombuster connection object
                            raw: c, // Ensure 'raw' field has the original PB object
                            connectionDegree: "1st", // These are existing connections
                            linkedinProfileUrl: (c.profileUrl || c.linkedinProfileUrl || "").replace(/\/$/, ""),
                            scoringStatus: "To Be Scored" // Mark for batch scoring
                        },
                        null, null, null, null, null, null, null // Null for AI fields
                    );
                    totalUpsertedInThisRun++;
                } catch (upsertErr) {
                    console.error(`Error upserting a lead in /pb-pull/connections (URL: ${c.profileUrl || 'N/A'}):`, upsertErr.message);
                    // Don't alert for every single one, but log it.
                }
            }
            newLastRunId = Math.max(newLastRunId, currentRunId);
            console.log(`Finished processing run ${run.id}. Updated lastRunId to ${newLastRunId}.`);
        }

        if (newLastRunId > lastRunId) {
            try {
                fs.writeFileSync(LAST_RUN_ID_FILE, String(newLastRunId));
                console.log(`Successfully wrote new lastRunId ${newLastRunId} to ${LAST_RUN_ID_FILE}`);
                lastRunId = newLastRunId; // Update in-memory lastRunId
            } catch (writeErr) {
                console.error(`Failed to write lastRunId ${newLastRunId} to file:`, writeErr.message);
                await alertAdmin("Failed to write lastRunId", `Could not update lastRun.txt to ${newLastRunId}. Error: ${writeErr.message}`);
            }
        }
        
        const finalMessage = `Upserted/updated ${totalUpsertedInThisRun} profiles from Phantombuster. Current lastRunId is ${lastRunId}.`;
        console.log(finalMessage);
        res.json({ message: finalMessage, newProfiles: totalUpsertedInThisRun });

    } catch (err) {
        console.error("Critical error in /pb-pull/connections:", err.message, err.stack);
        await alertAdmin("Critical Error in /pb-pull/connections", `Error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

/* ------------------------------------------------------------------
   10) DEBUG – return GPT URL (Will become Gemini related if kept)
------------------------------------------------------------------*/
// This was GPT specific. If you have a similar debug URL for Gemini testing, update it.
// For now, let's comment it out or make it clear it's not for Gemini.
app.get("/debug-gemini-info", (_req, res) => {
    res.json({
        message: "Gemini Debug Info",
        model_id: MODEL_ID,
        project_id: GCP_PROJECT_ID,
        location: GCP_LOCATION,
        client_initialized: !!globalGeminiModel
    });
});

/* ------------------------------------------------------------------
   11) Start server (Unchanged)
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
    `▶︎ Server starting – Version: Gemini Integrated – Commit ${process.env.RENDER_GIT_COMMIT || "local"
    } – ${new Date().toISOString()}`
);
app.listen(port, () => {
    console.log(`Server running on port ${port}. Ready to receive requests.`);
    if (!globalGeminiModel) {
        console.error("WARNING: Global Gemini Model Client failed to initialize at startup. Some endpoints might not work.");
        alertAdmin("Server Started with Gemini Init Failure", "The global Gemini model client failed to initialize. Check server logs immediately.");
    } else {
        console.log("Global Gemini Model Client seems initialized.");
    }
});

/* ------------------------------------------------------------------
   SECTION 4) getScoringData & helpers (Legacy - Commented Out)
   These functions seem to parse attributes from markdown, which is
   now handled by attributeLoader.js from Airtable.
   Keeping for reference but recommend removing if truly unused.
------------------------------------------------------------------*/
/*
async function getScoringData() {
  const md = await buildPrompt(); // buildPrompt now uses loadAttributes
  const passMark = 0;
  // parseMarkdownTables was specific to a markdown format of attributes
  // This is likely not needed if attributes are loaded from Airtable by loadAttributes
  // const { positives, negatives } = parseMarkdownTables(truncated);
  // return { truncatedInstructions: truncated, passMark, positives, negatives };
  console.warn("getScoringData function is likely obsolete and called unexpectedly.");
  return { truncatedInstructions: "", passMark: 0, positives: {}, negatives: {} };
}

function parseMarkdownTables(markdown) {
  // ... (implementation from your file) ...
  console.warn("parseMarkdownTables function is likely obsolete and called unexpectedly.");
  return { positives: {}, negatives: {} };
}
*/