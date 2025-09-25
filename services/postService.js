// services/postService.js
// Service for managing LinkedIn posts in Airtable

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

    console.log(`[postService] Creating post record for URL: ${post.url}`);

    // Check if post already exists
    const existingPosts = await clientBase('Posts').select({
      filterByFormula: `{URL} = '${post.url.replace(/'/g, "\\'")}'`,
      maxRecords: 1
    }).firstPage();

    if (existingPosts && existingPosts.length > 0) {
      console.log(`[postService] Post already exists: ${post.url}`);
      return existingPosts[0];
    }

    // Format the post data for Airtable
    const postRecord = {
      'URL': post.url,
      'Content': post.text || '',
      'Author Name': post.authorName || '',
      'Author URL': post.authorUrl || '',
      'Posted At': post.timestamp || new Date().toISOString(),
      'Like Count': post.likeCount || 0,
      'Comment Count': post.commentCount || 0,
      'Media Type': post.mediaType || 'text',
      'Post Type': post.postType || 'regular',
      'Raw Data': JSON.stringify(post.rawData || {})
    };

    // Create the record
    const records = await clientBase('Posts').create([{ fields: postRecord }]);
    console.log(`[postService] Created post record ID: ${records[0].id}`);
    return records[0];
  } catch (error) {
    console.error(`[postService] Error creating post: ${error.message}`);
    throw error;
  }
}

module.exports = {
  createPost
};