// routes/apifyWebhookRoutes.js
// Webhook endpoint for Apify actor runs that scrape LinkedIn profile posts.
// Secured with a Bearer token and requires x-client-id for multi-tenant routing.

const express = require('express');
const router = express.Router();
const dirtyJSON = require('dirty-json');
con            // First get the current count to avoid overwriting with a lower count
            try {
              // Get the client run record to check existing post count
              const clientBase = await getClientBase(clientId);
              const runRecords = await clientBase('Client Run Results').select({
                filterByFormula: `{Run ID} = '${clientSuffixedRunId}'`,
                maxRecords: 1
              }).firstPage();
              
              if (runRecords && runRecords.length > 0) {
                // Get current count, default to 0 if not set
                const currentCount = Number(runRecords[0].get('Total Posts Harvested') || 0);
                // Use the higher of current count or new posts.length
                const updatedCount = Math.max(currentCount, posts.length);
                
                await airtableService.updateClientRun(clientSuffixedRunId, clientId, {
                  'Total Posts Harvested': updatedCount
                });
                
                console.log(`[ApifyWebhook] Updated client run ${clientSuffixedRunId} record for ${clientId}: ${currentCount} → ${updatedCount} posts harvested`);
              } else {
                // If record not found, create a new one with the current count
                await airtableService.updateClientRun(clientSuffixedRunId, clientId, {
                  'Total Posts Harvested': posts.length
                });
                console.log(`[ApifyWebhook] Created/updated client run ${clientSuffixedRunId} record for ${clientId} with ${posts.length} posts harvested`);
              }
            } catch (recordError) {
              // Fall back to simple update if record lookup fails
              console.warn(`[ApifyWebhook] Failed to check existing record, using simple update: ${recordError.message}`);
              await airtableService.updateClientRun(clientSuffixedRunId, clientId, {
                'Total Posts Harvested': posts.length
              });
              console.log(`[ApifyWebhook] Updated client run ${clientSuffixedRunId} record for ${clientId} with ${posts.length} posts harvested`);
            }yncPBPostsToAirtable = require('../utils/pbPostsSync');
const { getFetch } = require('../utils/safeFetch');
const fetchDynamic = getFetch();

// Multi-tenant base resolver
const { getClientBase } = require('../config/airtableClient');

// Apify runs service for multi-tenant webhook handling
const { getClientIdForRun, extractRunIdFromPayload, updateApifyRun } = require('../services/apifyRunsService');
const runIdService = require('../services/runIdService');
const runIdUtils = require('../utils/runIdUtils');

// Helper: normalize LinkedIn profile URL from author input (string or object)
function toProfileUrl(author) {
  try {
    if (!author) return null;
    if (typeof author === 'string') {
      if (author.startsWith('http')) return author.replace(/\/$/, '');
      // Sometimes just the publicIdentifier is provided
      return `https://www.linkedin.com/in/${author.replace(/\/$/, '')}`;
    }
    if (typeof author === 'object') {
      if (author.url && typeof author.url === 'string') return author.url.replace(/\/$/, '');
      if (author.linkedinUrl && typeof author.linkedinUrl === 'string') return author.linkedinUrl.replace(/\/$/, '');
      if (author.publicIdentifier && typeof author.publicIdentifier === 'string') {
        return `https://www.linkedin.com/in/${author.publicIdentifier.replace(/\/$/, '')}`;
      }
    }
  } catch {}
  return null;
}

// Helper: robustly parse/normalize Apify webhook payload body (dataset id discovery)
function extractDatasetId(body) {
  if (!body) return null;
  // Common Apify webhook payload shapes
  // - { resource: { defaultDatasetId: 'xxxx' }, ... }
  // - { datasetId: 'xxxx' }
  // - { detail: { datasetId: 'xxxx' } }
  // - direct stringified JSON
  try {
    if (typeof body === 'string') {
      try { body = JSON.parse(body); }
      catch { try { body = dirtyJSON.parse(body); } catch { /* keep as string */ } }
    }
    if (body && typeof body === 'object') {
      if (body.resource && body.resource.defaultDatasetId) return body.resource.defaultDatasetId;
      if (body.datasetId) return body.datasetId;
      if (body.detail && body.detail.datasetId) return body.detail.datasetId;
    }
  } catch {}
  return null;
}

