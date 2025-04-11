require("dotenv").config(); // For local dev

const express = require("express");
const bodyParser = require("body-parser");
const Airtable = require("airtable");

// 1. Configure Airtable
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
const TABLE_NAME = "Leads";

// 2. Create Express app
const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// 3. Simple GET route for verifying Airtable connectivity
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

// 4. Main POST route to upsert leads with 2-tiered lookup + job history + about + source logic
app.post("/pb-webhook/scrapeLeads", async (req, res) => {
  try {
    const leads = req.body;
    if (!Array.isArray(leads)) {
      return res.status(400).json({ error: "Expected an array of profiles" });
    }

    for (const lead of leads) {
      // Extract fields we plan to store
      const {
        firstName = "",
        lastName = "",
        linkedinHeadline = "",
        linkedinJobTitle = "",
        linkedinCompanyName = "",
        linkedinDescription = "", // we'll map this to "About"
        connectionDegree = "",
        // We'll do the "Pending" check if lead.linkedinConnectionStatus === "Pending"
        refreshedAt = "",
        linkedinProfileUrn = "",
        linkedinProfileUrl = "",
        profileUrl: fallbackProfileUrl = "",
        // Current job details
        linkedinJobDateRange = "",
        linkedinJobDescription = "",
        // Previous job details
        linkedinPreviousJobDateRange = "",
        linkedinPreviousJobDescription = "",
        // Everything else goes in rest
        ...rest
      } = lead;

      // Build "Job History" multiline
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

      // Normalise the URL (remove trailing slash)
      let finalUrl = linkedinProfileUrl || fallbackProfileUrl || "";
      finalUrl = finalUrl.replace(/\/$/, "");

      // If we have neither URN nor URL, skip
      if (!linkedinProfileUrn && !finalUrl) {
        console.log("Skipping lead. No URN or URL:", lead);
        continue;
      }

      // (1) Lookup by URN
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

      // (2) If not found, fallback to URL
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

      // Determine LinkedIn Connection Status
      let connectionStatus = "";
      // If '1st' => 'Connected'
      if (connectionDegree === "1st") {
        connectionStatus = "Connected";
      }
      // If the JSON has something like lead.linkedinConnectionStatus === "Pending"
      else if (lead.linkedinConnectionStatus === "Pending") {
        connectionStatus = "Pending";
      }
      // Otherwise => "To Be Sent"
      else {
        connectionStatus = "To Be Sent";
      }

      // Build fields to upsert
      const fieldsToUpsert = {
        "LinkedIn Profile URN": linkedinProfileUrn || null,
        "LinkedIn Profile URL": finalUrl || null,
        "First Name": firstName,
        "Last Name": lastName,
        "Headline": linkedinHeadline,
        "Job Title": linkedinJobTitle,
        "Company Name": linkedinCompanyName,
        "About": linkedinDescription,
        "Job History": combinedJobHistory,
        "LinkedIn Connection Status": connectionStatus,
        "Refreshed At": refreshedAt ? new Date(refreshedAt) : null,
        "Raw Profile Data": JSON.stringify(rest)
      };

      // If we found a record, we do not overwrite "Source"
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
        // Brand new record => set a "Source" based on connectionDegree
        let sourceValue = "";
        if (connectionDegree === "1st") {
          sourceValue = "Existing";
        } else {
          sourceValue = "2nd level leads from PB";
        }
        fieldsToUpsert["Source"] = sourceValue;

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

// 5. Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});