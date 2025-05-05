/* ===================================================================
   breakdown.js — turn raw scores into a human-readable markdown
   -------------------------------------------------------------------
   • Alphabetical ordering of attributes (A…Z)
   • Shows reason text for every attribute (positive & negative)
=================================================================== */
function fmtOne(id, label, score, max, reason) {
    const scoreStr = max ? `${score} / ${max}` : `${score}`;
    return `- **${id} (${label})**: ${scoreStr}\n  ↳ ${reason || "_No reason provided_"}\n`;
  }
  
  function buildAttributeBreakdown(
    positive_scores,
    positivesDict,
    negative_scores,
    negativesDict,
    unscored = [],
    _pct = 0,           // deprecated – retained for signature compatibility
    _dummy = 0,         // "
    attribute_reasoning = {},
    _includeReadiness = false,
    _readiness = null
  ) {
    let txt = "";
  
    /* -------- positives ------------------------------------------- */
    txt += "**Positive Attributes**:\n";
    for (const id of Object.keys(positive_scores).sort()) {
      const def   = positivesDict[id] || {};
      const max   = def.maxPoints     || null;
      const label = def.label         || id;
      const score = positive_scores[id];
      const reason = attribute_reasoning[id] || "";
      txt += fmtOne(id, label, score, max, reason);
    }
  
    /* -------- negatives ------------------------------------------- */
    const negIds = Object.keys(negative_scores)
      .filter(id => negative_scores[id]?.score < 0)
      .sort();
  
    if (negIds.length) {
      txt += "\n**Negative Attributes**:\n";
      for (const id of negIds) {
        const def    = negativesDict[id] || {};
        const max    = def.maxPoints     || null;
        const label  = def.label         || id;
        const entry  = negative_scores[id];
        const score  = entry.score;
        const reason = entry.reason || attribute_reasoning[id] || "";
        txt += fmtOne(id, label, score, max, reason);
      }
    }
  
    /* -------- unscored -------------------------------------------- */
    if (unscored.length) {
      txt += "\n**Unscored / Missing Attributes**:\n";
      txt += unscored.sort().map(id => `- ${id}`).join("\n") + "\n";
    }
  
    return txt.trim();
  }
  
  module.exports = { buildAttributeBreakdown };