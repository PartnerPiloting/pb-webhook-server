/********************************************************************
  breakdown.js — hybrid Markdown builder
  -------------------------------------------------------------------
  • Always lists every positive (A–K, I) and every negative (L1, N1–N5)
  • Accepts scores as plain numbers *or* objects { score, reason }
  • Inserts GPT’s narrative bullets when available
  • Total line is driven by our own maths (earned / denominator)
********************************************************************/

function fmt(id, label, scoreStr, reason) {
    return `- **${id} (${label})**: ${scoreStr}\n  ↳ ${reason}\n`;
  }
  
  function buildAttributeBreakdown(
    posScores,
    positivesDict,
    negScores,
    negativesDict,
    unscored,
    earned,
    max,
    reasoning = {},
    showZeros = false,
    header = null
  ) {
    const lines = [];
    if (header) lines.push(header);
  
    /* ---------- Positive Attributes ------------------------------ */
    lines.push("**Positive Attributes**:");
    for (const id of Object.keys(positivesDict).sort()) {
      const def   = positivesDict[id];
      const entry = posScores[id];
      const score =
        typeof entry === "number"
          ? entry
          : typeof entry === "object" && entry !== null
          ? entry.score ?? 0
          : 0;
  
      if (!showZeros && score === 0) continue;
  
      const reason =
        typeof reasoning[id] === "string"
          ? reasoning[id]
          : reasoning[id]?.reason ||
            (typeof entry === "object" && entry?.reason) ||
            "(no reason)";
  
      lines.push(fmt(id, def.label, `${score} / ${def.maxPoints}`, reason));
    }
  
    /* ---------- Negative Attributes ------------------------------ */
    lines.push("\n**Negative Attributes**:");
    for (const id of Object.keys(negativesDict).sort()) {
      const def   = negativesDict[id];
      const entry = negScores[id];
      const score =
        typeof entry === "number"
          ? entry
          : typeof entry === "object" && entry !== null
          ? entry.score ?? 0
          : 0;
  
      if (!showZeros && score === 0) continue;
  
      const reason =
        typeof reasoning[id] === "string"
          ? reasoning[id]
          : reasoning[id]?.reason ||
            (typeof entry === "object" && entry?.reason) ||
            "(no reason)";
  
      lines.push(fmt(id, def.label, `${score} / ${def.penalty}`, reason));
    }
  
    /* ---------- Unscored list ------------------------------------ */
    if (unscored.length) {
      lines.push(
        `\n_Unscored attributes:_ ${unscored
          .map((id) => `**${id}**`)
          .join(", ")}`
      );
    }
  
    /* ---------- Total line --------------------------------------- */
    const pct = max ? (earned / max) * 100 : 0;
    lines.push(
      `\n**Total:** ${earned} / ${max} ⇒ ${pct.toFixed(1)} % — Not Disqualified`
    );
  
    return lines.join("\n").trim();
  }
  
  module.exports = { buildAttributeBreakdown };