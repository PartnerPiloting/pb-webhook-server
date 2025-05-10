// services/leadService.js

// Dependencies that upsertLead needs
const base = require('../config/airtableClient.js'); // Gets the initialized Airtable base
const { getLastTwoOrgs, canonicalUrl, safeDate } = require('../utils/appHelpers.js');
const { slimLead } = require('../promptBuilder.js'); // Assuming promptBuilder.js is in the project root

/**
 * Upserts a lead into Airtable, creating or updating as necessary.
 * Also handles mapping various lead data fields to Airtable fields.
 */
async function upsertLead(
    lead, // The lead data object, expected to contain a 'raw' property with the original webhook data
    finalScore = null,
    aiProfileAssessment = null,
    attribute_reasoning_obj = null, // Note: parameter name from recent index.js
    attributeBreakdown = null,
    auFlag = null,
    ai_excluded_val = null,       // Note: parameter name from recent index.js
    exclude_details_val = null    // Note: parameter name from recent index.js
) {
    // Critical check: Ensure the Airtable base is initialized and available
    if (!base) {
        console.error("CRITICAL ERROR in leadService/upsertLead: Airtable Base is not initialized. Cannot proceed.");
        // Depending on how you want to handle this, you could throw an error
        // to make the failure immediately obvious to the calling function.
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
        connectionSince, scoringStatus = undefined, // Default to undefined, set by caller or later logic if new
        raw, // Expect 'raw' to be passed in, containing the original LH/PB object or the full profile for scoring
        ...rest // any other fields from the webhook not explicitly mapped (used for Raw Profile Data)
    } = lead;

    let jobHistory = [
        linkedinJobDateRange ? `Current:\n${linkedinJobDateRange} — ${linkedinJobDescription}` : "",
        linkedinPreviousJobDateRange ? `Previous:\n${linkedinPreviousJobDateRange} — ${linkedinPreviousJobDescription}` : ""
    ].filter(Boolean).join("\n");

    // 'raw' should ideally be the original, most complete lead object received from the webhook or source
    const originalLeadData = raw || lead;

    if (!jobHistory && originalLeadData) {
        const hist = getLastTwoOrgs(originalLeadData); // Uses helper from appHelpers.js
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
        return; // Cannot proceed without a URL to use as a key
    }
    const profileKey = canonicalUrl(finalUrl); // Uses helper from appHelpers.js

    let currentConnectionStatus = "Candidate"; // Default
    if (connectionDegree === "1st") currentConnectionStatus = "Connected";
    else if (lead.linkedinConnectionStatus === "Pending") currentConnectionStatus = "Pending";
    else if (originalLeadData.connectionStatus) currentConnectionStatus = originalLeadData.connectionStatus;


    // Use slimLead from promptBuilder.js for the 'Profile Full JSON' field content
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
        "Status": "In Process", // Default status
        "Scoring Status": scoringStatus, // This should be passed in, e.g., "To Be Scored" for new leads
        "Location": locationName || originalLeadData.location || "",
        "Date Connected": safeDate(connectionSince) || safeDate(originalLeadData.connectedAt) || safeDate(originalLeadData.connectionDate) || null, // Uses helper
        "Email": emailAddress || originalLeadData.email || originalLeadData.workEmail || "",
        "Phone": phoneNumber || originalLeadData.phone || (originalLeadData.phoneNumbers || [])[0]?.value || "",
        "Refreshed At": refreshedAt ? new Date(refreshedAt) : (originalLeadData.lastRefreshed ? new Date(originalLeadData.lastRefreshed) : null),
        "Profile Full JSON": JSON.stringify(profileForJsonField),
        "Raw Profile Data": JSON.stringify(originalLeadData) // Store the original/raw lead data
    };

    // Add AI scoring fields only if they are provided (not null)
    if (finalScore !== null) fields["AI Score"] = Math.round(finalScore * 100) / 100;
    if (aiProfileAssessment !== null) fields["AI Profile Assessment"] = String(aiProfileAssessment || "");
    if (attributeBreakdown !== null) fields["AI Attribute Breakdown"] = attributeBreakdown;
    if (auFlag !== null) fields["AU"] = !!auFlag; // Convert to boolean
    if (ai_excluded_val !== null) fields["AI_Excluded"] = (ai_excluded_val === "Yes" || ai_excluded_val === true);
    if (exclude_details_val !== null) fields["Exclude Details"] = exclude_details_val;

    const existing = await base("Leads").select({ filterByFormula: `{Profile Key} = "${profileKey}"`, maxRecords: 1 }).firstPage();

    if (existing.length) {
        console.log(`leadService/upsertLead: Updating existing lead ${finalUrl} (ID: ${existing[0].id})`);
        await base("Leads").update(existing[0].id, fields);
        return existing[0].id; // Return ID of updated record
    } else {
        // Ensure new leads get a "To Be Scored" status if not otherwise specified
        if (fields["Scoring Status"] === undefined) fields["Scoring Status"] = "To Be Scored";
        // Default source if not provided by other logic
        if (!fields["Source"]) { // Check if Source is already set
            fields["Source"] = connectionDegree === "1st" ? "Existing Connection Added by PB" : "SalesNav + LH Scrape";
        }
        console.log(`leadService/upsertLead: Creating new lead ${finalUrl}`);
        const createdRecords = await base("Leads").create([{ fields }]);
        return createdRecords[0].id; // Return ID of new record
    }
}

module.exports = {
    upsertLead
};