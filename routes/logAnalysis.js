// routes/logAnalysis.js
// API endpoints for log analysis and monitoring

const express = require('express');
const router = express.Router();
const RenderLogService = require('../services/renderLogService');
const { StructuredLogger } = require('../utils/structuredLogger');

// Initialize log service
let renderLogService;
try {
    renderLogService = new RenderLogService();
} catch (error) {
    console.error('Failed to initialize RenderLogService:', error.message);
}

/**
 * GET /api/logs/services
 * List all Render services
 */
router.get('/services', async (req, res) => {
    const logger = new StructuredLogger('API', 'LOG-SERVICES');
    
    try {
        if (!renderLogService) {
            throw new Error('Render log service not available - check RENDER_API_KEY');
        }

        logger.setup('getServices', 'Fetching all Render services');
        const services = await renderLogService.getAllServices();
        
        logger.summary('getServices', `Retrieved ${services.length} services`);
        res.json({
            success: true,
            services,
            count: services.length
        });
    } catch (error) {
        logger.error('getServices', `Failed to fetch services: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/logs/search
 * Search logs across all services
 * Body: { searchTerms: ["CLIENT:ABC123", "ERROR"], timeRange: "1h" }
 */
router.post('/search', async (req, res) => {
    const logger = new StructuredLogger('API', 'LOG-SEARCH');
    
    try {
        if (!renderLogService) {
            throw new Error('Render log service not available - check RENDER_API_KEY');
        }

        const { searchTerms = [], timeRange = '1h' } = req.body;
        
        if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'searchTerms array is required and cannot be empty'
            });
        }

        logger.setup('searchLogs', `Searching for: ${searchTerms.join(', ')} in last ${timeRange}`);
        const results = await renderLogService.searchLogsAcrossServices(searchTerms, timeRange);
        
        logger.summary('searchLogs', `Found matches in ${results.length} services`);
        res.json({
            success: true,
            results,
            searchTerms,
            timeRange,
            totalServices: results.length,
            totalMatches: results.reduce((sum, r) => sum + r.totalMatches, 0)
        });
    } catch (error) {
        logger.error('searchLogs', `Search failed: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/logs/analyze-errors?timeRange=1h
 * Automatic error pattern analysis
 */
router.get('/analyze-errors', async (req, res) => {
    const logger = new StructuredLogger('API', 'ERROR-ANALYSIS');
    
    try {
        if (!renderLogService) {
            throw new Error('Render log service not available - check RENDER_API_KEY');
        }

        const { timeRange = '1h' } = req.query;
        
        logger.setup('analyzeErrors', `Analyzing errors in last ${timeRange}`);
        const analysis = await renderLogService.analyzeErrorPatterns(timeRange);
        
        logger.summary('analyzeErrors', `Found ${analysis.totalErrors} errors across ${analysis.affectedServices} services`);
        res.json({
            success: true,
            analysis,
            timeRange,
            hasIssues: analysis.totalErrors > 0
        });
    } catch (error) {
        logger.error('analyzeErrors', `Error analysis failed: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/logs/client-check
 * Check logs for a specific client
 * Body: { clientId: "ABC123", timeRange: "2h", includeTypes: ["ERROR", "WARN"] }
 */
router.post('/client-check', async (req, res) => {
    const logger = new StructuredLogger('API', 'CLIENT-CHECK');
    
    try {
        if (!renderLogService) {
            throw new Error('Render log service not available - check RENDER_API_KEY');
        }

        const { clientId, timeRange = '2h', includeTypes = ['ERROR', 'WARN'] } = req.body;
        
        if (!clientId) {
            return res.status(400).json({
                success: false,
                error: 'clientId is required'
            });
        }

        // Build search terms for this client
        const searchTerms = [`CLIENT:${clientId}`];
        if (includeTypes.length > 0) {
            searchTerms.push(...includeTypes);
        }

        logger.setup('clientCheck', `Checking logs for client ${clientId} in last ${timeRange}`);
        const results = await renderLogService.searchLogsAcrossServices(searchTerms, timeRange);
        
        // Filter to only logs that contain the client ID
        const clientResults = results.map(result => ({
            ...result,
            matchingLogs: result.matchingLogs.filter(log => 
                (log.message || log.text || '').includes(`CLIENT:${clientId}`)
            )
        })).filter(result => result.matchingLogs.length > 0);

        logger.summary('clientCheck', `Found ${clientResults.length} services with logs for client ${clientId}`);
        res.json({
            success: true,
            clientId,
            results: clientResults,
            timeRange,
            totalMatches: clientResults.reduce((sum, r) => sum + r.matchingLogs.length, 0),
            hasIssues: clientResults.length > 0
        });
    } catch (error) {
        logger.error('clientCheck', `Client check failed: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
