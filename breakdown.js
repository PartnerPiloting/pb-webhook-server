/***********************************************************************
  breakdown.js — builds the Markdown block shown in “AI Attribute Breakdown”
  ----------------------------------------------------------------------
  • Works for both manual and batch routes.
  • Always lists every attribute in alphabetical order.
  • Drops GPT’s own formatting and instead inserts GPT’s 25-word reasons
    (attribute_reasoning) into a deterministic template.
  • The “Total” line is driven by *our* maths (earned / max ⇒ pct),
    so it can never drift from the value stored in the “AI Score” field.
***********************************************************************/

function pct(earned, max) {
    if (!max) return 0;
    return (earned / max) * 100;
  }
  
  /**
   * Build the full Markdown breakdown.
   *
   * @param {object} posScores      – { A: { score, reason }, … }
   * @param {object} positives      – full positives dictionary (labels, maxPoints)
   * @param {object} negScores      – { N1: { score, reason }, … }
   * @param {object} negatives      – full negatives dictionary (labels, penalty)
   * @param {array}  unscored       – attribute IDs GPT said it couldn’t score
   * @param {number} earned         – total points after penalties (our maths)
   * @param {number} max            – denominator (sum of all maxPoints)
   * @param {object} reasoning      – GPT’s attribute_reasoning map
   * @param {boolean} showZeros     – if false, hide positives/negatives with 0
   * @param {string|null} header    – optional extra heading line
   */
  function buildAttributeBreakdown(
    posScores,
    positives,
    negScores,
    negatives,
    unscored,
    earned,
    max,
    reasoning = {},
    showZeros = false,
    header = null
  ) {
    const lines = [];
  
    if (header) lines.push(header);
  
    /* ---------- Positives (A … K) ----------------------------------- */
    lines.push("**Positive Attributes**:");
    for (const id of Object.keys(positives).sort()) {
      const scoreObj = posScores[id] || { score: 0 };
      if (!showZeros && scoreObj.score === 0) continue;
  
      const info   = positives[id];
      const score  = scoreObj.score || 0;
      const reason = reasoning[id]?.reason || scoreObj.reason || "(no reason)";
  
      lines.push(`- **${id} (${info.label})**: ${score} / ${info.maxPoints}`);
      lines.push(`  ↳ ${reason}`);
    }
  
    /* ---------- Negatives (L / N…) ---------------------------------- */
    lines.push("\n**Negative Attributes**:");
    for (const id of Object.keys(negatives).sort()) {
      const scoreObj = negScores[id] || { score: 0 };
      if (!showZeros && scoreObj.score === 0) continue;
  
      const info   = negatives[id];
      const score  = scoreObj.score || 0;
      const reason = reasoning[id]?.reason || scoreObj.reason || "(no reason)";
  
      lines.push(`- **${id} (${info.label})**: ${score} / ${info.penalty}`);
      lines.push(`  ↳ ${reason}`);
    }
  
    /* ---------- Unscored -------------------------------------------- */
    if (unscored.length) {
      lines.push(
        `\n_Unscored attributes:_ ${unscored.map((id) => `**${id}**`).join(", ")}`
      );
    }
  
    /* ---------- Total Line ------------------------------------------ */
    const percentage = pct(earned, max).toFixed(1);
    lines.push(
      `\n**Total:** ${earned} / ${max} ⇒ ${percentage} % — Not Disqualified`
    );
  
    return lines.join("\n");
  }
  
  module.exports = { buildAttributeBreakdown };