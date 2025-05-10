// routes/webhookHandlers.js
const express = require('express');
const router = express.Router();

// --- Dependencies ---
// Configs
const globalGeminiModel = require('../config/geminiClient.js');
const base = require('../config/airtableClient.js');

// Services
const { upsertLead } = require('../services/leadService.js');
const { scoreLeadNow } = require('../singleScorer.js'); // Assuming singleScorer.js is in the project root

// Loaders & Logic
const { loadAttributes } = require('../attributeLoader.js'); // Assuming in root
const { computeFinalScore } = require('../scoring.js');       // Assuming in root
const { buildAttributeBreakdown } = require('../breakdown.js'); // Assuming in root

// Helpers
const { isAustralian, alertAdmin } = require('../utils/appHelpers.js');

// Environment Variables (accessible via process.env due to dotenv in index.js)
const MIN_SCORE = Number(process.env.MIN_SCORE || 0);
const SAVE_FILTERED_ONLY = process.env.SAVE_FILTERED_ONLY === "true";

/* ------------------------------------------------------------------
    POST /pb-webhook/scrapeLeads – Phantombuster array
------------------------------------------------------------------*/
router.post("/pb-webhook/scrapeLeads", async (req, res) => {
    if (!globalGeminiModel || !base) {
        console.error("/pb-webhook/scrapeLeads: Cannot proceed, Gemini Model or Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
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
    POST /lh-webhook/upsertLeadOnly – Linked Helper Webhook
------------------------------------------------------------------*/
router.post("/lh-webhook/upsertLeadOnly", async (req, res) => {
    if (!base) { 
        console.error("/lh-webhook/upsertLeadOnly: Cannot proceed, Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
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

module.exports = router; // Export the router