/* ===================================================================
   callGptScoring.js – shared parser  (TEMP debug prints)
   -------------------------------------------------------------------
   • Works exactly like your current parser
   • PLUS: if DEBUG_PARSE=true it logs the raw negatives JSON once,
     so we can see how GPT marks “not triggered” and where it puts
     the reason text
=================================================================== */

function stripToJson(txt = "") {
    const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
    if (s === -1 || e === -1) throw new Error("No JSON block found");
    return JSON.parse(txt.slice(s, e + 1).trim());
  }
  
  /* helper: split map → numeric scores + reasons */
  function splitScoreMap(map = {}) {
    const nums = {}, why = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === "object" && v !== null) {
        /* --- NUMBER (we’ll refine “triggered” logic after we see JSON) --- */
        nums[k] = Object.values(v).find(n => typeof n === "number") ?? 0;
  
        /* --- REASON: first string we find ------------------------------ */
        const firstStr = Object.values(v).find(x => typeof x === "string");
        why[k] = firstStr ?? "";
      } else {
        nums[k] = v;                         // GPT already gave a plain number
      }
    }
    return { nums, why };
  }
  
  function callGptScoring(rawText = "") {
    const data = stripToJson(rawText);
  
    /* ---------- TEMP DEBUG ---------- */
    if (process.env.DEBUG_PARSE === "true") {
      console.log(
        "DBG-NEG",
        JSON.stringify(data.negatives ?? data.negative_scores ?? {}, null, 2)
      );
    }
    /* -------------------------------- */
  
    /* normalise top-level keys */
    data.finalPct            = data.finalPct            ?? data.final_pct;
    data.aiProfileAssessment = data.aiProfileAssessment ?? data.ai_profile_assessment;
    data.attribute_breakdown = data.attribute_breakdown ?? data.aiAttributeBreakdown;
  
    /* split positives & negatives */
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
    data.ai_excluded         = data.ai_excluded         ?? data.aiExcluded;
    data.exclude_details     = data.exclude_details     ?? data.excludeDetails;
    data.contact_readiness   = data.contact_readiness   ?? data.contactReadiness;
    data.unscored_attributes = data.unscored_attributes ?? data.unscoredAttributes;
  
    return data;             // finalPct handled later by each route
  }
  
  module.exports = { callGptScoring };