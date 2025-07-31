/* ===================================================================
   promptBuilder.js – builds the verbose JSON scoring prompt for Gemini
   -------------------------------------------------------------------
   • Incorporates a preamble from attributeLoader.
   • Embeds the positive & negative attribute dictionaries.
   • Defines the strict verbose response schema for Gemini, aligned
     with scoring.js and breakdown.js.
   • Provides slimLead(profile) for data minimization.
=================================================================== */

const fs = require("fs");
const path = require("path");
const StructuredLogger = require('./utils/structuredLogger');

const { loadAttributes } = require("./attributeLoader");

/* ------------------------------------------------------------------
   extractExperience  –  normalises a profile’s work-history array
   (Unchanged from your version)
------------------------------------------------------------------ */
function extractExperience(profile = {}) {
    // Prefer the native experience array when present
    if (Array.isArray(profile.experience) && profile.experience.length > 0) {
        return profile.experience;
    }

    // Fallback – rebuild from organization_1..5 (legacy scraper output)
    const jobs = [];
    for (let i = 1; i <= 5; i++) {
        const company = profile[`organization_${i}`];
        const title = profile[`organization_title_${i}`];
        const description = profile[`position_description_${i}`] || "";
        const start = profile[`organization_start_${i}`];
        const end = profile[`organization_end_${i}`];

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
   (Unchanged from your version)
------------------------------------------------------------------ */
function slimLead(profile = {}) {
    const headline = (profile.headline || profile.jobTitle || "").trim();

    const about =
        (profile.about ||
            profile.summary ||
            profile.linkedinDescription ||
            "").trim();

    const jobs = extractExperience(profile);
    const firstFive = jobs.slice(0, 5); // stay within token budget

    return {
        headline,
        about,
        experience: firstFive,
        // debug helpers (can be ignored by the AI if not mentioned in schema)
        _experienceCount: jobs.length,
        _originalId: profile.id || profile.public_id || "",
    };
}

/* ------------------------------------------------------------------
   buildPrompt  –  returns the SYSTEM prompt string for Gemini
   (Schema updated for perfect alignment with helper functions)
------------------------------------------------------------------ */
async function buildPrompt(logger = null) {
    // Initialize logger if not provided (backward compatibility)
    if (!logger) {
        logger = new StructuredLogger('SYSTEM', 'PROMPT');
    }

    logger.setup('buildPrompt', 'Starting lead scoring prompt construction');

    // loadAttributes now returns { preamble, positives, negatives }
    const { preamble, positives, negatives } = await loadAttributes(logger);

    logger.process('buildPrompt', `Loaded attributes: ${Object.keys(positives).length} positive, ${Object.keys(negatives).length} negative`);

    // This schema defines the structure for EACH lead object within the JSON array
    // that Gemini is instructed to return.
    const verboseSchemaDefinition = `
{
  "positive_scores": { 
    "A": <integer score for attribute A, e.g., 15>, 
    "B": <integer score for attribute B, e.g., 0>, 
    // ... and so on for all applicable positive attributes where a score is assigned ...
  },
  "negative_scores": { 
    "N1": <integer score for attribute N1, e.g., 5 (note: actual value will be negative e.g. -5)>, 
    "N2": <integer score for attribute N2, e.g., 0>,
    // ... and so on for all applicable negative attributes where a score is assigned ...
  },
  "attribute_reasoning": { 
    "A": "<Concise string reason for the score given to attribute A, if scored>",
    "B": "<Concise string reason for the score given to attribute B, if scored>",
    "N1": "<Concise string reason for the score given to attribute N1, if scored>",
    // ... and so on for every attribute that received a score. Omit ID if no reason applicable.
  },
  "contact_readiness": <boolean, true or false, reflecting overall readiness for contact based on profile signals>,
  "unscored_attributes": ["<ID of attribute 1 that could not be scored due to missing info>", "<ID of attribute 2...>", /* ... list of strings ... */], 
  "aiProfileAssessment": "<Single-paragraph assessment string (approx 50-150 words) summarizing the profile's overall fit based on the attributes. This is a general overview.>",
  "ai_excluded": "<string, strictly 'Yes' or 'No', indicating if the lead should be programmatically excluded based on very specific disqualifying criteria observed>",
  "exclude_details": "<string, concise reason if ai_excluded is 'Yes', otherwise can be an empty string.>"
}
`;

    const rulesAndOutputFormat = `
You will be provided with an array of lead profiles. For each lead profile, you MUST meticulously evaluate it against the POSITIVE and NEGATIVE attributes defined below, following any overarching instructions provided in the initial preamble.

Your response MUST be ONLY a single, valid JSON array. Each element in this array MUST be a JSON object strictly adhering to the following schema for each lead:
${verboseSchemaDefinition}

IMPORTANT RULES:
1.  The JSON array you return must contain exactly one object for each lead provided in the input array, in the same order.
2.  Scores for attributes in "positive_scores" and "negative_scores" must be integers. For positive attributes, scores should be between 0 and the maxPoints defined. For negative attributes, scores should be between the defined penalty (e.g., -5) and 0.
3.  If an attribute cannot be scored for a lead (e.g., due to missing information), omit its key entirely from the "positive_scores" or "negative_scores" objects for that lead, AND add that attribute's ID (e.g., "A", "N1") to the "unscored_attributes" array for that lead.
4.  For every attribute that IS scored (has an entry in "positive_scores" or "negative_scores"), provide a concise string reason in the "attribute_reasoning" object. The key for the reason must match the attribute ID. If an attribute is unscored, it should not have an entry in "attribute_reasoning".
5.  Do NOT invent new attribute labels; use only those defined in the dictionaries.
6.  Do NOT include any markdown, code fences (like \`\`\`json), explanations, or any text outside of the single main JSON array response. Your entire output must be parsable as a JSON array.
7.  The "contact_readiness" field should reflect an overall assessment for contact, potentially influenced by specific attributes (like "I") but representing a holistic view.
8.  The "ai_excluded" should be "Yes" only if very specific, hard disqualifying conditions are met as per your understanding of the attributes (e.g., if a 'disqualifying: true' negative attribute gets its full penalty).
`;

    // Construct the system prompt, including the preamble if it exists
    const systemPrompt = `
${preamble ? preamble + "\n\n================= SCORING CRITERIA AND ATTRIBUTE DEFINITIONS =================" : "You are an expert AI lead-scoring engine. Your task is to analyze LinkedIn profiles based on a detailed set of positive and negative attributes, and then provide a structured JSON output."}

================= POSITIVE ATTRIBUTES (with max scores) =================
${JSON.stringify(positives, null, 2)}

================= NEGATIVE ATTRIBUTES (with max deduction) ================
${JSON.stringify(negatives, null, 2)}

================= RESPONSE FORMAT AND RULES =====================
${rulesAndOutputFormat}
`;

    // Optional debug dump
    if (process.env.DEBUG_RAW_PROMPT === "1") {
        const fp = path.join(__dirname, "DEBUG_PROMPT_GEMINI.txt");
        fs.writeFileSync(fp, systemPrompt, "utf8");
        logger.debug('buildPrompt', 'Dumped DEBUG_PROMPT_GEMINI.txt for debugging');
    }

    logger.summary('buildPrompt', `Successfully built prompt with ${systemPrompt.length} characters`);
    return systemPrompt;
}

/* ------------------------------------------------------------------
   Exports (Unchanged)
------------------------------------------------------------------ */
module.exports = {
    buildPrompt,
    slimLead,
};