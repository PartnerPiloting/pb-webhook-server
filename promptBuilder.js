/* ===================================================================
   promptBuilder.js
   -------------------------------------------------------------------
   • buildPrompt()      → returns the full system prompt string
   • slimLead(profile)  → extracts minimal JSON to keep token count low
   • NOTE: now aliases  summary → about, so legacy rows still score
=================================================================== */

const fs = require("fs");
const path = require("path");

/* -------------------------------------------------------------------
   Load static prompt parts (header, footer) from disk
------------------------------------------------------------------- */
const header = fs.readFileSync(
  path.join(__dirname, "prompts", "system-header.txt"),
  "utf8"
);
const footer = fs.readFileSync(
  path.join(__dirname, "prompts", "system-footer.txt"),
  "utf8"
);

/* -------------------------------------------------------------------
   Cached attribute dictionaries are loaded once
------------------------------------------------------------------- */
let cachedDictionaries = null;
async function loadDictionaries() {
  if (cachedDictionaries) return cachedDictionaries;
  cachedDictionaries = JSON.parse(
    fs.readFileSync(path.join(__dirname, "prompts", "attributes.json"), "utf8")
  );
  return cachedDictionaries;
}

/* -------------------------------------------------------------------
   buildPrompt
------------------------------------------------------------------- */
async function buildPrompt() {
  const dicts = await loadDictionaries();
  const positives = Object.values(dicts.positives)
    .map(d => `• ${d.id}: ${d.description}`)
    .join("\n");
  const negatives = Object.values(dicts.negatives)
    .map(d => `• ${d.id}: ${d.description}`)
    .join("\n");

  return (
    header +
    "\n\nPositive attributes:\n" +
    positives +
    "\n\nNegative attributes:\n" +
    negatives +
    "\n\n" +
    footer
  );
}

/* -------------------------------------------------------------------
   slimLead – reduce LinkedIn scrape to minimal fields
------------------------------------------------------------------- */
function slimLead(profile) {
  return {
    firstName : profile.firstName         || "",
    lastName  : profile.lastName          || "",
    headline  : profile.headline          || "",
    location  : profile.locationName      || "",
    about     : (profile.about || profile.summary || "").trim(), // ← alias added
    experience: Array.isArray(profile.experience)
                  ? profile.experience.slice(0, 3)                // first 3 roles
                  : [],
    skills    : profile.skills || ""
  };
}

module.exports = { buildPrompt, slimLead };