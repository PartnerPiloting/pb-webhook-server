// routes/extensionConfigRoutes.js
// API endpoints for Chrome extension configuration

const express = require('express');
const router = express.Router();
const { getMasterClientsBase } = require('../config/airtableClient');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({
    runId: 'SYSTEM',
    clientId: 'SYSTEM',
    operation: 'extension-config'
});

const TABLE_NAME = 'Extension Config';

// Cache for config to reduce Airtable API calls
let configCache = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/extension-config
 * Returns all active extension configuration
 * Used by Chrome extension to get selectors and settings
 */
router.get('/', async (req, res) => {
    try {
        // Check cache first
        if (configCache && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
            logger.info('Returning cached extension config');
            return res.json({
                success: true,
                cached: true,
                config: configCache
            });
        }

        const base = getMasterClientsBase();
        const records = await base(TABLE_NAME)
            .select({
                filterByFormula: '{Active} = "Yes"'
            })
            .all();

        // Transform records into config object
        const config = {};
        for (const record of records) {
            const key = record.get('Key');
            const value = record.get('Value');
            const version = record.get('Version');

            if (key && value) {
                try {
                    // Try to parse as JSON, otherwise use as string
                    config[key] = {
                        value: JSON.parse(value),
                        version: version || 1
                    };
                } catch (e) {
                    // Not valid JSON, use as-is
                    config[key] = {
                        value: value,
                        version: version || 1
                    };
                }
            }
        }

        // Update cache
        configCache = config;
        cacheTimestamp = Date.now();

        logger.info(`Extension config loaded: ${Object.keys(config).length} items`);

        res.json({
            success: true,
            cached: false,
            config: config
        });

    } catch (error) {
        logger.error('Error fetching extension config:', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/extension-config/version
 * Returns just the config version (for quick cache invalidation checks)
 */
router.get('/version', async (req, res) => {
    try {
        const base = getMasterClientsBase();
        const records = await base(TABLE_NAME)
            .select({
                filterByFormula: 'AND({Key} = "config_version", {Active} = "Yes")',
                maxRecords: 1
            })
            .all();

        const version = records.length > 0 ? records[0].get('Value') : '1';

        res.json({
            success: true,
            version: version
        });

    } catch (error) {
        logger.error('Error fetching config version:', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/extension-config/clear-cache
 * Clears the config cache (useful after updating Airtable)
 */
router.post('/clear-cache', async (req, res) => {
    configCache = null;
    cacheTimestamp = null;
    logger.info('Extension config cache cleared');
    
    res.json({
        success: true,
        message: 'Cache cleared'
    });
});

module.exports = router;
