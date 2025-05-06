/********************************************************************
  scoring.js  –  SINGLE SOURCE OF TRUTH for final-score maths
  -------------------------------------------------------------------
  Why this exists
  ---------------    
  • Every scoring route (manual, batch, Linked-Helper, Phantombuster,
    /api/test-score) calls ONE function so the % can never drift.
  • We recalculate the percentage ourselves instead of trusting
    GPT’s “finalPct”, protecting against rounding or logic slips.
  • Contact-readiness (“I”) and negative penalties are handled here,
    so no route has to remember special cases.
********************************************************************/

/**
 * computeFinalScore
 * -----------------
 * @param {Object} positiveScores  { A: 15, B: 7, … } or numbers
 * @param {Object} positivesDict   full positives dictionary (Airtable)
 * @param {Object} negativeScores  { N2: -5, N5:{score:-5} } etc.
 * @param {Object} negativesDict   full negatives dictionary (Airtable)
 * @param {Boolean} contactReady   if GPT flagged “contact_readiness”
 * @param {Array}   unscored       array (kept for future use)
 *
 * @return {Object} {
 *           percentage,      // 0-100, rounded to 0.01
 *           rawScore,        // earned points after penalties
 *           denominator      // Σ maxPoints of every positive attr
 *         }
 */
function computeFinalScore(
  positiveScores = {},
  positivesDict  = {},
  negativeScores = {},
  negativesDict  = {},
  contactReady   = false,
  _unscored      = []
) {
  /* ---------- 1. Auto-award “I – Contact Readiness” ------------- */
  if (contactReady && positivesDict.I && !positiveScores.I) {
    positiveScores.I = positivesDict.I.maxPoints;   // full 3 points
  }

  /* ---------- 2. rawScore = Σ positives + Σ negatives ----------- */
  let rawScore = 0;

  // 2a. positives
  for (const id in positiveScores) {
    rawScore += Number(positiveScores[id]) || 0;
  }

  // 2b. negatives (each value may be number OR { score, reason })
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

  /* ---------- 3. denominator = Σ maxPoints of ALL positives ----- */
  const denominator = Object.values(positivesDict).reduce(
    (sum, def) => sum + Number(def.maxPoints || 0),
    0
  );

  /* ---------- 4. Percentage (guard against /0) ------------------ */
  const percentage = denominator ? (rawScore / denominator) * 100 : 0;

  /* ---------- 5. Return tidy object ----------------------------- */
  return {
    percentage: Math.round(percentage * 100) / 100,  // tidy 2-dp
    rawScore,                                        // “earned”
    denominator,                                     // “max”
  };
}

module.exports = { computeFinalScore };