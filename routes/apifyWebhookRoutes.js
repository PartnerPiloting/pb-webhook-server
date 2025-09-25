// routes/apifyWebhookRoutes.js
// Webhook endpoint for Apify actor runs that scrape LinkedIn profile posts.
// Secured with a Bearer token and requires x-client-id for multi-tenant routing.

const express = require('express');
const router = express.Router();
const dirtyJSON = require('dirty-json');
const syncPBPostsToAirtable = require('../utils/pbPostsSync');
const { getFetch } = require('../utils/safeFetch');
const fetchDynamic = getFetch();

// Multi-tenant base resolver
const { getClientBase } = require('../config/airtableClient');

// Apify runs service for multi-tenant webhook handling
const { getClientIdForRun, extractRunIdFromPayload, updateApifyRun } = require('../services/apifyRunsService');

// For direct client updates
const runIdService = require('../services/runIdService');
const airtableService = require('../services/airtableService');

// Constants for error handling
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Map Apify dataset items to PB post format
 * Handles different actor output formats
 */
function mapApifyItemsToPBPosts(items) {
  if (!items || !Array.isArray(items) || !items.length) {
    return [];
  }

  // Transform all items to our expected post shape
  return items.map(item => {
    // Extract the post info
    const post = item.post || item; // Some actors nest under 'post', others directly

    // Extract author info (could be different locations)
    const author = post.author || item.author || {};

    // Standardize the post data structure
    return {
      postUrl: post.postUrl || post.url || '',
      text: post.text || post.content || '',
      date: post.date || post.createdAt || '',
      profileName: author.name || post.authorName || '',
      profileUrl: author.profileUrl || author.url || post.authorUrl || '',
      likeCount: post.likeCount || post.likes || 0,
      commentCount: post.commentCount || post.comments || 0,
      media: post.media || []
    };
  }).filter(p => p.postUrl && p.text); // Ensure we have at minimum a URL and text
}

/**
 * Extract public ID from LinkedIn URL
 * @param {string} url - LinkedIn profile URL
 * @returns {string} - Public ID (username/vanity name)
 */
function extractLinkedInPublicId(url) {
  if (!url) return '';
  try {
    const urlObj = new URL(url);
    if (!urlObj.hostname.includes('linkedin.com')) return '';
    
    // Extract the path without leading/trailing slashes
    const path = urlObj.pathname.replace(/^\/+|\/+$/g, '');
    
    // Split the path and get the relevant parts
    const parts = path.split('/');
    if (parts.length >= 2 && ['in', 'company'].includes(parts[0])) {
      return parts[1]; // Return the identifier after in/ or company/
    }
    return '';
  } catch (e) {
    console.error(`Error extracting LinkedIn public ID from ${url}: ${e.message}`);
    return '';
  }
}

/**
 * Normalize LinkedIn profile URL to a consistent format for matching
 * Converts any LinkedIn profile URL to recent-activity format for better results
 * @param {string} url - Any LinkedIn profile URL
 * @returns {string} - Normalized LinkedIn URL in recent-activity format
 */
