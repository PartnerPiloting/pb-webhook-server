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
    
    // Check for client ID in query parameters first
    const queryClientId = req.query.clientId || req.query.testClient;
    
    // For debugging
    // console.log('[ApifyWebhook] Received webhook:', JSON.stringify(payload, null, 2));
    
    // Extract run ID from payload
    const runId = extractRunIdFromPayload(payload);
    if (!runId) {
      console.error('[ApifyWebhook] No run ID found in payload');
      return res.status(400).json({ success: false, error: 'No run ID found in payload' });
    }
    
    // Log warning if no client ID in query params
    if (!queryClientId) {
      console.warn(`⚠️ [ApifyWebhook] No clientId provided in query parameters for run: ${runId}`);
      console.warn(`⚠️ [ApifyWebhook] Please update webhook URL to include ?clientId=CLIENT_ID`);
    } else {
      console.log(`[ApifyWebhook] Received webhook for run: ${runId}, clientId: ${queryClientId}`);
    }
    
    // Send immediate 200 response to avoid Apify retries
    res.status(200).json({ success: true, message: `Processing webhook for run ${runId}` });
    
    // Process the webhook in the background, passing query clientId if available
    processWebhookInBackground(payload, runId, queryClientId).catch(err => {
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
 * @param {string|null} queryClientId - Client ID from query parameters, if provided
 */
async function processWebhookInBackground(payload, runId, queryClientId = null) {
  let clientBase;
  let clientId;
  let posts = [];

  try {
    console.log(`[ApifyWebhook] Processing webhook for run ${runId} (background)`);
    
    // Step 1: Identify the client - prioritize query parameter if available
    if (queryClientId) {
      console.log(`[ApifyWebhook] Using client ID from query parameters: ${queryClientId}`);
      clientId = queryClientId;
    } else {
      // Step 1b: Fall back to run ID lookup
      clientId = await getClientIdForRun(runId);
      if (!clientId) {
        // Step 1c: Fall back to payload analysis as last resort
        console.log(`[ApifyWebhook] No client ID found for run ${runId}, trying payload analysis`);
        clientId = extractClientIdFromPayload(payload);
      }
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
        console.log(`[DEBUG][METRICS_TRACKING] Original runId from Apify: ${runId}`);
        console.log(`[DEBUG][METRICS_TRACKING] Normalized run ID: ${clientSuffixedRunId}`);
        
        // Enhanced debugging to trace where the record might be missing
        console.log(`[WEBHOOK_DEBUG] RECORD SEARCH DIAGNOSTICS:`);
        console.log(`[WEBHOOK_DEBUG] 1. Looking for run ID: ${clientSuffixedRunId}`);
        console.log(`[WEBHOOK_DEBUG] 2. Looking for client ID: ${clientId}`); 
        console.log(`[WEBHOOK_DEBUG] 3. Raw webhook runId format: ${runId}`);
        console.log(`[WEBHOOK_DEBUG] 4. Expected record would have been created by apifyProcessRoutes.js`);
        console.log(`[WEBHOOK_DEBUG] 5. Current timestamp for reference: ${new Date().toISOString()}`);
        
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
          
          // Check if this is part of an orchestrated flow by looking for parentRunId marker
          // For webhooks, we can check if the run was initiated as part of an orchestrated flow
          const apifyRunsService = require('../services/apifyRunsService');
          const runDetails = await apifyRunsService.getApifyRun(runId).catch(() => null);
          const isOrchestrated = runDetails?.meta?.parentRunId || false;
          
          if (isOrchestrated) {
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
            console.log(`[ApifyWebhook] Skipping metrics update for standalone run (no parentRunId found)`);
          }
        } else {
          // ERROR: Record not found - this should have been created at process kickoff
          const errorMsg = `ERROR: Client run record not found for ${clientSuffixedRunId} (${clientId})`;
          console.error(`[ApifyWebhook] ${errorMsg}`);
          console.error(`[ApifyWebhook] This indicates a process kickoff issue - run record should exist`);
          console.error(`[ApifyWebhook] Run ID: ${runId}, Client ID: ${clientId}`);
          console.error(`[ApifyWebhook] Posts count: ${posts.length}`);
          console.error(`[ApifyWebhook] IMPORTANT: Ensure webhook URL includes ?clientId=${clientId} parameter`);
          
          // Add enhanced debugging to help diagnose why the record wasn't found
          await debugRunRecordLookupFailure(clientId, clientSuffixedRunId, runId);
          
          // STRICT ENFORCEMENT: Do NOT attempt to create or update missing records
          console.error(`[ApifyWebhook] STRICT ENFORCEMENT: Skipping metrics update for missing record`);
          console.error(`[ApifyWebhook] This webhook data will not be recorded as requested`);
          
          // Log detailed diagnostics to help identify the root cause
          console.error(`[ApifyWebhook] Diagnostics for missing record:`);
          console.error(`[ApifyWebhook] - Standard run ID format: ${clientSuffixedRunId}`);
          console.error(`[ApifyWebhook] - Original Apify run ID: ${runId}`);
          console.error(`[ApifyWebhook] - Client ID: ${clientId}`);
          console.error(`[ApifyWebhook] - Posts processed: ${posts.length}`);
          console.error(`[ApifyWebhook] - Webhook received at: ${new Date().toISOString()}`);
          
          // Return without attempting any updates - as explicitly requested
          // Will rely on error logs for visibility
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

/**
 * Enhanced debugging function to help diagnose why a run record wasn't found
 * @param {string} clientId - The client ID
 * @param {string} clientSuffixedRunId - The run ID with client suffix
 * @param {string} originalRunId - The original run ID from the webhook
 */
async function debugRunRecordLookupFailure(clientId, clientSuffixedRunId, originalRunId) {
  try {
    console.log(`[DEBUG][RUN_RECORD_LOOKUP] Starting enhanced debugging for failed run record lookup`);
    console.log(`[DEBUG][RUN_RECORD_LOOKUP] Client ID: ${clientId}`);
    console.log(`[DEBUG][RUN_RECORD_LOOKUP] Client-suffixed Run ID: ${clientSuffixedRunId}`);
    console.log(`[DEBUG][RUN_RECORD_LOOKUP] Original Run ID: ${originalRunId}`);
    
    // Check if run ID normalization is working correctly
    const runIdService = require('../services/runIdService');
    const normalizedRunId = runIdService.normalizeRunId(originalRunId, clientId);
    console.log(`[DEBUG][RUN_RECORD_LOOKUP] Normalized Run ID: ${normalizedRunId}`);
    console.log(`[DEBUG][RUN_RECORD_LOOKUP] Expected format should match: ${clientSuffixedRunId}`);
    
    // Try to find any run records for this client
    try {
      const clientBase = await getClientBase(clientId);
      const recentRunRecords = await clientBase('Client Run Results').select({
        filterByFormula: `{Client ID} = '${clientId}'`,
        maxRecords: 5,
        sort: [{field: 'Created Time', direction: 'desc'}]
      }).firstPage();
      
      if (recentRunRecords && recentRunRecords.length > 0) {
        console.log(`[DEBUG][RUN_RECORD_LOOKUP] Found ${recentRunRecords.length} recent run records for client ${clientId}:`);
        recentRunRecords.forEach(record => {
          console.log(`[DEBUG][RUN_RECORD_LOOKUP] - Run ID: ${record.get('Run ID')}, Created: ${record.get('Created Time')}`);
        });
      } else {
        console.log(`[DEBUG][RUN_RECORD_LOOKUP] No recent run records found for client ${clientId}`);
      }
      
      // Try a wildcard search for similar run IDs
      const baseRunId = originalRunId.split('-').slice(0, 2).join('-');
      console.log(`[DEBUG][RUN_RECORD_LOOKUP] Searching for any run records with base ID: ${baseRunId}`);
      const similarRecords = await clientBase('Client Run Results').select({
        filterByFormula: `FIND('${baseRunId}', {Run ID})`,
        maxRecords: 5
      }).firstPage();
      
      if (similarRecords && similarRecords.length > 0) {
        console.log(`[DEBUG][RUN_RECORD_LOOKUP] Found ${similarRecords.length} similar run records with base ID ${baseRunId}:`);
        similarRecords.forEach(record => {
          console.log(`[DEBUG][RUN_RECORD_LOOKUP] - Run ID: ${record.get('Run ID')}, Client: ${record.get('Client ID')}`);
        });
      } else {
        console.log(`[DEBUG][RUN_RECORD_LOOKUP] No similar run records found with base ID ${baseRunId}`);
      }
      
    } catch (error) {
      console.error(`[DEBUG][RUN_RECORD_LOOKUP] Error during enhanced debugging: ${error.message}`);
    }
    
    console.log(`[DEBUG][RUN_RECORD_LOOKUP] Debugging complete - check webhook URL includes ?clientId=${clientId}`);
    
  } catch (debugError) {
    console.error(`[DEBUG][RUN_RECORD_LOOKUP] Error in debug function: ${debugError.message}`);
  }
}

// Routes
router.post('/', webhookLimiter, apifyWebhookHandler);
router.post('/apify-webhook', webhookLimiter, apifyWebhookHandler);

module.exports = router;