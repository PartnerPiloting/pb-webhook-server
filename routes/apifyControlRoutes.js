// routes/apifyControlRoutes.js
// Start Apify Task/Actor runs from our API. Two modes:
// - mode=webhook (default): fire-and-forget; Apify will call our /api/apify-webhook on success
// - mode=inline: wait for run to finish, fetch dataset, and upsert to Airtable immediately

const express = require('express');
const { getFetch } = require('../utils/safeFetch');
const fetch = getFetch();
const router = express.Router();

// Helpers reused from webhook route without re-import cycles
const { DateTime } = require('luxon');
const syncPBPostsToAirtable = require('../utils/pbPostsSync');

function toProfileUrl(author) {
  if (!author) return null;
  if (typeof author === 'string' && author.startsWith('http')) return author;
  if (author?.url) return author.url;
  if (author?.publicIdentifier) return `https://www.linkedin.com/in/${author.publicIdentifier}`;
  return null;
}

function mapApifyItemsToPBPosts(items = []) {
  return items
    .map((it) => {
      const profileUrl = toProfileUrl(it.author || it.profileUrl || it.profile);
      const postUrl = it.url || it.postUrl || it.shareUrl || it.link || null;
      const content = it.text || it.content || it.caption || it.body || '';
      const publishedAt = it.publishedAt || it.time || it.date || it.createdAt || null;
      return {
        profileUrl,
        postUrl,
        content,
        publishedAt,
        // Extras we may store later
        meta: {
          source: 'apify',
          apifyItemId: it.id || it.uniqueId || null,
        },
      };
    })
    .filter((p) => p.profileUrl && p.postUrl && p.content);
}

// POST /api/apify/run
// Headers:
//   Authorization: Bearer <PB_WEBHOOK_SECRET>
//   x-client-id: <tenant id>
// Body:
//   { targetUrls: string[], options?: { postedLimit?: string, maxPosts?: number, reactions?: boolean, comments?: boolean }, mode?: 'webhook'|'inline' }
router.post('/api/apify/run', async (req, res) => {
  try {
    // Auth
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const clientId = req.headers['x-client-id'] || req.query.client || req.body.clientId;
    if (!clientId) return res.status(400).json({ ok: false, error: 'Missing x-client-id header' });

    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) return res.status(500).json({ ok: false, error: 'Server missing APIFY_API_TOKEN' });

    const taskId = process.env.APIFY_TASK_ID; // preferred if set (has webhook + defaults)
    const actorId = process.env.APIFY_ACTOR_ID || 'harvestapi~linkedin-profile-posts';

    // Input assembly
    const targetUrls = Array.isArray(req.body?.targetUrls) ? req.body.targetUrls : [];
    if (!targetUrls.length) {
      return res.status(400).json({ ok: false, error: 'Provide targetUrls: string[] in body' });
    }
    const opts = req.body?.options || {};
    const input = {
      targetUrls,
      postedLimit: opts.postedLimit || 'month',
      maxPosts: typeof opts.maxPosts === 'number' ? opts.maxPosts : 2,
      includeReactions: Boolean(opts.reactions) || false,
      includeComments: Boolean(opts.comments) || false,
    };

    const mode = (req.body?.mode || 'webhook').toLowerCase();
    const baseUrl = 'https://api.apify.com/v2';

    if (mode === 'inline') {
      // Start run and wait until it finishes, then fetch dataset and ingest
      const startUrl = taskId
        ? `${baseUrl}/actor-tasks/${encodeURIComponent(taskId)}/runs?waitForFinish=120`
        : `${baseUrl}/acts/${encodeURIComponent(actorId)}/runs?waitForFinish=120`;
      const startResp = await fetch(startUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ input }),
      });
      const startData = await startResp.json();
      if (!startResp.ok) {
        return res.status(startResp.status).json({ ok: false, error: 'Failed to start Apify run', details: startData });
      }

      const run = startData.data || startData;
      const datasetId = run.defaultDatasetId || run.datasetId || run.data?.defaultDatasetId;
      if (!datasetId) {
        return res.json({ ok: true, mode: 'inline', runId: run.id, status: run.status, note: 'No datasetId returned yet' });
      }

      // Fetch items and ingest
      const itemsUrl = `${baseUrl}/datasets/${encodeURIComponent(datasetId)}/items?clean=true`;
      const itemsResp = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${apiToken}` } });
      const items = await itemsResp.json();
      const posts = mapApifyItemsToPBPosts(items || []);
      let result = { processed: 0, updated: 0, skipped: 0 };
      if (posts.length) {
        result = await syncPBPostsToAirtable(posts, { clientId, source: 'apify_inline' });
      }
      return res.json({ ok: true, mode: 'inline', runId: run.id, status: run.status, datasetId, counts: { items: (items||[]).length, posts: posts.length }, result });
    }

    // Default: webhook mode (fast return). Ensure a webhook is configured on the Saved Task.
    const startUrl = taskId
      ? `${baseUrl}/actor-tasks/${encodeURIComponent(taskId)}/runs`
      : `${baseUrl}/acts/${encodeURIComponent(actorId)}/runs`;

    const startResp = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ input }),
    });
    const startData = await startResp.json();
    if (!startResp.ok) {
      return res.status(startResp.status).json({ ok: false, error: 'Failed to start Apify run', details: startData });
    }

    const run = startData.data || startData;
    return res.json({ ok: true, mode: 'webhook', runId: run.id, status: run.status, url: run.url || run.buildUrl || null });
  } catch (e) {
    console.error('[ApifyControl] run error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
