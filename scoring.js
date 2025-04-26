/***************************************************************
  scoring.js  –  shared helper used by scoreApi.js
***************************************************************/

/**
 * Compute the final score for a candidate.
 *
 * @param {Object} attributeScores  e.g. { A: 4, B: 7, C: 2 }
 * @param {Object} _dicts           (reserved for future weighting rules)
 * @returns {number}                summed total, max two decimals
 */
function computeFinalScore(attributeScores = {}, _dicts = {}) {
    // Very first version: just add every numeric value
    let total = 0;
    for (const key in attributeScores) {
      const val = Number(attributeScores[key]) || 0;
      total += val;
    }
  
    // Round neatly to 2 dp so Airtable looks tidy
    return Math.round(total * 100) / 100;
  }
  
  module.exports = { computeFinalScore };