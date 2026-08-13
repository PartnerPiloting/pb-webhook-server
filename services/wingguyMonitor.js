// services/wingguyMonitor.js
// The Wingguy watchtower (Guy's spec, 2026-08-13): tell Guy when something is WRONG, with enough
// raw detail in the email that he can paste the whole thing into a Claude session and have it fixed
// — and stay silent otherwise, except a Monday "all green" heartbeat so silence never means the
// checker itself died.
//
// What it watches (daily, 7am Brisbane):
//   1. LANDMARK MISSES — wingguy_selector_health rows the extensions phone home. A landmark that
//      keeps missing = LinkedIn moved the furniture (or one client is being A/B-served new markup).
//      The fix is a selector-store DB row; the email carries the raw rows to make that fast.
//   2. BLIND DRAFTS — wingguy_chat_metrics rows (one per chat turn, written by the chat route).
//      A spike in profile_thin means profile reading is failing broadly (extension fetch broken,
//      portal sync stalled, or LinkedIn changed shape) even if no single landmark looks guilty.
//
// Design rules: never throw into the app (every entry point swallows); no alert-fatigue (email only
// on breach, thresholds env-tunable); state in Postgres so restarts never double-send or skip.

const { Pool } = require('pg');
const { createLogger } = require('../utils/contextLogger');
const { sendAlertEmail } = require('./emailNotificationService');

const log = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'wingguy-monitor' });

const TICK_MS = Number(process.env.WINGGUY_MONITOR_TICK_MS) || 30 * 60 * 1000;   // check the clock every 30 min
const RUN_HOUR = Number(process.env.WINGGUY_MONITOR_HOUR) || 7;                  // Brisbane hour to run after
const MISS_MIN = Number(process.env.WINGGUY_MONITOR_MISS_MIN) || 3;              // landmark: min misses in 24h
const MISS_RATE = Number(process.env.WINGGUY_MONITOR_MISS_RATE) || 0.25;         // landmark: min miss share
const THIN_MIN = Number(process.env.WINGGUY_MONITOR_THIN_MIN) || 4;              // blind drafts: min count in 24h
const THIN_RATE = Number(process.env.WINGGUY_MONITOR_THIN_RATE) || 0.4;          // blind drafts: min share of turns

