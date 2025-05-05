/* ===================================================================
   promptBuilder.js – builds the compact JSON scoring prompt
   -------------------------------------------------------------------
   • Embeds the positive & negative attribute dictionaries
   • Adds a strict response schema so GPT returns clean JSON
   • Requires a 25–40-word "reason" for every scored attribute
=================================================================== */
const { loadAttributes } = require("./attributeLoader");

/* ------------------------------------------------------------------
   buildPrompt  –  returns the system prompt for GPT-4o
------------------------------------------------------------------ */
async function buildPrompt() {
  // 1️⃣  Fetch { positives, negatives } from Airtable (cached)
  const dicts = await loadAttributes();

  // 2️⃣  Define the exact JSON schema GPT must return
  const schema = `
Return **only** a valid JSON object exactly like this:

{
  "positive_scores": {
    "A": { "score": 15, "reason": "…" },
    "B": { "score": 12, "reason": "…" },
    ...
  },
  "negative_scores": {
    "N1": { "score": 0,  "reason": "…" },
    "N2": { "score": -5, "reason": "…" },
    ...
  },
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
    • "score"  – a number (≥ 0 for positives, ≤ 0 for negatives)
    • "reason" – 25-40 words explaining why you awarded that score.
• Do NOT wrap the JSON in \`\`\` fences or add extra commentary.
`;

  // 3️⃣  Combine dictionaries + schema into one system prompt
  return `${JSON.stringify(dicts, null, 2)}\n\n${schema}`;
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
                   ? full.experience.slice(0, 2)   // first two jobs only
                   : undefined,
  };
}

module.exports = { buildPrompt, slimLead };