// Transform Apify dataset items into the PB posts input shape used by syncPBPostsToAirtable
function mapApifyItemsToPBPosts(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue;
    
    try {
      const p = it.post || {};
      const originalAuthorUrl = toProfileUrl(it.author || it.profileUrl || it.profile || it.authorUrl || it.authorProfileUrl || p.author)
        || (p.profileUrl || null);
      const postUrl = it.url || it.postUrl || it.shareUrl || it.link || it.linkedinUrl || p.url || p.postUrl || null;
      const postContent = it.text || it.content || it.caption || it.title || it.body || p.text || p.content || '';
      
      let postTimestamp = it.publishedAt || it.time || it.date || it.createdAt || p.publishedAt || p.time || p.date || p.createdAt || null;
      if (!postTimestamp && it.postedAt) {
        if (typeof it.postedAt === 'object') {
          postTimestamp = it.postedAt.timestamp || it.postedAt.date || null;
        } else if (typeof it.postedAt === 'string') {
          postTimestamp = it.postedAt;
        }
      }
      
      const engagement = it.engagement || p.engagement || {};
      const likeCount = engagement.likes ?? engagement.reactions ?? it.likes ?? null;
      const commentCount = engagement.comments ?? it.comments ?? null;
      const repostCount = engagement.shares ?? it.shares ?? null;
      const imgUrl = (Array.isArray(it.postImages) && it.postImages.length ? (it.postImages[0].url || it.postImages[0]) : null)
        || (Array.isArray(it.images) && it.images.length ? it.images[0] : null)
        || (Array.isArray(p.images) && p.images.length ? p.images[0] : null);

      if (!originalAuthorUrl || !postUrl) continue;

      // Determine origin label for UI/processing clarity
      const isRepost = (String(it.postType || it.type || '').toLowerCase().includes('repost'));
      const originLabel = isRepost
        ? `REPOST - ORIGINAL AUTHOR: ${originalAuthorUrl || '(unknown) '}`.trim()
        : 'ORIGINAL';

      out.push({
        profileUrl: originalAuthorUrl,
        postUrl,
        postContent,
        postTimestamp,
        timestamp: new Date().toISOString(),
        type: it.postType || it.type || 'post',
        imgUrl,
        author: (typeof it.author === 'object' ? it.author?.name : null) || null,
        authorUrl: originalAuthorUrl,
        likeCount,
        commentCount,
        repostCount,
        action: 'apify_ingest',
        pbMeta: {
          authorUrl: originalAuthorUrl,
          authorName: (typeof it.author === 'object' ? it.author?.name : null) || null,
          action: (it.postType || it.type || 'post'),
          originLabel
        }
      });
    } catch (error) {
      console.warn(`[ApifyWebhook] Error processing item ${i}: ${error.message}`);
    }
  }
  
  return out;
}

// POST /api/apify-webhook
// Header requirements:
//   Authorization: Bearer <APIFY_WEBHOOK_TOKEN>
//   x-client-id: <ClientId>

// GET handler for webhook endpoint testing (Apify uses GET requests to test webhook availability)
router.get('/api/apify-webhook', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  res.status(200).json({ 
    success: true,
    message: 'Apify webhook endpoint is accessible',
    method: 'GET',
    timestamp: new Date().toISOString(),
    status: 'ready'
  });
});

