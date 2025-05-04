/* ===================================================================
   promptBuilder.js – builds the compact JSON scoring prompt
   -------------------------------------------------------------------
   • Dynamically fetches the attribute list from Airtable
     via attributeLoader.js (cached for 10 min).
   • Falls back to a hard-coded list if Airtable is unreachable.
   • Exports:
       – buildPrompt()  → async JSON string for GPT
       – slimLead()     → trims a LinkedIn profile to essential fields
=================================================================== */
const { loadAttributes } = require("./attributeLoader");

/* ------------------------------------------------------------------
   buildPrompt  –  returns the framework JSON for GPT
------------------------------------------------------------------ */
async function buildPrompt() {
  // Fetch { positives, negatives } from Airtable (cached).
  const dicts = await loadAttributes();

  // Pretty-print so GPT sees a readable JSON structure.
  return JSON.stringify(dicts, null, 2);
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
                   ? full.experience.slice(0, 2)       // first two jobs only
                   : undefined,
  };
}

/* ------------------------------------------------------------------
   Exports
------------------------------------------------------------------ */
module.exports = { buildPrompt, slimLead };