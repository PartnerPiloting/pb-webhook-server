// routes/webhookHandlers.js
// This version includes updated logic for handling 'scoringStatus' for /lh-webhook/upsertLeadOnly
// and the corrected regex for trailing slash removal.
// It has the /pb-webhook/scrapeLeads route removed.
// MODIFIED: Corrected capitalization for "View In Sales Navigator".

const express = require('express');
const router = express.Router();

// --- Dependencies needed for /lh-webhook/upsertLeadOnly ---
const airtableBase = require('../config/airtableClient.js'); // For upsertLead via leadService
const { upsertLead } = require('../services/leadService.js');
const { alertAdmin } = require('../utils/appHelpers.js'); // For error alerting

// Import client service for multi-tenant support
const { getClientBase, getClientById } = require('../services/clientService.js');

/* ------------------------------------------------------------------
    POST /lh-webhook/upsertLeadOnly?client=CLIENT_ID – Linked Helper Webhook
    (This endpoint saves/updates lead data in client-specific Airtable bases.
     It aims to preserve existing Scoring Status for connection updates and 
     sets "To Be Scored" for new profiles).
     
    REQUIRED: client query parameter to specify which client's base to use
------------------------------------------------------------------*/
router.post("/lh-webhook/upsertLeadOnly", async (req, res) => {
    try {
        // Extract and validate client parameter
        const clientId = req.query.client;
        
        if (!clientId) {
            console.error("webhookHandlers.js - /lh-webhook/upsertLeadOnly: Missing required 'client' parameter");
            return res.status(400).json({ 
                error: "Missing required 'client' parameter. Use: /lh-webhook/upsertLeadOnly?client=YOUR_CLIENT_ID" 
            });
        }

        // Get client information and validate client exists
        let client;
        try {
            client = await getClientById(clientId);
            if (!client) {
                console.error(`webhookHandlers.js - /lh-webhook/upsertLeadOnly: Invalid client ID: ${clientId}`);
                return res.status(401).json({ 
                    error: "Invalid client ID. Please check your client parameter." 
                });
            }
        } catch (clientError) {
            console.error(`webhookHandlers.js - /lh-webhook/upsertLeadOnly: Error validating client ${clientId}:`, clientError.message);
            return res.status(401).json({ 
                error: "Failed to validate client. Please check your client parameter." 
            });
        }

        // Check if client is active - CRITICAL SECURITY CHECK
        if (client.status !== 'Active') {
            console.warn(`webhookHandlers.js - /lh-webhook/upsertLeadOnly: Inactive client attempted webhook access: ${clientId} (status: ${client.status})`);
            await alertAdmin("Inactive Client Webhook Attempt", `Client: ${clientId} (${client.clientName})\\nStatus: ${client.status}\\nAttempted webhook access denied`);
            return res.status(403).json({ 
                error: "Client account is not active. Please check your account status.",
                clientStatus: client.status
            });
        }

        // Get client-specific Airtable base
        let clientAirtableBase;
        try {
            clientAirtableBase = await getClientBase(client.airtableBaseId);
            if (!clientAirtableBase) {
                console.error(`webhookHandlers.js - /lh-webhook/upsertLeadOnly: Cannot get Airtable base for client ${clientId}`);
                return res.status(503).json({ 
                    error: "Service temporarily unavailable. Client's Airtable base not accessible." 
                });
            }
        } catch (baseError) {
            console.error(`webhookHandlers.js - /lh-webhook/upsertLeadOnly: Error getting Airtable base for client ${clientId}:`, baseError.message);
            return res.status(503).json({ 
                error: "Service temporarily unavailable. Failed to access client's database." 
            });
        }

        console.log(`webhookHandlers.js: ▶︎ /lh-webhook/upsertLeadOnly processing for client: ${client.clientName} (${clientId})`);

        const rawLeadsFromWebhook = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
        console.log(`webhookHandlers.js: ▶︎ /lh-webhook/upsertLeadOnly received ${rawLeadsFromWebhook.length} leads for client ${clientId}.`);
        
        if (rawLeadsFromWebhook.length > 0) {
            console.log("/lh-webhook/upsertLeadOnly first raw lead payload:", JSON.stringify(rawLeadsFromWebhook[0], null, 2));
        }

        if (rawLeadsFromWebhook.length === 0) {
            return res.json({ message: `No leads provided in /lh-webhook/upsertLeadOnly payload for client ${clientId}.` });
        }
        let processedCount = 0; 
        let errorCount = 0;

        const salesNavBaseUrl = "https://www.linkedin.com/sales/lead/"; // Define this once

        for (const lh of rawLeadsFromWebhook) {
            try {
                const rawUrl = lh.profileUrl || 
                               lh.linkedinProfileUrl || 
                               lh.profile_url || 
                               (lh.publicId ? `https://www.linkedin.com/in/${lh.publicId}/` : null) ||
                               (lh.memberId ? `https://www.linkedin.com/profile/view?id=${lh.memberId}` : null);

                if (!rawUrl) {
                    console.warn("webhookHandlers.js: Skipping lead in /lh-webhook/upsertLeadOnly due to missing URL identifier. Lead data:", JSON.stringify(lh, null, 2));
                    errorCount++; 
                    continue;
                }

                const isLikelyExistingConnectionUpdate = (
                    lh.connectionDegree === "1st" ||
                    (typeof lh.distance === "string" && lh.distance.endsWith("_1")) ||
                    (typeof lh.member_distance === "string" && lh.member_distance.endsWith("_1")) ||
                    lh.degree === 1 ||
                    lh.connectionStatus === "Connected" ||
                    lh.linkedinConnectionStatus === "Connected"
                );

                const scoringStatusForThisLead = isLikelyExistingConnectionUpdate ? undefined : "To Be Scored";
                
                // ***** START: Construct Sales Navigator URL *****
                let salesNavigatorUrl = null;
                if (lh.sn_hash_id && typeof lh.sn_hash_id === 'string' && lh.sn_hash_id.trim() !== '') {
                    const coreSnHashId = lh.sn_hash_id.split(',')[0].trim(); // Get part before comma
                    if (coreSnHashId) {
                        salesNavigatorUrl = `${salesNavBaseUrl}${coreSnHashId}`;
                    }
                }
                // ***** END: Construct Sales Navigator URL *****

                const leadForUpsert = {
                    "First Name": lh.firstName || lh.first_name || "", 
                    "Last Name": lh.lastName || lh.last_name || "",
                    "Headline": lh.headline || "", 
                    "Location": lh.locationName || lh.location_name || lh.location || "",
                    "Phone": (lh.phoneNumbers || [])[0]?.value || lh.phone_1 || lh.phone_2 || "",
                    "Email": lh.email || lh.workEmail || "",
                    "LinkedIn Profile URL": rawUrl ? rawUrl.replace(/\/$/, "") : null, 
                    "View In Sales Navigator": salesNavigatorUrl, 
                    "Job Title": lh.headline || lh.occupation || lh.position || (lh.experience && lh.experience[0] ? lh.experience[0].title : "") || "",
                    "Company Name": lh.companyName || (lh.company ? lh.company.name : "") || (lh.experience && lh.experience[0] ? lh.experience[0].company : "") || lh.organization_1 || "",
                    "About": lh.summary || lh.bio || "", 
                    "Source": "LinkedHelper",
                    "Lead Scoring Status": scoringStatusForThisLead, 
                    "LinkedIn Connection Status": lh.connectionStatus || lh.linkedinConnectionStatus || (((typeof lh.distance === "string" && lh.distance.endsWith("_1")) || (typeof lh.member_distance === "string" && lh.member_distance.endsWith("_1")) || lh.degree === 1) ? "Connected" : "Candidate")
                };
                
                // Use client-specific Airtable base for upsert instead of global leadService
                await upsertLeadToClientBase(leadForUpsert, clientAirtableBase, clientId);
                processedCount++;
            } catch (upsertError) {
                errorCount++;
                console.error(`webhookHandlers.js: Error upserting a lead in /lh-webhook/upsertLeadOnly for client ${clientId} (Attempted URL: ${lh.profileUrl || lh.linkedinProfileUrl || lh.profile_url || 'N/A'}):`, upsertError.message, upsertError.stack);
                await alertAdmin("Lead Upsert Error in /lh-webhook/upsertLeadOnly", `Client: ${clientId}\\nAttempted URL: ${lh.profileUrl || lh.linkedinProfileUrl || lh.profile_url || 'N/A'}\\nError: ${upsertError.message}`);
            }
        }
        console.log(`webhookHandlers.js: /lh-webhook/upsertLeadOnly finished for client ${clientId}. Upserted/Updated: ${processedCount}, Failed: ${errorCount}`);
        if (!res.headersSent) {
            res.json({ message: `Client ${clientId}: Upserted/Updated ${processedCount} LH profiles, Failed: ${errorCount}` });
        }
    } catch (err) {
        console.error(`webhookHandlers.js: Critical error in /lh-webhook/upsertLeadOnly for client ${req.query.client || 'unknown'}:`, err.message, err.stack);
        await alertAdmin("Critical Error in /lh-webhook/upsertLeadOnly", `Client: ${req.query.client || 'unknown'}\\nError: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

/**
 * Client-aware upsert function for webhook use
 * Similar to leadService.upsertLead but uses provided Airtable base
 */
async function upsertLeadToClientBase(lead, airtableBase, clientId) {
    const firstName = lead["First Name"] || "";
    const lastName = lead["Last Name"] || "";
    const linkedinProfileUrl = lead["LinkedIn Profile URL"] || "";
    const scoringStatus = lead["Lead Scoring Status"];

    if (!linkedinProfileUrl) {
        console.warn(`webhookHandlers.js: Skipping upsert for client ${clientId}. No LinkedIn URL provided for lead:`, firstName, lastName);
        return;
    }

    // Normalize URL (remove trailing slash)
    const finalUrl = linkedinProfileUrl.replace(/\/$/, "");

    try {
        // Check if lead already exists
        const existing = await airtableBase('Leads').select({
            maxRecords: 1,
            filterByFormula: `{LinkedIn Profile URL} = "${finalUrl}"`
        }).firstPage();

        if (existing && existing.length > 0) {
            // Update existing lead
            console.log(`webhookHandlers.js: Updating existing lead for client ${clientId}: ${finalUrl} (ID: ${existing[0].id})`);
            
            // Prepare update fields (exclude LinkedIn Profile URL since it's the identifier)
            const updateFields = { ...lead };
            delete updateFields["LinkedIn Profile URL"]; // Don't update the URL field
            
            // Only update Lead Scoring Status if we have a value and it's not already set
            if (scoringStatus && !existing[0].fields['Lead Scoring Status']) {
                updateFields["Lead Scoring Status"] = scoringStatus;
            } else {
                delete updateFields["Lead Scoring Status"];
            }

            await airtableBase('Leads').update([{
                id: existing[0].id,
                fields: updateFields
            }]);
        } else {
            // Create new lead
            console.log(`webhookHandlers.js: Creating new lead for client ${clientId}: ${finalUrl}`);
            
            const createFields = {
                ...lead,
                "LinkedIn Profile URL": finalUrl,
                "Lead Scoring Status": scoringStatus || 'To Be Scored'
            };

            await airtableBase('Leads').create([{
                fields: createFields
            }]);
        }
    } catch (error) {
        console.error(`webhookHandlers.js: Error in upsertLeadToClientBase for client ${clientId}:`, error);
        throw error;
    }
}

module.exports = router;