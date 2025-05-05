/* ===================================================================
   breakdown.js — human-readable markdown breakdown
   -------------------------------------------------------------------
   • Always lists EVERY attribute in alphabetical order
   • Shows 0 / max (positives) or 0 (negatives) when GPT gave no score
   • Includes GPT reason or fallback message
   • Appends Total line with rawScore / denominator ⇒ % and qual status
=================================================================== */
function fmtPos(id, label, score, max, reason) {
    const scoreStr = `${score} / ${max}`;
    return `- **${id} (${label})**: ${scoreStr}\n  ↳ ${reason}\n`;
  }
  function fmtNeg(id, label, score, reason) {
    return `- **${id} (${label})**: ${score}\n  ↳ ${reason}\n`;
  }
  
  function buildAttributeBreakdown(
    positive_scores,
    positivesDict,
    negative_scores,
    negativesDict,
    unscored = [],
    finalPct = 0,
    rawScore = 0,
    attribute_reasoning = {},
    disqualified = false,
    disqualifyReason = null
  ) {
    let out = "";
  
    /* ---------- positives ----------------------------------------- */
    out += "**Positive Attributes**:\n";
    for (const id of Object.keys(positivesDict).sort()) {
      const def    = positivesDict[id];
      const max    = def.maxPoints;
      const score  =
        typeof positive_scores[id] === "number" ? positive_scores[id] : 0;
      const reason =
        attribute_reasoning[id] ||
        (def.notes ? `_GPT could not score this attribute_` : "");
      out += fmtPos(id, def.label, score, max, reason);
    }
  
    /* ---------- negatives ----------------------------------------- */
    out += "\n**Negative Attributes**:\n";
    for (const id of Object.keys(negativesDict).sort()) {
      const def    = negativesDict[id];
      const entry  = negative_scores[id];
      const score  =
        typeof entry === "number"
          ? entry
          : typeof entry === "object" && entry !== null
          ? entry.score ?? 0
          : 0;
      const reason =
        (typeof entry === "object" ? entry.reason : null) ||
        attribute_reasoning[id] ||
        "_GPT could not score this attribute_";
      out += fmtNeg(id, def.label, score, reason);
    }
  
    /* ---------- total line ---------------------------------------- */
    const line =
      rawScore !== null && rawScore !== undefined
        ? `**Total:** ${rawScore} / ${positivesDict.__denominator} ⇒ ${finalPct.toFixed(
            1
          )} %`
        : `**Total:** ${finalPct.toFixed(1)} %`;
  
    if (disqualified && disqualifyReason) {
      out += `\n\n${line} — Disqualified: ${disqualifyReason}`;
    } else {
      out += `\n\n${line} — Qualified`;
    }
  
    return out.trim();
  }
  
  module.exports = { buildAttributeBreakdown };