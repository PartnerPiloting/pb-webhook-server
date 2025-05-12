// routes/webhookHandlers.js
// REMOVED: /pb-webhook/scrapeLeads route and its specific dependencies.

const express = require('express');
const router = express.Router();

// --- Dependencies needed for the remaining /lh-webhook/upsertLeadOnly route ---
const airtableBase = require('../config/airtableClient.js'); 
const { upsertLead } = require('../services/leadService.js');
const { alertAdmin } = require('../utils/appHelpers.js'); 

/*
    Dependencies removed as they were only for the now-removed /pb-webhook/scrapeLeads endpoint:
    - globalGeminiModel, vertexAIClient, geminiModelId from '../config/geminiClient.js'
    - scoreLeadNow from '../singleScorer.js'
    - loadAttributes from '../attributeLoader.js'
    - computeFinalScore from '../scoring.js'
    - buildAttributeBreakdown from '../breakdown.js'
    - isAustralian from '../utils/appHelpers.js'
    - MIN_SCORE, SAVE_FILTERED_ONLY (environment variables)
*/

/* ------------------------------------------------------------------
    POST /lh-webhook/upsertLeadOnly – Linked Helper Webhook
------------------------------------------------------------------*/
router.post("/lh-webhook/upsertLeadOnly", async (req, res) => {
    if (!airtableBase) { 
        console.error("webhookHandlers.js - /lh-webhook/upsertLeadOnly: Cannot proceed, Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        const rawLeadsFromWebhook = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
        console.log(`webhookHandlers.js: ▶︎ /lh-webhook/upsertLeadOnly received ${rawLeadsFromWebhook.length} leads.`);
        
        if (rawLeadsFromWebhook.length === 0) {
            return res.json({ message: "No leads provided in /lh-webhook/upsertLeadOnly payload." });
        }
        let processedCount = 0; 
        let errorCount = 0;

        for (const lh of rawLeadsFromWebhook) {
            try {
                const rawUrl = lh.profileUrl || lh.linkedinProfileUrl ||
                                 (lh.publicId ? `https://www.linkedin.com/in/${lh.publicId}/` : null) ||
                                 (lh.memberId ? `https://www.linkedin.com/profile/view?id=${lh.memberId}` : null);

                if (!rawUrl) {
                    console.warn("webhookHandlers.js: Skipping lead in /lh-webhook/upsertLeadOnly due to missing URL identifier:", lh.firstName, lh.lastName);
                    errorCount++; 
                    continue;
                }

                const leadForUpsert = {
                    firstName: lh.firstName || lh.first_name || "", 
                    lastName: lh.lastName || lh.last_name || "",
                    headline: lh.headline || "", 
                    locationName: lh.locationName || lh.location_name || lh.location || "",
                    phone: (lh.phoneNumbers || [])[0]?.value || lh.phone_1 || lh.phone_2 || "",
                    email: lh.email || lh.workEmail || "",
                    linkedinProfileUrl: rawUrl.replace(/\/$/, ""),
                    linkedinJobTitle: lh.headline || lh.occupation || lh.position || (lh.experience && lh.experience[0] ? lh.experience[0].title : "") || "",
                    linkedinCompanyName: lh.companyName || (lh.company ? lh.company.name : "") || (lh.experience && lh.experience[0] ? lh.experience[0].company : "") || lh.organization_1 || "",
                    linkedinDescription: lh.summary || lh.bio || "",
                    linkedinJobDateRange: (lh.experience && lh.experience[0] ? (lh.experience[0].dateRange || lh.experience[0].dates) : "") || "",
                    linkedinJobDescription: (lh.experience && lh.experience[0] ? lh.experience[0].description : "") || "",
                    linkedinPreviousJobDateRange: (lh.experience && lh.experience[1] ? (lh.experience[1].dateRange || lh.experience[1].dates) : "") || "",
                    linkedinPreviousJobDescription: (lh.experience && lh.experience[1] ? lh.experience[1].description : "") || "",
                    connectionDegree: lh.connectionDegree || ((typeof lh.distance === "string" && lh.distance.endsWith("_1")) || (typeof lh.member_distance === "string" && lh.member_distance.endsWith("_1")) || lh.degree === 1 ? "1st" : (lh.degree ? String(lh.degree) : "")),
                    connectionSince: lh.connectionDate || lh.connected_at_iso || lh.connected_at || lh.invited_date_iso || null,
                    refreshedAt: lh.lastRefreshed || lh.profileLastRefreshedDate || new Date().toISOString(),
                    raw: lh, 
                    scoringStatus: "To Be Scored", 
                    linkedinConnectionStatus: lh.connectionStatus || lh.linkedinConnectionStatus || (((typeof lh.distance === "string" && lh.distance.endsWith("_1")) || (typeof lh.member_distance === "string" && lh.member_distance.endsWith("_1")) || lh.degree === 1) ? "Connected" : "Candidate")
                };
                
                await upsertLead(leadForUpsert);
                processedCount++;
            } catch (upsertError) {
                errorCount++;
                console.error(`webhookHandlers.js: Error upserting a lead in /lh-webhook/upsertLeadOnly (URL: ${lh.profileUrl || 'N/A'}):`, upsertError.message);
                await alertAdmin("Lead Upsert Error in /lh-webhook/upsertLeadOnly", `URL: ${lh.profileUrl || 'N/A'}\nError: ${upsertError.message}`);
            }
        }
        console.log(`webhookHandlers.js: /lh-webhook/upsertLeadOnly finished. Upserted/Updated: ${processedCount}, Failed: ${errorCount}`);
        if (!res.headersSent) {
            res.json({ message: `Upserted/Updated ${processedCount} LH profiles, Failed: ${errorCount}` });
        }
    } catch (err) {
        console.error("webhookHandlers.js: Critical error in /lh-webhook/upsertLeadOnly:", err.message, err.stack);
        await alertAdmin("Critical Error in /lh-webhook/upsertLeadOnly", `Error: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

module.exports = router;