/* ===================================================================
   promptBuilder.js  –  self-contained (no external prompt files)
   -------------------------------------------------------------------
   • buildPrompt()  → returns the full system prompt string
   • slimLead()     → extracts minimal JSON; now includes a
                      fallback that builds an experience array from
                      organization_1 / organization_title_1, etc.
=================================================================== */

const { loadAttributes } = require("./attributeLoader");

/* ---------- hard-coded header & footer -------------------------- */
const HEADER = `
You are a lead-scoring engine for Partner Piloting.
• You receive an array of LinkedIn profiles in JSON.
• For each profile, judge the presence of the listed positive
  and negative attributes.
• Output must follow the exact schema and order requested.
`.trim();

const FOOTER = `
Return ONLY valid JSON in the exact schema—no prose,
no Markdown, no code fences, no explanations.
If you cannot score a profile, return an empty object {} in its slot.
`.trim();

/* ----------------------------------------------------------------
   buildPrompt – header + bullets from Airtable + footer
----------------------------------------------------------------- */
async function buildPrompt() {
  const { positives, negatives } = await loadAttributes();

  const positivesTxt = Object.values(positives)
    .map(d => `• ${d.id}: ${d.description}`)
    .join("\n");

  const negativesTxt = Object.values(negatives)
    .map(d => `• ${d.id}: ${d.description}`)
    .join("\n");

  return (
    HEADER +
    "\n\nPositive attributes:\n" + positivesTxt +
    "\n\nNegative attributes:\n" + negativesTxt +
    "\n\n" +
    FOOTER
  );
}

/* ----------------------------------------------------------------
   extractExperience – use array if present, else build from the
   flattened organization_* keys (max 3 roles)
----------------------------------------------------------------- */
function extractExperience(profile) {
  if (Array.isArray(profile.experience) && profile.experience.length) {
    return profile.experience.slice(0, 3);
  }

  const exp = [];
  for (let i = 1; i <= 5; i++) {
    const company = profile[`organization_${i}`];
    const title   = profile[`organization_title_${i}`];
    if (!company && !title) break;
    exp.push({ company, title });
    if (exp.length === 3) break;
  }
  return exp;
}

/* ----------------------------------------------------------------
   slimLead – keep only the fields GPT needs
----------------------------------------------------------------- */
function slimLead(profile) {
  return {
    firstName : profile.firstName    || "",
    lastName  : profile.lastName     || "",
    headline  : profile.headline     || "",
    location  : profile.locationName || "",
    about     : (profile.about || profile.summary || "").trim(),
    experience: extractExperience(profile),
    skills    : profile.skills || ""
  };
}

module.exports = { buildPrompt, slimLead };