/********************************************************************
  scoring.js  –  SINGLE SOURCE OF TRUTH for final-score maths
********************************************************************/

/**
 * computeFinalScore
 *
 * @return {Object} {
 *   percentage,   // 0-100, rounded to 0.01
 *   rawScore,     // earned points after penalties
 *   denominator   // Σ maxPoints of every positive attribute
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
  /* 1. Auto-award “I – Contact Readiness” when flagged */
  if (contactReady && positivesDict.I && !positiveScores.I) {
    positiveScores.I = positivesDict.I.maxPoints;
  }

  /* 2. rawScore = Σ positives + Σ negatives */
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

  /* 3. denominator = Σ maxPoints of ALL positives (robust to “15 pts”) */
  const denominator = Object.values(positivesDict).reduce(
    (sum, def) => sum + (parseInt(def.maxPoints, 10) || 0),
    0
  );

  /* 4. Percentage (guard against /0) */
  const percentage = denominator ? (rawScore / denominator) * 100 : 0;

  return {
    percentage: Math.round(percentage * 100) / 100,
    rawScore,
    denominator,
  };
}

module.exports = { computeFinalScore };