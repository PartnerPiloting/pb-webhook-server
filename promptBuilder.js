/* ===================================================================
   promptBuilder.js – builds the compact JSON scoring prompt
=================================================================== */
const { loadAttributes } = require("./attributeLoader");

/* ------------------------------------------------------------------
   buildPrompt  –  returns the framework JSON for GPT
------------------------------------------------------------------ */
async function buildPrompt() {
  // Fetch { positives, negatives } from Airtable (cached).
  const dicts = await loadAttributes();

  /*  NEW ➜  Explicitly ask GPT for a reason string on every attribute  */
  return (
    JSON.stringify(dicts, null, 2) +
    "\n\n" +
    "For **every** attribute you score, ALSO include a short \"reason\" " +
    "string (25–40 words) explaining **why** you awarded that score. " +
    'Put that text in a property called **"reason"**.'
  );
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

module.exports = { buildPrompt, slimLead };