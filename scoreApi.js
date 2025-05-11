// scoreApi.js – UPDATED to use passed-in 'base' and 'globalGeminiModel'

require("dotenv").config();
const express = require("express");
// No longer need: const Airtable = require("airtable");

// Dependencies - assuming these .js files are in the project root
const { buildPrompt, slimLead } = require("./promptBuilder"); // slimLead is used by scoreLeadNow internally
const { loadAttributes } = require("./attributeLoader");
const { computeFinalScore } = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");
const { scoreLeadNow } = require("./singleScorer");

const router = express.Router();

// Airtable 'base' and 'globalGeminiModel' will be passed into mountScoreApi

/* ------------------------------------------------------------------
    POST /api/test-score
------------------------------------------------------------------*/
// Now 'base' and 'globalGeminiModel' are available in this scope from the function params
let moduleBase;
let moduleGlobalGeminiModel;

router.post("/test-score", async (req, res) => { // Path is just /test-score as /api is prefixed by app.use
    console.log("scoreApi.js: POST /api/test-score hit. Processing lead data...");

    if (!moduleBase || !moduleGlobalGeminiModel) {
        console.error("scoreApi.js - /api/test-score: Airtable base or Gemini model not provided to mountScoreApi. Endpoint will fail.");
        return res.status(503).json({ error: "Service temporarily unavailable due to internal configuration error." });
    }

    try {
        const leadProfileData = req.body || {}; 
        if (typeof leadProfileData !== 'object' || leadProfileData === null || Object.keys(leadProfileData).length === 0) {
            return res.status(400).json({ error: "Request body must be a valid lead profile object." });
        }

        const { positives, negatives } = await loadAttributes();

        // Call scoreLeadNow, PASSING the globalGeminiModel
        const geminiScoredOutput = await scoreLeadNow(leadProfileData, moduleGlobalGeminiModel);

        if (!geminiScoredOutput) {
            throw new Error("scoreLeadNow (Gemini) did not return valid output for /api/test-score.");
        }
        
        const parsed = geminiScoredOutput;

        let { // Use 'let' for attribute_reasoning
            positive_scores = {}, 
            negative_scores = {}, 
            attribute_reasoning = {},
            contact_readiness = false, 
            unscored_attributes = [], 
            aiProfileAssessment = "N/A"
        } = parsed;

        // Apply "I" attribute logic for consistency (copied from apiAndJobRoutes.js)
        let temp_positive_scores = {...positive_scores};
        if (contact_readiness && positives?.I && (temp_positive_scores.I === undefined || temp_positive_scores.I === null)) {
            temp_positive_scores.I = positives.I.maxPoints || 0; 
            if (!attribute_reasoning.I && temp_positive_scores.I > 0) { 
                attribute_reasoning.I = "Contact readiness indicated by AI, points awarded for attribute I.";
            }
        }

        const {
            percentage,
            rawScore: earned, 
            denominator: max  
        } = computeFinalScore(
            temp_positive_scores, // Use modified scores
            positives,
            negative_scores, 
            negatives,
            contact_readiness,
            unscored_attributes || []
        );
        
        const breakdown = buildAttributeBreakdown(
            temp_positive_scores, // Use modified scores
            positives,
            negative_scores, 
            negatives,
            unscored_attributes || [],
            earned, 
            max,    
            attribute_reasoning, // Use potentially modified reasoning
            false, // showZeros = false for consistency
            null  
        );

        if (req.query.recordId) {
            console.log(`scoreApi.js: Updating Airtable record ${req.query.recordId} from /api/test-score.`);
            // Use the passed-in 'moduleBase'
            await moduleBase("Leads").update(req.query.recordId, {
                "AI Score": Math.round(percentage * 100) / 100, 
                "AI Profile Assessment": parsed.aiProfileAssessment || "",
                "AI Attribute Breakdown": breakdown,
                "Scoring Status": "Scored (Test)", 
                "Date Scored": new Date().toISOString().split("T")[0],
                "AI_Excluded": (parsed.ai_excluded === "Yes" || parsed.ai_excluded === true),
                "Exclude Details": parsed.exclude_details || ""
            });
        }

        console.log(`scoreApi.js: /api/test-score successful. Final Pct: ${Math.round(percentage * 100) / 100}`);
        res.json({
            finalPct: Math.round(percentage * 100) / 100,
            breakdown,
            assessment: parsed.aiProfileAssessment || ""
        });

    } catch (err) {
        console.error("scoreApi.js - Error in /api/test-score:", err.message, err.stack);
        res.status(500).json({ error: err.message });
    }
});

module.exports = function mountScoreApi(app, base, globalGeminiModel) { // <-- Now accepts 'base' and 'globalGeminiModel'
  if (!base || !globalGeminiModel) {
    console.error("scoreApi.js: mountScoreApi called without base or globalGeminiModel. API will not function.");
    return;
  }
  moduleBase = base; // Make base available to route handlers
  moduleGlobalGeminiModel = globalGeminiModel; // Make model available

  app.use("/api", router); // Mounts the router at /api, so route is /api/test-score
  console.log("scoreApi.js: /api/test-score route mounted.");
};