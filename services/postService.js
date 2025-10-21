// services/postService.js
// Removed old error logger - now using production issue tracking
const logCriticalError = async () => {};
// Service for managing LinkedIn posts in Airtable

// Import unified constants for field names
const { CLIENT_TABLES, POST_FIELDS, POST_MEDIA_TYPES, POST_TYPES } = require('../constants/airtableUnifiedConstants');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'system' });

/**
 * Create a new post record in the Posts table
 * @param {Object} clientBase - The Airtable base for the client
 * @param {Object} post - The post data to create
 * @returns {Promise<Object>} - The created Airtable record
 */
async function createPost(clientBase, post) {
  try {
    if (!clientBase) {
      throw new Error('Client base not provided');
    }

    if (!post || !post.url) {
      throw new Error('Invalid post data');
    }

    logger.info(`[postService] Creating post record for URL: ${post.url}`);

    // Check if post already exists
    const existingPosts = await clientBase(CLIENT_TABLES.LINKEDIN_POSTS).select({
      filterByFormula: `{${POST_FIELDS.URL}} = '${post.url.replace(/'/g, "\\'")}'`,
      maxRecords: 1
    }).firstPage();

    if (existingPosts && existingPosts.length > 0) {
      logger.info(`[postService] Post already exists: ${post.url}`);
      return existingPosts[0];
    }

    // Format the post data for Airtable
    const postRecord = {
      [POST_FIELDS.URL]: post.url,
      [POST_FIELDS.CONTENT]: post.text || '',
      [POST_FIELDS.AUTHOR_NAME]: post.authorName || '',
      [POST_FIELDS.AUTHOR_URL]: post.authorUrl || '',
      [POST_FIELDS.POSTED_AT]: post.timestamp || new Date().toISOString(),
      [POST_FIELDS.LIKE_COUNT]: post.likeCount || 0,
      [POST_FIELDS.COMMENT_COUNT]: post.commentCount || 0,
      [POST_FIELDS.MEDIA_TYPE]: post.mediaType || POST_MEDIA_TYPES.TEXT,
      [POST_FIELDS.POST_TYPE]: post.postType || POST_TYPES.REGULAR,
      [POST_FIELDS.RAW_DATA]: JSON.stringify(post.rawData || {})
    };

    // Create the record
    const records = await clientBase(CLIENT_TABLES.LINKEDIN_POSTS).create([{ fields: postRecord }]);
    logger.info(`[postService] Created post record ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    logger.error(`[postService] Error creating post: ${error.message}`);
    await logCriticalError(error, { context: 'Service error (before throw)', service: 'postService.js' }).catch(() => {});
    throw error;
  }
}

module.exports = {
  createPost
};