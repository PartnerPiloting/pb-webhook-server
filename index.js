require("dotenv").config(); // Loads environment variables from .env

const express = require("express");
const bodyParser = require("body-parser");
const Airtable = require("airtable");

// Airtable setup
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

const TABLE_NAME = "Leads"; // Make sure this matches your actual table name

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// ✅ Route to list all fields from the first record in the table
app.get("/list-fields", async (req, res) => {
  try {
    const records = await base(TABLE_NAME).select({ maxRecords: 1 }).firstPage();

    if (records.length === 0) {
      return res.status(404).json({ message: "No records found in table" });
    }

    const fieldNames = Object.keys(records[0].fields);
    console.log("Fields found in Airtable:", fieldNames);

    res.status(200).json({
      message: "Fields retrieved from Airtable",
      fields: fieldNames
    });
  } catch (error) {
    console.error("Error retrieving fields from Airtable:", error);
    res.status(500).json({ error: "Failed to retrieve fields" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});