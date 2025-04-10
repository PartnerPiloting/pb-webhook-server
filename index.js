require("dotenv").config(); // For local development

const express = require("express");
const bodyParser = require("body-parser");
const Airtable = require("airtable");

// 1. Configure Airtable using environment variables
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

const TABLE_NAME = "Leads"; // Change if your Airtable table has a different name

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

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
        profileUrl = "", // This maps to "LinkedIn Profile URL"
        refreshedAt = "",
        ...rest
      } = lead;

      // Set your default field values
      const linkedInConnectionStatus = "To Be Sent";
      const status = "In Process";
      const dateConnectionRequestSent = "";
      const aiProfileAssessment = "";

      // 2. Search for existing record with matching LinkedIn Profile URL
      const existingRecords = await base(TABLE_NAME)
        .select({
          filterByFormula: `{LinkedIn Profile URL} = "${profileUrl}"`
        })
        .firstPage();

      if (existingRecords.length > 0) {
        // 3. Update existing record
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
        // 4. Create new record
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});