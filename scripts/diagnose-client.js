#!/usr/bin/env node

/**
 * diagnose-client.js — "Why aren't this client's leads being scored?"
 *
 * One-shot health check for a single client's lead-scoring pipeline.
 * Pulls everything together that normally lives in three separate places:
 *   1. The client's record in the master Clients base (is it set up / active?)
 *   2. The client's own Leads table (how many leads are waiting?)
 *   3. The Client Run Results log + the scoring cron (when did it last run / next run?)
 *
 * ...then prints a plain-English VERDICT — most importantly distinguishing
 * "nothing's wrong, the leads just arrived after the last run, they'll score
 * at the next one" from "these leads sat through a run and still didn't score,
 * something is actually broken."
 *
 * Credentials: you don't need any local .env setup beyond RENDER_API_KEY
 * (already in .env.local). The script pulls AIRTABLE_API_KEY and
 * MASTER_CLIENTS_BASE_ID straight from Render's env groups, the same place
 * production reads them.
 *
 * Usage:
 *   node scripts/diagnose-client.js "Alasdair Bell"      # check by name (partial ok)
 *   node scripts/diagnose-client.js Alasdair-Bell        # or by Client ID
 *   node scripts/diagnose-client.js Alasdair-Bell --score  # also kick off a scoring run now
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // also pick up plain .env if present
const Airtable = require('airtable');

// ---- Constants -------------------------------------------------------------
const TZ = 'Australia/Brisbane';                 // display timezone
const LEAD_SCORING_CRON_ID = 'crn-d3rhs1ndiees73bne5l0'; // cron-fire-and-forget-batch-processing-main
const KNOWN_AUTH_ENV_GROUP = 'evg-d3o594qli9vc73brb4cg'; // "Authentication & API Keys" (fast path)
const PROD_BASE_URL = 'https://pb-webhook-server.onrender.com';
const NEEDED_KEYS = ['AIRTABLE_API_KEY', 'MASTER_CLIENTS_BASE_ID'];

// ---- Tiny helpers ----------------------------------------------------------
const fmt = (d) => d
  ? new Date(d).toLocaleString('en-AU', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })
  : '—';

function renderHeaders() {
  if (!process.env.RENDER_API_KEY) throw new Error('RENDER_API_KEY not found in .env.local');
  return { headers: { Authorization: 'Bearer ' + process.env.RENDER_API_KEY } };
}

async function rget(path) {
  const r = await fetch('https://api.render.com/v1' + path, renderHeaders());
  if (!r.ok) throw new Error(`Render API ${path} -> ${r.status}`);
  return r.json();
}

// Pull the Airtable creds from Render env groups (fast path = known group, then scan).
async function loadCreds() {
  const have = () => NEEDED_KEYS.every((k) => process.env[k]);
  if (have()) return; // already in the environment, nothing to do

  const tryGroup = (g) => (g.envVars || []).forEach((e) => {
    if (NEEDED_KEYS.includes(e.key) && !process.env[e.key]) process.env[e.key] = e.value;
  });

  try { tryGroup(await rget('/env-groups/' + KNOWN_AUTH_ENV_GROUP)); } catch { /* fall through to scan */ }
  if (have()) return;

  const groups = await rget('/env-groups?limit=100');
  for (const g of (Array.isArray(groups) ? groups : [])) {
    if (have()) break;
    const id = g.envGroup ? g.envGroup.id : g.id;
    try { tryGroup(await rget('/env-groups/' + id)); } catch { /* ignore */ }
  }
  if (!have()) throw new Error('Could not find AIRTABLE_API_KEY / MASTER_CLIENTS_BASE_ID in Render env groups');
}

