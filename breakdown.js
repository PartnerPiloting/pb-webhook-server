/********************************************************************
  breakdown.js — hybrid Markdown builder
  -------------------------------------------------------------------
  • ALWAYS lists every positive (A-K, I) and every negative (L1, N1–N5)
  • Accepts numeric scores *or* objects { score, reason }
  • Inserts GPT’s 25-word reason when present (attribute_reasoning[id])
  • Total line uses the earned / denominator values we pass in
********************************************************************/

/* helper for consistent bullet formatting */
function fmt(id, label, scoreStr, reason) {
    return `- **${id} (${label})**: ${scoreStr}\n  ↳ ${reason}\n`;
  }
  
  /**
   * buildAttributeBreakdown
   * -----------------------
   * @param  {Object} posScores        – e.g. { A:15, B:{score:7,reason:"…"} }
   * @param  {Object} positivesDict    – Airtable dict (labels, maxPoints)
   * @param  {Object} negScores        – e.g. { N2:-5, N5:{score:-5,reason:"…"} }
   * @param  {Object} negativesDict    – Airtable dict (labels, penalty)
   * @param  {Array}  unscored         – attr IDs GPT couldn’t score
   * @param  {Number} earned           – rawScore from computeFinalScore
   * @param  {Number} max              – denominator from computeFinalScore
   * @param  {Object} reasoning        – GPT’s attribute_reasoning map
   * @param  {Boolean} showZeros       – list 0-scores? (default false)
   * @param  {String|null} header      – optional extra heading line
   * @returns {String}   Markdown block
   */
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
  
    /* ---------- positives ---------------------------------------- */
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
        reasoning[id]?.reason ||
        (typeof entry === "object" && entry?.reason) ||
        "(no reason)";
  
      lines.push(fmt(id, def.label, `${score} / ${def.maxPoints}`, reason));
    }
  
    /* ---------- negatives ---------------------------------------- */
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
        reasoning[id]?.reason ||
        (typeof entry === "object" && entry?.reason) ||
        "(no reason)";
  
      lines.push(fmt(id, def.label, `${score} / ${def.penalty}`, reason));
    }
  
    /* ---------- unscored list ------------------------------------ */
    if (unscored.length) {
      lines.push(
        `\n_Unscored attributes:_ ${unscored
          .map((id) => `**${id}**`)
          .join(", ")}`
      );
    }
  
    /* ---------- total line --------------------------------------- */
    const pct = max ? (earned / max) * 100 : 0;
    lines.push(
      `\n**Total:** ${earned} / ${max} ⇒ ${pct.toFixed(1)} % — Not Disqualified`
    );
  
    return lines.join("\n").trim();
  }
  
  module.exports = { buildAttributeBreakdown };