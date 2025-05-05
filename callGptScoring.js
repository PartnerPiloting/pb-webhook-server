/* ===================================================================
   callGptScoring.js  –  shared reply-parser for BOTH scoring routes
   -------------------------------------------------------------------
   • Strips ```json fences or leading commentary
   • Accepts camelCase & snake_case keys
   • Returns a normalised object ready for Airtable
=================================================================== */
function callGptScoring(rawText = "") {
    // --- keep only the first {...} JSON block -----------------------
    const slice = rawText.substring(
      rawText.indexOf("{"),
      rawText.lastIndexOf("}") + 1
    );
    const data = JSON.parse(slice.trim());
  
    // --- normalise key names ---------------------------------------
    data.finalPct            = data.finalPct            ?? data.final_pct;
    data.aiProfileAssessment = data.aiProfileAssessment ?? data.ai_profile_assessment;
    data.attribute_breakdown = data.attribute_breakdown ?? data.aiAttributeBreakdown;
  
    // attribute-score objects
    data.positive_scores     = data.positive_scores     ?? data.positives;
    data.negative_scores     = data.negative_scores     ?? data.negatives;
  
    return data;
  }
  
  module.exports = { callGptScoring };