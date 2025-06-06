// File: postScoreTestApi.js

const express = require('express');
const router = express.Router();

// We will get this function from the postAnalysisService.js module we've defined
const { scoreSpecificLeadPosts } = require('./postAnalysisService');

// These module-level variables will hold the dependencies passed from index.js
let moduleBase;
let moduleVertexAIClient;
let modulePostAnalysisConfig;

/**
 * API Route: POST /api/test-post-score/:leadId
 *
 * This endpoint allows you to trigger post scoring for a single, specific lead
 * by providing their Airtable Record ID in the URL.
 * It's primarily intended for testing and debugging the scoring logic.
 *
 * Example Usage: Send a POST request to a URL like:
 * http://your-server-address/api/test-post-score/recABC123XYZ
 */
router.post('/test-post-score/:leadId', async (req, res) => {
    const { leadId } = req.params;
    console.log(`PostScoreTestApi: POST /api/test-post-score hit for leadId: ${leadId}`);

    // Check if the service has been properly initialized with dependencies from index.js
    if (!moduleBase || !moduleVertexAIClient || !modulePostAnalysisConfig) {
        console.error("PostScoreTestApi: Service not configured. Missing base, vertexAIClient, or config.");
        return res.status(503).json({ error: "Service temporarily unavailable due to internal configuration error." });
    }

    try {
        // Per our previous discussion, the "dry run" feature was removed. This will always update Airtable.
        const result = await scoreSpecificLeadPosts(
            leadId,
            moduleBase,
            moduleVertexAIClient,
            modulePostAnalysisConfig
        );

        // Send the result from the service function back as the API response
        if (result && result.error) {
            // If the service function returned a structured error, send an appropriate HTTP status code
            const statusCode = result.status === "Lead not found" ? 404 : 500;
            return res.status(statusCode).json(result);
        }

        // If successful, send a 200 OK status with the scoring result
        return res.status(200).json(result);

    } catch (err) {
        // Catch any unexpected errors that weren't handled by the service function
        console.error(`PostScoreTestApi: Unhandled error for leadId ${leadId}:`, err.message, err.stack);
        return res.status(500).json({ error: "An unexpected server error occurred." });
    }
});

/**
 * This is the main function exported by this module.
 * It will be called once from index.js when the server starts.
 * Its job is to "mount" the router (make the /api/test-post-score endpoint active)
 * and provide it with the necessary dependencies (Airtable base, Gemini client, config).
 */
module.exports = function mountPostScoreTestApi(app, base, vertexAIClient, postAnalysisConfig) {
    if (!base || !vertexAIClient || !postAnalysisConfig) {
        console.error("postScoreTestApi.js: mount function called without base, vertexAIClient, or postAnalysisConfig. API will not function.");
        return;
    }
    // Make dependencies available to our router
    moduleBase = base;
    moduleVertexAIClient = vertexAIClient;
    modulePostAnalysisConfig = postAnalysisConfig;

    // Mounts the router. The full path becomes /api/test-post-score/:leadId
    app.use('/api', router);
    console.log("postScoreTestApi.js: /api/test-post-score route mounted.");
};