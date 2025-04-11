require("dotenv").config(); // For local dev

const express = require("express");
const bodyParser = require("body-parser");
const Airtable = require("airtable");

// Airtable setup
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
const TABLE_NAME = "Leads";

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// A quick GET route for verifying Airtable connectivity
app.get("/test-airtable", async (req, res) => {
  try {
    const records = await base(TABLE_NAME).select({ maxRecords: 1 }).firstPage();
    if (records.length === 0) {
      return res.status(404).json({ message: "No records found in Airtable" });
    }
    const fieldNames = Object.keys(records[0].fields);
    console.log("Fields found in Airtable:", fieldNames);
    res.status(200).json({
      message: "Fields retrieved successfully",
      fields: fieldNames
    });
  } catch (error) {
    console.error("Error reading from Airtable:", error);
    res.status(500).json({ error: "Failed to read from Airtable" });
  }
});

// Main POST route to upsert leads
app.post("/pb-webhook/scrapeLeads", async (req, res) => {
  try {
    const leads = req.body;
    if (!Array.isArray(leads)) {
      return res.status(400).json({ error: "Expected an array of profiles" });
    }

    for (const lead of leads) {
      // Extract known fields
      const {
        // Basic fields
        firstName = "",
        lastName = "",
        linkedinHeadline = "",
        linkedinJobTitle = "",
        linkedinCompanyName = "",
        linkedinDescription = "",
        connectionDegree = "",
        refreshedAt = "",
        // URN & URL
        linkedinProfileUrn = "",
        linkedinProfileUrl = "",
        profileUrl: fallbackProfileUrl = "",
        // Current job details
        linkedinJobDateRange = "",
        linkedinJobDescription = "",
        // Previous job details
        linkedinPreviousJobDateRange = "",
        linkedinPreviousJobDescription = "",
        // Everything else
        ...rest
      } = lead;

      // Build a 'Job History' multiline string
      const jobHistoryParts = [];
      if (linkedinJobDateRange || linkedinJobDescription) {
        jobHistoryParts.push(
          "Current:\n" + (linkedinJobDateRange || "") + " — " + (linkedinJobDescription || "")
        );
      }
      if (linkedinPreviousJobDateRange || linkedinPreviousJobDescription) {
        jobHistoryParts.push(
          "\nPrevious:\n" + (linkedinPreviousJobDateRange || "") + " — " + (linkedinPreviousJobDescription || "")
        );
      }
      const combinedJobHistory = jobHistoryParts.join("\n");

      // Normalize the profile URL (remove trailing slash if any)
      let finalUrl = linkedinProfileUrl || fallbackProfileUrl || "";
      finalUrl = finalUrl.replace(/\/$/, "");

      // If we have neither URN nor URL, skip
      if (!linkedinProfileUrn && !finalUrl) {
        console.log("Skipping lead. No URN or URL:", lead);
        continue;
      }

      // (1) Attempt lookup by URN
      let recordFound = null;
      if (linkedinProfileUrn) {
        const urnQuery = await base(TABLE_NAME)
          .select({
            filterByFormula: `{LinkedIn Profile URN} = "${linkedinProfileUrn}"`
          })
          .firstPage();

        if (urnQuery.length > 0) {
          recordFound = urnQuery[0];
          console.log(`Found record by URN: ${linkedinProfileUrn}`);
        }
      }

      // (2) If no record found, fallback to URL
      if (!recordFound && finalUrl) {
        const urlQuery = await base(TABLE_NAME)
          .select({
            filterByFormula: `{LinkedIn Profile URL} = "${finalUrl}"`
          })
          .firstPage();

        if (urlQuery.length > 0) {
          recordFound = urlQuery[0];
          console.log(`Found record by URL: ${finalUrl}`);
        }
      }

      // Determine "LinkedIn Connection Status" based on the logic you described
      let connectionStatus = "";
      // If '1st' => 'Connected'
      if (connectionDegree === "1st") {
        connectionStatus = "Connected";
      }
      // If we see some property indicating 'Pending'
      else if (lead.linkedinConnectionStatus === "Pending") {
        connectionStatus = "Pending";
      }
      // Otherwise => 'To Be Sent'
      else {
        connectionStatus = "To Be Sent";
      }

      // Build the fields to upsert
      const fieldsToUpsert = {
        "LinkedIn Profile URN": linkedinProfileUrn || null,
        "LinkedIn Profile URL": finalUrl || null,
        "First Name": firstName,
        "Last Name": lastName,
        "Job Title": linkedinJobTitle,
        "Company Name": linkedinCompanyName,
        "About": linkedinDescription, // "About" field in Airtable
        "Headline": linkedinHeadline,
        "Job History": combinedJobHistory,
        "LinkedIn Connection Status": connectionStatus,
        "Refreshed At": refreshedAt ? new Date(refreshedAt) : null,
        "Raw Profile Data": JSON.stringify(rest)
      };

      // Update if found, else create
      if (recordFound) {
        console.log(
          `Updating record (Airtable ID: ${recordFound.id}) for URN="${linkedinProfileUrn}" URL="${finalUrl}"`
        );
        await base(TABLE_NAME).update([
          {
            id: recordFound.id,
            fields: fieldsToUpsert
          }
        ]);
      } else {
        console.log(`Creating new record for URN="${linkedinProfileUrn}" URL="${finalUrl}"`);
        await base(TABLE_NAME).create([{ fields: fieldsToUpsert }]);
      }
    }

    res.status(200).json({ message: "Upsert complete" });
  } catch (error) {
    console.error("Error saving to Airtable:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});