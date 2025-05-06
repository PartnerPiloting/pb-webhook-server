/********************************************************************
  scoring.js  –  SINGLE SOURCE OF TRUTH for final-score maths
********************************************************************/

/**
 * computeFinalScore
 *
 * @param {Object} positiveScores   e.g. { A: 15, B: 7 }
 * @param {Object} positivesDict    Airtable positives dictionary
 * @param {Object} negativeScores   e.g. { N2: -5 } or { N2:{score:-5} }
 * @param {Object} negativesDict    Airtable negatives dictionary
 * @param {boolean} contactReady    GPT flag for I – Contact Readiness
 * @param {Array}   unscored        Attribute IDs GPT couldn’t score
 *
 * @return {Object} {
 *   percentage,   // 0-100 (2-dp)
 *   rawScore,     // earned points
 *   denominator   // Σ maxPoints
 * }
 */
function computeFinalScore(
  positiveScores = {},
  positivesDict  = {},
  negativeScores = {},
  negativesDict  = {},
  contactReady   = false,
  _unscored      = []
) {
  /* ---------- Auto-award “I” if GPT set contactReady ------------ */
  if (contactReady && positivesDict.I && !positiveScores.I) {
    positiveScores.I = positivesDict.I.maxPoints;
  }

  /* ---------- rawScore = Σ positives + Σ negatives ------------- */
  let rawScore = 0;

  for (const id in positiveScores) {
    rawScore += Number(positiveScores[id]) || 0;
  }

  for (const id in negativeScores) {
    const entry = negativeScores[id];
    const val =
      typeof entry === "number"
        ? entry
        : typeof entry === "object" && entry !== null
        ? Number(entry.score) || 0
        : 0;
    rawScore += val;
  }

  /* ---------- Denominator (robust to “15 pts”, field name drift) - */
  const denominator = Object.values(positivesDict).reduce((sum, def) => {
    const raw =
      def.maxPoints ??   // preferred field
      def.max_points ??  // alt snake_case
      def.max ??         // legacy field
      0;
    return sum + (parseInt(String(raw), 10) || 0);
  }, 0);

  /* ---------- Percentage (guard ÷0) ----------------------------- */
  const percentage = denominator ? (rawScore / denominator) * 100 : 0;

  return {
    percentage: Math.round(percentage * 100) / 100,
    rawScore,
    denominator,
  };
}

module.exports = { computeFinalScore };