/* ===================================================================
   callGptScoring.js – single shared parser for BOTH routes
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
        /* -------- NUMBER (score / penalty) ----------------- */
        if ("triggered" in v && !v.triggered) {
          nums[k] = 0;                         // not triggered ➜ no penalty
        } else {
          nums[k] = Object.values(v).find(n => typeof n === "number") ?? 0;
        }
        /* -------- REASON (first string found) -------------- */
        const firstStr = Object.values(v).find(x => typeof x === "string");
        why[k] = firstStr ?? "";
      } else {
        nums[k] = v;            // GPT already gave a plain number
      }
    }
    return { nums, why };
  }
  
  function callGptScoring(rawText = "") {
    const data = stripToJson(rawText);
  
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
  
    return data;          // finalPct left as-is; routes recompute if needed
  }
  
  module.exports = { callGptScoring };