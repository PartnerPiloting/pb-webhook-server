/* ===================================================================
   breakdown.js — human-readable markdown breakdown
   -------------------------------------------------------------------
   • ALWAYS lists every positive (A-K, I, etc.) and every negative (N1-N… + L1)
   • Shows "score / max"   for positives
     and  "score / penalty" for negatives
   • If GPT gave no score ⇒ score = 0   and reason = "_GPT could not score…_"
   • Computes denominator internally and prints Total line
=================================================================== */
function totalPositivePoints(dict) {
    return Object.values(dict).reduce((s, d) => s + (d.maxPoints || 0), 0);
  }
  function fmt(id, label, scoreStr, reason) {
    return `- **${id} (${label})**: ${scoreStr}\n  ↳ ${reason}\n`;
  }
  
  function buildAttributeBreakdown(
    posScores,            // e.g. { A: 15, … }
    positivesDict,        // Airtable dictionary for positives
    negScores,            // e.g. { N2: { score:-5,reason:"…" }, N5:0, … }
    negativesDict,        // Airtable dictionary for negatives
    _unused = [],         // kept for API compatibility
    rawScore = 0,         // you now pass a real value
    _dummy = 0,           // deprecated
    attribute_reasoning = {},
    disqualified = false,
    disqualifyReason = null
  ) {
    let out = "";
  
    /* --------- Positive Attributes ------------------------------- */
    out += "**Positive Attributes**:\n";
    for (const id of Object.keys(positivesDict).sort()) {
      const def    = positivesDict[id];
      const max    = def.maxPoints;
      const score  =
        typeof posScores[id] === "number" ? posScores[id] : 0;
      const reason =
        attribute_reasoning[id] || "_GPT could not score this attribute_";
      out += fmt(id, def.label, `${score} / ${max}`, reason);
    }
  
    /* --------- Negative Attributes ------------------------------- */
    out += "\n**Negative Attributes**:\n";
    for (const id of Object.keys(negativesDict).sort()) {
      const def    = negativesDict[id];
      const entry  = negScores[id];
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
      out += fmt(id, def.label, `${score} / ${def.penalty}`, reason);
    }
  
    /* --------- Total line ---------------------------------------- */
    const denom = totalPositivePoints(positivesDict);
    const pct   = denom ? (rawScore / denom) * 100 : 0;
    const line  = `**Total:** ${rawScore} / ${denom} ⇒ ${pct.toFixed(1)} %`;
  
    out += disqualified && disqualifyReason
      ? `\n\n${line} — Disqualified: ${disqualifyReason}`
      : `\n\n${line} — Qualified`;
  
    return out.trim();
  }
  
  module.exports = { buildAttributeBreakdown };