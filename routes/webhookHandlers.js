// routes/webhookHandlers.js
// This version includes updated logic for handling 'scoringStatus' for /lh-webhook/upsertLeadOnly
// and the corrected regex for trailing slash removal.
// MODIFIED: Corrected capitalization for "View In Sales Navigator".

const express = require('express');
const router = express.Router();

// --- Dependencies needed for /lh-webhook/upsertLeadOnly ---
const { upsertLead } = require('../services/leadService.js');
const { alertAdmin } = require('../utils/appHelpers.js'); // For error alerting

// Import client service for multi-tenant support
const { getClientBase, getClientById } = require('../services/clientService.js');

// --- Structured Logging ---
const { StructuredLogger } = require('../utils/structuredLogger');

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
        
        // Create client-specific logger
        const log = new StructuredLogger(clientId || 'UNKNOWN');
        log.setup("=== WEBHOOK REQUEST: /lh-webhook/upsertLeadOnly ===");
        
        if (!clientId) {
            log.error("Missing required 'client' parameter");
            return res.status(400).json({ 
                error: "Missing required 'client' parameter. Use: /lh-webhook/upsertLeadOnly?client=YOUR_CLIENT_ID" 
            });
        }

        // Get client information and validate client exists
        let client;
        try {
            client = await getClientById(clientId);
            if (!client) {
                log.error(`Invalid client ID: ${clientId}`);
                return res.status(401).json({ 
                    error: "Invalid client ID. Please check your client parameter." 
                });
            }
        } catch (clientError) {
            log.error(`Error validating client ${clientId}: ${clientError.message}`);
            return res.status(401).json({ 
                error: "Failed to validate client. Please check your client parameter." 
            });
        }

        // Check if client is active - CRITICAL SECURITY CHECK
        if (client.status !== 'Active') {
            log.warn(`Inactive client attempted webhook access: ${clientId} (status: ${client.status})`);
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
                log.error(`Cannot get Airtable base for client ${clientId}`);
                return res.status(503).json({ 
                    error: "Service temporarily unavailable. Client's Airtable base not accessible." 
                });
            }
        } catch (baseError) {
            log.error(`Error getting Airtable base for client ${clientId}: ${baseError.message}`);
            return res.status(503).json({ 
                error: "Service temporarily unavailable. Failed to access client's database." 
            });
        }

        log.setup(`Processing for client: ${client.clientName} (${clientId})`);

        const rawLeadsFromWebhook = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
        log.setup(`Received ${rawLeadsFromWebhook.length} leads for processing`);
        
        if (rawLeadsFromWebhook.length > 0) {
            log.debug("First raw lead payload:", JSON.stringify(rawLeadsFromWebhook[0], null, 2));
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
                    log.warn("Skipping lead due to missing URL identifier. Lead data:", JSON.stringify(lh, null, 2));
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

                // DEBUG: Log name fields to understand the data structure
                log.debug(`Name fields for ${rawUrl}: firstName=${lh.firstName}, lastName=${lh.lastName}, first_name=${lh.first_name}, last_name=${lh.last_name}`);
                log.debug(`All available fields:`, Object.keys(lh));
                
                const leadForUpsert = {
                    "First Name": lh.firstName || lh.first_name || "", 
                    "Last Name": lh.lastName || lh.last_name || "",
                    firstName: lh.firstName || lh.first_name || "",  // Add camelCase for upsertLead function
                    lastName: lh.lastName || lh.last_name || "",     // Add camelCase for upsertLead function
                    "Headline": lh.headline || "", 
                    "Location": lh.locationName || lh.location_name || lh.location || "",
                    "Phone": (lh.phoneNumbers || [])[0]?.value || lh.phone_1 || lh.phone_2 || "",
                    "Email": lh.email || lh.workEmail || "",
                    "LinkedIn Profile URL": rawUrl ? rawUrl.replace(/\/$/, "") : null, 
                    linkedinProfileUrl: rawUrl ? rawUrl.replace(/\/$/, "") : null,  // Property name the function expects
                    "View In Sales Navigator": salesNavigatorUrl, 
                    "Job Title": lh.headline || lh.occupation || lh.position || (lh.experience && lh.experience[0] ? lh.experience[0].title : "") || "",
                    "Company Name": lh.companyName || (lh.company ? lh.company.name : "") || (lh.experience && lh.experience[0] ? lh.experience[0].company : "") || lh.organization_1 || "",
                    "About": lh.summary || lh.bio || "", 
                    "Scoring Status": scoringStatusForThisLead, 
                    "LinkedIn Connection Status": lh.connectionStatus || lh.linkedinConnectionStatus || "Unknown",
                    "Profile Full JSON": JSON.stringify(lh),
                    "Raw Profile Data": JSON.stringify(lh),
                    raw: lh  // originalLeadData for fallback URL lookup
                };
                
                // Use the original working upsertLead function from leadService.js
                // Pass the entire leadForUpsert object and the client-specific Airtable base
                await upsertLead(
                    leadForUpsert,      // The complete lead object
                    null,               // finalScore
                    null,               // aiProfileAssessment  
                    null,               // attribute_reasoning_obj
                    null,               // attributeBreakdown
                    null,               // auFlag
                    null,               // ai_excluded_val
                    null,               // exclude_details_val
                    clientAirtableBase  // Use the client-specific Airtable base
                );
                processedCount++;
            } catch (upsertError) {
                errorCount++;
                log.error(`Error upserting lead (Attempted URL: ${lh.profileUrl || lh.linkedinProfileUrl || lh.profile_url || 'N/A'}): ${upsertError.message}`, upsertError.stack);
                await alertAdmin("Lead Upsert Error in /lh-webhook/upsertLeadOnly", `Client: ${clientId}\\nAttempted URL: ${lh.profileUrl || lh.linkedinProfileUrl || lh.profile_url || 'N/A'}\\nError: ${upsertError.message}`);
            }
        }
        log.summary(`Processing finished. Upserted/Updated: ${processedCount}, Failed: ${errorCount}`);
        if (!res.headersSent) {
            res.json({ message: `Client ${clientId}: Upserted/Updated ${processedCount} LH profiles, Failed: ${errorCount}` });
        }
    } catch (err) {
        const finalClientId = req.query.client || 'unknown';
        const finalLog = log || new StructuredLogger(finalClientId);
        finalLog.error(`Critical error in /lh-webhook/upsertLeadOnly: ${err.message}`, err.stack);
        await alertAdmin("Critical Error in /lh-webhook/upsertLeadOnly", `Client: ${req.query.client || 'unknown'}\\nError: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

module.exports = router;