/* ===================================================================
   callGptScoring.js – single shared parser for BOTH routes
   -------------------------------------------------------------------
   • Strips ```json fences / extra lines
   • Normalises key names (camelCase ⇄ snake_case)
   • Leaves each attribute as a PLAIN number
     ─ that’s what buildAttributeBreakdown expects
=================================================================== */
function stripToJson(text = "") {
    const start = text.indexOf("{");
    const end   = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON block found");
    return JSON.parse(text.slice(start, end + 1).trim());
  }
  
  function toNumericScores(map = {}) {
    const fixed = {};
    for (const [k, v] of Object.entries(map)) {
      // if GPT already sent a number keep it; if it sent { score, … } pick score
      fixed[k] = typeof v === "object" && v !== null ? v.score ?? 0 : v;
    }
    return fixed;
  }
  
  function callGptScoring(rawText = "") {
    const data = stripToJson(rawText);
  
    /* 🔑  normalise top-level field names */
    data.finalPct             = data.finalPct            ?? data.final_pct;
    data.aiProfileAssessment  = data.aiProfileAssessment ?? data.ai_profile_assessment;
    data.attribute_breakdown  = data.attribute_breakdown ?? data.aiAttributeBreakdown;
  
    /* 🞄  positive / negative score maps → plain numbers */
    data.positive_scores = toNumericScores(
      data.positive_scores ?? data.positives ?? {}
    );
    data.negative_scores = toNumericScores(
      data.negative_scores ?? data.negatives ?? {}
    );
  
    /* passthrough extras */
    data.ai_excluded        = data.ai_excluded        ?? data.aiExcluded;
    data.exclude_details    = data.exclude_details    ?? data.excludeDetails;
    data.contact_readiness  = data.contact_readiness  ?? data.contactReadiness;
    data.unscored_attributes= data.unscored_attributes?? data.unscoredAttributes;
  
    /* leave finalPct as-is (routes will compute if undefined) */
    return data;
  }
  
  module.exports = { callGptScoring };