let pool;
let schemaEnsured = false;
let intervalHandle = null;
let ticking = false;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } });
    pool.on('error', (e) => log.error(`wingguy-monitor pool error: ${e.message}`));
  }
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_monitor_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_chat_metrics (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id TEXT NOT NULL,
      profile_thin BOOLEAN NOT NULL DEFAULT false,
      lead_name TEXT
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS wingguy_chat_metrics_recent_idx ON wingguy_chat_metrics (created_at DESC);
  `);
  schemaEnsured = true;
}

async function withClient(fn) {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

/** One row per chat turn, written by the chat route — fire-and-forget, can never block a draft. */
function recordChatTurn({ tenantId, profileThin, leadName }) {
  withClient((c) => c.query(
    `INSERT INTO wingguy_chat_metrics (tenant_id, profile_thin, lead_name) VALUES ($1, $2, $3)`,
    [String(tenantId || 'unknown'), !!profileThin, String(leadName || '').slice(0, 120) || null],
  )).catch((e) => log.warn(`wingguy-monitor: recordChatTurn failed (non-fatal): ${e.message}`));
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

async function landmarkFindings(client) {
  const { rows } = await client.query(`
    SELECT selector_key, COALESCE(tenant_id, '(shared)') AS tenant, COALESCE(surface, '') AS surface,
           COALESCE(extension_version, '?') AS version,
           count(*) FILTER (WHERE NOT found) AS misses,
           count(*) FILTER (WHERE found) AS founds,
           min(created_at) FILTER (WHERE NOT found) AS first_miss,
           max(created_at) FILTER (WHERE NOT found) AS last_miss
    FROM wingguy_selector_health
    WHERE created_at > now() - interval '24 hours'
    GROUP BY 1, 2, 3, 4
  `);
  const perTenant = rows
    .map((r) => ({ ...r, misses: Number(r.misses), founds: Number(r.founds) }))
    .filter((r) => r.misses >= MISS_MIN && r.misses / (r.misses + r.founds) >= MISS_RATE);

  // Cross-tenant aggregate (added 2026-08-13, from the monitor's own first blind spot): a landmark
  // missing for EVERY client is the strongest possible "LinkedIn moved it" signal, but split per
  // tenant/version each slice can sit under MISS_MIN — the exact shape of the profile_name/headline/
  // location staleness the per-tenant rule failed to flag on day one. A key with ZERO finds anywhere
  // and MISS_MIN total misses alerts regardless of how the misses are spread.
  const byKey = new Map();
  for (const r of rows) {
    const agg = byKey.get(r.selector_key) || { selector_key: r.selector_key, tenant: '(all tenants)', misses: 0, founds: 0, versions: new Set(), tenants: new Set(), last_miss: null };
    agg.misses += Number(r.misses);
    agg.founds += Number(r.founds);
    if (Number(r.misses)) { agg.versions.add(r.version); agg.tenants.add(r.tenant); }
    if (r.last_miss && (!agg.last_miss || r.last_miss > agg.last_miss)) agg.last_miss = r.last_miss;
    byKey.set(r.selector_key, agg);
  }
  const flaggedKeys = new Set(perTenant.map((r) => r.selector_key));
  const deadEverywhere = [...byKey.values()]
    .filter((a) => a.founds === 0 && a.misses >= MISS_MIN && !flaggedKeys.has(a.selector_key))
    .map((a) => ({ ...a, versions: [...a.versions].join(', '), tenants: [...a.tenants].join(', '), note: 'zero finds across ALL tenants in 24h — strongest moved-furniture signal' }));

  return [...perTenant, ...deadEverywhere];
}

async function thinFindings(client) {
  const { rows } = await client.query(`
    SELECT tenant_id, count(*) AS turns, count(*) FILTER (WHERE profile_thin) AS thin,
           array_to_string((array_agg(lead_name ORDER BY created_at DESC) FILTER (WHERE profile_thin))[1:5], ', ') AS recent_thin_leads
    FROM wingguy_chat_metrics
    WHERE created_at > now() - interval '24 hours'
    GROUP BY tenant_id
  `);
  return rows
    .map((r) => ({ ...r, turns: Number(r.turns), thin: Number(r.thin) }))
    .filter((r) => r.thin >= THIN_MIN && r.thin / r.turns >= THIN_RATE);
}

async function weeklySummary(client) {
  const [health, metrics] = await Promise.all([
    client.query(`
      SELECT count(*) AS checks, count(*) FILTER (WHERE NOT found) AS misses,
             count(DISTINCT selector_key) AS keys, array_to_string(array_agg(DISTINCT extension_version), ', ') AS versions
      FROM wingguy_selector_health WHERE created_at > now() - interval '7 days'
    `),
    client.query(`
      SELECT count(*) AS turns, count(*) FILTER (WHERE profile_thin) AS thin, count(DISTINCT tenant_id) AS tenants
      FROM wingguy_chat_metrics WHERE created_at > now() - interval '7 days'
    `),
  ]);
  return { health: health.rows[0], metrics: metrics.rows[0] };
}

// ---------------------------------------------------------------------------
// Email assembly — everything paste-able, nothing that needs this codebase to decode
// ---------------------------------------------------------------------------

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function alertEmailHtml(landmarks, thin) {
  const parts = [];
  parts.push(`<p>Wingguy's daily self-check found something that needs a look. Paste this ENTIRE email into a Claude Code session on the pb-webhook-server repo and ask it to investigate and fix - it contains the raw data needed.</p>`);
  if (landmarks.length) {
    parts.push(`<h3>Landmarks the extensions could not find (last 24h)</h3>
      <p>Meaning: LinkedIn likely moved these on the page (or is A/B-serving one client new markup). Fix path: a corrected selector row in the store (wingguy_selectors) - no extension reinstall needed.</p>
      <pre>${esc(JSON.stringify(landmarks, null, 2))}</pre>`);
  }
  if (thin.length) {
    parts.push(`<h3>Profile-blind drafts above threshold (last 24h)</h3>
      <p>Meaning: drafts are going out generic because no profile material arrived - the hidden-tab profile read, the Portal sync, or the page scrape is failing for these clients.</p>
      <pre>${esc(JSON.stringify(thin, null, 2))}</pre>`);
  }
  parts.push(`<p style="color:#666">Thresholds: landmarks ≥${MISS_MIN} misses and ≥${Math.round(MISS_RATE * 100)}% miss-rate · blind drafts ≥${THIN_MIN} and ≥${Math.round(THIN_RATE * 100)}% of turns. Quiet means healthy; the Monday heartbeat confirms the checker itself is alive.</p>`);
  return parts.join('\n');
}

