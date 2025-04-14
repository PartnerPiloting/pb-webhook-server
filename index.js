require("dotenv").config();
const express = require("express");
const { Configuration, OpenAIApi } = require("openai");
const Airtable = require("airtable");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// === OpenAI setup ===
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// === Airtable setup ===
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
});

const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
const TABLE_NAME = "Leads";

// === POST /api/test-score ===
app.post("/api/test-score", async (req, res) => {
  try {
    const leadData = req.body;

    const prompt = `Please summarise this lead data:\n${JSON.stringify(leadData, null, 2)}`;

    const response = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "user", content: prompt }
      ]
    });

    const gptReply = response.data.choices[0].message.content;

    res.json({
      success: true,
      message: "GPT-4 replied successfully",
      gptReply
    });
  } catch (error) {
    console.error("Error in /api/test-score:", error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// === POST /pb-webhook/scrapeLeads ===
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
        linkedinJobTitle = "",
        linkedinCompanyName = "",
        linkedinDescription = "",
        linkedinProfileUrl = "",
        linkedinProfileUrn = "",
        connectionDegree = "",
        linkedinJobDateRange = "",
        linkedinJobDescription = "",
        linkedinPreviousJobDateRange = "",
        linkedinPreviousJobDescription = "",
        refreshedAt = "",
        profileUrl: fallbackProfileUrl = "",
        ...rest
      } = lead;

      const jobHistoryParts = [];
      if (linkedinJobDateRange || linkedinJobDescription) {
        jobHistoryParts.push(`Current:\n${linkedinJobDateRange || ""} — ${linkedinJobDescription || ""}`);
      }
      if (linkedinPreviousJobDateRange || linkedinPreviousJobDescription) {
        jobHistoryParts.push(`\nPrevious:\n${linkedinPreviousJobDateRange || ""} — ${linkedinPreviousJobDescription || ""}`);
      }
      const combinedJobHistory = jobHistoryParts.join("\n");

      const finalUrl = (linkedinProfileUrl || fallbackProfileUrl || "").replace(/\/$/, "");

      const connectionStatus =
        connectionDegree === "1st" ? "Connected" :
        lead.linkedinConnectionStatus === "Pending" ? "Pending" : "To Be Sent";

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

      const lookupBy = linkedinProfileUrn
        ? `{LinkedIn Profile URN} = "${linkedinProfileUrn}"`
        : finalUrl
        ? `{LinkedIn Profile URL} = "${finalUrl}"`
        : null;

      if (!lookupBy) continue;

      const existing = await base(TABLE_NAME).select({
        filterByFormula: lookupBy
      }).firstPage();

      if (existing.length > 0) {
        await base(TABLE_NAME).update([
          {
            id: existing[0].id,
            fields: fieldsToUpsert
          }
        ]);
      } else {
        fieldsToUpsert["Source"] = connectionDegree === "1st" ? "Existing" : "2nd level leads from PB";
        await base(TABLE_NAME).create([{ fields: fieldsToUpsert }]);
      }
    }

    res.json({ message: "Upsert complete" });
  } catch (error) {
    console.error("Error in /pb-webhook/scrapeLeads:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// === Start the server ===
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});