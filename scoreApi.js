/********************************************************************
 * scoreApi.js  –  POST /calcScore
 * Body: {
 *   positive_scores: { A:4, B:7, … },
 *   negative_scores: { L1:-5, … },
 *   contact_readiness: 2,
 *   unscored_attributes: []
 * }
 * Returns: { percentage: 45, rawScore: 58, denominator: 128 }
 *******************************************************************/
const { computeFinalScore } = require("./index"); // already in index.js
const Airtable = require("airtable");             // to fetch dictionaries

module.exports = function mountScoreAPI(app) {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
                 .base(process.env.AIRTABLE_BASE_ID);
  const SCORING_TABLE = "tblzphTYVTTQC7zG5";

  async function getDictionaries() {
    const rec = await base(SCORING_TABLE).find("recdictionaryRow"); // or first()
    const md = rec.get("Dictionary Markdown") || "";
    const { positives, negatives } = require("./index")
                                       .parseMarkdownTables(md.replace(/```python[\s\S]*?```/g, ""));
    return { positives, negatives };
  }

  app.post("/calcScore", async (req, res) => {
    try {
      const {
        positive_scores = {},
        negative_scores = {},
        contact_readiness = false,
        unscored_attributes = []
      } = req.body || {};

      const { positives, negatives } = await getDictionaries();

      const { percentage, rawScore, denominator } =
        computeFinalScore(
          positive_scores,
          positives,
          negative_scores,
          negatives,
          contact_readiness,
          unscored_attributes
        );

      return res.json({ percentage, rawScore, denominator });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
};