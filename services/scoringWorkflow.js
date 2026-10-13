/**
 * The scoring workflow - the fixed, shared part of what the lead scorer is told first.
 *
 * WHY (13 Oct 2026): every client's PREAMBLE row used to hold two things in one block of text - a
 * purpose statement ("who we're looking for and why") and the scoring workflow (the disqualifier
 * check, the formula, the bands). Only the first is the client's own. Twenty bases still opened
 * with the starting template's "explore a side-venture with Partner Piloting" because nobody could
 * see or change the row from the portal, and a client who did rewrite it could just as easily
 * delete the workflow by accident.
 *
 * So the split: the PREAMBLE row's Instructions field now holds ONLY the client's purpose
 * statement (editable in the portal and through wingguy_scoring_propose), and the workflow lives
 * here, in code, where no client can reword it. buildScoringPreamble() puts them back together in
 * the order the scorer needs: purpose first, then workflow. An empty purpose is fine - the scorer
 * then runs on the workflow and the attributes alone.
 */

const SCORING_WORKFLOW = `Scoring workflow

1. Disqualifying check - immediate stop. If any negative attribute marked Disqualifying applies, the final score is 0% and the reason is recorded.
2. Minimum threshold - early stop. If a positive attribute has a Min to Qualify and the profile falls short of it, the final score is 0%.
3. Score each positive attribute from 0 up to its maximum points, using its score bands. Use the full range: most profiles will score low on at least one attribute, and that is expected. If an attribute genuinely cannot be judged from the profile, leave it unscored and list it in unscored_attributes rather than guessing.
4. Subtract the penalty for any negative attribute that applies but is not disqualifying.
5. Final % = points awarded / points possible x 100. Bonus attributes count at 25% weight in the points possible.
6. Judge only what the profile shows - headline, About section and job history. Evidence over buzzwords: what the person actually does, for whom, and how they describe it outweighs keywords in a headline.`;

/** What the scorer is told first: the client's purpose statement (if any), then the fixed workflow. */
function buildScoringPreamble(purpose) {
  const p = String(purpose || '').trim();
  return p ? `${p}\n\n${SCORING_WORKFLOW}` : SCORING_WORKFLOW;
}

// Phrases that only appear when someone has pasted scoring mechanics into the purpose.
const WORKFLOW_MARKERS = [
  /scoring workflow/i,
  /disqualifying check/i,
  /minimum threshold filter/i,
  /final\s*(%|score)\s*=/i,
  /points?\s+awarded\s*\/\s*(points\s+)?possible/i,
  /awarded points\s*\/\s*possible points/i,
  /AI Updating Instructions/i,
  /standard interpretation bands/i,
];

/** True when a purpose text contains the workflow (or the old template's editing notes). */
function looksLikeWorkflow(text) {
  const t = String(text || '');
  return WORKFLOW_MARKERS.some((re) => re.test(t));
}

/**
 * Pull the purpose statement out of a legacy PREAMBLE block (purpose + workflow in one field).
 * Used by scripts/migrate-scoring-purpose.js. Handles the shapes found in the live bases on
 * 13 Oct 2026:
 *   - the template: "**Purpose**\n\n<statement>\n\n---\n\n## Scoring workflow ..." -> the statement
 *   - Dean's: "**Purpose**", "**Method**" (dropped), "**Guiding principles**" (kept) sections
 *   - Matthew's: plain paragraphs, the last one a "Disqualifier: ..." note (dropped)
 * Anything that already reads as a plain statement comes back unchanged.
 */
function extractPurposeStatement(legacyText) {
  let text = String(legacyText || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  // Template shape: everything after the first horizontal rule is workflow.
  const rule = text.search(/\n---+\s*\n/);
  if (rule > -1) text = text.slice(0, rule).trim();

  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const kept = [];
  let dropSection = false;
  for (const block of blocks) {
    const header = block.match(/^\*\*([^*]+)\*\*\s*$/) || block.match(/^#{1,3}\s+(.+)$/);
    if (header) {
      const name = header[1].trim().toLowerCase();
      if (name === 'purpose') { dropSection = false; continue; } // implied now
      dropSection = /method|workflow|how to score|scoring/.test(name);
      if (!dropSection) kept.push(`**${header[1].trim()}**`);
      continue;
    }
    if (dropSection) continue;
    if (/^\*{0,2}disqualifier/i.test(block) || looksLikeWorkflow(block)) continue;
    kept.push(block);
  }
  // A trailing header with nothing under it is noise.
  while (kept.length && /^\*\*[^*]+\*\*$/.test(kept[kept.length - 1])) kept.pop();
  return kept.join('\n\n').trim();
}

module.exports = { SCORING_WORKFLOW, buildScoringPreamble, looksLikeWorkflow, extractPurposeStatement };
