/* ===================================================================
   promptBuilder.js — builds the compact JSON scoring prompt
   -------------------------------------------------------------------
   • Embeds the full attribute dictionaries (now with Instructions /
     Examples / Signals already cleaned by attributeLoader.js)
   • Adds strict response schema + partial-credit guidance
   • Sends the first 5 experience entries (was 2)
=================================================================== */
const { loadAttributes } = require("./attributeLoader");

/* ------------------------------------------------------------------
   buildPrompt  –  returns the system prompt string for GPT-4o
------------------------------------------------------------------ */
async function buildPrompt() {
  const dicts = await loadAttributes();

  /* ---------- use minified JSON for token efficiency ------------- */
  const dictJson = JSON.stringify(dicts); // no pretty indent

  const schema = `
Return **only** a valid JSON object exactly like this:
{ "positive_scores": { "A": { "score": 15, "reason": "..." }, ... }, ... }

Rules:
• If evidence is weak or partial, award partial credit
  (e.g. 5 / 10 / 15 or 2 / 5 / 8 / 10 for 10-point max).
• Prefer scoring every attribute (or 0 with a reason); use
  "unscored_attributes" only when no clue exists.
• A negative is **not triggered** when "score": 0.
• Each object needs "score" and a 25–40-word "reason".
• Do NOT wrap the JSON in \`\`\` fences or add extra commentary.
`;

  const prompt = `${dictJson}\n\n${schema.trim()}`;

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

/* ------------------------------------------------------------------
   slimLead  –  drop unused fields to keep the prompt tiny
------------------------------------------------------------------ */
function slimLead(full = {}) {
  return {
    firstName   : full.firstName || "",
    lastName    : full.lastName  || "",
    headline    : full.headline  || "",
    summary     : full.summary   || full.linkedinDescription || "",
    locationName: full.locationName || "",
    experience  : Array.isArray(full.experience)
                   ? full.experience.slice(0, 5)   // first 5 roles
                   : undefined
  };
}

module.exports = { buildPrompt, slimLead };