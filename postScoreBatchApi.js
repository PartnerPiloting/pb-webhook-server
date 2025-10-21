// File: postScoreBatchApi.js
const { createLogger } = require('./utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'api' });

const express = require('express');
const router = express.Router();

// Import our main batch processing function from the service module
const { processAllPendingLeadPosts } = require('./postAnalysisService');

// These module-level variables will hold the dependencies passed from index.js
let moduleBase;
let moduleVertexAIClient;
let modulePostAnalysisConfig;

/**
 * API Route: POST /api/internal/trigger-post-scoring-batch
 *
 * An internal endpoint designed to be called by a scheduler (like a Render Cron Job)
 * or manually to start the batch process of scoring all unscored lead posts.
 * It is secured with your existing PB_WEBHOOK_SECRET.
 */
router.post('/trigger-post-scoring-batch', (req, res) => {
    logger.info("PostScoreBatchApi: POST /api/internal/trigger-post-scoring-batch hit.");

    // --- Security Check REMOVED ---
    // The endpoint is now open for internal or manual triggering without a secret key.
    // --------------------

    // Check if the service has been properly initialized
    if (!moduleBase || !moduleVertexAIClient || !modulePostAnalysisConfig) {
        logger.error("PostScoreBatchApi: Service not configured. Missing base, vertexAIClient, or config.");
        return res.status(503).json({ error: "Service is not ready to process batch job." });
    }

    // --- Parse limit and forceRescore from query string ---
    let limit = undefined;
    if (req.query && req.query.limit) {
        limit = parseInt(req.query.limit, 10);
        if (isNaN(limit) || limit <= 0) limit = undefined;
    }
    const forceRescore = req.query && (req.query.forceRescore === 'true' || req.query.forceRescore === true);
    // --- Specify the view name for leads with posts not yet scored ---
    const viewName = 'Leads with Posts not yet scored';

    // --- Trigger the background task ---
    // We call the function but DO NOT use 'await' here.
    // This allows the API to send an immediate response while the (potentially long)
    // batch job runs in the background.
    processAllPendingLeadPosts(moduleBase, moduleVertexAIClient, modulePostAnalysisConfig, limit, forceRescore, viewName)
        .then(() => {
            logger.info("PostScoreBatchApi: Background task 'processAllPendingLeadPosts' has completed.");
        })
        .catch(err => {
            logger.error("PostScoreBatchApi: Background task 'processAllPendingLeadPosts' finished with an error.", err);
        });
    // ---------------------------------

    // Immediately send a response to the caller (Render Cron Job or Postman)
    // to confirm the job has been successfully started.
    res.status(202).json({
        status: "accepted",
        message: "Batch post-scoring process has been started successfully in the background."
    });
});

/**
 * The main exported function called from index.js to mount this API.
 */
module.exports = function mountPostScoreBatchApi(app, base, vertexAIClient, postAnalysisConfig) {
    if (!base || !vertexAIClient || !postAnalysisConfig) {
        logger.error("postScoreBatchApi.js: mount function called without base, vertexAIClient, or postAnalysisConfig. API will not function.");
        return;
    }
    // Make dependencies available to our router
    moduleBase = base;
    moduleVertexAIClient = vertexAIClient;
    modulePostAnalysisConfig = postAnalysisConfig;

    // Mounts the router. The full path becomes /api/internal/trigger-post-scoring-batch
    app.use('/api/internal', router);
    logger.info("postScoreBatchApi.js: /api/internal/trigger-post-scoring-batch route mounted.");
};