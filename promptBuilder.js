/* ===================================================================
   promptBuilder.js – builds the compact JSON scoring prompt
   -------------------------------------------------------------------
   • Embeds the positive & negative attribute dictionaries
   • Adds the strict response schema
   • Sends the first 5 experience entries (was 2)
=================================================================== */
const { loadAttributes } = require("./attributeLoader");

/* ------------------------------------------------------------------
   buildPrompt  –  returns the system prompt for GPT-4o
------------------------------------------------------------------ */
async function buildPrompt() {
  const dicts = await loadAttributes();

  const schema = `
Return **only** a valid JSON object exactly like this:

{
  "positive_scores": { "A": { "score": 15, "reason": "..." }, ... },
  "negative_scores": { "N1": { "score": 0, "reason": "..." }, ... },
  "contact_readiness": false,
  "unscored_attributes": [],
  "aiProfileAssessment": "Single-paragraph assessment",
  "finalPct": 72.5
}

Rules:
• If you cannot score an attribute, omit it from "positive_scores"/"negative_scores"
  and list its ID in "unscored_attributes".
• A negative is **not triggered** when "score": 0.
• **Every attribute object in BOTH maps must contain:**
    • "score"  – number (≥ 0 for positives, ≤ 0 for negatives)
    • "reason" – 25–40 words explaining why you awarded that score.
• Do NOT wrap the JSON in \`\`\` fences or add extra commentary.
`;

  /* ---------------------------------------------------------------
     Assemble the full system prompt
  --------------------------------------------------------------- */
  const prompt = `${JSON.stringify(dicts, null, 2)}\n\n${schema}`;

  /* ---------------------------------------------------------------
     DEBUG: print instructions + token estimate when enabled
  --------------------------------------------------------------- */
  if (process.env.DEBUG_PROMPT === "true") {
    // ╭─ token estimate (≈ 4 chars per token heuristic) ───────────╮
    const tokenEstimate = Math.ceil(prompt.length / 4);
    // ╰─────────────────────────────────────────────────────────────╯
    console.log("\n───────── Assembled GPT System Prompt ─────────\n");
    console.log(prompt);
    console.log(`\nApprox. tokens in system prompt: ${tokenEstimate}\n`);
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
                   ? full.experience.slice(0, 5)   // ← now 5 jobs
                   : undefined,
  };
}

module.exports = { buildPrompt, slimLead };