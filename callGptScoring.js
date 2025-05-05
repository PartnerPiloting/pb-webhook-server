/* ===================================================================
   callGptScoring.js — parse GPT-4o scoring reply
   -------------------------------------------------------------------
   • Keeps “reason” text for every attribute
   • Filters negative_scores so only attributes whose score < 0
     appear (therefore only truly negative items penalise)
=================================================================== */
function safeJsonParse(str) {
    try { return JSON.parse(str); } catch (_) { return null; }
  }
  
  /* ---------- extract a JSON object from a chat response ------------ */
  function extractJson(raw) {
    // 1. If the whole thing is JSON, great.
    const direct = safeJsonParse(raw);
    if (direct && typeof direct === "object") return direct;
  
    // 2. Look for a fenced ```json … ``` block.
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
    if (fenceMatch) {
      const fenced = safeJsonParse(fenceMatch[1]);
      if (fenced && typeof fenced === "object") return fenced;
    }
  
    // 3. Last-ditch effort: take the first {...} that parses.
    const braceMatch = raw.match(/\{[\s\S]+/);
    if (braceMatch) {
      try {
        /* eslint-disable no-constant-condition */
        let depth = 0, end = -1;
        for (let i = 0; i < braceMatch[0].length; i++) {
          if (braceMatch[0][i] === "{") depth++;
          if (braceMatch[0][i] === "}") depth--;
          if (depth === 0) { end = i + 1; break; }
        }
        if (end !== -1) {
          const obj = safeJsonParse(braceMatch[0].slice(0, end));
          if (obj && typeof obj === "object") return obj;
        }
      } catch (_) { /* ignore */ }
    }
    throw new Error("Unable to parse GPT response as JSON");
  }
  
  /* ---------- main export ------------------------------------------ */
  function callGptScoring(raw) {
    const j = extractJson(raw);
  
    /* -------- ensure required properties exist --------------------- */
    const out = {
      positive_scores     : j.positive_scores      || {},
      negative_scores     : {},
      contact_readiness   : !!j.contact_readiness,
      unscored_attributes : Array.isArray(j.unscored_attributes) ? j.unscored_attributes : [],
      aiProfileAssessment : j.aiProfileAssessment  || "",
      finalPct            : typeof j.finalPct === "number" ? j.finalPct : undefined,
      ai_excluded         : j.ai_excluded          || "No",
      exclude_details     : j.exclude_details      || "",
      attribute_reasoning : {},
    };
  
    /* ---- copy over positives + reasoning -------------------------- */
    for (const [id, val] of Object.entries(out.positive_scores)) {
      if (val && typeof val === "object") {
        // { score, reason } form
        out.attribute_reasoning[id] = val.reason || "";
        out.positive_scores[id] = Number(val.score) || 0;
      } else {
        // simple number, no explicit reason
        out.positive_scores[id] = Number(val) || 0;
      }
    }
  
    /* ---- copy over negatives only when score < 0 ------------------ */
    const negativesIn = j.negative_scores || {};
    for (const [id, val] of Object.entries(negativesIn)) {
      let score, reason = "";
      if (val && typeof val === "object") {
        score  = Number(val.score)  || 0;
        reason = String(val.reason || "");
      } else {
        score = Number(val) || 0;
      }
      if (score < 0) {
        out.negative_scores[id]   = { score, reason };
        out.attribute_reasoning[id] = reason;           // keep reason text
      }
    }
  
    return out;
  }
  
  module.exports = { callGptScoring };