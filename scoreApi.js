/***************************************************************
  scoreApi.js  –  POST /calcScore → updates AI Score on a Lead
  Works with the global Airtable.configure() already run in index.js
***************************************************************/
require("dotenv").config();
const express  = require("express");
const Airtable = require("airtable");           // inherits global config
const { computeFinalScore } = require("./scoring");

module.exports = function (app) {
  app.post("/calcScore", async (req, res) => {
    try {
      /* --------------------------------------------------------
         1. Validate body
      -------------------------------------------------------- */
      const { id, attributeScores } = req.body || {};
      if (!id || !attributeScores) {
        return res
          .status(400)
          .json({ error: "Body must include { id, attributeScores }" });
      }

      /* --------------------------------------------------------
         2. Table handles
      -------------------------------------------------------- */
      const base  = Airtable.base(process.env.AIRTABLE_BASE_ID); // uses global key
      const leads = base("Leads");

      /* --------------------------------------------------------
         3. Build dictionaries + compute total
      -------------------------------------------------------- */
      const { pos, neg, meta } = await getDictionaries(base);
      const total = computeFinalScore(attributeScores, { pos, neg, meta });

      /* --------------------------------------------------------
         4. Persist results on the lead
      -------------------------------------------------------- */
      await leads.update([
        {
          id,
          fields: {
            "AI Score":               total,
            "AI Attribute Breakdown": JSON.stringify(attributeScores),
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
  const records = await base("Attributes")
    .select({ maxRecords: 1 })
    .firstPage();

  if (!records.length) {
    throw new Error("Attributes table empty — cannot build dictionaries");
  }

  const row = records[0];
  return {
    pos:  JSON.parse(row.get("Positive Dict")   || "{}"),
    neg:  JSON.parse(row.get("Negative Dict")   || "{}"),
    meta: JSON.parse(row.get("Global Settings") || "{}"),
  };
}