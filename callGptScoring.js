/* ===================================================================
   callGptScoring.js – shared GPT-response parser  (with DBG-NEG dump)
   -------------------------------------------------------------------
   • Parses the raw text returned by GPT-4o into a clean JS object
   • If DEBUG_PARSE=true, logs the entire negatives block once so we
     can see how GPT flags “not triggered” and where the reason lives.
   • NOTE: The “not-triggered” logic is still a TODO until we inspect
     that dump. For now it treats the first numeric value it finds as
     the score and the first string as the reason.
=================================================================== */

/* ------------------------------------------------------------------
   stripToJson  –  finds the first {...} block in the text and parses
------------------------------------------------------------------ */
function stripToJson(txt = "") {
    const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
    if (s === -1 || e === -1) throw new Error("No JSON block found");
    return JSON.parse(txt.slice(s, e + 1).trim());
  }
  
  /* ------------------------------------------------------------------
     splitScoreMap  –  separates numeric scores and reason strings
     (Will refine once we know the exact “not-triggered” pattern)
  ------------------------------------------------------------------ */
  function splitScoreMap(map = {}) {
    const nums = {}, why = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === "object" && v !== null) {
        /* ---------- NUMBER (placeholder until we refine) ------------- */
        nums[k] = Object.values(v).find(n => typeof n === "number") ?? 0;
  
        /* ---------- REASON: first string we find -------------------- */
        const firstStr = Object.values(v).find(x => typeof x === "string");
        why[k] = firstStr ?? "";
      } else {
        nums[k] = v;                 // GPT already gave a plain number
      }
    }
    return { nums, why };
  }
  
  /* ------------------------------------------------------------------
     callGptScoring  –  main entry
  ------------------------------------------------------------------ */
  function callGptScoring(rawText = "") {
    const data = stripToJson(rawText);
  
    /* ---------- TEMP DEBUG PRINT ----------------------------------- */
    if (process.env.DEBUG_PARSE === "true") {
      console.log(
        "DBG-NEG",
        JSON.stringify(data.negatives ?? data.negative_scores ?? {}, null, 2)
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
  
    return data;                       // finalPct handled by caller
  }
  
  module.exports = { callGptScoring };