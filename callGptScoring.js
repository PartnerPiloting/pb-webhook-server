/* ===================================================================
   callGptScoring.js  –  shared reply-parser for BOTH scoring routes
   -------------------------------------------------------------------
   • Removes ```json fences or extra chatter
   • Accepts camelCase & snake_case keys
   • Normalises the structure so the rest of the app
     (computeFinalScore + buildAttributeBreakdown) works unchanged
=================================================================== */
function callGptScoring(rawText = "") {
    /* ---------------------------------------------------------------
       1. isolate the JSON blob
    ----------------------------------------------------------------- */
    const slice = rawText.substring(
      rawText.indexOf("{"),
      rawText.lastIndexOf("}") + 1
    );
  
    const data = JSON.parse(slice.trim());
  
    /* ---------------------------------------------------------------
       2. normalise top-level field names
    ----------------------------------------------------------------- */
    data.finalPct            = data.finalPct            ?? data.final_pct;
    data.aiProfileAssessment = data.aiProfileAssessment ?? data.ai_profile_assessment;
    data.attribute_breakdown = data.attribute_breakdown ?? data.aiAttributeBreakdown;
  
    // scores
    data.positive_scores     = data.positive_scores     ?? data.positives;
    data.negative_scores     = data.negative_scores     ?? data.negatives;
  
    /* ---------------------------------------------------------------
       3. if scores came back as objects { score, reason } convert
          to the structure buildAttributeBreakdown expects:
          {
            A: { score: 10, reason: "text" },
            …
          }
          – nothing to change if GPT already used that shape
    ----------------------------------------------------------------- */
    if (data.positive_scores && typeof Object.values(data.positive_scores)[0] === "number") {
      const fixed = {};
      for (const [k, v] of Object.entries(data.positive_scores))
        fixed[k] = { score: v, reason: "" };
      data.positive_scores = fixed;
    }
  
    if (data.negative_scores && typeof Object.values(data.negative_scores)[0] === "number") {
      const fixed = {};
      for (const [k, v] of Object.entries(data.negative_scores))
        fixed[k] = { score: v, reason: "" };
      data.negative_scores = fixed;
    }
  
    /* ---------------------------------------------------------------
       4. passthrough any optional fields so future logic sees them
    ----------------------------------------------------------------- */
    data.ai_excluded        = data.ai_excluded        ?? data.aiExcluded;
    data.exclude_details    = data.exclude_details    ?? data.excludeDetails;
    data.contact_readiness  = data.contact_readiness  ?? data.contactReadiness;
    data.unscored_attributes= data.unscored_attributes?? data.unscoredAttributes;
  
    return data;
  }
  
  module.exports = { callGptScoring };