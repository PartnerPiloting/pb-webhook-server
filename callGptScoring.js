/* ===================================================================
   callGptScoring.js – shared parser  (with TEMP debug print)
=================================================================== */

function stripToJson(text = "") {
    const start = text.indexOf("{");
    const end   = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON block found");
    return JSON.parse(text.slice(start, end + 1).trim());
  }
  
  /* split attribute map → numeric scores + reasons */
  function splitScoreMap(map = {}) {
    const nums = {}, why = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === "object" && v !== null) {
        nums[k] = Object.values(v).find(n => typeof n === "number") ?? 0;
        why[k]  = v.reason ?? v.explanation ?? "";
      } else {
        nums[k] = v;
      }
    }
    return { nums, why };
  }
  
  function callGptScoring(rawText = "") {
    const data = stripToJson(rawText);
  
    /* ---------- TEMP DEBUG ---------------------------------------- */
    if (process.env.DEBUG_PARSE === "true") {
      const rawPos = data.positive_scores ?? data.positives ?? {};
      console.log("DBG-RAW-POS", JSON.stringify(rawPos, null, 2));
    }
    /* -------------------------------------------------------------- */
  
    /* normalise top-level keys */
    data.finalPct            = data.finalPct            ?? data.final_pct;
    data.aiProfileAssessment = data.aiProfileAssessment ?? data.ai_profile_assessment;
    data.attribute_breakdown = data.attribute_breakdown ?? data.aiAttributeBreakdown;
  
    /* numbers + reasons */
    const { nums: posNums, why: posWhy } = splitScoreMap(
      data.positive_scores ?? data.positives ?? {}
    );
    const { nums: negNums, why: negWhy } = splitScoreMap(
      data.negative_scores ?? data.negatives ?? {}
    );
  
    data.positive_scores     = posNums;
    data.negative_scores     = negNums;
    data.attribute_reasoning = { ...posWhy, ...negWhy };
  
    /* pass-through flags */
    data.ai_excluded        = data.ai_excluded        ?? data.aiExcluded;
    data.exclude_details    = data.exclude_details    ?? data.excludeDetails;
    data.contact_readiness  = data.contact_readiness  ?? data.contactReadiness;
    data.unscored_attributes= data.unscored_attributes?? data.unscoredAttributes;
  
    return data;
  }
  
  module.exports = { callGptScoring };