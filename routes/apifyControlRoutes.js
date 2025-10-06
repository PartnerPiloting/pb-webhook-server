// routes/apifyControlRoutes.js
// Start Apify Actor runs from our API. Two modes:
// - mode=webhook (default): fire-and-forget; Apify will call our /api/apify-webhook on success
// - mode=inline: wait for run to finish, fetch dataset, and upsert to Airtable immediately

const express = require('express');
const { getFetch } = require('../utils/safeFetch');
const fetch = getFetch();
const router = express.Router();
const { logCriticalError } = require('../utils/errorLogger');

// Helpers reused from webhook route without re-import cycles
const { DateTime } = require('luxon');
const syncPBPostsToAirtable = require('../utils/pbPostsSync');
const { getClientBase } = require('../config/airtableClient');
const { createApifyRun } = require('../services/apifyRunsService');

function toProfileUrl(author) {
  try {
    if (!author) return null;
    if (typeof author === 'string') {
      if (author.startsWith('http')) return author.replace(/\/$/, '');
      return `https://www.linkedin.com/in/${author.replace(/\/$/, '')}`;
    }
    if (typeof author === 'object') {
      if (author.url && typeof author.url === 'string') return author.url.replace(/\/$/, '');
      if (author.linkedinUrl && typeof author.linkedinUrl === 'string') return author.linkedinUrl.replace(/\/$/, '');
      if (author.publicIdentifier && typeof author.publicIdentifier === 'string') {
        return `https://www.linkedin.com/in/${author.publicIdentifier.replace(/\/$/, '')}`;
      }
    }
  } catch (error) {
    logCriticalError(error, { 
      operation: 'extract_author_url',
      expectedBehavior: true 
    }).catch(() => {});
  }
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
  } catch (error) {
    logCriticalError(error, { 
      operation: 'normalize_linkedin_url',
      expectedBehavior: true,
      url: url 
    }).catch(() => {});
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

// Build a canonical profile URL from a LinkedIn public identifier
function buildCanonicalProfileUrl(publicId) {
    logCriticalError(_, { operation: 'unknown' }).catch(() => {});
  if (!publicId || typeof publicId !== 'string') return null;
  const clean = publicId.replace(/\/$/, '');
  return `https://www.linkedin.com/in/${clean}`;
}

function mapApifyItemsToPBPosts(items = []) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue;
    try {
      const p = it.post || {};
  const originalAuthorUrl = toProfileUrl(it.author || it.profileUrl || it.profile || it.authorUrl || it.authorProfileUrl || p.author) || p.profileUrl || null;
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

    const isRepost = (String(it.postType || it.type || '').toLowerCase().includes('repost'));
    const originLabel = isRepost ? `REPOST - ORIGINAL AUTHOR: ${originalAuthorUrl || '(unknown)'}` : 'ORIGINAL';

    out.push({
        // Attach to lead via profileUrl later (reconcile may overwrite this), but keep original author in pbMeta
        profileUrl: originalAuthorUrl,
        postUrl,
        postContent,
        postTimestamp,
        // alias used by some of our downstream utils
        postedAt: postTimestamp || null,
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
    } catch (err) {
      console.warn(`[ApifyControl] Error processing item ${i}: ${err.message}`);
      logRouteError(err, req).catch(() => {});
    }
  }
  return out;
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

    // Multi-tenant client identification
    let clientId = req.headers['x-client-id'];
    // Fallback to query param for visibility/simplicity in testing
    if (!clientId) clientId = req.query.client || req.query.clientId;
    if (!clientId) {
      return res.status(400).json({ ok: false, error: 'Missing x-client-id header (or ?client=CLIENT_ID)' });
    }

    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) return res.status(500).json({ ok: false, error: 'Server missing APIFY_API_TOKEN' });

  // Always use Actor directly - no Saved Task support to avoid confusion
  const taskId = null;
  // Allow per-request override of actor/build (useful to replicate successful console runs)
  const actorIdOverride = (req.body && (req.body.actorId || (req.body.input && req.body.input.actorId))) || undefined;
  const actorId = actorIdOverride || process.env.APIFY_ACTOR_ID || 'harvestapi~linkedin-profile-posts';

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
      // Build override (e.g., 'latest', 'beta', or a specific build ID)
      build: typeof rawOpts.build === 'string' ? rawOpts.build : (typeof rawOpts.buildId === 'string' ? rawOpts.buildId : undefined),
    };

  // Always assume cookie-enabled behavior to maximize yields from /recent-activity/.
  // We intentionally ignore request/env toggles here to avoid worse public-only results.
  // If an emergency override is ever needed, we can reintroduce an env switch.
  const expectsCookies = true;

    // Build input according to cookie mode. For no-cookies, keep it minimal and public-safe
  let input;
    if (expectsCookies) {
      // Cookie-enabled actors: normalize to recent-activity and add profiles aliases
      const normalized = targetUrls.map((url) => normalizeLinkedInUrl(url));
      const profiles = normalized.map((url) => extractLinkedInPublicId(url)).filter(Boolean);
      input = {
        // Provide multiple aliases so the actor recognizes targets regardless of its schema
        targetUrls,
        startUrls: normalized.map((url) => ({ url })),
        profileUrls: normalized,
        profiles,
  postedLimit: typeof opts.postedLimit === 'string' ? opts.postedLimit : (process.env.APIFY_POSTED_LIMIT || 'year'),
  maxPosts: typeof opts.maxPosts === 'number' ? opts.maxPosts : (parseInt(process.env.APIFY_MAX_POSTS) || 2),
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
    } else {
      // Fallback branch retained for clarity but not reachable with current hard-coded expectsCookies=true
      input = { targetUrls };
      Object.keys(input).forEach((k) => input[k] === undefined && delete input[k]);
    }

    const mode = (req.body?.mode || 'webhook').toLowerCase();
    const baseUrl = 'https://api.apify.com/v2';

    if (mode === 'inline') {
      // Start Actor run and wait until it finishes, then fetch dataset and ingest
      const inlineParams = new URLSearchParams({ waitForFinish: '120' });
      if (opts.build) inlineParams.set('build', opts.build);
      const startUrl = `${baseUrl}/acts/${encodeURIComponent(actorId)}/runs?${inlineParams.toString()}`;
      const startResp = await fetch(startUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(input),
      });
      const startData = await startResp.json();
      if (!startResp.ok) {
        return res.status(startResp.status).json({ ok: false, error: 'Failed to start Apify run', details: startData });
      }

      const run = startData.data || startData;
      const datasetId = run.defaultDatasetId || run.datasetId || run.data?.defaultDatasetId;
      
      // Store run mapping for multi-tenant tracking
      try {
        await createApifyRun(run.id, clientId, {
          actorId,
          build: opts.build,
          targetUrls,
          mode: 'inline'
        });
      } catch (runTrackingError) {
        console.warn(`[ApifyControl] Failed to track run ${run.id}:`, runTrackingError.message);
        await logRouteError(runTrackingError, req).catch(() => {});
        // Continue execution - run tracking failure shouldn't break the flow
      }
      
      if (!datasetId) {
        return res.json({ ok: true, mode: 'inline', runId: run.id, status: run.status, note: 'No datasetId returned yet' });
      }

      // Fetch items and ingest
      const itemsUrl = `${baseUrl}/datasets/${encodeURIComponent(datasetId)}/items?clean=true`;
      const itemsResp = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${apiToken}` } });
      const items = await itemsResp.json();
      const posts = mapApifyItemsToPBPosts(items || []);
      // Reconcile profileUrl to the exact target(s) we ran for, to avoid slug mismatches
      try {
        const targetIds = (Array.isArray(targetUrls) ? targetUrls : []).map(u => extractLinkedInPublicId(u)).filter(Boolean);
        const key = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const targetMap = new Map();
        for (const id of targetIds) {
          targetMap.set(key(id), buildCanonicalProfileUrl(id));
        }
        if (targetIds.length === 1) {
          const only = buildCanonicalProfileUrl(targetIds[0]);
          posts.forEach(p => { p.profileUrl = only; });
        } else if (targetMap.size) {
          posts.forEach(p => {
            const pid = extractLinkedInPublicId(p.profileUrl);
            const m = pid ? targetMap.get(key(pid)) : null;
            if (m) p.profileUrl = m;
          });
        }
      } catch (reconcileErr) {
        console.warn('[ApifyControl] profileUrl reconcile skipped:', reconcileErr.message);
        await logRouteError(reconcileErr, req).catch(() => {});
      }
      let result = { processed: 0, updated: 0, skipped: 0 };
      if (posts.length) {
        // Pass the actual client base so sync writes to the correct tenant
        let clientBase;
        try {
          clientBase = await getClientBase(clientId);
        } catch (e) {
          console.warn(`[ApifyControl] Failed to resolve client base for ${clientId}: ${e.message}`);
          await logRouteError(e, req).catch(() => {});
        }
        result = await syncPBPostsToAirtable(posts, clientBase || null);
        
        // Update metrics ONLY if we're in an orchestrated run (not standalone)
        // Check if this is part of an orchestrated flow by looking for parent run ID
        const isOrchestrated = req.query.parentRunId || req.body.parentRunId;
        
        if (isOrchestrated) {
          // Update the client run record with post harvesting metrics using the centralized function
          try {
            const { updateClientRunMetrics } = require('../services/apifyRunsService');
            
            // Update metrics using the centralized function
            await updateClientRunMetrics(run.id, clientId, {
              postsCount: posts.length,
              profilesCount: targetUrls.length
            });
            
          } catch (metricsError) {
            console.error(`[ApifyControl] Failed to update post harvesting metrics: ${metricsError.message}`);
            await logRouteError(metricsError, req).catch(() => {});
            // Continue execution even if metrics update fails
          }
        } else {
          console.log(`[ApifyControl] Skipping metrics update for standalone run (no parentRunId provided)`);
        }
      }
      return res.json({ ok: true, mode: 'inline', runId: run.id, status: run.status, datasetId, counts: { items: (items||[]).length, posts: posts.length }, result });
    }

    // Default: webhook mode (fast return). Actor runs with webhook configuration.
  const webhookParams = new URLSearchParams();
  if (opts.build) webhookParams.set('build', opts.build);
  const startUrl = `${baseUrl}/acts/${encodeURIComponent(actorId)}/runs${webhookParams.toString() ? `?${webhookParams.toString()}` : ''}`;
    
    // Generate a standardized system run ID
    const runIdSystem = require('../services/runIdSystem');
    const systemRunId = runIdSystem.generateRunId();
    console.log(`[ApifyControl] Generated system run ID ${systemRunId} for client ${clientId}`);

    // Add webhook configuration for Actor runs
    const defaultWebhookUrl = 'https://pb-webhook-server.onrender.com/api/apify-webhook';
    const webhookUrl = process.env.APIFY_WEBHOOK_URL || defaultWebhookUrl;
    const webhookConfig = {
      webhooks: [{
        eventTypes: ['ACTOR.RUN.SUCCEEDED'],
        requestUrl: webhookUrl,
        payloadTemplate: JSON.stringify({
          resource: {
            defaultDatasetId: '{{resource.defaultDatasetId}}',
            id: '{{resource.id}}',
            status: '{{resource.status}}'
          },
          // Include our system-generated run ID in the payload
          jobRunId: systemRunId,
          clientId: clientId,
          eventType: '{{eventType}}',
          createdAt: '{{createdAt}}'
        }),
        headersTemplate: JSON.stringify({
          'Authorization': `Bearer ${process.env.APIFY_WEBHOOK_TOKEN}`,
          'Content-Type': 'application/json'
        })
      }]
    };

    // Always merge input with webhook config for Actor runs
    const requestBody = { ...input, ...webhookConfig };



  const startResp = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(requestBody),
    });
    const startData = await startResp.json();
    if (!startResp.ok) {
      return res.status(startResp.status).json({ ok: false, error: 'Failed to start Apify run', details: startData });
    }

    const run = startData.data || startData;
    
    // Store run mapping for multi-tenant webhook handling
    try {
      // Store both the Apify run ID and our system run ID in the record
      await createApifyRun(run.id, clientId, {
        actorId,
        build: opts.build,
        targetUrls,
        mode: 'webhook',
        systemRunId: systemRunId  // Include our system run ID
      });
      console.log(`[ApifyControl] Created run tracking for Apify ID ${run.id} -> System ID ${systemRunId} -> Client ${clientId}`);
    } catch (runTrackingError) {
      console.warn(`[ApifyControl] Failed to track run ${run.id}:`, runTrackingError.message);
      await logRouteError(runTrackingError, req).catch(() => {});
      // Continue execution - run tracking failure shouldn't break the flow
    }
    
    return res.json({ ok: true, mode: 'webhook', runId: run.id, systemRunId: systemRunId, status: run.status, url: run.url || run.buildUrl || null });
  } catch (e) {
    console.error('[ApifyControl] run error:', e.message);
    await logCriticalError(error, req).catch(() => {});
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