function heartbeatEmailHtml(sum) {
  const h = sum.health || {};
  const m = sum.metrics || {};
  return `<p>Wingguy monitor - all green this week.</p>
    <ul>
      <li>Landmark checks phoned home: ${esc(h.checks)} across ${esc(h.keys)} landmarks - ${esc(h.misses)} misses (below alert thresholds${Number(h.misses) ? '' : ' - a clean sheet'})</li>
      <li>Drafting turns: ${esc(m.turns)} across ${esc(m.tenants)} client(s) - ${esc(m.thin)} went out profile-blind (below thresholds)</li>
      <li>Extension versions seen in the field: ${esc(h.versions || '(none)')}</li>
    </ul>
    <p style="color:#666">This heartbeat exists so silence on other days provably means "nothing wrong", not "monitor dead".</p>`;
}

// ---------------------------------------------------------------------------
// Scheduling — Brisbane-clocked, restart-safe via wingguy_monitor_state
// ---------------------------------------------------------------------------

function brisbaneNow() {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), weekday: get('weekday') };
}

async function getState(client, key) {
  const r = await client.query(`SELECT value FROM wingguy_monitor_state WHERE key = $1`, [key]);
  return r.rows.length ? r.rows[0].value : null;
}

async function setState(client, key, value) {
  await client.query(
    `INSERT INTO wingguy_monitor_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, value],
  );
}

/** The daily check. force=true (the run-now script) skips the clock and the already-ran-today gate. */
async function runDailyCheck({ force = false } = {}) {
  return withClient(async (client) => {
    const now = brisbaneNow();
    if (!force) {
      if (now.hour < RUN_HOUR) return { ran: false, reason: 'before run hour' };
      if ((await getState(client, 'last_daily')) === now.date) return { ran: false, reason: 'already ran today' };
    }
    const [landmarks, thin] = await Promise.all([landmarkFindings(client), thinFindings(client)]);
    let emailed = false;
    if (landmarks.length || thin.length) {
      const issues = landmarks.length + thin.length;
      const r = await sendAlertEmail(
        `⚠ Wingguy monitor: ${issues} issue${issues === 1 ? '' : 's'} need${issues === 1 ? 's' : ''} a look (${now.date})`,
        alertEmailHtml(landmarks, thin),
      );
      emailed = !!(r && r.success);
      log.info(`wingguy-monitor daily: ${landmarks.length} landmark + ${thin.length} thin finding(s), email ${emailed ? 'sent' : 'FAILED'}`);
    } else {
      log.info('wingguy-monitor daily: all green, no email');
    }
    if (!force) await setState(client, 'last_daily', now.date);
    return { ran: true, landmarks, thin, emailed };
  });
}

async function runWeeklyHeartbeat({ force = false } = {}) {
  return withClient(async (client) => {
    const now = brisbaneNow();
    if (!force) {
      if (now.weekday !== 'Mon' || now.hour < RUN_HOUR) return { ran: false, reason: 'not Monday morning' };
      if ((await getState(client, 'last_heartbeat')) === now.date) return { ran: false, reason: 'already sent today' };
    }
    const sum = await weeklySummary(client);
    const r = await sendAlertEmail(`Wingguy monitor: all green this week (${now.date})`, heartbeatEmailHtml(sum));
    if (!force) await setState(client, 'last_heartbeat', now.date);
    log.info(`wingguy-monitor heartbeat: email ${r && r.success ? 'sent' : 'FAILED'}`);
    return { ran: true, summary: sum, emailed: !!(r && r.success) };
  });
}

function startWingguyMonitor() {
  if (String(process.env.WINGGUY_MONITOR || 'on').toLowerCase() === 'off') {
    log.info('wingguy-monitor: disabled via WINGGUY_MONITOR=off');
    return;
  }
  if (intervalHandle) return;
  log.info(`wingguy-monitor: starting (tick every ${Math.round(TICK_MS / 60000)} min, runs after ${RUN_HOUR}:00 Brisbane)`);
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runDailyCheck();
      await runWeeklyHeartbeat();
    } catch (e) {
      log.error(`wingguy-monitor tick failed (non-fatal): ${e.message}`);
    } finally {
      ticking = false;
    }
  };
  intervalHandle = setInterval(tick, TICK_MS);
  setTimeout(tick, 60 * 1000);   // first look one minute after boot, not mid-startup
}

module.exports = { startWingguyMonitor, runDailyCheck, runWeeklyHeartbeat, recordChatTurn };
