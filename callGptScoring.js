/* ===================================================================
   callGptScoring.js – robust GPT-response parser  (with DBG-NEG dump)
   -------------------------------------------------------------------
   • Finds the first balanced {...} block even if GPT adds text after
   • If DEBUG_PARSE=true, prints the raw negatives map
=================================================================== */

/* ------------------------------------------------------------------
   stripToJson  –  extract the first balanced { … } block
------------------------------------------------------------------ */
function stripToJson(txt = "") {
    const start = txt.indexOf("{");
    if (start === -1) throw new Error("No '{' found in GPT response");
  
    let depth = 0;
    for (let i = start; i < txt.length; i++) {
      const ch = txt[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          // Found the matching closing brace for the first '{'
          const slice = txt.slice(start, i + 1);
          try {
            return JSON.parse(slice.trim());
          } catch (err) {
            // Fall through to throw at end
          }
          break;
        }
      }
    }
    throw new Error("Could not parse JSON block from GPT response");
  }
  
  /* ------------------------------------------------------------------
     splitScoreMap  –  separate numeric scores and reason strings
  ------------------------------------------------------------------ */
  function splitScoreMap(map = {}) {
    const nums = {}, why = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === "object" && v !== null) {
        // NUMBER: look for 'score' key first, else first numeric value
        nums[k] =
          typeof v.score === "number"
            ? v.score
            : Object.values(v).find((n) => typeof n === "number") ?? 0;
  
        // REASON: prefer 'reason' key, else first string value
        why[k] =
          typeof v.reason === "string"
            ? v.reason
            : Object.values(v).find((s) => typeof s === "string") || "";
      } else {
        nums[k] = v; // GPT already gave a plain number
      }
    }
    return { nums, why };
  }
  
  /* ------------------------------------------------------------------
     callGptScoring  –  main entry
  ------------------------------------------------------------------ */
  function callGptScoring(rawText = "") {
    let data;
    try {
      data = stripToJson(rawText);
    } catch (err) {
      console.error("❌ Failed to parse GPT response:\n", rawText);
      throw err;
    }
  
    /* ---------- TEMP DEBUG PRINT ----------------------------------- */
    if (process.env.DEBUG_PARSE === "true") {
      console.log(
        "DBG-NEG",
        JSON.stringify(data.negative_scores ?? data.negatives ?? {}, null, 2)
      );
    }
    /* --------------------------------------------------------------- */
  
    /* ---------- Normalise top-level keys --------------------------- */
    data.finalPct            = data.finalPct            ?? data.final_pct;
    data.aiProfileAssessment = data.aiProfileAssessment ?? data.ai_profile_assessment;
    data.attribute_breakdown = data.attribute_breakdown ?? data.aiAttributeBreakdown;
  
    /* ---------- Split positives & negatives ------------------------ */
    const { nums: posNums, why: posWhy } = splitScoreMap(
      data.positive_scores ?? data.positives ?? {}
    );
    const { nums: negNums, why: negWhy } = splitScoreMap(
      data.negative_scores ?? data.negatives ?? {}
    );
  
    data.positive_scores     = posNums;
    data.negative_scores     = negNums;
    data.attribute_reasoning = { ...posWhy, ...negWhy };
  
    /* ---------- Pass-through flags --------------------------------- */
    data.ai_excluded         = data.ai_excluded         ?? data.aiExcluded;
    data.exclude_details     = data.exclude_details     ?? data.excludeDetails;
    data.contact_readiness   = data.contact_readiness   ?? data.contactReadiness;
    data.unscored_attributes = data.unscored_attributes ?? data.unscoredAttributes;
  
    return data; // finalPct handled by caller
  }
  
  module.exports = { callGptScoring };