function normalizeLinkedInUrl(url) {
  if (!url) return '';
  try {
    const urlObj = new URL(url);
    if (!urlObj.hostname.includes('linkedin.com')) return url;
    
    // Extract the path without leading/trailing slashes
    const path = urlObj.pathname.replace(/^\/+|\/+$/g, '');
    
    // Split the path and get the relevant parts
    const parts = path.split('/');
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

    // Step 3: Extract posts from payload
    try {
      if (payload.resource && payload.resource.defaultDatasetId) {
        // Load from dataset API directly
        const datasetId = payload.resource.defaultDatasetId;
        console.log(`[ApifyWebhook] Loading dataset from Apify API: ${datasetId}`);
        
        const apiToken = process.env.APIFY_API_TOKEN;
        if (!apiToken) {
          throw new Error('Missing APIFY_API_TOKEN environment variable');
        }
        
        const url = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`;
        const resp = await fetchDynamic(url, {
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        });
        
        if (!resp.ok) {
          await updateApifyRun(runId, { 
            status: 'FAILED', 
            error: `API error: ${resp.status} ${resp.statusText}` 
          });
          throw new Error(`Apify API returned status ${resp.status} ${resp.statusText}`);
        }
        
        try {
          const text = await resp.text();
          try {
            const items = JSON.parse(text);
            posts = mapApifyItemsToPBPosts(items);
            console.log(`[ApifyWebhook] Loaded ${posts.length} posts from dataset API`);
          } catch (jsonError) {
            // Handle potential JSON parsing errors with dirty-json
            await updateApifyRun(runId, { 
              status: 'FAILED', 
              error: `JSON parse error: ${jsonError.message}` 
            });
            throw new Error(`Could not parse JSON from Apify API: ${jsonError.message}`);
          }
        } catch (textError) {
          throw new Error(`Failed to read response text: ${textError.message}`);
        }
      } else if (payload.data && payload.data.items) {
        // Handle direct items array in webhook payload
        const items = payload.data.items;
        posts = mapApifyItemsToPBPosts(items);
        console.log(`[ApifyWebhook] Loaded ${posts.length} posts from webhook payload`);
      } else if (typeof payload.data === 'string') {
        // Handle dirty JSON string that needs parsing
        try {
          const parsed = dirtyJSON.parse(payload.data);
          if (parsed && Array.isArray(parsed)) {
            posts = mapApifyItemsToPBPosts(parsed);
          } else if (parsed && parsed.items && Array.isArray(parsed.items)) {
            posts = mapApifyItemsToPBPosts(parsed.items);
          }
          console.log(`[ApifyWebhook] Loaded ${posts.length} posts from string payload`);
        } catch (parseError) {
          console.error(`[ApifyWebhook] Failed to parse string payload: ${parseError.message}`);
          throw new Error(`Could not parse payload string: ${parseError.message}`);
        }
      }

      if (!posts.length) {
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
        
        // Calculate an estimated API cost based on post count (rough estimate)
        const estimatedCost = posts.length * 0.02; // $0.02 per post - stored as a number, not a string
        
        // Update metrics in client's run record
        try {
            // Get the client run record to check existing values
            console.log(`[METDEBUG] Webhook checking for existing record: ${clientSuffixedRunId} for client ${clientId}`);
            const clientBase = await getClientBase(clientId);
            const runRecords = await clientBase('Client Run Results').select({
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
              // If record not found, create a new one with the current values
              console.log(`[DEBUG][METRICS_TRACKING] Webhook creating new record for ${clientSuffixedRunId}:`);
              console.log(`[DEBUG][METRICS_TRACKING] - Posts Harvested: ${posts.length}`);
              console.log(`[DEBUG][METRICS_TRACKING] - API Costs: ${estimatedCost}`);
              console.log(`[DEBUG][METRICS_TRACKING] - Profiles Submitted: ${posts.length}`);
              console.log(`[DEBUG][METRICS_TRACKING] - Apify Run ID: ${runId || '(empty)'}`);
              
              // Get the centralized metrics update function
              const { updateClientRunMetrics } = require('../services/apifyRunsService');
              
              // Create a new record with the centralized function
              await updateClientRunMetrics(runId, clientId, {
                postsCount: posts.length,
                profilesCount: posts.length
              });
              
              console.log(`[ApifyWebhook] Created/updated client run ${clientSuffixedRunId} record for ${clientId}:`);
              console.log(`  - Total Posts Harvested: ${posts.length}`);
              console.log(`  - Apify API Costs: ${estimatedCost}`);
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

// POST /api/apify-webhook
// Main webhook endpoint for Apify Actor runs
router.post('/api/apify-webhook', async (req, res) => {
  const auth = req.headers['authorization'];
  const secret = process.env.APIFY_WEBHOOK_TOKEN;

  if (!secret) {
    return res.status(500).json({ ok: false, error: 'Server missing APIFY_WEBHOOK_TOKEN' });
  }

  if (!auth || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const payload = req.body;
    // Extract the run ID from the payload
    const runId = extractRunIdFromPayload(payload);

    if (!runId) {
      return res.status(400).json({ ok: false, error: 'Missing runId in payload' });
    }

    // Immediately return success response to Apify
    res.status(200).json({ ok: true, received: true, runId });
    
    // Process in background to avoid webhook timeouts
    processWebhookInBackground(payload, runId).catch(e => {
      console.error(`[ApifyWebhook] Unhandled error in background processing: ${e.message}`, e.stack);
    });
  } catch (e) {
    console.error('[ApifyWebhook] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;