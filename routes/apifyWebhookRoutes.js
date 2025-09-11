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
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    try {
      const profileUrl = toProfileUrl(it.author || it.profileUrl || it.profile) || it.authorUrl || null;
      const postUrl = it.url || it.postUrl || it.shareUrl || it.link || it.linkedinUrl || null;
      const postContent = it.text || it.content || it.caption || it.title || it.body || '';
      // postedAt may be in various fields or object
      let postTimestamp = it.publishedAt || it.time || it.date || it.createdAt || null;
      if (!postTimestamp && it.postedAt) {
        if (typeof it.postedAt === 'object') {
          postTimestamp = it.postedAt.timestamp || it.postedAt.date || null;
        } else if (typeof it.postedAt === 'string') {
          postTimestamp = it.postedAt;
        }
      }
      // Engagement mapping (if present)
      const engagement = it.engagement || {};
      const likeCount = engagement.likes ?? engagement.reactions ?? it.likes ?? null;
      const commentCount = engagement.comments ?? it.comments ?? null;
      const repostCount = engagement.shares ?? it.shares ?? null;
      const imgUrl = Array.isArray(it.postImages) && it.postImages.length ? (it.postImages[0].url || it.postImages[0]) : (Array.isArray(it.images) && it.images.length ? it.images[0] : null);

      if (!profileUrl || !postUrl) continue; // minimal contract

      out.push({
        profileUrl,
        postUrl,
        postContent,
        postTimestamp,
        timestamp: new Date().toISOString(),
        type: it.postType || it.type || 'post',
        imgUrl,
        author: (typeof it.author === 'object' ? it.author?.name : null) || null,
        authorUrl: profileUrl,
        likeCount,
        commentCount,
        repostCount,
        action: 'apify_ingest'
      });
    } catch { /* skip malformed item */ }
  }
  return out;
}

// POST /api/apify-webhook
// Header requirements:
//   Authorization: Bearer <APIFY_WEBHOOK_TOKEN>
//   x-client-id: <ClientId>
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

    // Tenant resolution
    const clientId = req.headers['x-client-id'];
    if (!clientId) {
      return res.status(400).json({ error: 'Missing x-client-id header' });
    }
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
      return res.json({ ok: true, mode: 'inline', result });
    }

    // Fetch items from Apify dataset
    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) {
      return res.status(500).json({ error: 'Server not configured: APIFY_API_TOKEN missing' });
    }

    // Quick ack before fetch to keep webhook latency low
    res.status(200).json({ ok: true, mode: 'dataset', datasetId });

    // Background processing
    (async () => {
      try {
        const url = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true`;
        const resp = await fetchDynamic(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        if (!resp.ok) {
          console.error('[ApifyWebhook] Failed to fetch dataset items', datasetId, resp.status);
          return;
        }
        const items = await resp.json();
        const posts = mapApifyItemsToPBPosts(items);
        if (!posts.length) {
          console.log(`[ApifyWebhook] No valid posts mapped from dataset ${datasetId}`);
          return;
        }
        const result = await syncPBPostsToAirtable(posts, clientBase);
        console.log(`[ApifyWebhook] Synced posts from dataset ${datasetId}`, result);
      } catch (e) {
        console.error('[ApifyWebhook] Background processing error:', e.message);
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
