// routes/webhookHandlers.js
// This version includes the updated URL identifier logic for /lh-webhook/upsertLeadOnly
// and has the /pb-webhook/scrapeLeads route removed.

const express = require('express');
const router = express.Router();

// --- Dependencies needed for /lh-webhook/upsertLeadOnly ---
const airtableBase = require('../config/airtableClient.js'); // For upsertLead via leadService
const { upsertLead } = require('../services/leadService.js');
const { alertAdmin } = require('../utils/appHelpers.js'); // For error alerting

/*
    The following dependencies were for the now-removed /pb-webhook/scrapeLeads endpoint
    and are no longer needed by this file:
    - globalGeminiModel, vertexAIClient, geminiModelId from '../config/geminiClient.js'
    - scoreLeadNow from '../singleScorer.js'
    - loadAttributes from '../attributeLoader.js'
    - computeFinalScore from '../scoring.js'
    - buildAttributeBreakdown from '../breakdown.js'
    - isAustralian from '../utils/appHelpers.js' (alertAdmin is still used)
    - MIN_SCORE, SAVE_FILTERED_ONLY (environment variables)
*/

/* ------------------------------------------------------------------
    POST /lh-webhook/upsertLeadOnly – Linked Helper Webhook
    (This endpoint saves lead data without immediate AI scoring)
------------------------------------------------------------------*/
router.post("/lh-webhook/upsertLeadOnly", async (req, res) => {
    if (!airtableBase) { 
        console.error("webhookHandlers.js - /lh-webhook/upsertLeadOnly: Cannot proceed, Airtable Base not initialized.");
        return res.status(503).json({ error: "Service temporarily unavailable due to configuration issues." });
    }
    try {
        const rawLeadsFromWebhook = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
        console.log(`webhookHandlers.js: ▶︎ /lh-webhook/upsertLeadOnly received ${rawLeadsFromWebhook.length} leads.`);
        
        // Log the raw payload to help debug (can be removed or conditionalized later)
        if (rawLeadsFromWebhook.length > 0) {
            console.log("/lh-webhook/upsertLeadOnly first raw lead payload:", JSON.stringify(rawLeadsFromWebhook[0], null, 2));
        }

        if (rawLeadsFromWebhook.length === 0) {
            return res.json({ message: "No leads provided in /lh-webhook/upsertLeadOnly payload." });
        }
        let processedCount = 0; 
        let errorCount = 0;

        for (const lh of rawLeadsFromWebhook) {
            try {
                // Updated rawUrl derivation logic
                const rawUrl = lh.profileUrl || // Check 1: camelCase profileUrl
                               lh.linkedinProfileUrl || // Check 2: camelCase linkedinProfileUrl
                               lh.profile_url || // Check 3: snake_case profile_url <<< ADDED THIS
                               (lh.publicId ? `https://www.linkedin.com/in/${lh.publicId}/` : null) || // Check 4: publicId
                               (lh.memberId ? `https://www.linkedin.com/profile/view?id=${lh.memberId}` : null); // Check 5: memberId

                if (!rawUrl) {
                    // Log the specific lh object that's causing the skip for better debugging
                    console.warn("webhookHandlers.js: Skipping lead in /lh-webhook/upsertLeadOnly due to missing URL identifier. Lead data:", JSON.stringify(lh, null, 2));
                    errorCount++; 
                    continue;
                }

                // Construct the lead object for upsertLead, ensuring 'raw' and 'scoringStatus' are set
                // This mapping logic should be reviewed to ensure it correctly maps all desired fields from 'lh'
                const leadForUpsert = {
                    firstName: lh.firstName || lh.first_name || "", 
                    lastName: lh.lastName || lh.last_name || "",
                    headline: lh.headline || "", 
                    locationName: lh.locationName || lh.location_name || lh.location || "",
                    phone: (lh.phoneNumbers || [])[0]?.value || lh.phone_1 || lh.phone_2 || "",
                    email: lh.email || lh.workEmail || "",
                    linkedinProfileUrl: rawUrl.replace(/\\/$/, ""), // Use the derived rawUrl
                    linkedinJobTitle: lh.headline || lh.occupation || lh.position || (lh.experience && lh.experience[0] ? lh.experience[0].title : "") || "",
                    linkedinCompanyName: lh.companyName || (lh.company ? lh.company.name : "") || (lh.experience && lh.experience[0] ? lh.experience[0].company : "") || lh.organization_1 || "",
                    linkedinDescription: lh.summary || lh.bio || "", // 'about' section
                    linkedinJobDateRange: (lh.experience && lh.experience[0] ? (lh.experience[0].dateRange || lh.experience[0].dates) : "") || "",
                    linkedinJobDescription: (lh.experience && lh.experience[0] ? lh.experience[0].description : "") || "",
                    linkedinPreviousJobDateRange: (lh.experience && lh.experience[1] ? (lh.experience[1].dateRange || lh.experience[1].dates) : "") || "",
                    linkedinPreviousJobDescription: (lh.experience && lh.experience[1] ? lh.experience[1].description : "") || "",
                    connectionDegree: lh.connectionDegree || ((typeof lh.distance === "string" && lh.distance.endsWith("_1")) || (typeof lh.member_distance === "string" && lh.member_distance.endsWith("_1")) || lh.degree === 1 ? "1st" : (lh.degree ? String(lh.degree) : "")),
                    connectionSince: lh.connectionDate || lh.connected_at_iso || lh.connected_at || lh.invited_date_iso || null,
                    refreshedAt: lh.lastRefreshed || lh.profileLastRefreshedDate || new Date().toISOString(),
                    raw: lh, // Pass the full original LH object as 'raw'
                    scoringStatus: "To Be Scored", // Explicitly set for this webhook's purpose
                    linkedinConnectionStatus: lh.connectionStatus || lh.linkedinConnectionStatus || (((typeof lh.distance === "string" && lh.distance.endsWith("_1")) || (typeof lh.member_distance === "string" && lh.member_distance.endsWith("_1")) || lh.degree === 1) ? "Connected" : "Candidate")
                    // Ensure all other fields expected by leadService.upsertLead are mapped or handled
                };
                
                await upsertLead(leadForUpsert);
                processedCount++;
            } catch (upsertError) {
                errorCount++;
                console.error(`webhookHandlers.js: Error upserting a lead in /lh-webhook/upsertLeadOnly (Attempted URL: ${lh.profileUrl || lh.linkedinProfileUrl || lh.profile_url || 'N/A'}):`, upsertError.message, upsertError.stack);
                await alertAdmin("Lead Upsert Error in /lh-webhook/upsertLeadOnly", `Attempted URL: ${lh.profileUrl || lh.linkedinProfileUrl || lh.profile_url || 'N/A'}\\nError: ${upsertError.message}`);
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