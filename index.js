require("dotenv").config(); // Load local .env variables

const express = require("express");
const bodyParser = require("body-parser");
const Airtable = require("airtable");

// Airtable setup using environment variables
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

const TABLE_NAME = "Leads";

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// ✅ TEST ROUTE: Simple read from Airtable
app.get("/test-airtable", async (req, res) => {
  try {
    const records = await base(TABLE_NAME).select({ maxRecords: 3 }).firstPage();

    records.forEach(record => {
      console.log("Found record:", record.fields["LinkedIn Profile URL"]);
    });

    res.status(200).json({ message: "Airtable read test passed", records: records.length });
  } catch (error) {
    console.error("Error reading from Airtable:", error);
    res.status(500).json({ error: "Failed to read from Airtable" });
  }
});

// ✅ MAIN ROUTE: Upsert from PhantomBuster (or Postman)
app.post("/pb-webhook/scrapeLeads", async (req, res) => {
  try {
    const leads = req.body;

    if (!Array.isArray(leads)) {
      return res.status(400).json({ error: "Expected an array of profile objects." });
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
      const dateConnectionRequestSent = "";
      const aiProfileAssessment = "";

      // Upsert logic: check for existing record by LinkedIn Profile URL
      const existingRecords = await base(TABLE_NAME)
        .select({
          filterByFormula: `{LinkedIn Profile URL} = "${profileUrl}"`
        })
        .firstPage();

      if (existingRecords.length > 0) {
        const recordId = existingRecords[0].id;
        console.log(`Updating record for: ${profileUrl}`);

        await base(TABLE_NAME).update([
          {
            id: recordId,
            fields: {
              "LinkedIn Profile URL": profileUrl,
              "First Name": firstName,
              "Last Name": lastName,
              "Headline": linkedinHeadline,
              "Location": location,
              "LinkedIn Connection Status": linkedInConnectionStatus,
              "Status": status,
              "Date Connection Request Sent": dateConnectionRequestSent,
              "Refreshed At": refreshedAt ? new Date(refreshedAt) : null,
              "AI Profile Assessment": aiProfileAssessment,
              "Raw Profile Data": JSON.stringify(rest)
            }
          }
        ]);
      } else {
        console.log(`Creating new record for: ${profileUrl}`);

        await base(TABLE_NAME).create([
          {
            fields: {
              "LinkedIn Profile URL": profileUrl,
              "First Name": firstName,
              "Last Name": lastName,
              "Headline": linkedinHeadline,
              "Location": location,
              "LinkedIn Connection Status": linkedInConnectionStatus,
              "Status": status,
              "Date Connection Request Sent": dateConnectionRequestSent,
              "Refreshed At": refreshedAt ? new Date(refreshedAt) : null,
              "AI Profile Assessment": aiProfileAssessment,
              "Raw Profile Data": JSON.stringify(rest)
            }
          }
        ]);
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