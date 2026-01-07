// services/leadService.js
// UPDATED to better handle Scoring Status on updates and Date Connected
// MODIFIED: To include "View In Sales Navigator" field
// ENHANCED: To support run tracking metrics
// MIGRATED: To use unified constants

const base = require('../config/airtableClient.js'); 
const { createLogger } = require('../utils/contextLogger');

// Create module-level logger for lead service
const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'lead-service' 
});
// Removed old error logger - now using production issue tracking
const logCriticalError = async () => {};
const { getLastTwoOrgs, canonicalUrl, safeDate } = require('../utils/appHelpers.js');
const { slimLead } = require('../promptBuilder.js');
const airtableService = require('./airtableService');
// Updated to use new run ID system
const runIdSystem = require('./runIdSystem');
const { safeUpdateMetrics } = require('./runRecordAdapterSimple');

// Import unified constants
const { CLIENT_TABLES, LEAD_FIELDS, SCORING_STATUS_VALUES, CONNECTION_STATUS_VALUES, LEAD_STATUS_VALUES, CLIENT_RUN_FIELDS } = require('../constants/airtableUnifiedConstants');
const { validateFieldNames, createValidatedObject } = require('../utils/airtableFieldValidator');

async function upsertLead(
    lead, 
    finalScore = null,
    aiProfileAssessment = null,
    attribute_reasoning_obj = null, 
    attributeBreakdown = null,
    auFlag = null,
    ai_excluded_val = null,         
    exclude_details_val = null,
    clientAirtableBase = null,  // Optional client-specific Airtable base
    trackingInfo = null         // NEW: Optional tracking info for run metrics
) {
    // Use client-specific base if provided, otherwise use global base
    const airtableBase = clientAirtableBase || base;
    
    if (!airtableBase) {
        logger.error("CRITICAL ERROR in leadService/upsertLead: Airtable Base is not initialized. Cannot proceed.");
        throw new Error("Airtable base is not available in leadService. Check config/airtableClient.js logs.");
    }
    
    // Initialize tracking variables
    let isNewLead = false;
    let isScored = false;
    let tokenUsage = 0;

    const {
        firstName = "", lastName = "", headline: lhHeadline = "",
        linkedinHeadline = "", linkedinJobTitle = "", linkedinCompanyName = "", linkedinDescription = "",
        linkedinProfileUrl = "", connectionDegree = "", 
        linkedinJobDateRange = "", linkedinJobDescription = "",
        linkedinPreviousJobDateRange = "", linkedinPreviousJobDescription = "",
        refreshedAt = "", profileUrl: fallbackProfileUrl = "",
        emailAddress = "", phoneNumber = "", locationName = "",
        connectionSince, 
        scoringStatus, 
        raw, 
        [LEAD_FIELDS.VIEW_IN_SALES_NAVIGATOR]: viewInSalesNavigatorUrl, // Using constant instead of string literal
        ...rest 
    } = lead;

    const originalLeadData = raw || lead;

    let jobHistory = [
        linkedinJobDateRange ? `Current:\n${linkedinJobDateRange} — ${linkedinJobDescription}` : "",
        linkedinPreviousJobDateRange ? `Previous:\n${linkedinPreviousJobDateRange} — ${linkedinPreviousJobDescription}` : ""
    ].filter(Boolean).join("\n");

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
        logger.warn("leadService/upsertLead: Skipping upsert. No finalUrl could be determined for lead:", firstName, lastName);
        return; 
    }
    const profileKey = canonicalUrl(finalUrl); 

    let currentConnectionStatus = CONNECTION_STATUS_VALUES.CANDIDATE; 
    if (connectionDegree === "1st") currentConnectionStatus = CONNECTION_STATUS_VALUES.CONNECTED;
    else if (lead.linkedinConnectionStatus === CONNECTION_STATUS_VALUES.PENDING) currentConnectionStatus = CONNECTION_STATUS_VALUES.PENDING;
    else if (originalLeadData.connectionStatus) currentConnectionStatus = originalLeadData.connectionStatus;


    const profileForJsonField = slimLead(originalLeadData);

    // DEBUG LOCATION: Log all location sources to diagnose blank Location field
    logger.info(`[LOCATION-DEBUG] locationName from destructure: "${locationName}"`);
    logger.info(`[LOCATION-DEBUG] originalLeadData.location_name: "${originalLeadData?.location_name}"`);
    logger.info(`[LOCATION-DEBUG] originalLeadData.location: "${originalLeadData?.location}"`);
    const resolvedLocation = locationName || originalLeadData.location_name || originalLeadData.location || "";
    logger.info(`[LOCATION-DEBUG] RESOLVED location value: "${resolvedLocation}"`);

    const fields = {
        [LEAD_FIELDS.LINKEDIN_PROFILE_URL]: finalUrl,
        [LEAD_FIELDS.FIRST_NAME]: firstName,
        [LEAD_FIELDS.LAST_NAME]: lastName,
        [LEAD_FIELDS.HEADLINE]: linkedinHeadline || lhHeadline || originalLeadData.headline || "",
        [LEAD_FIELDS.JOB_TITLE]: linkedinJobTitle || originalLeadData.occupation || originalLeadData.position || "",
        [LEAD_FIELDS.COMPANY_NAME]: linkedinCompanyName || (originalLeadData.company ? originalLeadData.company.name : "") || originalLeadData.organization_1 || "",
        [LEAD_FIELDS.ABOUT]: linkedinDescription || originalLeadData.summary || originalLeadData.bio || "",
        [LEAD_FIELDS.JOB_HISTORY]: jobHistory,
        [LEAD_FIELDS.LINKEDIN_CONNECTION_STATUS]: currentConnectionStatus,
        [LEAD_FIELDS.STATUS]: LEAD_STATUS_VALUES.IN_PROCESS, 
        [LEAD_FIELDS.LOCATION]: resolvedLocation,
        [LEAD_FIELDS.DATE_CONNECTED]: safeDate(connectionSince) || safeDate(originalLeadData.connectedAt) || safeDate(originalLeadData.connectionDate) || (currentConnectionStatus === CONNECTION_STATUS_VALUES.CONNECTED && !lead.id ? new Date().toISOString() : null), // Set Date Connected if newly Connected and no previous date
        [LEAD_FIELDS.EMAIL]: emailAddress || originalLeadData.email || originalLeadData.workEmail || "",
        [LEAD_FIELDS.PHONE]: phoneNumber || originalLeadData.phone || (originalLeadData.phoneNumbers || [])[0]?.value || "",
        [LEAD_FIELDS.REFRESHED_AT]: refreshedAt ? new Date(refreshedAt) : (originalLeadData.lastRefreshed ? new Date(originalLeadData.lastRefreshed) : null),
        [LEAD_FIELDS.PROFILE_FULL_JSON]: JSON.stringify(profileForJsonField),
        [LEAD_FIELDS.RAW_PROFILE_DATA]: JSON.stringify(originalLeadData),

        // Use constant for Sales Navigator field
        [LEAD_FIELDS.VIEW_IN_SALES_NAVIGATOR]: viewInSalesNavigatorUrl || null
    };

    // --- MODIFIED Scoring Status Handling ---
    if (scoringStatus !== undefined) { // Only include if explicitly passed (e.g., "To Be Scored" for new leads)
        fields[LEAD_FIELDS.SCORING_STATUS] = scoringStatus;
    }
    // --- END MODIFIED Scoring Status Handling ---

    if (finalScore !== null) fields[LEAD_FIELDS.AI_SCORE] = Math.round(finalScore * 100) / 100;
    if (aiProfileAssessment !== null) fields[LEAD_FIELDS.AI_PROFILE_ASSESSMENT] = String(aiProfileAssessment || "");
    if (attributeBreakdown !== null) fields[LEAD_FIELDS.AI_ATTRIBUTES_DETAIL] = attributeBreakdown;
    if (auFlag !== null) fields[LEAD_FIELDS.AU] = !!auFlag;
    // Note: "Yes" is a legacy string value from Airtable, not a field constant we control
    if (ai_excluded_val !== null) fields[LEAD_FIELDS.AI_EXCLUDED] = (ai_excluded_val === "Yes" || ai_excluded_val === true);
    if (exclude_details_val !== null) fields[LEAD_FIELDS.EXCLUDE_DETAILS] = exclude_details_val;

    const existing = await airtableBase(CLIENT_TABLES.LEADS).select({ 
        filterByFormula: `{Profile Key} = "${profileKey}"`, 
        maxRecords: 1 
    }).firstPage();

    let recordId;
    
    if (existing.length) {
        isNewLead = false;
        logger.info(`leadService/upsertLead: Updating existing lead ${finalUrl} (ID: ${existing[0].id})`);
        // For "Date Connected", update if:
        // 1. We have a new connection date from the webhook, OR
        // 2. Status is now "Connected" but there's no existing date
        if (currentConnectionStatus === CONNECTION_STATUS_VALUES.CONNECTED) {
            if (!existing[0].fields[LEAD_FIELDS.DATE_CONNECTED] && !fields[LEAD_FIELDS.DATE_CONNECTED]) {
                // No date anywhere - set to now
                fields[LEAD_FIELDS.DATE_CONNECTED] = new Date().toISOString();
            }
            // If fields[LEAD_FIELDS.DATE_CONNECTED] already exists from connectionSince, it will be used
        }
        
        // Validate field names before sending to Airtable
        const validatedFields = createValidatedObject(fields);
        await airtableBase(CLIENT_TABLES.LEADS).update(existing[0].id, validatedFields);
        recordId = existing[0].id; 
    } else {
        isNewLead = true;
        // If it's a new record, and scoringStatus wasn't explicitly set to "To Be Scored" (e.g. it was undefined)
        // default it to "To Be Scored".
        if (fields[LEAD_FIELDS.SCORING_STATUS] === undefined) {
            fields[LEAD_FIELDS.SCORING_STATUS] = SCORING_STATUS_VALUES.NOT_SCORED;
        }
        if (currentConnectionStatus === CONNECTION_STATUS_VALUES.CONNECTED && !fields[LEAD_FIELDS.DATE_CONNECTED]) {
            fields[LEAD_FIELDS.DATE_CONNECTED] = new Date().toISOString();
        }
        // REMOVED: System Notes field - not all client bases have this field (e.g., Dean Hobin)
        // This was causing "Unknown field name: 'System Notes'" errors
        // The field is not critical for lead creation, so we're omitting it for compatibility
        logger.info(`leadService/upsertLead: Creating new lead ${finalUrl}`);
        
        // Validate field names before sending to Airtable (filters out fields that don't exist in client's base)
        const validatedFields = createValidatedObject(fields);
        const createdRecords = await airtableBase(CLIENT_TABLES.LEADS).create([{ fields: validatedFields }]);
        recordId = createdRecords[0].id; 
    }
    
    // Track metrics if tracking info is provided
    if (trackingInfo && finalScore !== null) {
        isScored = true;
        
        // Extract token usage if available (from the AI service)
        if (attribute_reasoning_obj && attribute_reasoning_obj._tokenUsage) {
            tokenUsage = attribute_reasoning_obj._tokenUsage.totalTokens || 0;
        }
        
        try {
            // Update run metrics with this lead's information
            if (trackingInfo.runId && trackingInfo.clientId) {
                const updates = {
                    [CLIENT_RUN_FIELDS.PROFILES_SCORED]: 1, // Increment by one for this lead
                    [CLIENT_RUN_FIELDS.PROFILE_SCORING_TOKENS]: tokenUsage
                };
                
                logger.info(`leadService/upsertLead: Updating run metrics for client ${trackingInfo.clientId} - Lead ${finalUrl} scored (tokens: ${tokenUsage})`);
                await airtableService.updateClientRun(trackingInfo.runId, trackingInfo.clientId, updates);
            }
        } catch (metricError) {
            logger.error(`leadService/upsertLead: Failed to update run metrics: ${metricError.message}`);
            // Continue execution even if metrics update fails
    logCriticalError(metricError, { operation: 'unknown' }).catch(() => {});
        }
    }
    
    return recordId;
}

