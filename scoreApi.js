/***************************************************************
  scoreApi.js  –  POST /calcScore → updates AI Score on a Lead
***************************************************************/
require("dotenv").config();
const express  = require("express");
const Airtable = require("airtable");
const { computeFinalScore } = require("./scoring");  // shared logic

module.exports = function (app) {
  app.post("/calcScore", async (req, res) => {
    try {
      /* --------------------------------------------------------
         1. Validate body
         ------------------------------------------------------*/
      const { id, attributeScores } = req.body || {};
      if (!id || !attributeScores) {
        return res.status(400).json({
          error: "Body must include { id, attributeScores }",
        });
      }

      /* --------------------------------------------------------
         2. Connect to Airtable
         ------------------------------------------------------*/
      const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
        .base(process.env.AIRTABLE_BASE_ID);
      const leads = base.getTable("Leads");

      /* --------------------------------------------------------
         3. Build dictionaries + compute total
         ------------------------------------------------------*/
      const { pos, neg, meta } = await getDictionaries(base);
      const total = computeFinalScore(attributeScores, { pos, neg, meta });

      /* --------------------------------------------------------
         4. Persist results on the lead
         ------------------------------------------------------*/
      await leads.update([
        {
          id,
          fields: {
            "AI Score":                 total,
            "AI Attribute Breakdown":   JSON.stringify(attributeScores),
            // keep existing columns unchanged
          },
        },
      ]);

      console.log("calcScore ✓", id, "→", total, "%");
      res.json({ id, total });
    } catch (err) {
      console.error("calcScore ❌", err);
      res.status(500).json({ error: err.message || "Server error" });
    }
  });
};

/* ------------------------------------------------------------------
   helper: getDictionaries – fetch JSON blobs from row 0
------------------------------------------------------------------*/
async function getDictionaries(base) {
  const tbl = base.getTable("Attributes");
  const recs = await tbl.selectRecordsAsync({ maxRecords: 1 });
  if (!recs || recs.records.length === 0) {
    throw new Error("Attributes table empty — cannot build dictionaries");
  }
  const row = recs.records[0];
  return {
    pos:  JSON.parse(row.getCellValueAsString("Positive Dict")      || "{}"),
    neg:  JSON.parse(row.getCellValueAsString("Negative Dict")      || "{}"),
    meta: JSON.parse(row.getCellValueAsString("Global Settings")    || "{}"),
  };
}