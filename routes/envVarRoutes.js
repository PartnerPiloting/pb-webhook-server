// routes/envVarRoutes.js
// API endpoints for environment variable analysis

const express = require('express');
const router = express.Router();
const EnvVarAnalyzer = require('../services/envVarAnalyzer');

/**
 * GET /api/env-vars/list
 * List all environment variables found in code
 * Query params:
 *   - branch: Git branch to analyze (optional, defaults to current)
 */
router.get('/list', async (req, res) => {
    try {
        const branch = req.query.branch || null;
        const analyzer = new EnvVarAnalyzer();
        
        const varNames = analyzer.scanCodeForEnvVars(branch);
        const vars = varNames.map(name => ({
            name,
            currentValue: analyzer.getCurrentValue(name),
            isSet: !!analyzer.getCurrentValue(name)
        }));
        
        res.json({
            success: true,
            branch: branch || 'current',
            count: vars.length,
            variables: vars
        });
    } catch (error) {
        console.error('Error listing env vars:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/env-vars/analyze
 * Analyze environment variables with AI descriptions
 * Query params:
 *   - branch: Git branch to analyze (optional)
 *   - var: Specific variable to analyze (optional, analyzes all if not provided)
 */
router.get('/analyze', async (req, res) => {
    try {
        const branch = req.query.branch || null;
        const specificVar = req.query.var || null;
        const analyzer = new EnvVarAnalyzer();
        
        if (specificVar) {
            // Analyze single variable
            const result = await analyzer.generateDescription(specificVar);
            res.json({
                success: true,
                branch: branch || 'current',
                variable: result
            });
        } else {
            // Analyze all variables
            const results = await analyzer.analyzeAll(branch);
            
            // Group by category
            const byCategory = results.reduce((acc, v) => {
                const cat = v.category || 'other';
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(v);
                return acc;
            }, {});
            
            res.json({
                success: true,
                branch: branch || 'current',
                count: results.length,
                variables: results,
                byCategory
            });
        }
    } catch (error) {
        console.error('Error analyzing env vars:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/env-vars/compare
 * Compare environment variables between two branches
 * Query params:
 *   - from: First branch name (required)
 *   - to: Second branch name (required)
 */
router.get('/compare', async (req, res) => {
    try {
        const { from, to } = req.query;
        
        if (!from || !to) {
            return res.status(400).json({
                success: false,
                error: 'Both "from" and "to" branch parameters are required'
            });
        }
        
        const analyzer = new EnvVarAnalyzer();
        const comparison = analyzer.compareEnvVars(from, to);
        
        res.json({
            success: true,
            comparison
        });
    } catch (error) {
        console.error('Error comparing env vars:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/env-vars/current
 * Get current runtime environment variables
 * Returns actual values from the running server
 */
router.get('/current', (req, res) => {
    try {
        const analyzer = new EnvVarAnalyzer();
        const varNames = analyzer.scanCodeForEnvVars();
        
        const vars = varNames.map(name => {
            const value = process.env[name];
            return {
                name,
                isSet: !!value,
                // Mask sensitive values
                value: value ? (name.includes('SECRET') || name.includes('KEY') || name.includes('PASSWORD') 
                    ? '***MASKED***' 
                    : value) 
                : null
            };
        });
        
        res.json({
            success: true,
            environment: process.env.NODE_ENV || 'development',
            count: vars.length,
            variables: vars
        });
    } catch (error) {
        console.error('Error getting current env vars:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
