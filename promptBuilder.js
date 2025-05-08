/* ===================================================================
   promptBuilder.js — builds the full system-prompt for GPT-4o
   -------------------------------------------------------------------
   • PREAMBLE narrative comes first (from the “Meta / PREAMBLE” row)
   • Follows with minified JSON of { positives, negatives }
   • Appends strict response-schema / partial-credit guidance
   • Sends the first 5 experience entries (or a fallback array built
     from organization_* keys if the array is missing)
=================================================================== */
const { loadAttributes } = require("./attributeLoader");

/* ------------------------------------------------------------------
   buildPrompt  –  returns the system prompt string for GPT-4o
------------------------------------------------------------------ */
async function buildPrompt() {
  const { preamble, positives, negatives } = await loadAttributes();

  /* ---------- use minified JSON for token efficiency ------------- */
  const dictJson = JSON.stringify({ positives, negatives }); // no pretty indent

  const schema = `
Return **only** a valid JSON object exactly like this:
{ "positive_scores": { "A": { "score": 15, "reason": "..." }, ... },
  "negative_scores": { "N1": { "score": -5, "reason": "..." }, ... },
  "unscored_attributes": [ "C", "D" ] }

Rules:
• Award partial credit when evidence is partial
  (e.g. 5 / 10 / 15 or 2 / 5 / 8 / 10 for a 10-point max).
• Prefer scoring every attribute; use "unscored_attributes" only when
  no clue exists.
• A negative is **not triggered** if you return "score": 0.
• Every scored attribute needs both "score" **and** a 25–40-word "reason".
• Do **NOT** wrap the JSON in \`\`\` fences or add extra commentary.
`;

  /* ---------- final assembled prompt ----------------------------- */
  const prompt = `${preamble.trim()}\n\n${dictJson}\n\n${schema.trim()}`;

  /* ---------- optional debug output ------------------------------ */
  if (process.env.DEBUG_PROMPT === "true") {
    const tok = Math.ceil(prompt.length / 4); // ≈ token estimate
    console.log("\n───────── Assembled GPT System Prompt ─────────\n");
    console.log(prompt);
    console.log(`\nApprox. tokens in system prompt: ${tok}\n`);
    console.log("───────────────────────────────────────────────\n");
  }

  return prompt;
}

/* ---------- helper: extractExperience ----------------------------
   • Use profile.experience if present.
   • Otherwise build up to 3 entries from organization_* keys.
------------------------------------------------------------------ */
function extractExperience(profile = {}) {
  if (Array.isArray(profile.experience) && profile.experience.length) {
    return profile.experience.slice(0, 5);       // keep first 5 roles
  }
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const company = profile[`organization_${i}`];
    const title   = profile[`organization_title_${i}`];
    if (!company && !title) break;
    out.push({ company, title });
    if (out.length === 3) break;                 // max 3 fallback roles
  }
  return out;
}

/* ------------------------------------------------------------------
   slimLead  –  drop unused fields to keep the prompt tiny
------------------------------------------------------------------ */
function slimLead(full = {}) {
  return {
    firstName   : full.firstName    || "",
    lastName    : full.lastName     || "",
    headline    : full.headline     || "",
    summary     : (full.summary || full.about || full.linkedinDescription || "").trim(),
    locationName: full.locationName || "",
    experience  : extractExperience(full)
  };
}

module.exports = { buildPrompt, slimLead };