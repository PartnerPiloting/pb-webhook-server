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

// Ensure LinkedIn profile URLs point to recent activity and extract public identifiers
function normalizeLinkedInUrl(url) {
  try {
    if (typeof url !== 'string') return url;
    if (!url.includes('linkedin.com')) return url;
    // Trim params/fragments
    const u = new URL(url);
    // Only handle /in/<handle> or /in/<handle>/...
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('in');
    if (idx !== -1 && parts[idx + 1]) {
      const handle = parts[idx + 1];
      // If already a recent-activity URL, keep
      if (parts.includes('recent-activity')) return `https://www.linkedin.com/in/${handle}/recent-activity/all/`;
      return `https://www.linkedin.com/in/${handle}/recent-activity/all/`;
    }
    return url;
  } catch (_) {
    return url;
  }
}

function extractLinkedInPublicId(url) {
  try {
    if (typeof url !== 'string') return null;
    const match = url.match(/linkedin\.com\/in\/([^\/?#]+)/i);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
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
    // Support both our API shape and Apify-like shape where input is nested under body.input
    const body = req.body || {};
    const bodyInput = (body && typeof body.input === 'object') ? body.input : {};
    const targetUrls = Array.isArray(body?.targetUrls)
      ? body.targetUrls
      : (Array.isArray(bodyInput?.targetUrls) ? bodyInput.targetUrls : []);
    if (!targetUrls.length) {
      return res.status(400).json({ ok: false, error: 'Provide targetUrls: string[] (either at root or under input)' });
    }
    // Merge options from preferred locations: options -> input -> root
  const rawOpts = {
      ...(body?.options || {}),
      ...(bodyInput || {}),
      ...(body || {}),
    };
    // Normalize flags and types
    const coerceBool = (v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return ['1','true','yes','on'].includes(v.toLowerCase());
      if (typeof v === 'number') return v !== 0;
      return undefined;
    };
    const coerceNum = (v) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    };
    const opts = {
      postedLimit: typeof rawOpts.postedLimit === 'string' ? rawOpts.postedLimit : undefined,
      commentsPostedLimit: typeof rawOpts.commentsPostedLimit === 'string' ? rawOpts.commentsPostedLimit : undefined,
      maxPosts: coerceNum(rawOpts.maxPosts),
      maxReactions: coerceNum(rawOpts.maxReactions),
      maxComments: coerceNum(rawOpts.maxComments),
      // accept both reactions/scrapeReactions and comments/scrapeComments
      reactions: (typeof rawOpts.reactions !== 'undefined') ? coerceBool(rawOpts.reactions) : (typeof rawOpts.scrapeReactions !== 'undefined' ? coerceBool(rawOpts.scrapeReactions) : undefined),
      comments: (typeof rawOpts.comments !== 'undefined') ? coerceBool(rawOpts.comments) : (typeof rawOpts.scrapeComments !== 'undefined' ? coerceBool(rawOpts.scrapeComments) : undefined),
      expectsCookies: (typeof rawOpts.expectsCookies !== 'undefined') ? coerceBool(rawOpts.expectsCookies) : undefined,
      proxyConfiguration: (rawOpts && typeof rawOpts.proxyConfiguration === 'object' && rawOpts.proxyConfiguration)
        ? rawOpts.proxyConfiguration
        : undefined,
    };

    // Decide whether we should assume a cookie-enabled actor (can access /recent-activity/) or not.
    // Priority: request override -> env var -> heuristic based on actor/task id text
  const expectsCookiesOverride = (typeof opts.expectsCookies !== 'undefined') ? Boolean(opts.expectsCookies) : undefined;
    const expectsCookiesEnv = ['1', 'true', 'yes', 'on'].includes(String(process.env.APIFY_EXPECTS_COOKIES || '').toLowerCase());
    const heuristicCookies = /cookie/i.test(`${taskId || ''} ${actorId || ''}`) && !/no-?cookie/i.test(`${taskId || ''} ${actorId || ''}`);
    const expectsCookies = typeof expectsCookiesOverride === 'boolean' ? expectsCookiesOverride : (expectsCookiesEnv || heuristicCookies);

    // Build input according to cookie mode. For no-cookies, keep it minimal and public-safe
  let input;
    if (!expectsCookies) {
      // No-cookies actors: Send EXACTLY the same flat structure as Console
      input = {
        targetUrls,
        maxComments: typeof opts.maxComments === 'number' ? opts.maxComments : 5,
        maxPosts: typeof opts.maxPosts === 'number' ? opts.maxPosts : 5,
        maxReactions: typeof opts.maxReactions === 'number' ? opts.maxReactions : 5,
        postedLimit: typeof opts.postedLimit === 'string' ? opts.postedLimit : 'month',
        scrapeComments: typeof opts.comments === 'boolean' ? opts.comments : false,
        scrapeReactions: typeof opts.reactions === 'boolean' ? opts.reactions : false,
        // Pass-through proxy configuration if provided
        proxyConfiguration: (opts.proxyConfiguration && typeof opts.proxyConfiguration === 'object') ? opts.proxyConfiguration : undefined,
      };
      // Remove undefined keys to avoid confusing some actors
      Object.keys(input).forEach((k) => input[k] === undefined && delete input[k]);
    } else {
      // Cookie-enabled actors: normalize to recent-activity and add profiles aliases
      const normalized = targetUrls.map((url) => normalizeLinkedInUrl(url));
      const profiles = normalized.map((url) => extractLinkedInPublicId(url)).filter(Boolean);
      input = {
        // Provide multiple aliases so the actor recognizes targets regardless of its schema
        targetUrls,
        startUrls: normalized.map((url) => ({ url })),
        profileUrls: normalized,
        profiles,
  postedLimit: typeof opts.postedLimit === 'string' ? opts.postedLimit : 'month',
  maxPosts: typeof opts.maxPosts === 'number' ? opts.maxPosts : 2,
        // Support both naming styles
  includeReactions: typeof opts.reactions === 'boolean' ? opts.reactions : false,
  includeComments: typeof opts.comments === 'boolean' ? opts.comments : false,
  scrapeReactions: typeof opts.reactions === 'boolean' ? opts.reactions : false,
  scrapeComments: typeof opts.comments === 'boolean' ? opts.comments : false,
  maxReactions: typeof opts.maxReactions === 'number' ? opts.maxReactions : undefined,
  maxComments: typeof opts.maxComments === 'number' ? opts.maxComments : undefined,
  commentsPostedLimit: typeof opts.commentsPostedLimit === 'string' ? opts.commentsPostedLimit : undefined,
  proxyConfiguration: (opts.proxyConfiguration && typeof opts.proxyConfiguration === 'object') ? opts.proxyConfiguration : undefined,
      };
      Object.keys(input).forEach((k) => input[k] === undefined && delete input[k]);
    }

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
    const debugEcho = (process.env.NODE_ENV !== 'production' && String(req.query.debug || '') === '1')
      ? { expectsCookies, sentInput: input }
      : undefined;
    return res.json({ ok: true, mode: 'webhook', runId: run.id, status: run.status, url: run.url || run.buildUrl || null, ...(debugEcho ? { debug: debugEcho } : {}) });
  } catch (e) {
    console.error('[ApifyControl] run error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
