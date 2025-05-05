/* ===================================================================
   callGptScoring.js – shared reply-parser for BOTH scoring routes
   -------------------------------------------------------------------
   • Removes ```json fences or extra chatter
   • Normalises key names (camelCase ⇆ snake_case)
   • Computes finalPct if GPT forgets it
   • Leaves positive/negative score objects in the
     { score, reason } shape expected by buildAttributeBreakdown()
=================================================================== */

const { computeFinalScore } = require("./scoring");

/* ------------------------------------------------------------------
   helper: coerce plain numbers → { score, reason } objects
------------------------------------------------------------------ */
function normaliseScoreMap(map = {}) {
  // if values are already objects, nothing to do
  if (typeof Object.values(map)[0] === "object") return map;

  const fixed = {};
  for (const [attr, val] of Object.entries(map)) {
    fixed[attr] = { score: val, reason: "" };
  }
  return fixed;
}

/* ------------------------------------------------------------------
   main parser
------------------------------------------------------------------ */
function callGptScoring(rawText = "") {
  /* 1️⃣  isolate JSON */
  const slice = rawText.substring(
    rawText.indexOf("{"),
    rawText.lastIndexOf("}") + 1
  );
  const data = JSON.parse(slice.trim());

  /* 2️⃣  normalise top-level fields */
  data.finalPct             = data.finalPct            ?? data.final_pct;
  data.aiProfileAssessment  = data.aiProfileAssessment ?? data.ai_profile_assessment;
  data.attribute_breakdown  = data.attribute_breakdown ?? data.aiAttributeBreakdown;

  // score maps
  data.positive_scores      = data.positive_scores     ?? data.positives;
  data.negative_scores      = data.negative_scores     ?? data.negatives;

  /* 3️⃣  coerce score maps to expected object shape */
  data.positive_scores = normaliseScoreMap(data.positive_scores || {});
  data.negative_scores = normaliseScoreMap(data.negative_scores || {});

  /* 4️⃣  compute finalPct if GPT omitted it */
  if (data.finalPct === undefined) {
    const { percentage } = computeFinalScore(
      data.positive_scores,
      {},                // attribute dictionary injected later; leave blank here
      data.negative_scores,
      {},
      data.contact_readiness,
      data.unscored_attributes || []
    );
    data.finalPct = Math.round(percentage * 100) / 100;
  }

  /* 5️⃣  pass through optional flags */
  data.ai_excluded       = data.ai_excluded       ?? data.aiExcluded;
  data.exclude_details   = data.exclude_details   ?? data.excludeDetails;
  data.contact_readiness = data.contact_readiness ?? data.contactReadiness;
  data.unscored_attributes = data.unscored_attributes ?? data.unscoredAttributes;

  return data;
}

module.exports = { callGptScoring };