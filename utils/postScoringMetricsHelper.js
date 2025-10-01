/**
 * utils/postScoringMetricsHelper.js
 * 
 * Helper module for consistent post scoring metrics tracking.
 * Ensures consistent metrics calculation and tracking across all post scoring operations.
 */

const { createSafeLogger } = require('./loggerHelper');
const { CLIENT_RUN_RESULTS_FIELDS } = require('../constants/airtableFields');
const JobTracking = require('../services/jobTracking');

/**
 * Track post scoring metrics for a collection of posts
 * @param {Array} posts - Array of posts to score
 * @param {Function} scoringFunction - Async function that scores a post, returns {success, tokens}
 * @param {Object} options - Options object
 * @param {string} options.clientId - Client ID
 * @param {string} options.runId - Run ID
 * @param {string} options.source - Source of the scoring operation
 * @returns {Promise<Object>} - Object containing metrics
 */
async function trackPostScoringMetrics(posts, scoringFunction, options) {
  const { clientId, runId, source = 'post_scoring' } = options;
  const logger = createSafeLogger(clientId, runId, 'post_scoring_metrics');
  
  logger.debug(`Tracking metrics for ${posts.length} posts`);
  
  const metrics = {
    postsExamined: posts.length,
    postsScored: 0,
    tokensUsed: 0,
    errors: 0,
    errorDetails: []
  };
  
  // Process each post and accumulate metrics
  for (const post of posts) {
    try {
      const result = await scoringFunction(post);
      
      // Track successful scoring
      if (result.success) {
        metrics.postsScored++;
      }
      
      // Track tokens used
      if (result.tokens) {
        metrics.tokensUsed += result.tokens;
      }
      
    } catch (error) {
      metrics.errors++;
      metrics.errorDetails.push({
        postId: post.id || 'unknown',
        error: error.message
      });
      
      logger.error(`Error scoring post ${post.id || 'unknown'}: ${error.message}`);
    }
  }
  
  logger.info(`Post scoring metrics - Examined: ${metrics.postsExamined}, Scored: ${metrics.postsScored}, Tokens: ${metrics.tokensUsed}, Errors: ${metrics.errors}`);
  
  return metrics;
}

/**
 * Update Airtable client run record with post scoring metrics
 * @param {Object} metrics - Metrics object from trackPostScoringMetrics
 * @param {Object} options - Options object
 * @param {string} options.clientId - Client ID
 * @param {string} options.runId - Run ID
 * @param {string} options.source - Source of the update
 * @returns {Promise<Object>} - Result from JobTracking.updateClientMetrics
 */
async function updatePostScoringMetrics(metrics, options) {
  const { clientId, runId, source = 'post_scoring' } = options;
  const logger = createSafeLogger(clientId, runId, 'post_scoring_metrics');
  
  try {
    // Format metrics for Airtable update
    const airtableMetrics = {
      [CLIENT_RUN_RESULTS_FIELDS.POSTS_EXAMINED]: metrics.postsExamined,
      [CLIENT_RUN_RESULTS_FIELDS.POSTS_SCORED]: metrics.postsScored,
      [CLIENT_RUN_RESULTS_FIELDS.POST_SCORING_TOKENS]: metrics.tokensUsed,
    };
    
    // Add system notes
    const systemNotes = `Post scoring completed with ${metrics.postsScored}/${metrics.postsExamined} posts scored, ${metrics.errors} errors. Total tokens: ${metrics.tokensUsed}.`;
    airtableMetrics[CLIENT_RUN_RESULTS_FIELDS.SYSTEM_NOTES] = systemNotes;
    
    // If there are errors, add error details
    if (metrics.errors > 0 && metrics.errorDetails.length > 0) {
      const errorSummary = metrics.errorDetails
        .map(err => `Post ${err.postId}: ${err.error}`)
        .join('; ');
        
      airtableMetrics[CLIENT_RUN_RESULTS_FIELDS.POST_SCORING_ERRORS] = errorSummary;
    }
    
    logger.debug(`Updating run record with post scoring metrics`);
    
    // Update client metrics using JobTracking service
    return await JobTracking.updateClientMetrics({
      runId,
      clientId,
      metrics: airtableMetrics,
      options: {
        source,
        logger
      }
    });
  } catch (error) {
    logger.error(`Failed to update post scoring metrics: ${error.message}`);
    throw error;
  }
}

module.exports = {
  trackPostScoringMetrics,
  updatePostScoringMetrics
};