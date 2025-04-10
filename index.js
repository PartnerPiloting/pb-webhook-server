require("dotenv").config(); // Load .env variables (for local development)

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

// ✅ TEST ROUTE — Confirms Airtable is reachable and lists fields
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

// ✅ MAIN ROUTE — Webhook that creates or updates records in Airtable
app.post("/pb-webhook/scrapeLeads", async (req, res) => {
  try {
    const leads = req.body;

    if (!Array.isArray(leads)) {
      return res.status(400).json({ error: "Expected an array of profiles" });
    }

    for (const lead of leads) {
      const {
        firstName = "",
        lastName = "",
        linkedinHeadline = "",
        location = "",
        profileUrl = "",
        refreshedAt = "",
        ...rest
      } = lead;

      const linkedInConnectionStatus = "To Be Sent";
      const status = "In Process";
      const dateConnectionRequestSent = null; // ✅ Use null instead of an empty string
      const aiProfileAssessment = "";

      // Airtable upsert: find record by LinkedIn Profile URL
      const existingRecords = await base(TABLE_NAME)
        .select({
          filterByFormula: `{LinkedIn Profile URL} = "${profileUrl}"`
        })
        .firstPage();

      const fields = {
        "LinkedIn Profile URL": profileUrl,
        "First Name": firstName,
        "Last Name": lastName,
        "Headline": linkedinHeadline,
        "Location": location,
        "LinkedIn Connection Status": linkedInConnectionStatus,
        "Status": status,
        "Date Connection Request Sent": dateConnectionRequestSent || null,
        "Refreshed At": refreshedAt ? new Date(refreshedAt) : null,
        "AI Profile Assessment": aiProfileAssessment,
        "Raw Profile Data": JSON.stringify(rest)
      };

      if (existingRecords.length > 0) {
        const recordId = existingRecords[0].id;
        console.log(`Updating record for: ${profileUrl}`);

        await base(TABLE_NAME).update([{ id: recordId, fields }]);
      } else {
        console.log(`Creating new record for: ${profileUrl}`);
        await base(TABLE_NAME).create([{ fields }]);
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