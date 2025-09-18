/**
 * scripts/apify-harvest-level2/index.js
 *
 * Simple cron-friendly script that triggers the all-eligible (service level >= 2)
 * harvesting orchestrator on the API server.
 *
 * Required env:
 * - API_PUBLIC_BASE_URL: full URL to the running API (e.g., https://pb-webhook-server-staging.onrender.com)
 * - PB_WEBHOOK_SECRET: admin secret used by the orchestrator endpoint
 */

require('dotenv').config();

function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  const argUrl = getArg('url');
  const argSecret = getArg('secret');
  const baseUrl = argUrl || process.env.API_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
  const secret = argSecret || process.env.PB_WEBHOOK_SECRET;

  if (!baseUrl) throw new Error('API_PUBLIC_BASE_URL or --url is required');
  if (!secret) throw new Error('PB_WEBHOOK_SECRET or --secret is required');

  const url = `${baseUrl.replace(/\/$/, '')}/api/apify/process-level2`;
  const startedAt = Date.now();
  console.log(`[harvest-level2] Triggering orchestrator: ${url}`);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secret}`,
      'Content-Type': 'application/json'
    }
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  const elapsed = Date.now() - startedAt;
  if (!resp.ok) {
    console.error(`[harvest-level2] FAILED status=${resp.status} timeMs=${elapsed} body=`, data);
    process.exitCode = 1;
    return;
  }

  const processed = (data && data.processed) || (data && data.summary && data.summary.processed) || 0;
  console.log(`[harvest-level2] Success processed=${processed} timeMs=${elapsed}`);
  if (Array.isArray(data?.summaries)) {
    const brief = data.summaries.map(s => `${s.clientId}:${s.status}`).join(', ');
    console.log(`[harvest-level2] Summaries: ${brief}`);
  }
  console.log('[harvest-level2] Done');
}

main().catch(err => {
  console.error('[harvest-level2] Error:', err.message);
  process.exitCode = 1;
});