router.post('/api/apify-webhook', async (req, res) => {
  try {
    // Auth check
    const auth = req.headers['authorization'];
    const expected = process.env.APIFY_WEBHOOK_TOKEN;
    if (!expected) {
      return res.status(500).json({ error: 'Server not configured: APIFY_WEBHOOK_TOKEN missing' });
    }
    if (!auth || auth !== `Bearer ${expected}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Extract run ID from webhook payload for multi-tenant lookup
    const runId = extractRunIdFromPayload(req.body);
    if (!runId) {
      return res.status(400).json({ error: 'Missing run ID in webhook payload' });
    }

    // Get client ID for this run
    let clientId = await getClientIdForRun(runId);
    // Optional test override via query param (non-production only)
    if (!clientId) {
      const override = req.query.client || req.query.clientId;
      if (override && process.env.NODE_ENV !== 'production') {
        clientId = override;
        console.warn(`[ApifyWebhook] Using non-production client override from query: ${clientId}`);
      }
    }
    if (!clientId) {
      return res.status(404).json({ error: `No client mapping found for run: ${runId}` });
    }

    console.log(`[ApifyWebhook] Processing webhook for run ${runId} -> client ${clientId}`);

    // Get client base using the mapped client ID
    let clientBase;
    try {
      clientBase = await getClientBase(clientId);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid client', details: e.message });
    }
    if (!clientBase) {
      return res.status(503).json({ error: 'Client base unavailable' });
    }

    // Discover dataset id
    const datasetId = extractDatasetId(req.body);
    if (!datasetId) {
      // If actor posts items directly (rare), accept payload.items
      const items = (req.body && Array.isArray(req.body.items)) ? req.body.items : [];
      if (!items.length) {
        return res.status(400).json({ error: 'Missing datasetId in payload and no inline items' });
      }
      // Inline items flow – transform and sync now
      const posts = mapApifyItemsToPBPosts(items);
      if (!posts.length) return res.json({ ok: true, message: 'No valid posts', items: items.length });
      const result = await syncPBPostsToAirtable(posts, clientBase);
      
      // Update run status
      try {
        await updateApifyRun(runId, { status: 'SUCCEEDED' });
      } catch (updateError) {
        console.warn(`[ApifyWebhook] Failed to update run status for ${runId}:`, updateError.message);
      }
      
      return res.json({ ok: true, mode: 'inline', result });
    }

    // Update run status with dataset ID
    try {
      await updateApifyRun(runId, { 
        status: 'SUCCEEDED', 
        datasetId: datasetId 
      });
    } catch (updateError) {
      console.warn(`[ApifyWebhook] Failed to update run status for ${runId}:`, updateError.message);
    }

    // Fetch items from Apify dataset
    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) {
      return res.status(500).json({ error: 'Server not configured: APIFY_API_TOKEN missing' });
    }

    // Quick ack before fetch to keep webhook latency low
    res.status(200).json({ ok: true, mode: 'dataset', runId, clientId, datasetId });

    // Background processing with error handling
    (async () => {
      try {
        const url = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true`;
        const resp = await fetchDynamic(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        
        if (!resp.ok) {
          console.error('[ApifyWebhook] Failed to fetch dataset items', datasetId, resp.status);
          // Update run status to failed
          try {
            await updateApifyRun(runId, { 
              status: 'FAILED', 
              error: `Failed to fetch dataset: ${resp.status}` 
            });
          } catch (updateError) {
            console.warn(`[ApifyWebhook] Failed to update run status for ${runId}:`, updateError.message);
          }
          return;
        }
        
        // Use dirty-json for safer parsing
        let raw;
        try {
          const text = await resp.text();
          try {
            raw = JSON.parse(text);
          } catch (jsonError) {
            raw = dirtyJSON.parse(text);
          }
        } catch (parseError) {
          console.error('[ApifyWebhook] JSON parsing failed:', parseError.message);
          // Update run status to failed
          try {
            await updateApifyRun(runId, { 
              status: 'FAILED', 
              error: `JSON parsing failed: ${parseError.message}` 
            });
          } catch (updateError) {
            console.warn(`[ApifyWebhook] Failed to update run status for ${runId}:`, updateError.message);
          }
          return;
        }
        
        const items = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : (Array.isArray(raw.data) ? raw.data : []));
        
        console.log(`[ApifyWebhook] Dataset ${datasetId} fetched. ${items.length} items found for client ${clientId}`);
        
        const posts = mapApifyItemsToPBPosts(items);
        
        if (!posts.length) {
          console.log(`[ApifyWebhook] No valid posts mapped from dataset ${datasetId} for client ${clientId}`);
          return;
        }
        
        const result = await syncPBPostsToAirtable(posts, clientBase);
        console.log(`[ApifyWebhook] Successfully synced ${posts.length} posts from dataset ${datasetId} for client ${clientId}`);
        
        // Update client run record with post harvesting metrics if we have a run ID
        try {
          const airtableService = require('../services/airtableService');
          
          // Try to update client run record with posts harvested
          if (runId) {
            // Create client-suffixed run ID if it doesn't already have the suffix
            const clientSuffixedRunId = runIdUtils.hasSpecificClientSuffix(runId, clientId) 
              ? runId 
              : `${runId}-${clientId}`;
            console.log(`[ApifyWebhook] Using client-suffixed run ID: ${clientSuffixedRunId} (from ${runId})`);
            
            // Calculate estimated API costs (based on LinkedIn post queries)
            const estimatedCost = (posts.length * 0.02).toFixed(2); // $0.02 per post as estimate
            
            // Get the client run record to check existing values
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
              
              // Use the higher count (in case we're processing multiple batches)
              const updatedCount = Math.max(currentPostCount, posts.length);
              // Add to API costs
              const updatedCosts = currentApiCosts + Number(estimatedCost);
              
              // Update the record with all relevant fields
              await airtableService.updateClientRun(clientSuffixedRunId, clientId, {
                'Total Posts Harvested': updatedCount,
                'Apify API Costs': updatedCosts,
                'Profiles Submitted for Post Harvesting': Math.max(profilesSubmittedCount, posts.length) // Update if higher
              });
              
              console.log(`[ApifyWebhook] Updated client run ${clientSuffixedRunId} record for ${clientId}:`);
              console.log(`  - Total Posts Harvested: ${currentPostCount} → ${updatedCount}`);
              console.log(`  - Apify API Costs: ${currentApiCosts} → ${updatedCosts}`);
            } else {
              // If record not found, create a new one with the current values
              await airtableService.updateClientRun(clientSuffixedRunId, clientId, {
                'Total Posts Harvested': posts.length,
                'Apify API Costs': estimatedCost,
                'Profiles Submitted for Post Harvesting': posts.length
              });
              
              console.log(`[ApifyWebhook] Created/updated client run ${clientSuffixedRunId} record for ${clientId}:`);
              console.log(`  - Total Posts Harvested: ${posts.length}`);
              console.log(`  - Apify API Costs: ${estimatedCost}`);
            }
          }
        } catch (metricError) {
          console.error(`[ApifyWebhook] Failed to update post harvesting metrics: ${metricError.message}`);
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
          console.warn(`[ApifyWebhook] Failed to update run status for ${runId}:`, updateError.message);
        }
      }
    })();
  } catch (e) {
    console.error('[ApifyWebhook] Handler error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// Development-only debug endpoint to verify webhook env is loaded
if (process.env.NODE_ENV === 'development') {
  router.get('/api/_debug/apify-webhook-config', (req, res) => {
    const hasToken = Boolean(process.env.APIFY_WEBHOOK_TOKEN);
    const hasApiToken = Boolean(process.env.APIFY_API_TOKEN);
    return res.json({
      ok: true,
      env: {
        APIFY_WEBHOOK_TOKEN: hasToken ? 'present' : 'missing',
        APIFY_API_TOKEN: hasApiToken ? 'present' : 'missing'
      }
    });
  });
}

module.exports = router;
