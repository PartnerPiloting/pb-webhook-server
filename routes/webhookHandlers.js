// routes/webhookHandlers.js
// This version includes updated logic for handling 'scoringStatus' for /lh-webhook/upsertLeadOnly
// and the corrected regex for trailing slash removal.
// MODIFIED: Corrected capitalization for "View In Sales Navigator".

const express = require('express');
const router = express.Router();

// --- Error Logging ---
// Removed old error logger - now using production issue tracking
const logCriticalError = async () => {};

// --- Dependencies needed for /lh-webhook/upsertLeadOnly ---
const { upsertLead } = require('../services/leadService.js');
const { alertAdmin } = require('../utils/appHelpers.js'); // For error alerting
const dirtyJSON = require('dirty-json');

// Import Airtable field constants for standardization
const { LEAD_FIELDS } = require('../constants/airtableUnifiedConstants.js');

// Import client service for multi-tenant support
const { getClientBase, getClientById } = require('../services/clientService.js');

// --- Structured Logging ---
// FIXED: Using unified logger factory to prevent "Object passed as sessionId" errors
const { createSafeLogger } = require('../utils/loggerHelper');

/* ------------------------------------------------------------------
    POST /lh-webhook/upsertLeadOnly?client=CLIENT_ID – Linked Helper Webhook
    (This endpoint saves/updates lead data in client-specific Airtable bases.
     It aims to preserve existing Scoring Status for connection updates and 
     sets "To Be Scored" for new profiles).
     
    REQUIRED: client query parameter to specify which client's base to use
------------------------------------------------------------------*/
router.post("/lh-webhook/upsertLeadOnly", async (req, res) => {
    let log; // Define log here to be accessible in the final catch block
    try {
        // Extract and validate client parameter
        const clientId = req.query.client;
        
        // Create client-specific logger using safe creation
        log = createSafeLogger(clientId || 'UNKNOWN', null, 'webhook');
        log.info("=== WEBHOOK REQUEST: /lh-webhook/upsertLeadOnly ===");
        
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
    await logCriticalError(clientError, { operation: 'lh_webhook_upsertLeadOnly', isSearch: true, clientId: clientId }).catch(() => {});
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
    logCriticalError(baseError, { operation: 'unknown' }).catch(() => {});
            return res.status(503).json({ 
                error: "Service temporarily unavailable. Failed to access client's database." 
            });
        }

        log.info(`Processing for client: ${client.clientName} (${clientId})`);

        // ADDED: Enhanced JSON processing with dirty-json fallback for malformed data
        let processedBody;
        try {
            // If the body is a string, try to parse it as JSON.
            if (typeof req.body === 'string') {
                try {
                    processedBody = JSON.parse(req.body);
                } catch (e) {
                    log.warn("Request body is a string but not valid JSON. Attempting to process as-is.");
                    processedBody = req.body; // Keep as string if parsing fails
                }
            } else {
    logCriticalError(e, { operation: 'unknown' }).catch(() => {});
                processedBody = req.body;
            }

            // Function to recursively parse stringified JSON within an object
            function processObjectForStringifiedJSON(obj) {
                if (!obj || typeof obj !== 'object') return obj;
                
                for (const [key, value] of Object.entries(obj)) {
                    if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                        try {
                            obj[key] = JSON.parse(value);
                            log.debug(`Successfully parsed stringified JSON in field: ${key}`);
                        } catch (parseError) {
                            try {
    logCriticalError(parseError, { operation: 'unknown' }).catch(() => {});
                                obj[key] = dirtyJSON.parse(value);
                                log.info(`dirty-json successfully parsed malformed JSON in field: ${key}`);
                            } catch (dirtyError) {
                                log.warn(`Failed to parse JSON in field ${key} with both JSON.parse and dirty-json. Keeping original string.`);
    logCriticalError(dirtyError, { operation: 'unknown' }).catch(() => {});
                            }
                        }
                    } else if (typeof value === 'object') {
                        processObjectForStringifiedJSON(value);
                    }
                }
            }
            
            if (Array.isArray(processedBody)) {
                processedBody.forEach(item => processObjectForStringifiedJSON(item));
            } else if (typeof processedBody === 'object') {
                processObjectForStringifiedJSON(processedBody);
            }

        } catch (bodyProcessingError) {
            logCriticalError(bodyProcessingError, { 
                operation: 'json_parse_webhook_body',
                expectedBehavior: true 
            }).catch(() => {});
            log.error("Error processing request body with enhanced JSON parsing:", bodyProcessingError.message);
            processedBody = req.body; // Fallback
        }

        const rawLeadsFromWebhook = Array.isArray(processedBody) ? processedBody : (processedBody ? [processedBody] : []);
        log.info(`Received ${rawLeadsFromWebhook.length} leads for processing`);
        
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
                    [LEAD_FIELDS.FIRST_NAME]: lh.firstName || lh.first_name || "", 
                    [LEAD_FIELDS.LAST_NAME]: lh.lastName || lh.last_name || "",
                    firstName: lh.firstName || lh.first_name || "",  // Add camelCase for upsertLead function
                    lastName: lh.lastName || lh.last_name || "",     // Add camelCase for upsertLead function
                    [LEAD_FIELDS.HEADLINE]: lh.headline || "", 
                    [LEAD_FIELDS.LOCATION]: lh.locationName || lh.location_name || lh.location || "",
                    [LEAD_FIELDS.PHONE]: (lh.phoneNumbers || [])[0]?.value || lh.phone_1 || lh.phone_2 || "",
                    [LEAD_FIELDS.EMAIL]: lh.email || lh.workEmail || "",
                    [LEAD_FIELDS.LINKEDIN_PROFILE_URL]: rawUrl ? rawUrl.replace(/\/$/, "") : null, 
                    linkedinProfileUrl: rawUrl ? rawUrl.replace(/\/$/, "") : null,  // Property name the function expects
                    [LEAD_FIELDS.VIEW_IN_SALES_NAVIGATOR]: salesNavigatorUrl, 
                    [LEAD_FIELDS.JOB_TITLE]: lh.headline || lh.occupation || lh.position || (lh.experience && lh.experience[0] ? lh.experience[0].title : "") || "",
                    [LEAD_FIELDS.COMPANY_NAME]: lh.companyName || (lh.company ? lh.company.name : "") || (lh.experience && lh.experience[0] ? lh.experience[0].company : "") || lh.organization_1 || "",
                    [LEAD_FIELDS.ABOUT]: lh.summary || lh.bio || "", 
                    [LEAD_FIELDS.SCORING_STATUS]: scoringStatusForThisLead, 
                    [LEAD_FIELDS.LINKEDIN_CONNECTION_STATUS]: lh.connectionStatus || lh.linkedinConnectionStatus || "Unknown",
                    [LEAD_FIELDS.PROFILE_FULL_JSON]: JSON.stringify(lh),
                    [LEAD_FIELDS.RAW_PROFILE_DATA]: JSON.stringify(lh),
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
    logCriticalError(upsertError, { operation: 'unknown' }).catch(() => {});
                await alertAdmin("Lead Upsert Error in /lh-webhook/upsertLeadOnly", `Client: ${clientId}\\nAttempted URL: ${lh.profileUrl || lh.linkedinProfileUrl || lh.profile_url || 'N/A'}\\nError: ${upsertError.message}`);
            }
        }
        log.info(`Processing finished. Upserted/Updated: ${processedCount}, Failed: ${errorCount}`);
        if (!res.headersSent) {
            res.json({ message: `Client ${clientId}: Upserted/Updated ${processedCount} LH profiles, Failed: ${errorCount}` });
        }
    } catch (err) {
        const finalClientId = req.query.client || 'unknown';
        // FIXED: Using createLogger instead of direct StructuredLogger instantiation
        const finalLog = log || createLogger({ runId: 'SYSTEM', clientId: finalClientId, operation: 'webhook' });
        finalLog.error(`Critical error in /lh-webhook/upsertLeadOnly: ${err.message}`, err.stack);
        
        // Log to Airtable Error Log
        await logCriticalError(err, {
            endpoint: 'POST /lh-webhook/upsertLeadOnly',
            clientId: finalClientId,
            webhookPayload: req.body
        }).catch(() => {});
        
        await alertAdmin("Critical Error in /lh-webhook/upsertLeadOnly", `Client: ${req.query.client || 'unknown'}\\nError: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

module.exports = router;