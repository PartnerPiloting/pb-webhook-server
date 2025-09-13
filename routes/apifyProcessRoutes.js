// routes/apifyProcessRoutes.js
// Process a client's leads in batches until Posts Daily Target is met

const express = require('express');
const router = express.Router();
const { getClientBase, createBaseInstance } = require('../config/airtableClient');
const { getClientById } = require('../services/clientService');
const { getFetch } = require('../utils/safeFetch');
const fetch = getFetch();

const LEADS_TABLE = 'Leads';
const LINKEDIN_URL_FIELD = 'LinkedIn Profile URL';
const STATUS_FIELD = 'Posts Harvest Status';
const LAST_CHECK_AT_FIELD = 'Last Post Check At';
const FOUND_LAST_RUN_FIELD = 'Posts Found (Last Run)';
const RUN_ID_FIELD = 'Posts Harvest Run ID';

// Helper to format ISO now
const nowISO = () => new Date().toISOString();

// Pick a batch of leads: Pending, or Processing older than 30 minutes
async function pickLeadBatch(base, batchSize) {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const formula = `AND({${LINKEDIN_URL_FIELD}} != '', OR({${STATUS_FIELD}} = 'Pending', IS_BLANK({${STATUS_FIELD}}), AND({${STATUS_FIELD}} = 'Processing', {${LAST_CHECK_AT_FIELD}} < '${thirtyMinAgo}')))`;
  const records = await base(LEADS_TABLE).select({
    filterByFormula: formula,
    maxRecords: batchSize,
    fields: [LINKEDIN_URL_FIELD, STATUS_FIELD]
  }).firstPage();
  return records;
}

// Compute today's posts from leads table
async function computeTodaysPosts(base) {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(today.getUTCDate()).padStart(2, '0');
  const dayStart = `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
  const dayEnd = `${yyyy}-${mm}-${dd}T23:59:59.999Z`;
  const formula = `AND({${LAST_CHECK_AT_FIELD}} >= '${dayStart}', {${LAST_CHECK_AT_FIELD}} <= '${dayEnd}')`;
  const records = await base(LEADS_TABLE).select({
    filterByFormula: formula,
    fields: [FOUND_LAST_RUN_FIELD, LAST_CHECK_AT_FIELD]
  }).all();
  let sum = 0;
  for (const r of records) {
    const n = Number(r.get(FOUND_LAST_RUN_FIELD) || 0);
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

// POST /api/apify/process-client
// Headers: Authorization: Bearer PB_WEBHOOK_SECRET, x-client-id: <clientId>
// Body: { maxBatchesOverride?: number } optional
router.post('/api/apify/process-client', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    const secret = process.env.PB_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: 'Server missing PB_WEBHOOK_SECRET' });
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const clientId = req.headers['x-client-id'];
    if (!clientId) return res.status(400).json({ ok: false, error: 'Missing x-client-id header' });

    const client = await getClientById(clientId);
    if (!client) return res.status(404).json({ ok: false, error: 'Client not found' });
    if (client.status !== 'Active') return res.status(200).json({ ok: true, skipped: true, reason: 'Client not Active' });
    if (Number(client.serviceLevel) !== 2) return res.status(200).json({ ok: true, skipped: true, reason: 'Service level != 2' });

    const postsTarget = Number(client.postsDailyTarget || 0);
    const batchSize = Number(client.leadsBatchSizeForPostCollection || 20);
    const maxBatches = Number(req.body?.maxBatchesOverride ?? client.maxPostBatchesPerDayGuardrail ?? 10);
    if (!postsTarget || !batchSize) return res.status(200).json({ ok: true, skipped: true, reason: 'Missing targets' });

    const base = await getClientBase(clientId);

    // running tally
    let postsToday = await computeTodaysPosts(base);
    let batches = 0;
    const runs = [];

    while (postsToday < postsTarget && batches < maxBatches) {
      const pick = await pickLeadBatch(base, batchSize);
      if (!pick.length) break;

      // mark Processing + set run id placeholder
      const placeholderRunId = `local-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      await base(LEADS_TABLE).update(pick.map(r => ({
        id: r.id,
        fields: { [STATUS_FIELD]: 'Processing', [RUN_ID_FIELD]: placeholderRunId, [LAST_CHECK_AT_FIELD]: nowISO() }
      })));

      // prepare targetUrls
      const targetUrls = pick.map(r => r.get(LINKEDIN_URL_FIELD)).filter(Boolean);

      // call our own /api/apify/run in inline mode so we wait and sync immediately
      const baseUrl = process.env.API_PUBLIC_BASE_URL
        || process.env.NEXT_PUBLIC_API_BASE_URL
        || `http://localhost:${process.env.PORT || 3001}`;
      const startResp = await fetch(`${baseUrl}/api/apify/run`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret}`,
          'x-client-id': clientId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ targetUrls, mode: 'inline', options: { maxPosts: Number(process.env.APIFY_MAX_POSTS) || 2, postedLimit: process.env.APIFY_POSTED_LIMIT || 'any' } })
      });
      const startData = await startResp.json().catch(() => ({}));

      // after inline run, recompute today's posts
      const before = postsToday;
      postsToday = await computeTodaysPosts(base);
      const gained = Math.max(0, postsToday - before);

      // mark batch Done with counts
      await base(LEADS_TABLE).update(pick.map(r => ({
        id: r.id,
        fields: { [STATUS_FIELD]: 'Done', [FOUND_LAST_RUN_FIELD]: gained ? Math.round(gained / pick.length) : 0, [LAST_CHECK_AT_FIELD]: nowISO(), [RUN_ID_FIELD]: startData.runId || placeholderRunId }
      })));

      runs.push({ runId: startData.runId || placeholderRunId, gained, after: postsToday });
      batches++;
    }

    return res.json({ ok: true, clientId, postsToday, postsTarget, batches, runs });

  } catch (e) {
    console.error('[apify/process-client] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