// Next daily run time given a UTC hour (cron "0 H * * *").
function nextRunFromUtcHour(hour) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// Parse the leading integer out of a Service Level like "1-Lead Scoring".
function serviceLevelNum(v) {
  const m = String(v ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// ---- Main ------------------------------------------------------------------
(async () => {
  const args = process.argv.slice(2);
  const doScore = args.includes('--score');
  const query = args.filter((a) => !a.startsWith('--')).join(' ').trim();

  if (!query) {
    console.log('Usage: node scripts/diagnose-client.js "<client name or Client ID>" [--score]');
    process.exit(1);
  }

  await loadCreds();
  const apiKey = process.env.AIRTABLE_API_KEY;
  const masterBase = new Airtable({ apiKey }).base(process.env.MASTER_CLIENTS_BASE_ID);

  // 1) Find the client in the master Clients table -------------------------
  const clients = await masterBase('Clients').select({
    fields: ['Client ID', 'Client Name', 'Status', 'Airtable Base ID', 'Service Level', 'Processing Stream'],
  }).all();

  const q = query.toLowerCase();
  const idOrNameEq = (c) =>
    String(c.get('Client ID') || '').toLowerCase() === q ||
    String(c.get('Client Name') || '').toLowerCase() === q;
  const partial = (c) =>
    String(c.get('Client ID') || '').toLowerCase().includes(q) ||
    String(c.get('Client Name') || '').toLowerCase().includes(q);

  let matches = clients.filter(idOrNameEq);
  if (matches.length === 0) matches = clients.filter(partial);

  if (matches.length === 0) {
    console.log(`❌ No client matching "${query}".\n\nKnown clients:`);
    clients.forEach((c) => console.log(`   - ${c.get('Client Name')} (${c.get('Client ID')})`));
    process.exit(1);
  }
  if (matches.length > 1) {
    console.log(`⚠️  "${query}" matched ${matches.length} clients — be more specific:`);
    matches.forEach((c) => console.log(`   - ${c.get('Client Name')} (${c.get('Client ID')})`));
    process.exit(1);
  }

  const c = matches[0];
  const clientId = c.get('Client ID');
  const status = c.get('Status');
  const baseId = c.get('Airtable Base ID');
  const svcNum = serviceLevelNum(c.get('Service Level'));
  const stream = c.get('Processing Stream');

  console.log(`\n${'='.repeat(64)}`);
  console.log(`CLIENT  ${c.get('Client Name')} (${clientId})`);
  console.log('='.repeat(64));
  console.log(`  Status:        ${status}  ${status === 'Active' ? '✅' : '⚠️  not Active — will be skipped'}`);
  console.log(`  Service Level: ${c.get('Service Level')}  ${svcNum >= 1 ? '✅ (lead scoring on)' : '⚠️  no lead scoring'}`);
  console.log(`  Stream:        ${stream}`);
  console.log(`  Base ID:       ${baseId || '⚠️  MISSING — scorer cannot reach their leads'}`);

  // 2) Look at the scoring cron --------------------------------------------
  let cronHourUtc = 2, cronSuspended = false, cronKnown = false;
  try {
    const cron = await rget('/services/' + LEAD_SCORING_CRON_ID);
    cronSuspended = cron.suspended === 'suspended';
    const sched = cron.serviceDetails && cron.serviceDetails.schedule; // e.g. "0 2 * * *"
    const hr = sched && sched.split(/\s+/)[1];
    if (hr && hr !== '*') { cronHourUtc = parseInt(hr, 10); cronKnown = true; }
  } catch { /* non-fatal */ }

  if (!baseId) { printVerdictNoBase(); return; }

  // 3) Inspect their Leads table -------------------------------------------
  const clientBase = new Airtable({ apiKey }).base(baseId);
  let leads;
  try {
    leads = await clientBase('Leads').select({
      fields: ['Scoring Status', 'Date Scored', 'Profile Full JSON'],
    }).all();
  } catch (e) {
    console.log(`\n❌ Could not read their Leads table: ${e.message}`);
    return;
  }

  const byStatus = {};
  let toBeScored = 0, toBeScoredMissingJson = 0;
  let newestWaiting = null;
  for (const r of leads) {
    const s = r.get('Scoring Status') || '(blank)';
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (s === 'To Be Scored') {
      toBeScored++;
      const j = r.get('Profile Full JSON');
      if (!j || String(j).trim().length < 3) toBeScoredMissingJson++;
      const t = new Date(r._rawJson.createdTime);
      if (!newestWaiting || t > newestWaiting) newestWaiting = t;
    }
  }

  console.log(`\nLEADS (${leads.length} total)`);
  Object.entries(byStatus).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  if (toBeScored > 0) {
    console.log(`  → of "To Be Scored", ${toBeScored - toBeScoredMissingJson}/${toBeScored} have a profile (scorable)` +
      (toBeScoredMissingJson ? `, ${toBeScoredMissingJson} missing profile JSON ⚠️` : ' ✅'));
    console.log(`  → newest waiting lead added: ${fmt(newestWaiting)}`);
  }

  // 4) Recent scoring runs for this client ---------------------------------
  const runs = await masterBase('Client Run Results').select({
    filterByFormula: `{Client ID} = "${clientId}"`,
  }).all();
  runs.sort((a, b) => new Date(b._rawJson.createdTime) - new Date(a._rawJson.createdTime));

  console.log('\nSCORING RUNS (last 3)');
  if (runs.length === 0) {
    console.log('  (none recorded yet)');
  } else {
    runs.slice(0, 3).forEach((r) => {
      const log = r.get('Progress Log') || '';
      const line = (log.split('\n').find((l) => /Lead Scoring:/.test(l) && !/Started/.test(l))
        || log.split('\n').find((l) => /Lead Scoring:/.test(l)) || '').trim();
      console.log(`  ${fmt(r._rawJson.createdTime)}  → ${line.replace(/^\[[^\]]*\]\s*/, '') || '(no lead-scoring line)'}`);
    });
  }
  const lastRun = runs.length ? new Date(runs[0]._rawJson.createdTime) : null;
  const nextRun = nextRunFromUtcHour(cronHourUtc);

  // 5) VERDICT --------------------------------------------------------------
  console.log(`\n${'─'.repeat(64)}`);
  console.log('VERDICT');
  console.log('─'.repeat(64));

  if (cronSuspended) {
    console.log('🛑 The lead-scoring cron is SUSPENDED on Render — no client is being');
    console.log('   scored automatically. That is the problem. Re-enable the cron');
    console.log(`   ("${LEAD_SCORING_CRON_ID}") and leads will start scoring again.`);
  } else if (status !== 'Active') {
    console.log(`⚠️  This client's Status is "${status}", not "Active", so the scorer skips`);
    console.log('   them entirely. Set Status = Active to enable scoring.');
  } else if (svcNum < 1) {
    console.log('⚠️  Service Level has no lead scoring. Set it to 1+ to enable scoring.');
  } else if (toBeScored === 0) {
    console.log('✅ No leads are waiting to be scored. Everything that has arrived has');
    console.log('   already been scored (or there are no leads yet). Nothing to do.');
  } else if (lastRun && newestWaiting > lastRun) {
    console.log(`✅ Nothing is wrong. ${toBeScored} lead(s) are waiting, but they were added`);
    console.log(`   AFTER the last scoring run (last run: ${fmt(lastRun)}).`);
    console.log(`   They'll be scored automatically at the next run: ${fmt(nextRun)}.`);
    if (toBeScoredMissingJson) {
      console.log(`   (Note: ${toBeScoredMissingJson} of them have no profile JSON yet and will be`);
      console.log("    skipped as 'missing data' until LinkedHelper fills that in.)");
    }
    console.log('   To score them now instead, re-run with --score.');
  } else {
    console.log(`⚠️  ${toBeScored} lead(s) are waiting AND were already present during the last`);
    console.log(`   run (${fmt(lastRun)}) — yet still unscored. This looks like a real`);
    console.log('   problem worth investigating.');
    if (toBeScoredMissingJson === toBeScored) {
      console.log("   Likely cause: NONE of them have profile JSON, so the scorer skips");
      console.log('   them as "missing critical data". Check LinkedHelper is populating');
      console.log('   the Profile Full JSON field.');
    } else if (toBeScoredMissingJson) {
      console.log(`   (${toBeScoredMissingJson} of them are also missing profile JSON.)`);
    }
  }

  // 6) Optional: trigger a scoring run now ---------------------------------
  if (doScore) {
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`Triggering a scoring run for ${clientId} (stream ${stream || 1})…`);
    const url = `${PROD_BASE_URL}/run-batch-score-v2?clientId=${encodeURIComponent(clientId)}&stream=${stream || 1}&limit=500`;
    try {
      const r = await fetch(url);
      const body = await r.json().catch(() => ({}));
      console.log(`  HTTP ${r.status} — ${body.message || JSON.stringify(body)}`);
      console.log('  It runs in the background (a couple of minutes). Re-run this');
      console.log('  command without --score to confirm the leads got scored.');
    } catch (e) {
      console.log(`  ❌ Failed to trigger: ${e.message}`);
    }
  }

  console.log('');

  function printVerdictNoBase() {
    console.log(`\n${'─'.repeat(64)}\nVERDICT\n${'─'.repeat(64)}`);
    console.log('⚠️  No Airtable Base ID on the client record, so the scorer has nowhere');
    console.log('   to look. Fill in "Airtable Base ID" in the master Clients table.');
  }
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
