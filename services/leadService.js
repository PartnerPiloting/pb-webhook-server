// services/leadService.js
// UPDATED to better handle Scoring Status on updates and Date Connected
// MODIFIED: To include "View In Sales Navigator" field
// ENHANCED: To support run tracking metrics

const base = require('../config/airtableClient.js'); 
const { getLastTwoOrgs, canonicalUrl, safeDate } = require('../utils/appHelpers.js');
const { slimLead } = require('../promptBuilder.js');
const airtableService = require('./airtableService');
const runIdService = require('./runIdService');

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
        console.error("CRITICAL ERROR in leadService/upsertLead: Airtable Base is not initialized. Cannot proceed.");
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
        "View In Sales Navigator": viewInSalesNavigatorUrl, // ***** ADDED DESTRUCTURING for the new field *****
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
        console.warn("leadService/upsertLead: Skipping upsert. No finalUrl could be determined for lead:", firstName, lastName);
        return; 
    }
    const profileKey = canonicalUrl(finalUrl); 

    let currentConnectionStatus = "Candidate"; 
    if (connectionDegree === "1st") currentConnectionStatus = "Connected";
    else if (lead.linkedinConnectionStatus === "Pending") currentConnectionStatus = "Pending";
    else if (originalLeadData.connectionStatus) currentConnectionStatus = originalLeadData.connectionStatus;


    const profileForJsonField = slimLead(originalLeadData);

    const fields = {
        "LinkedIn Profile URL": finalUrl,
        "First Name": firstName,
        "Last Name": lastName,
        "Headline": linkedinHeadline || lhHeadline || originalLeadData.headline || "",
        "Job Title": linkedinJobTitle || originalLeadData.occupation || originalLeadData.position || "",
        "Company Name": linkedinCompanyName || (originalLeadData.company ? originalLeadData.company.name : "") || originalLeadData.organization_1 || "",
        "About": linkedinDescription || originalLeadData.summary || originalLeadData.bio || "",
        "Job History": jobHistory,
        "LinkedIn Connection Status": currentConnectionStatus,
        "Status": "In Process", 
        "Location": locationName || originalLeadData.location || "",
        "Date Connected": safeDate(connectionSince) || safeDate(originalLeadData.connectedAt) || safeDate(originalLeadData.connectionDate) || (currentConnectionStatus === "Connected" && !lead.id ? new Date().toISOString() : null), // Set Date Connected if newly Connected and no previous date
        "Email": emailAddress || originalLeadData.email || originalLeadData.workEmail || "",
        "Phone": phoneNumber || originalLeadData.phone || (originalLeadData.phoneNumbers || [])[0]?.value || "",
        "Refreshed At": refreshedAt ? new Date(refreshedAt) : (originalLeadData.lastRefreshed ? new Date(originalLeadData.lastRefreshed) : null),
        "Profile Full JSON": JSON.stringify(profileForJsonField),
        "Raw Profile Data": JSON.stringify(originalLeadData),

        // ***** ADDED THE NEW FIELD HERE TO BE SAVED TO AIRTABLE *****
        "View In Sales Navigator": viewInSalesNavigatorUrl || null 
        // Ensure "View In Sales Navigator" exactly matches your Airtable field name
    };

    // --- MODIFIED Scoring Status Handling ---
    if (scoringStatus !== undefined) { // Only include if explicitly passed (e.g., "To Be Scored" for new leads)
        fields["Scoring Status"] = scoringStatus;
    }
    // --- END MODIFIED Scoring Status Handling ---

    if (finalScore !== null) fields["AI Score"] = Math.round(finalScore * 100) / 100;
    if (aiProfileAssessment !== null) fields["AI Profile Assessment"] = String(aiProfileAssessment || "");
    if (attributeBreakdown !== null) fields["AI Attribute Breakdown"] = attributeBreakdown;
    if (auFlag !== null) fields["AU"] = !!auFlag; 
    if (ai_excluded_val !== null) fields["AI_Excluded"] = (ai_excluded_val === "Yes" || ai_excluded_val === true);
    if (exclude_details_val !== null) fields["Exclude Details"] = exclude_details_val;

    const existing = await airtableBase("Leads").select({ filterByFormula: `{Profile Key} = "${profileKey}"`, maxRecords: 1 }).firstPage();

    let recordId;
    
    if (existing.length) {
        isNewLead = false;
        console.log(`leadService/upsertLead: Updating existing lead ${finalUrl} (ID: ${existing[0].id})`);
        // For "Date Connected", if it's now "Connected" and didn't have a date before, or if a new date is provided
        if (currentConnectionStatus === "Connected" && !existing[0].fields["Date Connected"] && !fields["Date Connected"]) {
            fields["Date Connected"] = new Date().toISOString();
        }
        await airtableBase("Leads").update(existing[0].id, fields);
        recordId = existing[0].id; 
    } else {
        isNewLead = true;
        // If it's a new record, and scoringStatus wasn't explicitly set to "To Be Scored" (e.g. it was undefined)
        // default it to "To Be Scored".
        if (fields["Scoring Status"] === undefined) {
            fields["Scoring Status"] = "To Be Scored";
        }
        if (currentConnectionStatus === "Connected" && !fields["Date Connected"]) {
            fields["Date Connected"] = new Date().toISOString();
        }
        if (!fields["Source"]) { 
            fields["Source"] = connectionDegree === "1st" ? "Existing Connection Added by PB" : "SalesNav + LH Scrape";
        }
        console.log(`leadService/upsertLead: Creating new lead ${finalUrl}`);
        const createdRecords = await airtableBase("Leads").create([{ fields }]);
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
                    'Profiles Successfully Scored': 1, // Increment by one for this lead
                    'Profile Scoring Tokens': tokenUsage
                };
                
                console.log(`leadService/upsertLead: Updating run metrics for client ${trackingInfo.clientId} - Lead ${finalUrl} scored (tokens: ${tokenUsage})`);
                await airtableService.updateClientRun(trackingInfo.runId, trackingInfo.clientId, updates);
            }
        } catch (metricError) {
            console.error(`leadService/upsertLead: Failed to update run metrics: ${metricError.message}`);
            // Continue execution even if metrics update fails
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
        console.warn('leadService/trackLeadProcessingMetrics: Missing required tracking information');
        return;
    }
    
    try {
        // Normalize the run ID to ensure consistent format - explicitly prevent new timestamp generation
        const normalizedRunId = runIdService.normalizeRunId(runId, clientId, false);
        console.log(`leadService/trackLeadProcessingMetrics: Updating metrics for client ${clientId} in run ${normalizedRunId}`);
        await airtableService.updateClientRun(normalizedRunId, clientId, metrics);
    } catch (error) {
        console.error(`leadService/trackLeadProcessingMetrics: Failed to update metrics: ${error.message}`);
    }
}

module.exports = {
    upsertLead,
    trackLeadProcessingMetrics
};