/********************************************************************
  scoring.js  –  SINGLE SOURCE OF TRUTH for final-score math
  -------------------------------------------------------------------
  • Shared by every scoring route (manual, batch, Linked-Helper, etc.)
  • Accepts:
        positiveScores   – raw points GPT awarded for A…K, I (object)
        positivesDict    – full positives dictionary from Airtable
        negativeScores   – raw penalties GPT awarded for L1 / N1…N5
        negativesDict    – full negatives dictionary from Airtable
        contactReady     – Boolean flag: if GPT says lead is “ready
                           to be contacted”, we auto-award I points
        unscored         – array (currently unused, kept for future)
  • Returns ONE object with three keys:
        {
          percentage,    // 0-100, rounded to 0.01
          rawScore,      // earned points after penalties
          denominator    // always sum of ALL positive maxPoints
        }
  -------------------------------------------------------------------
  Why we do the math here (and NOT trust GPT’s own “finalPct”):
  1. We guarantee the Total line in the Markdown list ALWAYS matches
     the AI Score field in Airtable (single source of truth).
  2. We add / remove attributes later without editing prompts — the
     maths updates automatically because it reads Airtable.
  3. We protect against model quirks (e.g. GPT mis-adds or forgets
     an attribute) by recomputing everything server-side.
********************************************************************/

/**
 * computeFinalScore
 * -----------------
 * @param  {Object} positiveScores – e.g. { A:15, B:7, … }
 * @param  {Object} positivesDict  – Airtable dict with maxPoints
 * @param  {Object} negativeScores – e.g. { N2:-5, N5:{score:-5} }
 * @param  {Object} negativesDict  – Airtable dict with penalty
 * @param  {Boolean} contactReady  – flag from GPT
 * @param  {Array} unscored        – not used yet
 * @return {Object} { percentage, rawScore, denominator }
 */
function computeFinalScore(
  positiveScores = {},
  positivesDict  = {},
  negativeScores = {},
  negativesDict  = {},
  contactReady   = false,
  _unscored      = []
) {
  /* ------------------------------------------------------------- *
   * 1. Auto-award “I – Contact Readiness” when GPT flags it
   * ------------------------------------------------------------- */
  if (contactReady && positivesDict.I && !positiveScores.I) {
    positiveScores.I = positivesDict.I.maxPoints; // full 3 points
  }

  /* ------------------------------------------------------------- *
   * 2. rawScore = Σ positives  +  Σ negatives
   *    (negatives are negative numbers, so we just add them)
   * ------------------------------------------------------------- */
  let rawScore = 0;

  // Positives
  for (const id in positiveScores) {
    rawScore += Number(positiveScores[id]) || 0;
  }

  // Negatives
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

  /* ------------------------------------------------------------- *
   * 3. Denominator = Σ maxPoints of every positive attribute
   *    (A…K, I); this never changes based on GPT output.
   * ------------------------------------------------------------- */
  const denominator = Object.values(positivesDict).reduce(
    (sum, def) => sum + (def.maxPoints || 0),
    0
  );

  /* ------------------------------------------------------------- *
   * 4. Percentage (0-100). Guard against divide-by-zero (unlikely).
   * ------------------------------------------------------------- */
  const percentage = denominator ? (rawScore / denominator) * 100 : 0;

  /* ------------------------------------------------------------- *
   * 5. Return nicely rounded results
   * ------------------------------------------------------------- */
  return {
    percentage: Math.round(percentage * 100) / 100, // 2-dp tidy
    rawScore,
    denominator,
  };
}

module.exports = { computeFinalScore };