/**
 * Track lead processing metrics for batch operations
 * @param {string} runId - The run ID
 * @param {string} clientId - The client ID
 * @param {Object} metrics - Metrics to track (profiles, tokens, etc.)
 */
async function trackLeadProcessingMetrics(runId, clientId, metrics) {
    if (!runId || !clientId) {
        logger.warn('leadService/trackLeadProcessingMetrics: Missing required tracking information');
        return { success: false, reason: 'missing_parameters' };
    }
    
    try {
        logger.info(`leadService/trackLeadProcessingMetrics: Updating metrics for client ${clientId} in run ${runId}`);
        
        // Use our new safeUpdateMetrics function for consistent handling
        const updateResult = await safeUpdateMetrics({
            runId,
            clientId,
            processType: 'lead_scoring',
            metrics,
            options: {
                isStandalone: false, // Lead scoring is never standalone
                logger: console,
                source: 'lead_processing_metrics'
            }
        });
        
        return updateResult;
    } catch (error) {
        logger.error(`leadService/trackLeadProcessingMetrics: Failed to update metrics: ${error.message}`);
    logCriticalError(error, { operation: 'unknown' }).catch(() => {});
        return { 
            success: false, 
            error: error.message,
            reason: 'update_error'
        };
    }
}

module.exports = {
    upsertLead,
    trackLeadProcessingMetrics
};