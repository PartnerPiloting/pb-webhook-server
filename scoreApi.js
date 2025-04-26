/***************************************************************
  scoreApi.js  –  POST /calcScore → updates AI Score on a Lead
  Expects body: { id, positive_scores, negative_scores,
                  contact_readiness?, unscored_attributes? }
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
      const {
        id,
        positive_scores = {},
        negative_scores = {},
        contact_readiness = false,
        unscored_attributes = [],
      } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "Body must include { id }" });
      }

      /* --------------------------------------------------------
         2. Table handles
      -------------------------------------------------------- */
      const base  = Airtable.base(process.env.AIRTABLE_BASE_ID);
      const leads = base("Leads");

      /* --------------------------------------------------------
         3. Build dictionaries + compute total
      -------------------------------------------------------- */
      const { pos, neg, meta } = await getDictionaries(base);
      const total = computeFinalScore(
        positive_scores,
        pos,
        negative_scores,
        neg,
        contact_readiness,
        unscored_attributes
      );

      /* --------------------------------------------------------
         4. Persist results (single-record update)
      -------------------------------------------------------- */
      await leads.update(id, {
        "AI Score":               total,
        "AI Attribute Breakdown": JSON.stringify({
          positive_scores,
          negative_scores,
          contact_readiness,
          unscored_attributes,
        }),
      });

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
  const records = await base("Scoring Attributes")   // table name exact
    .select({ maxRecords: 1 })
    .firstPage();

  if (!records.length) {
    throw new Error("Scoring Attributes table empty — cannot build dictionaries");
  }

  const row = records[0];
  return {
    pos:  JSON.parse(row.get("Positive Dict")   || "{}"),
    neg:  JSON.parse(row.get("Negative Dict")   || "{}"),
    meta: JSON.parse(row.get("Global Settings") || "{}"),
  };
}