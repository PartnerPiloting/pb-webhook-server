// routes/apifyRunsRoutes.js
// API endpoints for managing and monitoring Apify runs
// Provides debugging and monitoring capabilities for the multi-tenant integration

const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'route' });
// Removed old error logger - now using production issue tracking
const logCriticalError = async () => {};
const { 
    getApifyRun, 
    getClientRuns, 
    updateApifyRun,
    clearRunsCache 
} = require('../services/apifyRunsService');

// GET /api/apify/runs/:runId - Get details for a specific run
router.get('/api/apify/runs/:runId', async (req, res) => {
    try {
        // Simple auth check
        const auth = req.headers['authorization'];
        const secret = process.env.PB_WEBHOOK_SECRET;
        if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
        if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

        const { runId } = req.params;
        const runData = await getApifyRun(runId);
        
        if (!runData) {
            return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
        }
        
        res.json({ ok: true, run: runData });
        
    } catch (error) {
        logger.error('[ApifyRunsAPI] Error fetching run:', error.message);
        await logCriticalError(error, req).catch(() => {});
        res.status(500).json({ ok: false, error: error.message });
    }
});

// GET /api/apify/runs/client/:clientId - Get recent runs for a client
router.get('/api/apify/runs/client/:clientId', async (req, res) => {
    try {
        // Simple auth check
        const auth = req.headers['authorization'];
        const secret = process.env.PB_WEBHOOK_SECRET;
        if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
        if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

        const { clientId } = req.params;
        const limit = parseInt(req.query.limit) || 10;
        
        const runs = await getClientRuns(clientId, limit);
        
        res.json({ 
            ok: true, 
            clientId, 
            runs,
            count: runs.length 
        });
        
    } catch (error) {
        logger.error('[ApifyRunsAPI] Error fetching client runs:', error.message);
        await logCriticalError(error, req).catch(() => {});
        res.status(500).json({ ok: false, error: error.message });
    }
});

// PUT /api/apify/runs/:runId - Update a run (for debugging/manual fixes)
router.put('/api/apify/runs/:runId', async (req, res) => {
    try {
        // Simple auth check
        const auth = req.headers['authorization'];
        const secret = process.env.PB_WEBHOOK_SECRET;
        if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
        if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

        const { runId } = req.params;
        const updateData = req.body;
        
        // Validate update data
        const allowedFields = ['status', 'datasetId', 'error'];
        const filteredUpdate = {};
        
        for (const field of allowedFields) {
            if (updateData[field] !== undefined) {
                filteredUpdate[field] = updateData[field];
            }
        }
        
        if (Object.keys(filteredUpdate).length === 0) {
            return res.status(400).json({ 
                ok: false, 
                error: 'No valid update fields provided',
                allowedFields 
            });
        }
        
        const updatedRun = await updateApifyRun(runId, filteredUpdate);
        
        res.json({ 
            ok: true, 
            run: updatedRun,
            updated: filteredUpdate 
        });
        
    } catch (error) {
        logger.error('[ApifyRunsAPI] Error updating run:', error.message);
        await logCriticalError(error, req).catch(() => {});
        res.status(500).json({ ok: false, error: error.message });
    }
});

// POST /api/apify/runs/cache/clear - Clear the runs cache (development only)
if (process.env.NODE_ENV === 'development') {
    router.post('/api/apify/runs/cache/clear', async (req, res) => {
        try {
            // Simple auth check
            const auth = req.headers['authorization'];
            const secret = process.env.PB_WEBHOOK_SECRET;
            if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
            if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

            clearRunsCache();
            res.json({ ok: true, message: 'Runs cache cleared' });
            
        } catch (error) {
            logger.error('[ApifyRunsAPI] Error clearing cache:', error.message);
            await logCriticalError(error, { endpoint: 'POST /api/apify/runs/cache/clear' }).catch(() => {});
            res.status(500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = router;
