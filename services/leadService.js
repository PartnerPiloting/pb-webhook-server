// services/leadService.js
// UPDATED to better handle Scoring Status on updates and Date Connected
// MODIFIED: To include "View In Sales Navigator" field

const base = require('../config/airtableClient.js'); 
const { getLastTwoOrgs, canonicalUrl, safeDate } = require('../utils/appHelpers.js');
const { slimLead } = require('../promptBuilder.js'); 

async function upsertLead(
    lead, 
    finalScore = null,
    aiProfileAssessment = null,
    attribute_reasoning_obj = null, 
    attributeBreakdown = null,
    auFlag = null,
    ai_excluded_val = null,         
    exclude_details_val = null,
    clientAirtableBase = null  // NEW: Optional client-specific Airtable base
) {
    // Use client-specific base if provided, otherwise use global base
    const airtableBase = clientAirtableBase || base;
    
    if (!airtableBase) {
        console.error("CRITICAL ERROR in leadService/upsertLead: Airtable Base is not initialized. Cannot proceed.");
        throw new Error("Airtable base is not available in leadService. Check config/airtableClient.js logs.");
    }

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

    if (existing.length) {
        console.log(`leadService/upsertLead: Updating existing lead ${finalUrl} (ID: ${existing[0].id})`);
        // For "Date Connected", if it's now "Connected" and didn't have a date before, or if a new date is provided
        if (currentConnectionStatus === "Connected" && !existing[0].fields["Date Connected"] && !fields["Date Connected"]) {
            fields["Date Connected"] = new Date().toISOString();
        }
        await airtableBase("Leads").update(existing[0].id, fields);
        return existing[0].id; 
    } else {
        // If it's a new record, and scoringStatus wasn't explicitly set to "To Be Scored" (e.g. it was undefined)
        // default it to "To Be Scored".
        if (fields["Scoring Status"] === undefined) {
            fields["Scoring Status"] = "To Be Scored";
        }
        if (currentConnectionStatus === "Connected" && !fields["Date Connected"]) {
            fields["Date Connected"] = new Date().toISOString();
        }
        if (!fields["System Notes"]) { 
            fields["System Notes"] = connectionDegree === "1st" ? "Existing Connection Added by PB" : "SalesNav + LH Scrape";
        }
        console.log(`leadService/upsertLead: Creating new lead ${finalUrl}`);
        const createdRecords = await airtableBase("Leads").create([{ fields }]);
        return createdRecords[0].id; 
    }
}

module.exports = {
    upsertLead
};