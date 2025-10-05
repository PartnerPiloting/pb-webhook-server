/**
 * services/postScoringMetricsHandler.js
 * 
 * Dedicated handler for post scoring metrics with proper error handling
 */

const { CLIENT_RUN_FIELDS } = require('../constants/airtableUnifiedConstants');
const runRecordAdapter = require('./runRecordAdapterSimple');
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');
const { safeGet } = require('../utils/safeAccess');
const RunIdValidator = require('./runIdValidator');

/**
 * Safely update post scoring metrics with comprehensive validation
 * This is a dedicated handler for post scoring metrics to ensure all updates
 * are validated and properly handled
 * 
 * @param {Object} params - Parameters object
 * @param {string} params.runId - The run ID
 * @param {string} params.clientId - The client ID
 * @param {Object} params.metrics - Metrics to update
 * @param {Object} [params.options] - Additional options
 * @returns {Promise<Object>} - Results of the update operation
 */
async function updatePostScoringMetrics(params) {
  // Input validation
  if (!params || typeof params !== 'object') {
    const error = new Error(`Invalid params: ${JSON.stringify(params)}`);
    console.error(`[PostScoringMetricsHandler] ${error.message}`);
    return { success: false, error: error.message };
  }

  const { runId, clientId, metrics, options = {} } = params;
  
  // Validate runId and clientId
  const validatedRunId = RunIdValidator.validateAndNormalize(runId, 'updatePostScoringMetrics');
  const validatedClientId = RunIdValidator.validateClientId(clientId, 'updatePostScoringMetrics');
  
  if (!validatedRunId || !validatedClientId) {
    const error = new Error(`Invalid parameters: runId=${JSON.stringify(runId)}, clientId=${JSON.stringify(clientId)}`);
    const logger = createSafeLogger('SYSTEM', String(runId), 'post_scoring');
    logger.error(`[PostScoringMetricsHandler] ${error.message}`);
    return { success: false, error: error.message };
  }
  
  // Create logger
  const logger = options.logger || createSafeLogger(validatedClientId, validatedRunId, 'post_scoring');
  
  try {
    // Validate metrics
    if (!metrics || typeof metrics !== 'object') {
      logger.error(`[PostScoringMetricsHandler] Invalid metrics object: ${JSON.stringify(metrics)}`);
      return { success: false, error: 'Invalid metrics object' };
    }
    
    // Create a clean metrics object with only valid fields
    const validMetrics = {
      // Always use field constants from the centralized fields file
      [CLIENT_RUN_FIELDS.POSTS_EXAMINED]: safeGet(metrics, 'postsExamined', 0),
      [CLIENT_RUN_FIELDS.POSTS_SCORED]: safeGet(metrics, 'postsScored', 0),
      [CLIENT_RUN_FIELDS.POST_SCORE_SUCCESS_RATE]: safeGet(metrics, 'successRate', 0),
      [CLIENT_RUN_FIELDS.POST_SCORING_TOKENS]: safeGet(metrics, 'tokensUsed', 0),
      [CLIENT_RUN_FIELDS.POST_SCORING_ERROR_COUNT]: safeGet(metrics, 'errorCount', 0)
    };
    
    // Only include system notes if they exist
    if (metrics.notes) {
      validMetrics[CLIENT_RUN_FIELDS.SYSTEM_NOTES] = String(metrics.notes);
    }
    
    logger.debug(`[PostScoringMetricsHandler] Updating post scoring metrics for run ${validatedRunId}, client ${validatedClientId}`);
    
    // Use the standard adapter to update metrics
    return await runRecordAdapter.safeUpdateMetrics({
      runId: validatedRunId,
      clientId: validatedClientId,
      processType: 'post_scoring',
      metrics: validMetrics,
      createIfMissing: false, // Never create records on metrics update
      options: {
        logger,
        source: 'post_scoring_handler'
      }
    });
  } catch (error) {
    logger.error(`[PostScoringMetricsHandler] Error updating post scoring metrics: ${error.message}`);
    return { 
      success: false, 
      error: error.message,
      runId: validatedRunId,
      clientId: validatedClientId
    };
  }
}

module.exports = {
  updatePostScoringMetrics
};