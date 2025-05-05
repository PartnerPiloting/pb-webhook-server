/* ===================================================================
   breakdown.js — human-readable markdown
   -------------------------------------------------------------------
   • Works whether negative_scores are numbers  *or*  { score, reason } objects
=================================================================== */
function fmtOne(id, label, score, max, reason) {
    const str = max ? `${score} / ${max}` : `${score}`;
    return `- **${id} (${label})**: ${str}\n  ↳ ${reason || "_No reason provided_"}\n`;
  }
  
  function buildAttributeBreakdown(
    positive_scores,
    positivesDict,
    negative_scores,
    negativesDict,
    unscored = [],
    _pct = 0,
    _dummy = 0,
    attribute_reasoning = {},
    _includeReadiness = false,
    _readiness = null
  ) {
    let out = "";
  
    /* ---------- positives ----------------------------------------- */
    out += "**Positive Attributes**:\n";
    for (const id of Object.keys(positive_scores).sort()) {
      const def    = positivesDict[id] || {};
      const max    = def.maxPoints     || null;
      const label  = def.label         || id;
      const score  = positive_scores[id];
      const reason = attribute_reasoning[id] || "";
      out += fmtOne(id, label, score, max, reason);
    }
  
    /* ---------- negatives ----------------------------------------- */
    const negIds = Object.keys(negative_scores)
      .filter((id) => {
        const entry = negative_scores[id];
        return typeof entry === "number"
          ? entry < 0
          : (entry?.score ?? 0) < 0;
      })
      .sort();
  
    if (negIds.length) {
      out += "\n**Negative Attributes**:\n";
      for (const id of negIds) {
        const def    = negativesDict[id] || {};
        const max    = def.maxPoints     || null;
        const label  = def.label         || id;
        const entry  = negative_scores[id];
        const score  =
          typeof entry === "number" ? entry : entry.score ?? 0;
        const reason =
          (typeof entry === "object" ? entry.reason : null) ||
          attribute_reasoning[id] ||
          "";
        out += fmtOne(id, label, score, max, reason);
      }
    }
  
    /* ---------- un-scored ----------------------------------------- */
    if (unscored.length) {
      out += "\n**Unscored / Missing Attributes**:\n";
      out += unscored.sort().map((id) => `- ${id}`).join("\n") + "\n";
    }
  
    return out.trim();
  }
  
  module.exports = { buildAttributeBreakdown };