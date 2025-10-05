/**
 * utils/postScoringMetricsHelper.js
 * 
 * Helper module for consistent post scoring metrics tracking.
 * Ensures consistent metrics calculation and tracking across all post scoring operations.
 */

const { createSafeLogger } = require('./loggerHelper');
const { CLIENT_RUN_FIELDS } = require('../constants/airtableUnifiedConstants');
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
 * @param {Object} params - Update parameters
 * @returns {Promise<Object>} - Update result
 */
async function updatePostScoringMetrics(params) {
  const { runId, clientId, metrics, logger: customLogger } = params;
  const logger = customLogger || createSafeLogger(clientId, runId, 'post_scoring_metrics');
  
  try {
    // Format metrics for Airtable update using direct field names
    // This is safer than using constants since it matches exactly what's in Airtable
    const airtableMetrics = {
      'Posts Examined for Scoring': metrics.postsExamined || 0,
      'Posts Successfully Scored': metrics.postsScored || 0,
      'Post Scoring Tokens': metrics.tokensUsed || 0
    };
    
    // Add system notes
    const systemNotes = `Post scoring completed with ${metrics.postsScored || 0}/${metrics.postsExamined || 0} posts scored, ${metrics.errors || 0} errors. Total tokens: ${metrics.tokensUsed || 0}.`;
    
    if (metrics.errors && metrics.errors > 0) {
      // Add error details if any
      const errorDetails = metrics.errorDetails && metrics.errorDetails.length > 0 
        ? metrics.errorDetails.slice(0, 3).map(e => e.error || e.message || 'Unknown error').join(', ')
        : 'No error details available';
      
      airtableMetrics['System Notes'] = `${systemNotes} Errors: ${errorDetails}${metrics.errorDetails && metrics.errorDetails.length > 3 ? ' (and more)' : ''}`;
      
      // Add specific error field if available
      if (metrics.errorDetails && metrics.errorDetails.length > 0) {
        airtableMetrics['Post Scoring Errors'] = metrics.errorDetails
          .slice(0, 10)
          .map(err => `Post ${err.postId || 'unknown'}: ${err.error || err.message || 'Unknown error'}`)
          .join('; ');
      }
    } else {
      airtableMetrics['System Notes'] = systemNotes;
    }
    
    logger.info(`Updating post scoring metrics - Examined: ${airtableMetrics['Posts Examined for Scoring']}, Scored: ${airtableMetrics['Posts Successfully Scored']}, Tokens: ${airtableMetrics['Post Scoring Tokens']}`);
    
    // Update using JobTracking service
    const JobTracking = require('../services/jobTracking');
    const result = await JobTracking.updateClientMetrics({
      runId,
      clientId,
      metrics: airtableMetrics,
      options: {
        source: 'post_scoring',
        logger
      }
    });
    
    return {
      success: true,
      Status: 'success',
      result
    };
  } catch (error) {
    logger.error(`Failed to update post scoring metrics: ${error.message}`);
    return {
      success: false,
      Status: 'error',
      error: error.message
    };
  }
}

module.exports = {
  trackPostScoringMetrics,
  updatePostScoringMetrics
};