// routes/apifyWebhookRoutes.js
// Routes for handling Apify webhooks for post harvesting
// This is a clean, restored version that fixes syntax errors

const express = require('express');
const router = express.Router();
const { getClientBase } = require('../config/airtableClient');
const { getClientIdForRun, updateApifyRun, updateClientRunMetrics } = require('../services/apifyRunsService');
const { normalizeRunId } = require('../services/runIdService');
const runIdService = require('../services/runIdService');
const { createPost } = require('../services/postService');

// Rate limiting for webhook endpoints - TEMPORARILY DISABLED
// const rateLimit = require("express-rate-limit");
// const webhookLimiter = rateLimit({
//   windowMs: 1 * 60 * 1000, // 1 minute
//   max: 100, // Max 100 requests per minute per IP
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: "Too many webhook requests from this IP, please try again after a minute",
// });
const webhookLimiter = (req, res, next) => next(); // Dummy middleware that does nothing

// Initialize webhook handler
const apifyWebhookHandler = async (req, res) => {
  try {
    const payload = req.body;
    
    // For debugging
    // console.log('[ApifyWebhook] Received webhook:', JSON.stringify(payload, null, 2));
    
    // Extract run ID from payload
    const runId = extractRunIdFromPayload(payload);
    if (!runId) {
      console.error('[ApifyWebhook] No run ID found in payload');
      return res.status(400).json({ success: false, error: 'No run ID found in payload' });
    }
    
    console.log(`[ApifyWebhook] Received webhook for run: ${runId}`);
    
    // Send immediate 200 response to avoid Apify retries
    res.status(200).json({ success: true, message: `Processing webhook for run ${runId}` });
    
    // Process the webhook in the background
    processWebhookInBackground(payload, runId).catch(err => {
      console.error(`[ApifyWebhook] Unhandled error in background processing: ${err.message}`);
    });
    
  } catch (error) {
    console.error('[ApifyWebhook] Error processing webhook:', error.message);
    
    // If response not sent yet, send error
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
};

/**
 * Normalize LinkedIn profile URL to ensure consistent format
 * @param {string} url - The URL to normalize
 * @returns {string} - Normalized URL
 */
function normalizeLinkedInProfileURL(url) {
  try {
    if (!url) return '';
    
    // Remove query parameters
    const baseUrl = url.split('?')[0];
    
    // Remove trailing slash if present
    const cleanUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    
    // Parse the path components
    const parts = cleanUrl.split('/').filter(p => p);
    // Get the last two parts (usually 'in' and the profile ID)
    const lastParts = parts.slice(-2);
    
    if (parts.length >= 2 && ['in', 'company'].includes(parts[0])) {
      // Reconstruct in recent-activity format
      return `https://www.linkedin.com/${parts[0]}/${parts[1]}/recent-activity/all/`;
    }
    return url;
  } catch (e) {
    console.error(`Error normalizing LinkedIn URL ${url}: ${e.message}`);
    return url;
  }
}

/**
 * Process the webhook payload in the background
 * @param {Object} payload - The raw webhook payload
 * @param {string} runId - The Apify run ID
 */
async function processWebhookInBackground(payload, runId) {
  let clientBase;
  let clientId;
  let posts = [];

  try {
    console.log(`[ApifyWebhook] Processing webhook for run ${runId} (background)`);
    
    // Step 1: Identify the client from the run ID
    clientId = await getClientIdForRun(runId);
    if (!clientId) {
      // Fall back to payload analysis
      console.log(`[ApifyWebhook] No client ID found for run ${runId}, trying payload analysis`);
      clientId = extractClientIdFromPayload(payload);
    }

    if (!clientId) {
      console.error(`[ApifyWebhook] Could not determine client ID for run ${runId}`);
      await updateApifyRun(runId, { status: 'FAILED', error: 'No client ID found' });
      return;
    }

    console.log(`[ApifyWebhook] Webhook processing for client: ${clientId}`);

    // Step 2: Get the client's Airtable base
    try {
      clientBase = await getClientBase(clientId);
      if (!clientBase) {
        console.error(`[ApifyWebhook] Could not load Airtable base for client ${clientId}`);
        await updateApifyRun(runId, { status: 'FAILED', error: 'Client Airtable base not found' });
        return;
      }
    } catch (baseError) {
      console.error(`[ApifyWebhook] Error getting client base: ${baseError.message}`);
      await updateApifyRun(runId, { status: 'FAILED', error: `Base error: ${baseError.message}` });
      return;
    }

    // Step 3: Extract posts from the payload
    try {
      posts = extractPostsFromPayload(payload);
      
      if (!posts || posts.length === 0) {
        console.warn(`[ApifyWebhook] No posts found in webhook payload for run ${runId}`);
      }
    } catch (extractError) {
      console.error(`[ApifyWebhook] Error extracting posts: ${extractError.message}`);
      await updateApifyRun(runId, { status: 'FAILED', error: `Extract error: ${extractError.message}` });
      throw extractError;
    }

    // Step 4: Save posts to Airtable
    try {
      const result = await syncPBPostsToAirtable(posts, clientBase);
      console.log(`[ApifyWebhook] Saved ${result.success} posts to Airtable for client ${clientId}`);

      // Step 5: Update run status to success
      await updateApifyRun(runId, { status: 'SUCCEEDED' });
      
      // Step 6: Update metrics tracking
      try {
        // Generate a standardized run ID with client suffix for tracking
        const clientSuffixedRunId = runIdService.normalizeRunId(runId, clientId);
        console.log(`[DEBUG][METRICS_TRACKING] Webhook tracking for run: ${clientSuffixedRunId} (${clientId})`);
        
        // NOTE: We expect the run record to already exist
        // It should have been created when the process was kicked off
        // If it doesn't exist, that's an error we want to see in the logs
        
        // Calculate an estimated API cost based on post count (rough estimate)
        const estimatedCost = posts.length * 0.02; // $0.02 per post - stored as a number, not a string
        
        // Update metrics in client's run record
        // Get the client run record to check existing values
        console.log(`[METDEBUG] Webhook checking for existing record: ${clientSuffixedRunId} for client ${clientId}`);
        const metricsClientBase = await getClientBase(clientId);
        const runRecords = await metricsClientBase('Client Run Results').select({
          filterByFormula: `{Run ID} = '${clientSuffixedRunId}'`,
          maxRecords: 1
        }).firstPage();
        
        if (runRecords && runRecords.length > 0) {
          // Get current counts, default to 0 if not set
          const currentRecord = runRecords[0];
          const currentPostCount = Number(currentRecord.get('Total Posts Harvested') || 0);
          const currentApiCosts = Number(currentRecord.get('Apify API Costs') || 0);
          const profilesSubmittedCount = Number(currentRecord.get('Profiles Submitted for Post Harvesting') || 0);
          const currentApifyRunId = currentRecord.get('Apify Run ID');
          
          console.log(`[DEBUG][METRICS_TRACKING] Webhook found existing record for ${clientSuffixedRunId}:`);
          console.log(`[DEBUG][METRICS_TRACKING] - Current Posts Harvested: ${currentPostCount}`);
          console.log(`[DEBUG][METRICS_TRACKING] - Current API Costs: ${currentApiCosts}`);
          console.log(`[DEBUG][METRICS_TRACKING] - Current Profiles Submitted: ${profilesSubmittedCount}`);
          console.log(`[DEBUG][METRICS_TRACKING] - Current Apify Run ID: ${currentApifyRunId || '(empty)'}`);
          console.log(`[DEBUG][METRICS_TRACKING] - New posts.length value: ${posts.length}`);
          console.log(`[DEBUG][METRICS_TRACKING] - New runId value: ${runId}`);
          
          // Use the higher count (in case we're processing multiple batches)
          const updatedCount = Math.max(currentPostCount, posts.length);
          // Add to API costs
          const updatedCosts = currentApiCosts + estimatedCost;
          
          console.log(`[DEBUG][METRICS_TRACKING] - Updated values to save:`);
          console.log(`[DEBUG][METRICS_TRACKING] - Posts Harvested: ${updatedCount}`);
          console.log(`[DEBUG][METRICS_TRACKING] - API Costs: ${updatedCosts}`);
          
          // Get the centralized metrics update function
          const { updateClientRunMetrics } = require('../services/apifyRunsService');
          
          // Update metrics using the centralized function with custom values
          // that preserve the existing logic specific to webhook handling
          await updateClientRunMetrics(runId, clientId, {
            postsCount: updatedCount,  // Use the max of current and new
            profilesCount: Math.max(profilesSubmittedCount, posts.length)  // Use the max
          });
          
          console.log(`[ApifyWebhook] Updated client run ${clientSuffixedRunId} record for ${clientId}:`);
          console.log(`  - Total Posts Harvested: ${currentPostCount} → ${updatedCount}`);
          console.log(`  - Apify API Costs: ${currentApiCosts} → ${updatedCosts}`);
        } else {
          // ERROR: Record not found - this should have been created at process kickoff
          const errorMsg = `ERROR: Client run record not found for ${clientSuffixedRunId} (${clientId})`;
          console.error(`[ApifyWebhook] ${errorMsg}`);
          console.error(`[ApifyWebhook] This indicates a process kickoff issue - run record should exist`);
          console.error(`[ApifyWebhook] Run ID: ${runId}, Client ID: ${clientId}`);
          console.error(`[ApifyWebhook] Posts count: ${posts.length}`);
          
          // We still need to try to update metrics for operational continuity
          // but we'll log it as an error
          try {
            // Get the centralized metrics update function
            const { updateClientRunMetrics } = require('../services/apifyRunsService');
            
            // Update metrics despite the missing record
            await updateClientRunMetrics(runId, clientId, {
              postsCount: posts.length,
              profilesCount: posts.length
            });
            
            console.log(`[ApifyWebhook] Attempted metrics update despite missing run record`);
            console.log(`  - Total Posts Harvested: ${posts.length}`);
          } catch (metricsError) {
            console.error(`[ApifyWebhook] Failed to update metrics: ${metricsError.message}`);
          }
        }
      } catch (metricError) {
        console.error(`[ApifyWebhook] Failed to update post harvesting metrics: ${metricError.message}`);
        console.error(`[DEBUG][METRICS_TRACKING] ERROR updating webhook metrics: ${metricError.message}`);
        console.error(`[DEBUG][METRICS_TRACKING] Error stack: ${metricError.stack}`);
        console.error(`[DEBUG][METRICS_TRACKING] Client ID: ${clientId}, Run ID: ${clientSuffixedRunId || '(none)'}`);
        console.error(`[DEBUG][METRICS_TRACKING] Posts length: ${posts ? posts.length : 0}`);
        // Continue execution even if metrics update fails
      }
    } catch (e) {
      console.error('[ApifyWebhook] Background processing error:', e.message);
      // Update run status to failed
      try {
        await updateApifyRun(runId, { 
          status: 'FAILED', 
          error: `Processing failed: ${e.message}` 
        });
      } catch (updateError) {
        console.error(`[ApifyWebhook] Error updating run status: ${updateError.message}`);
      }
    }
  } catch (outerError) {
    console.error(`[ApifyWebhook] Fatal error processing webhook: ${outerError.message}`);
    try {
      await updateApifyRun(runId, { 
        status: 'FAILED', 
        error: `Fatal error: ${outerError.message}` 
      });
    } catch (updateError) {
      console.error(`[ApifyWebhook] Error updating run status: ${updateError.message}`);
    }
  }
}

/**
 * Extract client ID from webhook payload
 * This is a fallback method when the run ID lookup fails
 * @param {Object} payload - The webhook payload
 * @returns {string|null} - Client ID if found, null otherwise
 */
function extractClientIdFromPayload(payload) {
  try {
    // Check if client ID is in resource.meta.clientId (our custom field)
    if (payload.resource && payload.resource.meta && payload.resource.meta.clientId) {
      return payload.resource.meta.clientId;
    }

    // For backwards compatibility, check for client in resource.defaultKeyValueStoreId
    if (payload.resource && payload.resource.defaultKeyValueStoreId) {
      const storeId = payload.resource.defaultKeyValueStoreId;
      // Some old runs might have client ID encoded in KVS ID
      if (storeId.includes('-client-')) {
        const parts = storeId.split('-client-');
        if (parts.length > 1) {
          return parts[1];
        }
      }
    }

    return null;
  } catch (e) {
    console.error(`[ApifyWebhook] Error extracting client ID from payload: ${e.message}`);
    return null;
  }
}

/**
 * Extract posts from the webhook payload
 * @param {Object} payload - The webhook payload
 * @returns {Array} - Array of post objects
 */
function extractPostsFromPayload(payload) {
  try {
    if (!payload || !payload.data) {
      return [];
    }

    // Normalize the data structure based on different payload formats
    let postsData = payload.data;
    
    // If it's an object with 'items', use that
    if (postsData.items && Array.isArray(postsData.items)) {
      postsData = postsData.items;
    }
    
    // If it's still not an array, try to find posts another way
    if (!Array.isArray(postsData)) {
      console.warn('[ApifyWebhook] Data is not an array, trying to find posts');
      
      // Look for posts in common locations
      if (payload.resource && payload.resource.defaultDatasetId) {
        const datasetId = payload.resource.defaultDatasetId;
        console.log(`[ApifyWebhook] Found dataset ID: ${datasetId}`);
        // We would need to fetch from Apify API here, but that's async
        // For now, return empty and let the client retry later
        return [];
      }
      
      // If we can't find posts, return empty array
      return [];
    }
    
    console.log(`[ApifyWebhook] Found ${postsData.length} posts in payload`);
    
    // Process and normalize post data
    const processedPosts = postsData.map(post => {
      // Skip if not a proper post or missing URL
      if (!post || !post.url) {
        return null;
      }
      
      // Normalize the post object
      return {
        url: post.url,
        text: post.text || '',
        authorName: post.authorName || '',
        authorUrl: post.authorUrl ? normalizeLinkedInProfileURL(post.authorUrl) : '',
        timestamp: post.timestamp || new Date().toISOString(),
        likeCount: post.likeCount || 0,
        commentCount: post.commentCount || 0,
        mediaType: post.mediaType || 'text',
        postType: post.postType || 'regular',
        rawData: post
      };
    }).filter(Boolean); // Remove nulls
    
    return processedPosts;
  } catch (error) {
    console.error('[ApifyWebhook] Error extracting posts:', error.message);
    return [];
  }
}

/**
 * Synchronize posts from Apify to Airtable
 * @param {Array} posts - Array of post objects
 * @param {Object} clientBase - Airtable base for the client
 * @returns {Object} - Result of the sync operation
 */
async function syncPBPostsToAirtable(posts, clientBase) {
  try {
    if (!posts || posts.length === 0) {
      return { success: 0, failed: 0 };
    }

    console.log(`[ApifyWebhook] Syncing ${posts.length} posts to Airtable`);
    
    // Process each post
    const results = await Promise.all(posts.map(async post => {
      try {
        await createPost(clientBase, post);
        return { success: true };
      } catch (error) {
        console.error(`[ApifyWebhook] Error saving post ${post.url}: ${error.message}`);
        return { success: false, error: error.message };
      }
    }));
    
    // Count successful and failed operations
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;
    
    console.log(`[ApifyWebhook] Sync complete: ${successCount} succeeded, ${failedCount} failed`);
    
    return {
      success: successCount,
      failed: failedCount
    };
  } catch (error) {
    console.error('[ApifyWebhook] Error syncing posts to Airtable:', error.message);
    throw error;
  }
}

/**
 * Extract run ID from webhook payload
 * @param {Object} body - Webhook payload body
 * @returns {string|null} Run ID or null if not found
 */
function extractRunIdFromPayload(body) {
  try {
    if (!body) return null;
    
    // Common Apify webhook payload shapes:
    // - { resource: { id: 'runId' }, ... }
    // - { runId: 'runId' }
    // - { id: 'runId' }
    
    if (typeof body === 'string') {
      try { 
        body = JSON.parse(body); 
      } catch { 
        return null; 
      }
    }
    
    if (body && typeof body === 'object') {
      if (body.resource && body.resource.id) return body.resource.id;
      if (body.runId) return body.runId;
      if (body.id) return body.id;
    }
    
    return null;
  } catch (error) {
    console.error('[ApifyWebhook] Error extracting run ID from payload:', error.message);
    return null;
  }
}

// Routes
router.post('/', webhookLimiter, apifyWebhookHandler);
router.post('/apify-webhook', webhookLimiter, apifyWebhookHandler);

module.exports = router;