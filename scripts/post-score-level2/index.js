/**
 * scripts/post-score-level2/index.js
 *
 * Cron-friendly script to trigger multi-tenant post scoring for
 * all Active clients with service level >= MIN_SERVICE_LEVEL (default 2).
 *
 * Required env:
 * - API_PUBLIC_BASE_URL: full URL to the running API (e.g., https://pb-webhook-server-staging.onrender.com)
 *
 * Optional env (maps to query params):
 * - LIMIT: number (e.g., 50)
 * - MIN_SERVICE_LEVEL: number (default 2)
 * - DRY_RUN: 'true' | 'false' (default false)
 * - VERBOSE_ERRORS: 'true' | 'false' (default false)
 * - MAX_VERBOSE_ERRORS: number (default 10)
 * - MARK_SKIPS: 'true' | 'false' (default true)
 * - TABLE: leads table override (default 'Leads')
 */

require('dotenv').config();

function buildQuery(params) {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qp.set(k, String(v));
  }
  return qp.toString();
}

async function main() {
  const baseUrl = process.env.API_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new Error('API_PUBLIC_BASE_URL is required');

  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
  const minServiceLevel = process.env.MIN_SERVICE_LEVEL ? parseInt(process.env.MIN_SERVICE_LEVEL, 10) : 2;
  const dryRun = process.env.DRY_RUN === 'true' ? 'true' : undefined;
  const verboseErrors = process.env.VERBOSE_ERRORS === 'true' ? 'true' : undefined;
  const maxVerboseErrors = process.env.MAX_VERBOSE_ERRORS ? parseInt(process.env.MAX_VERBOSE_ERRORS, 10) : undefined;
  const markSkips = process.env.MARK_SKIPS === 'false' ? 'false' : undefined; // default true server-side
  const table = process.env.TABLE || undefined;

  const q = buildQuery({
    limit,
    minServiceLevel,
    dryRun,
    verboseErrors,
    maxVerboseErrors,
    markSkips,
    table
  });

  const url = `${baseUrl.replace(/\/$/, '')}/run-post-batch-score-level2${q ? `?${q}` : ''}`;
  const startedAt = Date.now();
  console.log(`[post-score-level2] Triggering: ${url}`);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  const elapsed = Date.now() - startedAt;
  if (!resp.ok) {
    console.error(`[post-score-level2] FAILED status=${resp.status} timeMs=${elapsed} body=`, data);
    process.exitCode = 1;
    return;
  }

  const summary = data && (data.summary || {});
  const processed = summary.totalPostsProcessed || data.processed || 0;
  const scored = summary.totalPostsScored || data.scored || 0;
  console.log(`[post-score-level2] Success processed=${processed} scored=${scored} timeMs=${elapsed}`);
  if (Array.isArray(data?.clientResults)) {
    const brief = data.clientResults.map(r => `${r.clientId}:${r.status}`).join(', ');
    console.log(`[post-score-level2] Clients: ${brief}`);
  }
  console.log('[post-score-level2] Done');
}

main().catch(err => {
  console.error('[post-score-level2] Error:', err.message);
  process.exitCode = 1;
});
