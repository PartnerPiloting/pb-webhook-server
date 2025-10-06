// routes/topScoringLeadsRoutes.js
// Lightweight, feature-flagged scaffold for the Top Scoring Leads feature.
// - GET /api/top-scoring-leads/status: public status (always available)
// - POST /api/top-scoring-leads/dev/sanity-check: admin-only field existence checks

const express = require('express');
const { logCriticalError } = require('../utils/errorLogger');
const airtableClient = require('../config/airtableClient.js');

function parseBoolFlag(val, defaultValue = false) {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

module.exports = function mountTopScoringLeads(app, base) {
  const router = express.Router();

  const ENABLED = parseBoolFlag(process.env.ENABLE_TOP_SCORING_LEADS, false);
  const REPAIR_SECRET = process.env.PB_WEBHOOK_SECRET || 'changeme-please-update-this!';

  // Mount diagnostics
  console.log(`[TopScoringLeads] Mounted. ENABLED=${ENABLED}`);

  // Resolve Airtable base per-request (multi-tenant) with fallback to default
  async function getBaseForRequest(req) {
    const clientId = req.headers['x-client-id'] || req.query.clientId || req.query.testClient;
    if (clientId && typeof airtableClient.getClientBase === 'function') {
      try {
        return await airtableClient.getClientBase(clientId);
      } catch (e) {
        // Fall through to default base
        console.warn(`topScoringLeads: getClientBase failed for ${clientId}: ${e?.message || e}`);
      }
    }
    return base;
  }

  // Public status endpoint (responds even if disabled)
  router.get('/status', (req, res) => {
    res.json({
      ok: true,
      enabled: ENABLED,
      env: process.env.NODE_ENV || 'development',
      commit: process.env.RENDER_GIT_COMMIT || 'local',
      branch: process.env.RENDER_GIT_BRANCH || 'unknown'
    });
  });

  // --- Shared helpers for eligibility logic ---
  function buildEligibleFormula(threshold) {
    const esc = (s) => String(s).replace(/'/g, "\\'");
    const STATUS_SCORED = 'Scored';
    const STATUS_CANDIDATE = 'Candidate';
    const BATCH_SELECTED = 'Selected for Current LH Batch';
    const parts = [
      `({Scoring Status} = '${esc(STATUS_SCORED)}')`,
      `({LinkedIn Connection Status} = '${esc(STATUS_CANDIDATE)}')`,
      `OR({Date Added to LH Campaign} = BLANK(), {Date Added to LH Campaign} = '')`,
      `{AI Score} >= ${threshold}`,
      `OR({Temp LH Batch Status} = BLANK(), NOT({Temp LH Batch Status} = '${esc(BATCH_SELECTED)}'))`
    ];
    return `AND(${parts.join(', ')})`;
  }

  async function getThresholdForRequest(req, b) {
    let threshold = req.query.threshold !== undefined ? Number(req.query.threshold) : undefined;
    if (!Number.isFinite(threshold)) {
      const creds = await b('Credentials').select({ maxRecords: 1 }).firstPage();
      const row = creds && creds[0];
      const raw = row ? row.get('AI Score Threshold Input') : undefined;
      threshold = Number(raw);
    }
    if (!Number.isFinite(threshold)) threshold = 0;
    return threshold;
  }

  async function fetchEligibleIdsPaged(b, formula, maxToCollect) {
    const ids = [];
    let resolved = false;
    await new Promise((resolve, reject) => {
      b('Leads')
        .select({
          filterByFormula: formula,
          sort: [{ field: 'AI Score', direction: 'desc' }],
          pageSize: 100,
        })
        .eachPage(
          (records, fetchNextPage) => {
            for (const r of records) {
              if (ids.length >= maxToCollect) break;
              ids.push(r.id);
            }
            if (ids.length >= maxToCollect) {
              if (!resolved) {
                resolved = true;
                resolve();
              }
              return; // stop paging
            }
            fetchNextPage();
          },
          (err) => {
            if (resolved) return; // already resolved early
            if (err) reject(err);
            else resolve();
          }
        );
    });
    return ids;
  }

  // Helper to page and collect eligible item objects up to maxToCollect
  async function fetchEligibleItemsPaged(b, formula, maxToCollect) {
    const items = [];
    let resolved = false;
    await new Promise((resolve, reject) => {
      b('Leads')
        .select({
          filterByFormula: formula,
          sort: [{ field: 'AI Score', direction: 'desc' }],
          pageSize: 100,
        })
        .eachPage(
          (records, fetchNextPage) => {
            for (const r of records) {
              if (items.length >= maxToCollect) break;
              items.push({
                id: r.id,
                score: r.get('AI Score') ?? null,
                firstName: r.get('First Name') || null,
                lastName: r.get('Last Name') || null,
                linkedinUrl: r.get('LinkedIn Profile URL') || null,
                scoringStatus: r.get('Scoring Status') || null,
                connectionStatus: r.get('LinkedIn Connection Status') || null,
                batchStatus: r.get('Temp LH Batch Status') || null,
                dateAddedToLH: r.get('Date Added to LH Campaign') || null
              });
            }
            if (items.length >= maxToCollect) {
              if (!resolved) {
                resolved = true;
                resolve();
              }
              return; // stop paging
            }
            fetchNextPage();
          },
          (err) => {
            if (resolved) return;
            if (err) reject(err);
            else resolve();
          }
        );
    });
    return items;
  }

  // Helper: count eligible items (pages through without collecting full objects)
  async function countEligiblePaged(b, formula, maxToCount) {
    let total = 0;
    let resolved = false;
    await new Promise((resolve, reject) => {
      b('Leads')
        .select({
          filterByFormula: formula,
          sort: [{ field: 'AI Score', direction: 'desc' }],
          pageSize: 100,
          fields: ['AI Score']
        })
        .eachPage(
          (records, fetchNextPage) => {
            total += records.length;
            if (total >= maxToCount) {
              if (!resolved) { resolved = true; resolve(); }
              return;
            }
            fetchNextPage();
          },
          (err) => {
            if (resolved) return;
            if (err) reject(err); else resolve();
          }
        );
    });
    return Math.min(total, maxToCount);
  }

  // Early debug ping to confirm this file version is loaded
  router.get('/_debug/ping', (req, res) => {
    res.json({ ok: true, message: 'topScoringLeadsRoutes: debug ping', ts: new Date().toISOString() });
  });

  // Early debug route list (pre-gating) to inspect router stack
  router.get('/_debug/routes2', (req, res) => {
    try {
      const list = [];
      const stack = router.stack || [];
      for (const layer of stack) {
        if (layer && layer.route) {
          const path = layer.route.path;
          const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
          list.push({ path, methods });
        }
      }
      res.json({ ok: true, routes: list });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Public parameter metadata (pre-gating) so clients can discover valid query params
  // GET /_meta/params
  router.get('/_meta/params', (req, res) => {
    try {
      const simple = parseBoolFlag(req.query.simple, false);
      if (simple) {
        // Minimal, operator-focused params only
        return res.json({
          ok: true,
          scope: 'simple',
          uiParams: [
            { name: 'batchSize', in: 'query', type: 'integer', description: 'UI-only: caps both preview and selection size.' },
            { name: 'clientId', in: 'query', type: 'string', description: 'Tenant selection (alias: testClient).', alias: ['testClient'] }
          ],
          apiParams: {
            common: [
              { name: 'x-client-id', in: 'header', type: 'string', description: 'Tenant selection (alternative to clientId).' }
            ],
            selectAll: [
              { name: 'all', in: 'query', type: 'boolean', description: 'Select by eligibility (no explicit IDs).' },
              { name: 'pageSize', in: 'query', type: 'integer', description: 'Cap count to select (usually equals batchSize).' }
            ],
            eligible: [
              { name: 'page', in: 'query', type: 'integer', description: 'Preview page (UI typically uses 1).' },
              { name: 'pageSize', in: 'query', type: 'integer', description: 'Preview size (usually equals batchSize).' }
            ],
            eligibleCount: [
              { name: 'threshold', in: 'query', type: 'number', description: 'Override stored AI score threshold.' },
              { name: 'limit', in: 'query', type: 'integer', description: 'Safety cap for counting (defaults to MAX_SELECT_ALL).' }
            ],
            currentBatch: [
              { name: 'all', in: 'query', type: 'boolean', description: 'Fetch all selected with caps.' },
              { name: 'pageSize', in: 'query', type: 'integer', description: 'Cap current batch fetch (optional).' }
            ]
          },
          examples: {
            ui: '/top-scoring-leads?clientId=YOUR-CLIENT&batchSize=50',
            preview: '/api/top-scoring-leads/eligible?clientId=YOUR-CLIENT&page=1&pageSize=50',
            count: '/api/top-scoring-leads/eligible/count?clientId=YOUR-CLIENT',
            lock: '/api/top-scoring-leads/batch/select?clientId=YOUR-CLIENT&all=1&pageSize=50',
            current: '/api/top-scoring-leads/batch/current?clientId=YOUR-CLIENT&all=1',
            finalize: '/api/top-scoring-leads/batch/finalize?clientId=YOUR-CLIENT'
          }
        });
      }

      const common = [
        {
          name: 'x-client-id',
          in: 'header',
          type: 'string',
          required: false,
          description: 'Multi-tenant: client identifier header. Equivalent to clientId/testClient query params.'
        },
        {
          name: 'clientId',
          in: 'query',
          type: 'string',
          required: false,
          description: 'Multi-tenant: client identifier (same as x-client-id).'
        },
        {
          name: 'testClient',
          in: 'query',
          type: 'string',
          required: false,
          description: 'Legacy alias for clientId.'
        },
  // dryRun removed
      ];

      const endpoints = {
        '/status': { method: 'GET', params: [] },
        '/threshold': {
          method: 'GET',
          params: [
            { name: 'clientId', in: 'query', type: 'string', required: false, description: 'Tenant override.' },
            { name: 'testClient', in: 'query', type: 'string', required: false, description: 'Tenant override (alias).' }
          ]
        },
        '/eligible': {
          method: 'GET',
          params: [
            { name: 'threshold', in: 'query', type: 'number', required: false, description: 'Override stored AI score threshold.' },
            { name: 'limit', in: 'query', type: 'integer', required: false, default: 50, description: 'Page size (alias of pageSize). Max 200.' },
            { name: 'pageSize', in: 'query', type: 'integer', required: false, default: 50, description: 'Page size (alias of limit). Max 200.' },
            { name: 'page', in: 'query', type: 'integer', required: false, default: 1, description: '1-based page index.' }
          ]
        },
        '/eligible/count': {
          method: 'GET',
          params: [
            { name: 'threshold', in: 'query', type: 'number', required: false, description: 'Override stored AI score threshold.' },
            { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Safety cap for counting (defaults to MAX_SELECT_ALL).' }
          ]
        },
        '/export/last': {
          method: 'GET',
          params: []
        },
        '/batch/current': {
          method: 'GET',
          params: [
            { name: 'all', in: 'query', type: 'boolean', required: false, description: 'When true, page through all with safety caps.' },
            { name: 'limit', in: 'query', type: 'integer', required: false, default: 200, description: 'Max items to return (alias of pageSize). May be raised automatically when all=true.' },
            { name: 'pageSize', in: 'query', type: 'integer', required: false, default: 200, description: 'Max items to return (alias of limit). May be raised automatically when all=true.' }
          ]
        },
    '/batch/select': {
          method: 'POST',
          params: [
            { name: 'all', in: 'query', type: 'boolean', required: false, description: 'Auto-select eligible records instead of providing recordIds in body.' },
            { name: 'mode', in: 'query', type: 'string', enum: ['all'], required: false, description: 'Alternate way to request all-mode.' },
      { name: 'pageSize', in: 'query', type: 'integer', required: false, description: 'When in all-mode, cap how many to select. Default behavior: replace current selection unless append=1.' },
            { name: 'testPageSize', in: 'query', type: 'integer', required: false, description: 'Legacy alias for pageSize.' },
      { name: 'append', in: 'query', type: 'boolean', required: false, description: 'When in all-mode, append to current selection (overrides default replace behavior).' },
      { name: 'replace', in: 'query', type: 'boolean', required: false, description: 'When in all-mode, replace current selection (explicit override).'}
          ],
          body: [
            { name: 'recordIds', in: 'body', type: 'string[]', required: false, description: 'Explicit replace-mode IDs (max 200) when not using all-mode.' }
          ]
        },
        '/batch/finalize': {
          method: 'POST',
          params: [],
          body: [
            { name: 'recordIds', in: 'body', type: 'string[]', required: false, description: 'Optional explicit IDs to finalize (max 200). Falls back to current batch when omitted.' }
          ]
        },
        '/batch/reset': {
          method: 'POST',
          params: []
        },
        '/export/last (PUT)': {
          method: 'PUT',
          params: [],
          body: [
            { name: 'at', in: 'body', type: 'string|number', required: false, description: 'ISO timestamp or epoch ms. Defaults to now.' }
          ]
        },
        '/threshold (PUT)': {
          method: 'PUT',
          params: [],
          body: [
            { name: 'value', in: 'body', type: 'number', required: true, description: 'New AI score threshold to persist (0..1000).' }
          ]
        }
      };

      res.json({ ok: true, common, endpoints });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Human-friendly metadata page (pre-gating): lists endpoints and parameters with examples
  // GET /_meta
  router.get('/_meta', (req, res) => {
    try {
      const host = req.get('host') || 'localhost:3001';
      const scheme = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
      const apiBase = `${scheme}://${host}/api/top-scoring-leads`;
      const client = req.query.clientId || req.query.testClient;
      const tenantQS = client ? `?clientId=${encodeURIComponent(client)}` : '';
      const simple = parseBoolFlag(req.query.simple, false);

      if (simple) {
        const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Top Scoring Leads · Quick Params</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica Neue,sans-serif;margin:24px;line-height:1.45;color:#111827}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}.card{border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:12px 0 20px}.h{margin:0 0 8px}.muted{color:#6b7280}a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}.badge{display:inline-block;padding:2px 8px;background:#eef2ff;color:#3730a3;border-radius:9999px;font-size:12px}</style>
  </head>
  <body>
    <h1 class="h">Top Scoring Leads · Quick Params</h1>
    <p class="muted">Environment: <span class="badge">${process.env.NODE_ENV || 'development'}</span> · Tenant: <span class="badge">${client || 'not set'}</span></p>
    <p>JSON (simple): <a href="${apiBase}/_meta/params?simple=1${tenantQS ? '&clientId='+encodeURIComponent(client) : ''}">${apiBase}/_meta/params?simple=1${tenantQS ? '&clientId='+encodeURIComponent(client) : ''}</a></p>

    <div class="card">
      <h2 class="h">UI page URL</h2>
      <p>Use <code>batchSize</code> to cap both preview and selection; <code>clientId</code> picks tenant.</p>
      <p><code>http://localhost:3000/top-scoring-leads?clientId=${encodeURIComponent(client || 'YOUR-CLIENT')}&batchSize=50</code></p>
    </div>

    <div class="card">
      <h2 class="h">API (typical)</h2>
      <ul>
        <li>Preview: <a href="${apiBase}/eligible${tenantQS ? tenantQS + '&' : '?'}page=1&pageSize=50">${apiBase}/eligible${tenantQS ? tenantQS + '&' : '?'}page=1&pageSize=50</a></li>
  <li>Lock: <code>POST ${apiBase}/batch/select${tenantQS ? tenantQS + '&' : '?'}all=1&pageSize=50</code></li>
        <li>Current: <a href="${apiBase}/batch/current${tenantQS ? tenantQS + '&' : '?'}all=1">${apiBase}/batch/current${tenantQS ? tenantQS + '&' : '?'}all=1</a></li>
        <li>Finalize (dry-run): <code>POST ${apiBase}/batch/finalize${tenantQS ? tenantQS + '&' : '?'}dryRun=1</code></li>
      </ul>
    </div>
  </body>
</html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(html);
      }

      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Top Scoring Leads · API Parameters</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica Neue,sans-serif; margin: 24px; line-height: 1.45; color: #111827; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
      .badge { display: inline-block; padding: 2px 8px; background: #eef2ff; color: #3730a3; border-radius: 9999px; font-size: 12px; }
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 12px 0 20px; }
      .h { margin: 0 0 8px; }
      .muted { color: #6b7280; }
      .params dt { font-weight: 600; }
      .params dd { margin: 0 0 8px 0; }
      a { color: #2563eb; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <h1 class="h">Top Scoring Leads · API Parameters</h1>
    <p class="muted">Environment: <span class="badge">${process.env.NODE_ENV || 'development'}</span> · Tenant: <span class="badge">${client || 'not set'}</span></p>
    <p>JSON metadata: <a href="${apiBase}/_meta/params${tenantQS}">${apiBase}/_meta/params${tenantQS}</a></p>

    <div class="card">
      <h2 class="h">Common parameters</h2>
      <dl class="params">
        <dt><code>x-client-id</code> (header)</dt>
        <dd>Multi-tenant: client identifier header. Equivalent to <code>clientId</code>/<code>testClient</code> query.</dd>
        <dt><code>clientId</code> (query)</dt>
        <dd>Multi-tenant: client identifier (same as header). ${client ? `Current: <code>${client}</code>` : ''}</dd>
        <dt><code>testClient</code> (query)</dt>
        <dd>Legacy alias for <code>clientId</code>.</dd>
  <!-- dryRun removed -->
      </dl>
    </div>

    <div class="card">
      <h2 class="h">GET /status</h2>
      <p>Public status for the feature.</p>
      <p>Try: <a href="${apiBase}/status${tenantQS}">${apiBase}/status${tenantQS}</a></p>
    </div>

    <div class="card">
      <h2 class="h">GET /eligible</h2>
      <dl class="params">
        <dt><code>threshold</code> (number)</dt><dd>Override stored AI score threshold.</dd>
        <dt><code>limit</code> / <code>pageSize</code> (integer)</dt><dd>Page size (max 200). Default 50.</dd>
        <dt><code>page</code> (integer)</dt><dd>1-based page index. Default 1.</dd>
      </dl>
      <p>Try: <a href="${apiBase}/eligible${tenantQS ? tenantQS + '&' : '?'}page=1&pageSize=50">${apiBase}/eligible${tenantQS ? tenantQS + '&' : '?'}page=1&pageSize=50</a></p>
    </div>

    <div class="card">
      <h2 class="h">GET /batch/current</h2>
      <dl class="params">
        <dt><code>all</code> (boolean)</dt><dd>When true, page through all with safety caps.</dd>
        <dt><code>limit</code> / <code>pageSize</code> (integer)</dt><dd>Max items to return. Default 200.</dd>
      </dl>
      <p>Try: <a href="${apiBase}/batch/current${tenantQS}">${apiBase}/batch/current${tenantQS}</a></p>
    </div>

    <div class="card">
      <h2 class="h">POST /batch/select</h2>
      <dl class="params">
        <dt><code>all</code> (boolean)</dt><dd>Auto-select eligible records instead of providing body IDs.</dd>
        <dt><code>mode</code> (string)</dt><dd>Alternate: <code>mode=all</code>.</dd>
        <dt><code>pageSize</code> (integer)</dt><dd>In all-mode, cap how many to select (implies append).</dd>
        <dt><code>testPageSize</code> (integer)</dt><dd>Legacy alias for <code>pageSize</code>.</dd>
        <dt><code>append</code> (boolean)</dt><dd>In all-mode, append to current selection. Implied when <code>pageSize</code> is provided.</dd>
        <dt><code>replace</code> (boolean)</dt><dd>In all-mode, replace current selection (default when <code>pageSize</code> not provided).</dd>
      </dl>
      <p class="muted">Body (explicit mode): <code>{ "recordIds": ["recXXXX", "recYYYY"] }</code> (max 200)</p>
  <p>Example (cap 100): <code>POST ${apiBase}/batch/select${tenantQS ? tenantQS + '&' : '?'}all=1&pageSize=100</code></p>
    </div>

    <div class="card">
      <h2 class="h">POST /batch/finalize</h2>
      <p>Date-stamp and clear temp status for selected batch.</p>
      <p class="muted">Optional body: <code>{ "recordIds": ["rec..."] }</code> (max 200)</p>
  <p>Example: <code>POST ${apiBase}/batch/finalize${tenantQS ? tenantQS + '&' : ''}</code></p>
    </div>

    <div class="card">
      <h2 class="h">POST /batch/reset</h2>
      <p>Clear temp status for current staged batch (no date stamping).</p>
  <p>Example: <code>POST ${apiBase}/batch/reset${tenantQS ? tenantQS + '&' : ''}</code></p>
    </div>

    <div class="card">
      <h2 class="h">GET /export/last · PUT /export/last</h2>
      <p>Read or update last export timestamp. PUT body: <code>{ "at": "2025-08-18T12:34:56Z" }</code> (or epoch ms).</p>
      <p>Try: <a href="${apiBase}/export/last${tenantQS}">${apiBase}/export/last${tenantQS}</a></p>
    </div>

    <div class="card">
      <h2 class="h">GET /threshold · PUT /threshold</h2>
      <p>Read or set AI Score threshold. PUT body: <code>{ "value": 42 }</code></p>
      <p>Try: <a href="${apiBase}/threshold${tenantQS}">${apiBase}/threshold${tenantQS}</a></p>
    </div>

    <p class="muted">Tip: If you’re using the UI page, its URL supports <code>batchSize</code> (cap) and <code>clientId</code>/<code>testClient</code> (tenant), e.g. <code>http://localhost:3000/top-scoring-leads?clientId=${encodeURIComponent(client || 'YOUR-CLIENT')}&batchSize=50</code>.</p>
  </body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Gate subsequent routes behind the feature flag
  router.use((req, res, next) => {
    if (!ENABLED) {
      return res.status(404).json({ ok: false, error: 'Not Found' });
    }
    next();
  });

  // Admin-only sanity check: validates required Airtable tables/fields exist
  // Header: Authorization: Bearer <PB_WEBHOOK_SECRET>
  router.post('/dev/sanity-check', async (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${REPAIR_SECRET}`) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    // Use per-request base so sanity checks validate the intended client base
    const b = await getBaseForRequest(req);
    if (!b) {
      return res.status(500).json({
        ok: false,
        error: 'Airtable base is not configured on this server (AIRTABLE_API_KEY/AIRTABLE_BASE_ID missing).',
      });
    }

  const result = {
      ok: true,
      tables: {},
      fields: {},
      notes: []
    };

    // Helper: check if a table exists by attempting a select
  async function checkTable(tableName) {
      try {
    await b(tableName).select({ maxRecords: 1 }).firstPage();
        result.tables[tableName] = true;
      } catch (e) {
        result.tables[tableName] = false;
        result.notes.push(`Table check failed for "${tableName}": ${e?.message || e}`);
      }
    }

    // Helper: check if a field exists by requesting it via the `fields` option
  async function checkField(tableName, fieldName) {
      const key = `${tableName}::${fieldName}`;
      try {
    await b(tableName).select({ fields: [fieldName], maxRecords: 1 }).firstPage();
        result.fields[key] = true;
      } catch (e) {
        result.fields[key] = false;
        result.notes.push(`Field check failed for ${key}: ${e?.message || e}`);
      }
    }

    const LEADS = 'Leads';
    const CREDENTIALS = 'Credentials';

    await checkTable(LEADS);
    await checkTable(CREDENTIALS);

    // Leads table fields required by the feature
    const leadsFields = [
      'AI Score',
      'Scoring Status',
      'LinkedIn Connection Status',
      'Temp LH Batch Status',
      'Date Added to LH Campaign',
      'LinkedIn Profile URL',
      'First Name',
      'Last Name'
    ];
    for (const f of leadsFields) {
      // Skip field check if table missing to avoid redundant errors
      if (result.tables[LEADS]) {
        // eslint-disable-next-line no-await-in-loop
        await checkField(LEADS, f);
      }
    }

    // Credentials field for threshold persistence
    if (result.tables[CREDENTIALS]) {
      await checkField(CREDENTIALS, 'AI Score Threshold Input');
      // Optional fields to persist the last export time (support either name)
      await checkField(CREDENTIALS, 'Last LH Leads Export');
      await checkField(CREDENTIALS, 'Top Leads Last Export At');
    }

    res.json(result);
  });

  // GET /threshold - read the current threshold from Credentials
  router.get('/threshold', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });

      const creds = await b('Credentials').select({ maxRecords: 1 }).firstPage();
      const row = creds && creds[0];
      const raw = row ? row.get('AI Score Threshold Input') : undefined;
      const value = raw === undefined || raw === null || raw === '' ? null : Number(raw);
      res.json({ ok: true, value, recordId: row ? row.id : null });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // PUT /threshold - update threshold in Credentials (immediate persistence)
  router.put('/threshold', async (req, res) => {
    try {
      const { value } = req.body || {};
      const num = Number(value);
      if (!Number.isFinite(num)) return res.status(400).json({ ok: false, error: 'value must be a number' });
      // Optional: clamp to sane range
      const clamped = Math.max(0, Math.min(1000, num));

      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });
      const creds = await b('Credentials').select({ maxRecords: 1 }).firstPage();
      const row = creds && creds[0];
      if (!row) return res.status(500).json({ ok: false, error: 'No Credentials row found' });

      await b('Credentials').update(row.id, { 'AI Score Threshold Input': clamped });
      res.json({ ok: true, value: clamped, recordId: row.id });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /eligible - list eligible leads based on threshold and filters (supports paging)
  router.get('/eligible', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });

      // Load threshold (allow query override)
      const threshold = await getThresholdForRequest(req, b);

      const pageSize = Math.max(1, Math.min(200, parseInt(req.query.limit || req.query.pageSize || '50', 10)));
      const page = Math.max(1, parseInt(req.query.page || '1', 10));

      // Build Airtable formula
      const formula = buildEligibleFormula(threshold);

      // Collect enough to determine hasMore beyond requested page
      const maxToCollect = (page * pageSize) + 1;
      const collected = await fetchEligibleItemsPaged(b, formula, maxToCollect);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const items = collected.slice(start, end);
      const hasMore = collected.length > end;

      res.json({ ok: true, appliedThreshold: threshold, count: items.length, items, page, pageSize, hasMore });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /eligible/count - return total eligible count (respect threshold; apply safety cap)
  router.get('/eligible/count', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });

      const threshold = await getThresholdForRequest(req, b);
      const formula = buildEligibleFormula(threshold);
      const MAX_SELECT_ALL = parseInt(process.env.TOP_LEADS_MAX_SELECT_ALL || '5000', 10);
      // Optional limit to count fewer for performance; never exceed MAX_SELECT_ALL
      const limit = Math.max(1, Math.min(MAX_SELECT_ALL, parseInt(req.query.limit || `${MAX_SELECT_ALL}`, 10)));

      const total = await countEligiblePaged(b, formula, limit);
      // If total == limit, caller should assume there may be more beyond cap
      res.json({ ok: true, appliedThreshold: threshold, total, limit });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /export/last - read the last export timestamp from Credentials (optional feature)
  router.get('/export/last', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });
      const creds = await b('Credentials').select({ maxRecords: 1 }).firstPage();
      const row = creds && creds[0];
      const FIELD_NEW = 'Last LH Leads Export';
      const FIELD_OLD = 'Top Leads Last Export At';
      const raw = row ? (row.get(FIELD_NEW) || row.get(FIELD_OLD)) : undefined;
      // Airtable returns a JS Date for date fields; normalise to epoch ms number
      const at = raw ? new Date(raw).getTime() : null;
      res.json({ ok: true, at });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // PUT /export/last - update the last export timestamp in Credentials (requires field to exist)
  // Body: { at?: string | number } - iso string or epoch ms; defaults to now
  router.put('/export/last', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });
      const creds = await b('Credentials').select({ maxRecords: 1 }).firstPage();
      const row = creds && creds[0];
      if (!row) return res.status(500).json({ ok: false, error: 'No Credentials row found' });

      const atInput = req.body && req.body.at;
      const atDate = atInput ? new Date(atInput) : new Date();
      if (isNaN(atDate.getTime())) return res.status(400).json({ ok: false, error: 'Invalid at timestamp' });

      const FIELD_NEW = 'Last LH Leads Export';
      const FIELD_OLD = 'Top Leads Last Export At';
      // Try updating the new field name first; if missing, try the old one
      let updatedField = null;
      try {
        await b('Credentials').update(row.id, { [FIELD_NEW]: atDate });
        updatedField = FIELD_NEW;
      } catch (err1) {
        try {
          await b('Credentials').update(row.id, { [FIELD_OLD]: atDate });
          updatedField = FIELD_OLD;
        } catch (err2) {
          return res.status(400).json({
            ok: false,
            error: `Update failed: ${err1?.message || err1}. Ensure a Date field named "${FIELD_NEW}" exists on the Credentials table.`,
          });
        }
      }

      res.json({ ok: true, at: atDate.getTime(), recordId: row.id, field: updatedField });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /eligible/all - return ALL eligible leads without pagination
  router.get('/eligible/all', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });
      
      // Get threshold using the existing helper
      const threshold = await getThresholdForRequest(req, b);
      
      // Use the existing buildEligibleFormula function
      const filterFormula = buildEligibleFormula(threshold);
      
      // Use eachPage to get ALL matching records without pagination limits
      let allLeads = [];
      await new Promise((resolve, reject) => {
        b('Leads')
          .select({
            filterByFormula: filterFormula,
            sort: [{ field: 'AI Score', direction: 'desc' }]
          })
          .eachPage(
            (records, fetchNextPage) => {
              const items = records.map(r => ({
                id: r.id,
                score: r.get('AI Score') ?? null,
                firstName: r.get('First Name') || null,
                lastName: r.get('Last Name') || null,
                linkedinUrl: r.get('LinkedIn Profile URL') || null,
                scoringStatus: r.get('Scoring Status') || null,
                connectionStatus: r.get('LinkedIn Connection Status') || null
              }));
              allLeads = [...allLeads, ...items];
              fetchNextPage();
            },
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
      });
      
      return res.json(allLeads);
    } catch (e) {
      console.error('Error in /eligible/all:', e);
      await logCriticalError(error, req).catch(() => {});
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Utilities for batch updates
  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function updateInChunks(b, table, updates, chunkSize = 10) {
    // Airtable REST API limit: max 10 records per update/create request
    const size = Math.min(10, Math.max(1, chunkSize || 10));
    const chunks = chunk(updates, size);
    let updated = 0;
    for (const c of chunks) {
      const res = await b(table).update(c);
      updated += res.length;
    }
    return updated;
  }

  // GET /eligible/all - return ALL eligible leads without pagination
  router.get('/eligible/all', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });
      
      // Get threshold using the existing helper
      const threshold = await getThresholdForRequest(req, b);
      
      // Use the existing buildEligibleFormula function
      const filterFormula = buildEligibleFormula(threshold);
      
      // Use eachPage to get ALL matching records without pagination limits
      let allLeads = [];
      await new Promise((resolve, reject) => {
        b('Leads')
          .select({
            filterByFormula: filterFormula,
            sort: [{ field: 'AI Score', direction: 'desc' }]
          })
          .eachPage(
            (records, fetchNextPage) => {
              const items = records.map(r => ({
                id: r.id,
                score: r.get('AI Score') ?? null,
                firstName: r.get('First Name') || null,
                lastName: r.get('Last Name') || null,
                linkedinUrl: r.get('LinkedIn Profile URL') || null,
                scoringStatus: r.get('Scoring Status') || null,
                connectionStatus: r.get('LinkedIn Connection Status') || null
              }));
              allLeads = [...allLeads, ...items];
              fetchNextPage();
            },
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
      });
      
      return res.json(allLeads);
    } catch (e) {
      console.error('Error in /eligible/all:', e);
      await logCriticalError(error, req).catch(() => {});
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // GET /batch/current - return current batch (Temp LH Batch Status = Selected for Current LH Batch)
  router.get('/batch/current', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });
      const BATCH_SELECTED = 'Selected for Current LH Batch';

      const MAX_ALL = parseInt(process.env.TOP_LEADS_MAX_SELECT_ALL || '5000', 10);
      const providedLimit = req.query.limit || req.query.pageSize;
      let pageSize = Math.max(1, Math.min(5000, parseInt(providedLimit || '200', 10)));
      const all = parseBoolFlag(req.query.all, false) || pageSize > 200;
      if (all && !providedLimit) {
        // If caller asked for all but didn't pass a limit, use the high safety cap
        pageSize = MAX_ALL;
      }

      if (!all) {
        const records = await b('Leads').select({
          filterByFormula: `{Temp LH Batch Status} = '${BATCH_SELECTED}'`,
          sort: [{ field: 'AI Score', direction: 'desc' }],
          maxRecords: pageSize
        }).firstPage();

        const items = (records || []).map((r) => ({
          id: r.id,
          score: r.get('AI Score') ?? null,
          firstName: r.get('First Name') || null,
          lastName: r.get('Last Name') || null,
          linkedinUrl: r.get('LinkedIn Profile URL') || null,
          scoringStatus: r.get('Scoring Status') || null,
          connectionStatus: r.get('LinkedIn Connection Status') || null,
          batchStatus: r.get('Temp LH Batch Status') || null,
          dateAddedToLH: r.get('Date Added to LH Campaign') || null
        }));

        return res.json({ ok: true, count: items.length, items });
      }

      // Gather more than 200 by paging
      const items = [];
      await new Promise((resolve, reject) => {
        b('Leads')
          .select({
            filterByFormula: `{Temp LH Batch Status} = '${BATCH_SELECTED}'`,
            sort: [{ field: 'AI Score', direction: 'desc' }],
            pageSize: 100,
          })
          .eachPage(
            (records, fetchNextPage) => {
              for (const r of records) {
                if (items.length >= pageSize) break;
                items.push({
                  id: r.id,
                  score: r.get('AI Score') ?? null,
                  firstName: r.get('First Name') || null,
                  lastName: r.get('Last Name') || null,
                  linkedinUrl: r.get('LinkedIn Profile URL') || null,
                  scoringStatus: r.get('Scoring Status') || null,
                  connectionStatus: r.get('LinkedIn Connection Status') || null,
                  batchStatus: r.get('Temp LH Batch Status') || null,
                  dateAddedToLH: r.get('Date Added to LH Campaign') || null
                });
              }
              if (items.length >= pageSize) return resolve();
              fetchNextPage();
            },
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
      });

      res.json({ ok: true, count: items.length, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // POST /batch/select - replace current batch with provided recordIds (max 200)
  // Body: { recordIds: string[] }
  router.post('/batch/select', async (req, res) => {
    try {
  // Honor dry-run to support UI preview without mutating Airtable
  const dryRun = parseBoolFlag(req.query.dryRun, false);
      const allMode = parseBoolFlag(req.query.all, false) || parseBoolFlag(req.query.mode === 'all', false);
      const pageSizeRaw = req.query.pageSize || req.query.testPageSize;

      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });

      const BATCH_SELECTED = 'Selected for Current LH Batch';


      if (allMode) {
        // Auto-select eligible records. Default behavior is replace; append only when append=1.
        const threshold = await getThresholdForRequest(req, b);
        const formula = buildEligibleFormula(threshold);

        // Safety cap for select-all operations
        const MAX_SELECT_ALL = parseInt(process.env.TOP_LEADS_MAX_SELECT_ALL || '5000', 10);
  const pageSize = pageSizeRaw !== undefined ? Math.max(1, Math.min(500, parseInt(pageSizeRaw, 10) || 0)) : null;
        const maxToCollect = pageSize ? pageSize + 1 : MAX_SELECT_ALL + 1; // +1 to detect hasMore

        const ids = await fetchEligibleIdsPaged(b, formula, maxToCollect);
        const hasMore = ids.length > (pageSize || MAX_SELECT_ALL);
        const idsToSet = ids.slice(0, pageSize || MAX_SELECT_ALL);

  // Determine replace vs append
  // New rule: default to replace. append=1 forces append; replace=1 forces replace.
  const explicitAppend = parseBoolFlag(req.query.append, false);
  const explicitReplace = parseBoolFlag(req.query.replace, false);
  const appendMode = explicitAppend ? true : (explicitReplace ? false : false);

        // Prepare updates
        let clearUpdates = [];
        if (!appendMode) {
          // Clear ALL currently selected (page through all, no artificial 200/5000 caps)
          const currentIds = [];
          await new Promise((resolve, reject) => {
            b('Leads')
              .select({
                filterByFormula: `{Temp LH Batch Status} = '${BATCH_SELECTED}'`,
                // Don't fetch extra fields we don't need
                fields: [],
                pageSize: 100,
              })
              .eachPage(
                (records, fetchNextPage) => {
                  for (const r of records) currentIds.push(r.id);
                  fetchNextPage();
                },
                (err) => { if (err) reject(err); else resolve(); }
              );
          });
          clearUpdates = currentIds.map(id => ({ id, fields: { 'Temp LH Batch Status': '' } }));
        }

        const setUpdates = idsToSet.map(id => ({ id, fields: { 'Temp LH Batch Status': BATCH_SELECTED } }));

        // If dryRun, only report what would be changed
        if (dryRun) {
          return res.json({
            ok: true,
            mode: 'all',
            append: appendMode,
            willClear: clearUpdates.length,
            willSet: setUpdates.length,
            hasMore
          });
        }

        // Real mutation path
        let cleared = 0;
        if (clearUpdates.length) cleared = await updateInChunks(b, 'Leads', clearUpdates);
        const setCount = setUpdates.length ? await updateInChunks(b, 'Leads', setUpdates) : 0;

        return res.json({ ok: true, mode: 'all', append: appendMode, cleared, set: setCount, hasMore });
      }

      // Legacy explicit IDs mode (replace current batch)
      const { recordIds } = req.body || {};
      if (!Array.isArray(recordIds) || recordIds.length === 0) {
        return res.status(400).json({ ok: false, error: 'recordIds[] required' });
      }
      if (recordIds.length > 200) {
        return res.status(400).json({ ok: false, error: 'Limit 200 recordIds' });
      }

      // Find currently selected to clear: page through ALL (no arbitrary cap)
      const currentIds = [];
      await new Promise((resolve, reject) => {
        b('Leads')
          .select({
            filterByFormula: `{Temp LH Batch Status} = '${BATCH_SELECTED}'`,
            fields: [],
            pageSize: 100,
          })
          .eachPage(
            (records, fetchNextPage) => {
              for (const r of records) currentIds.push(r.id);
              fetchNextPage();
            },
            (err) => { if (err) reject(err); else resolve(); }
          );
      });

      // Build updates
      const clearUpdates = currentIds.map(id => ({ id, fields: { 'Temp LH Batch Status': '' } }));
      const setUpdates = recordIds.map(id => ({ id, fields: { 'Temp LH Batch Status': BATCH_SELECTED } }));

      // If dryRun, only report counts
      if (dryRun) {
        return res.json({ ok: true, willClear: clearUpdates.length, willSet: setUpdates.length });
      }

      // Real mutation path
      let cleared = 0;
      if (clearUpdates.length) cleared = await updateInChunks(b, 'Leads', clearUpdates);
      const setCount = await updateInChunks(b, 'Leads', setUpdates);

      res.json({ ok: true, cleared, set: setCount });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // POST /batch/finalize - date-stamp and clear temp status
  // Supports two modes:
  // 1) Body contains { recordIds: string[] } -> update exactly these IDs
  // 2) No body.recordIds -> fallback to previously staged batch (Temp LH Batch Status)
  router.post('/batch/finalize', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });
      const BATCH_SELECTED = 'Selected for Current LH Batch';

      let ids = [];
      const bodyIds = req.body && Array.isArray(req.body.recordIds) ? req.body.recordIds : null;
      if (bodyIds && bodyIds.length) {
        ids = bodyIds.slice(0, 200);
      } else {
        // Finalize ALL currently selected (page through all)
        await new Promise((resolve, reject) => {
          b('Leads')
            .select({
              filterByFormula: `{Temp LH Batch Status} = '${BATCH_SELECTED}'`,
              fields: ['Temp LH Batch Status'],
              pageSize: 100,
            })
            .eachPage(
              (records, fetchNextPage) => {
                for (const r of records) ids.push(r.id);
                fetchNextPage();
              },
              (err) => { if (err) reject(err); else resolve(); }
            );
        });
      }

      const now = new Date();
      const updates = ids.map(id => ({ id, fields: { 'Date Added to LH Campaign': now, 'Temp LH Batch Status': '' } }));

  // Always execute updates (dry-run removed)

      const updated = updates.length ? await updateInChunks(b, 'Leads', updates) : 0;
      res.json({ ok: true, updated });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // POST /batch/reset - clear temp status for current staged batch (no date stamping)
  router.post('/batch/reset', async (req, res) => {
    try {
      const b = await getBaseForRequest(req);
      if (!b) return res.status(500).json({ ok: false, error: 'Airtable base not configured' });
      const BATCH_SELECTED = 'Selected for Current LH Batch';

      // Page through ALL currently selected (no 200 limit) and clear
      const ids = [];
      await new Promise((resolve, reject) => {
        b('Leads')
          .select({
            filterByFormula: `{Temp LH Batch Status} = '${BATCH_SELECTED}'`,
            fields: [],
            pageSize: 100,
          })
          .eachPage(
            (records, fetchNextPage) => {
              for (const r of records) ids.push(r.id);
              fetchNextPage();
            },
            (err) => { if (err) reject(err); else resolve(); }
          );
      });

      const updates = ids.map(id => ({ id, fields: { 'Temp LH Batch Status': '' } }));

  // Always execute updates (dry-run removed)

      const cleared = updates.length ? await updateInChunks(b, 'Leads', updates) : 0;
      res.json({ ok: true, cleared });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // INTERNAL DEBUG: list registered routes on this router
  // GET /_debug/routes
  router.get('/_debug/routes', (req, res) => {
    try {
      const list = [];
      const stack = router.stack || [];
      for (const layer of stack) {
        if (layer && layer.route) {
          const path = layer.route.path;
          const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
          list.push({ path, methods });
        }
      }
      res.json({ ok: true, routes: list });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Mount under base path
  try {
    const stack = router.stack || [];
    const summary = stack
      .filter((layer) => layer && layer.route)
      .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods || {}).filter(Boolean) }));
    console.log(`[TopScoringLeads] Routes registered:`, summary);
  } catch (_) {}
  app.use('/api/top-scoring-leads', router);
};
