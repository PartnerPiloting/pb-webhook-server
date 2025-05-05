/* ===================================================================
   scoreApi.js – small helper API used by front-end tests
   -------------------------------------------------------------------
   • POST /api/test-score   (request body = raw lead JSON)
=================================================================== */
require("dotenv").config();
const express  = require("express");
const Airtable = require("airtable");
const {
  buildPrompt,
  slimLead
} = require("./promptBuilder");
const {
  loadAttributes
} = require("./attributeLoader");
const {
  computeFinalScore
} = require("./scoring");
const {
  buildAttributeBreakdown
} = require("./breakdown");
const {
  callGptScoring
} = require("./callGptScoring");
const {
  scoreLeadNow
} = require("./singleScorer");

const router = express.Router();

/* ---------- Airtable connection ---------------------------------- */
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ------------------------------------------------------------------
   POST /api/test-score
------------------------------------------------------------------*/
router.post("/api/test-score", async (req, res) => {
  try {
    const lead = req.body || {};

    /* --- build prompt & call GPT -------------------------------- */
    const sysPrompt                = await buildPrompt();
    const { positives, negatives } = await loadAttributes();

    // use the same deterministic path as /score-lead
    const raw    = await scoreLeadNow(lead);
    const parsed = callGptScoring(raw);

    /* --- always recompute percentage ---------------------------- */
    delete parsed.finalPct;

    const { percentage } = computeFinalScore(
      parsed.positive_scores,
      positives,
      parsed.negative_scores,
      negatives,
      parsed.contact_readiness,
      parsed.unscored_attributes || []
    );
    parsed.finalPct = Math.round(percentage * 100) / 100;

    /* --- build human-readable breakdown ------------------------- */
    const breakdown = buildAttributeBreakdown(
      parsed.positive_scores,
      positives,
      parsed.negative_scores,
      negatives,
      parsed.unscored_attributes || [],
      Object.values(parsed.positive_scores).reduce((s, v) => s + v, 0) +
        Object.values(parsed.negative_scores).reduce((s, v) => {
          const n = typeof v === "number" ? v : v?.score ?? 0;
          return s + n;
        }, 0),
      0,
      parsed.attribute_reasoning || {},
      parsed.disqualified,
      parsed.disqualifyReason
    );

    /* --- OPTIONAL: write to Airtable if recordId provided ------- */
    if (req.query.recordId) {
      await base("Leads").update(req.query.recordId, {
        // --------------- FIXED LINE ------------------------------
        "AI Score"              : parsed.finalPct,  // ← now correct %
        //----------------------------------------------------------
        "AI Profile Assessment" : parsed.aiProfileAssessment,
        "AI Attribute Breakdown": breakdown,
      });
    }

    /* --- respond ------------------------------------------------ */
    res.json({
      finalPct: parsed.finalPct,   // returns 60.2 %, not 100
      breakdown,
      assessment: parsed.aiProfileAssessment
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = (app) => app.use(router);