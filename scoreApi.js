/* ===================================================================
   scoreApi.js – small helper API used by front-end tests
   (UPDATED FOR GEMINI 2.5 PRO)
   -------------------------------------------------------------------
   • POST /api/test-score  (request body = raw lead JSON)
=================================================================== */
require("dotenv").config();
const express = require("express");
const Airtable = require("airtable");

// Updated dependencies - assuming these .js files are the Gemini-updated versions
const { buildPrompt, slimLead } = require("./promptBuilder");
const { loadAttributes } = require("./attributeLoader");
const { computeFinalScore } = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");
const { scoreLeadNow } = require("./singleScorer"); // This now uses Gemini and returns a parsed object

// callGptScoring is no longer needed as Gemini (via scoreLeadNow and buildPrompt)
// will be instructed to return the already structured/parsed JSON.
// const { callGptScoring } = require("./callGptScoring");

const router = express.Router();

/* ---------- Airtable connection ---------------------------------- */
// Note: If 'base' is already configured globally in your main app (index.js),
// you might not need to reconfigure Airtable here unless this module
// needs its own specific configuration. For now, keeping it as is.
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ------------------------------------------------------------------
   POST /api/test-score
------------------------------------------------------------------*/
router.post("/api/test-score", async (req, res) => {
    try {
        const leadProfileData = req.body || {}; // Assuming req.body is the lead profile object
        console.log("▶︎ POST /api/test-score (Gemini) hit. Processing lead data...");

        if (typeof leadProfileData !== 'object' || leadProfileData === null || Object.keys(leadProfileData).length === 0) {
            return res.status(400).json({ error: "Request body must be a valid lead profile object." });
        }

        // --- buildPrompt is still relevant for system instructions if scoreLeadNow uses it ---
        // const sysPrompt = await buildPrompt(); // scoreLeadNow will call buildPrompt internally

        const { positives, negatives } = await loadAttributes();

        // Call the updated scoreLeadNow from singleScorer.js (Gemini version)
        // This function is now expected to return an already parsed JavaScript object
        // matching the verboseSchemaDefinition.
        const geminiScoredObject = await scoreLeadNow(leadProfileData /*, pass globalGeminiModel if available and needed */);

        if (!geminiScoredObject) {
            throw new Error("scoreLeadNow (Gemini) did not return valid output for /api/test-score.");
        }
        
        // 'geminiScoredObject' is now what 'parsed' used to be after callGptScoring.
        // No need for callGptScoring(raw) anymore.
        const parsed = geminiScoredObject;

        /* --- always recompute percentage locally -------------------- */
        // The 'finalPct' if returned by AI is ignored; we recalculate.
        // delete parsed.finalPct; // Not necessary if AI isn't asked to return it, which it isn't in the new prompt.

        const {
            percentage,
            rawScore: earned, // Use this 'earned' score
            denominator: max  // Use this 'max' score
        } = computeFinalScore(
            parsed.positive_scores || {},
            positives,
            parsed.negative_scores || {},
            negatives,
            parsed.contact_readiness || false,
            parsed.unscored_attributes || []
        );
        // The finalPct is now calculated and available in 'percentage'

        /* --- build human-readable breakdown ------------------------- */
        const breakdown = buildAttributeBreakdown(
            parsed.positive_scores || {},
            positives,
            parsed.negative_scores || {},
            negatives,
            parsed.unscored_attributes || [],
            earned, // Use the 'earned' score from computeFinalScore
            max,    // Use the 'max' score (denominator) from computeFinalScore
            parsed.attribute_reasoning || {}, // This should be the object of reasons
            true, // showZeros - your original code had parsed.disqualified. This might need to be `true` as per previous example.
            null  // header - your original code had parsed.disqualifyReason.
                  // If disqualified status needs to be passed, it should come from AI or local logic.
                  // For now, setting showZeros to true and header to null as per the /score-lead endpoint example.
        );

        /* --- OPTIONAL: write to Airtable if recordId provided ------- */
        if (req.query.recordId) {
            console.log(`Updating Airtable record ${req.query.recordId} from /api/test-score (Gemini).`);
            await base("Leads").update(req.query.recordId, {
                "AI Score": Math.round(percentage * 100) / 100, // Use locally calculated percentage
                "AI Profile Assessment": parsed.aiProfileAssessment || "",
                "AI Attribute Breakdown": breakdown,
                "Scoring Status": "Scored (Test)", // Indicate it was scored via test endpoint
                "Date Scored": new Date().toISOString().split("T")[0],
                "AI_Excluded": (parsed.ai_excluded === "Yes" || parsed.ai_excluded === true),
                "Exclude Details": parsed.exclude_details || ""
            });
        }

        /* --- respond ------------------------------------------------ */
        console.log(`/api/test-score (Gemini) successful. Final Pct: ${Math.round(percentage * 100) / 100}`);
        res.json({
            finalPct: Math.round(percentage * 100) / 100,
            breakdown,
            assessment: parsed.aiProfileAssessment || ""
            // rawGeminiOutput: parsed // Optionally return the full parsed object for debugging
        });

    } catch (err) {
        console.error("Error in /api/test-score (Gemini):", err.message, err.stack);
        res.status(500).json({ error: err.message });
    }
});

// This line correctly exports the router to be used in index.js with app.use('/api', scoreApiRouter);
// module.exports = (app) => app.use(router);
// However, index.js currently does: require("./scoreApi")(app);
// This implies scoreApi.js should export a function that takes `app`.
// Let's stick to your original export pattern for now.
// If your index.js has `app.use('/api', scoreApi);` then `module.exports = router;` is correct.
// If your index.js has `require("./scoreApi")(app);` then the current export is fine.
// Sticking to your existing export pattern:
module.exports = function mountScoreApi(app) {
    app.use("/api", router); // Assuming you want this mounted at /api path
};