/* ===================================================================
   promptBuilder.js – builds the compact JSON scoring prompt + helpers
   -------------------------------------------------------------------
   • Embeds the positive & negative attribute dictionaries
   • Adds the strict response schema
   • Provides slimLead(profile) that:
       – consolidates headline + about/summary
       – grabs the first 5 experience entries (with robust fallback
         from organization_1..5 if profile.experience is missing)
=================================================================== */

const fs   = require("fs");
const path = require("path");

const { loadAttributes } = require("./attributeLoader");

/* ------------------------------------------------------------------
   extractExperience  –  normalises a profile’s work-history array
------------------------------------------------------------------ */
function extractExperience(profile = {}) {
  // Prefer the native experience array when present
  if (Array.isArray(profile.experience) && profile.experience.length > 0) {
    return profile.experience;
  }

  // Fallback – rebuild from organization_1..5 (legacy scraper output)
  const jobs = [];
  for (let i = 1; i <= 5; i++) {
    const company     = profile[`organization_${i}`];
    const title       = profile[`organization_title_${i}`];
    const description = profile[`position_description_${i}`] || "";
    const start       = profile[`organization_start_${i}`];
    const end         = profile[`organization_end_${i}`];

    if (!company && !title && !description) continue;

    jobs.push({
      company,
      title,
      description,
      start,
      end,
    });
  }
  return jobs;
}

/* ------------------------------------------------------------------
   slimLead  –  turns a huge scraped profile into a compact object
------------------------------------------------------------------
   • Always passes an **experience** array (max 5 entries)
   • Keeps headline & about text only
------------------------------------------------------------------ */
function slimLead(profile = {}) {
  const headline = (profile.headline || profile.jobTitle || "").trim();

  const about =
    (profile.about ||
      profile.summary ||
      profile.linkedinDescription ||
      "").trim();

  const jobs       = extractExperience(profile);
  const firstFive  = jobs.slice(0, 5);      // stay within token budget

  return {
    headline,
    about,
    experience: firstFive,
    // debug helpers (ignored by GPT schema)
    _experienceCount: jobs.length,
    _originalId     : profile.id || profile.public_id || "",
  };
}

/* ------------------------------------------------------------------
   buildPrompt  –  returns the SYSTEM prompt string for GPT-4o
------------------------------------------------------------------ */
async function buildPrompt() {
  const dicts = await loadAttributes(); // { positives, negatives }

  const schema = `
Return **ONLY** a valid JSON array (even when scoring one lead). No markdown, no prose, no code fences.

{
  "positive_scores": { "A": { "score": 15, "reason": "..." }, ... },
  "negative_scores": { "N1": { "score": 0, "reason": "..." }, ... },
  "contact_readiness": false,
  "unscored_attributes": [],
  "aiProfileAssessment": "Single-paragraph assessment",
  "finalPct": 72.5
}

Rules:
• If you cannot score an attribute, omit it and add its ID to unscored_attributes.
• Provide a concise reason for every scored attribute.
• Use the attribute dictionaries below exactly as written – do NOT invent new labels.
`;

  const systemPrompt = `
You are an AI lead-scoring engine.  Apply the following attribute
definitions to each LinkedIn profile you receive and output JSON that
obeys the strict schema shown below.

=================  POSITIVE ATTRIBUTES  =================
${JSON.stringify(dicts.positives, null, 2)}

=================  NEGATIVE ATTRIBUTES  =================
${JSON.stringify(dicts.negatives, null, 2)}

=================  RESPONSE SCHEMA  =====================
${schema}
`;

  // Optional debug dump
  if (process.env.DEBUG_RAW_PROMPT === "1") {
    const fp = path.join(__dirname, "DEBUG_PROMPT.txt");
    fs.writeFileSync(fp, systemPrompt, "utf8");
    console.log("▶︎ promptBuilder dumped DEBUG_PROMPT.txt");
  }

  return systemPrompt;
}

/* ------------------------------------------------------------------
   Exports
------------------------------------------------------------------ */
module.exports = {
  buildPrompt,
  slimLead,
};