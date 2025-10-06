/**
 * routes/diagnosticRoutes.js
 * 
 * Diagnostic routes for development and testing purposes.
 * These endpoints help validate system functionality and
 * identify issues before they occur in production.
 */

const express = require('express');
const router = express.Router();
const { logCriticalError } = require('../utils/errorLogger');
const runIdSystem = require('../services/runIdSystem');
const JobTracking = require('../services/jobTracking');
const { createLogger } = require('../utils/unifiedLoggerFactory');

// Default logger
const logger = createLogger('SYSTEM', null, 'diagnostic-routes');

/**
 * Environment check to prevent these routes from running in production
 */
const isProduction = process.env.NODE_ENV === 'production';
const DEBUG_API_KEY = process.env.DEBUG_API_KEY;

// Middleware to ensure these routes only run in development or with proper auth
function developmentOnlyMiddleware(req, res, next) {
  // Always allow in development
  if (!isProduction) {
    return next();
  }
  
  // In production, require DEBUG_API_KEY
  const providedKey = req.query.debug_key || req.headers['x-debug-key'];
  
  if (!DEBUG_API_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Diagnostic routes are disabled in production'
    });
  }
  
  if (providedKey !== DEBUG_API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Invalid debug key'
    });
  }
  
  // Key is valid, allow the request
  next();
}

// Apply the middleware to all routes in this file
router.use(developmentOnlyMiddleware);

/**
 * Endpoint to validate and normalize run IDs
 * Helps identify inconsistent run ID usage during testing
 * 
 * POST /api/diagnostic/validate-run-id
 * Body: { runId: "your-run-id" }
 */
router.post('/validate-run-id', async (req, res) => {
  try {
    const { runId } = req.body;
    
    if (!runId) {
      return res.status(400).json({
        success: false,
        error: 'No run ID provided',
      });
    }
    
    try {
      // This will throw if the run ID is invalid in strict mode
      const normalizedId = runIdSystem.normalizeRunId(runId, 'validate-run-id-endpoint');
      
      return res.status(200).json({
        success: true,
        originalRunId: runId,
        normalizedRunId: normalizedId,
        format: runIdSystem.detectRunIdFormat(runId)?.formatKey || 'unknown',
        isValid: true,
      });
    } catch (validationError) {
      return res.status(400).json({
    await logCriticalError(validationError, { operation: 'validate_run_id' }).catch(() => {});
        success: false,
        error: validationError.message,
        originalRunId: runId,
        isValid: false,
        stack: validationError.stack
      });
    }
  } catch (error) {
    console.error(`Error in validate-run-id endpoint: ${error.message}`);
    await logCriticalError(error, req).catch(() => {});
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Endpoint to check if a job tracking record exists for a run ID
 * 
 * GET /api/diagnostic/check-job-record/:runId
 */
router.get('/check-job-record/:runId', async (req, res) => {
  try {
    const { runId } = req.params;
    
    if (!runId) {
      return res.status(400).json({
        success: false,
        error: 'No run ID provided',
      });
    }
    
    try {
      // Try to get the job tracking record
      const jobRecord = await JobTracking.getJobById(runId, { 
        logger: createLogger('SYSTEM', runId, 'diagnostic-routes') 
      });
      
      if (jobRecord) {
        return res.status(200).json({
          success: true,
          exists: true,
          runId: runId,
          normalizedRunId: runIdSystem.normalizeRunId(runId, 'check-job-record-endpoint'),
          recordId: jobRecord.id,
          status: jobRecord.fields[JobTracking.JOB_TRACKING_FIELDS.STATUS],
          startTime: jobRecord.fields[JobTracking.JOB_TRACKING_FIELDS.START_TIME],
        });
      } else {
        return res.status(404).json({
          success: false,
          exists: false,
          runId: runId,
          error: `Job record not found for runId: ${runId}`
        });
      }
    } catch (error) {
      await logCriticalError(error, { 
        operation: 'check_job_record',
        runId: runId 
      }).catch(() => {});
      return res.status(400).json({
        success: false,
        error: error.message,
        runId: runId
      });
    }
  } catch (error) {
    console.error(`Error in check-job-record endpoint: ${error.message}`);
    await logCriticalError(error, req).catch(() => {});
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;