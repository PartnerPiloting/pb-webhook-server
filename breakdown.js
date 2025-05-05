/* breakdown.js – single source of buildAttributeBreakdown */
function buildAttributeBreakdown(
    positiveScores,
    dictionaryPositives,
    negativeScores,
    dictionaryNegatives,
    unscoredAttrs,
    rawScore,
    denominator,
    attributeReasoning = {},
    disqualified = false,
    disqualifyReason = null
  ) {
    const lines = [];
  
    lines.push("**Positive Attributes**:");
    for (const id of Object.keys(dictionaryPositives).sort()) {
      const info = dictionaryPositives[id];
      if (unscoredAttrs.includes(id)) {
        lines.push(`- ${id} (${info.label}): UNRECOGNISED (max ${info.maxPoints})`);
        continue;
      }
      const pts = positiveScores[id] || 0;
      lines.push(`- ${id} (${info.label}): ${pts} / ${info.maxPoints}`);
      if (attributeReasoning[id]) lines.push(`  ↳ ${attributeReasoning[id]}`);
    }
  
    lines.push("\n**Negative Attributes**:");
    for (const [id, info] of Object.entries(dictionaryNegatives)) {
      const pen = negativeScores[id] || 0;
      const status = pen !== 0 ? "Triggered" : "Not triggered";
      const display = `${pen} / ${info.penalty} max`;
      lines.push(
        `- ${id} (${info.label}): ${display} — ${status}\n  ↳ ${
          attributeReasoning[id] || "No signals detected."
        }`
      );
    }
  
    if (denominator > 0) {
      const pct = (rawScore / denominator) * 100;
      lines.push(`\nTotal: ${rawScore} / ${denominator} ⇒ ${pct.toFixed(2)} %`);
    }
  
    if (rawScore === 0) {
      lines.push(
        "\nTotal score is **0** → profile did not meet any positive criteria."
      );
      if (disqualified) lines.push("*(also disqualified – see above)*");
    }
  
    if (disqualified && disqualifyReason)
      lines.push(`\n**Disqualified ➜** ${disqualifyReason}`);
  
    return lines.join("\n");
  }
  
  module.exports = { buildAttributeBreakdown };