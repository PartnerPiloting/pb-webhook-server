#!/usr/bin/env node
/**
 * Smart Follow-up Sweep - Cron Fallback
 *
 * Run via Render Cron Job every 5-10 minutes.
 * When the web-triggered sweep gets stuck (Render kills background process after 202),
 * this cron picks it up and runs the sweep in its own process.
 *
 * Logic: If status is 'running' and (processed=0 and started>2min) OR (started>20min),
 * run the sweep. Otherwise skip.
 *
 * Setup in Render Dashboard:
 * - Create Cron Job
 * - Schedule: */5 * * * * (every 5 min) or */10 * * * * (every 10 min)
 * - Command: node scripts/smart-followup-sweep-cron/index.js
 * - Or: curl -H "Authorization: Bearer $PB_WEBHOOK_SECRET" "https://pb-webhook-server.onrender.com/api/cron/smart-followup-sweep"
 */

require('dotenv').config();

const SWEEP_STATUS_TABLE = 'Smart FUP Sweep Status';
const { SWEEP_STATUS_FIELDS } = require('../../scripts/setup-smart-fup-airtable');

const STUCK_NO_PROGRESS_MS = 2 * 60 * 1000;  // 2 min at 0 = stuck
const STALE_ANYWAY_MS = 20 * 60 * 1000;       // 20 min = stale

async function shouldRunSweep(clientId = 'Guy-Wilson') {
  const { initializeClientsBase } = require('../../services/clientService');
  const base = initializeClientsBase();
  try {
    const escapedKey = String(clientId).replace(/'/g, "''");
    const records = await base(SWEEP_STATUS_TABLE).select({
      filterByFormula: `{${SWEEP_STATUS_FIELDS.CLIENT_ID}} = '${escapedKey}'`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) return { run: false, reason: 'no status record' };
    const f = records[0].fields;
    const statusVal = (f[SWEEP_STATUS_FIELDS.STATUS] || '').toLowerCase();
    if (statusVal !== 'running') return { run: false, reason: `status=${statusVal}` };

    const startedAt = f[SWEEP_STATUS_FIELDS.STARTED_AT];
    if (!startedAt) return { run: true, reason: 'running with no startedAt' };
    const startedMs = new Date(startedAt).getTime();
    const elapsed = Date.now() - startedMs;
    const processed = f[SWEEP_STATUS_FIELDS.PROCESSED] ?? 0;

    if (elapsed > STALE_ANYWAY_MS) return { run: true, reason: `stale ${Math.floor(elapsed / 60000)}min` };
    if (processed === 0 && elapsed > STUCK_NO_PROGRESS_MS) return { run: true, reason: 'stuck at 0' };
    return { run: false, reason: `running, ${processed} done, ${Math.floor(elapsed / 1000)}s elapsed` };
  } catch (err) {
    console.error('[sweep-cron] Error checking status:', err.message);
    return { run: false, reason: `error: ${err.message}` };
  }
}

async function main() {
  const clientId = process.env.SMART_FUP_CRON_CLIENT_ID || 'Guy-Wilson';
  console.log(`[sweep-cron] Checking sweep status for ${clientId}...`);

  const { run, reason } = await shouldRunSweep(clientId);
  if (!run) {
    console.log(`[sweep-cron] Skip: ${reason}`);
    process.exit(0);
  }

  console.log(`[sweep-cron] Running sweep (${reason})...`);
  const { runSweep } = require('../../services/smartFollowUpService');
  const { initializeClientsBase } = require('../../services/clientService');
  try {
    const results = await runSweep({ clientId });
    const total = results.totalProcessed ?? 0;
    const created = results.totalCreated ?? 0;
    const updated = results.totalUpdated ?? 0;
    const clients = results.clients || [];
    const allErrors = clients.flatMap(c => (c.errors || []).map(e => ({ ...e, clientId: c.clientId })));
    const candidatesFound = clients.reduce((s, c) => s + (c.candidatesFound || 0), 0);
    const aiAnalyzed = clients.reduce((s, c) => s + (c.aiAnalyzed || 0), 0);
    const base = initializeClientsBase();
    const key = clientId || 'ALL';
    const now = new Date().toISOString();
    const recordData = {
      [SWEEP_STATUS_FIELDS.CLIENT_ID]: key,
      [SWEEP_STATUS_FIELDS.STATUS]: 'Completed',
      [SWEEP_STATUS_FIELDS.COMPLETED_AT]: now,
      [SWEEP_STATUS_FIELDS.PROCESSED]: total,
      [SWEEP_STATUS_FIELDS.CREATED]: created,
      [SWEEP_STATUS_FIELDS.UPDATED]: updated,
      [SWEEP_STATUS_FIELDS.CANDIDATES_FOUND]: candidatesFound,
      [SWEEP_STATUS_FIELDS.AI_ANALYZED]: aiAnalyzed,
      [SWEEP_STATUS_FIELDS.TOTAL_ERRORS]: allErrors.length,
      [SWEEP_STATUS_FIELDS.ERROR_DETAILS]: allErrors.length ? JSON.stringify(allErrors) : undefined,
    };
    const escapedKey = String(key).replace(/'/g, "''");
    const recs = await base(SWEEP_STATUS_TABLE).select({
      filterByFormula: `{${SWEEP_STATUS_FIELDS.CLIENT_ID}} = '${escapedKey}'`,
      maxRecords: 1
    }).firstPage();
    if (recs.length > 0) {
      await base(SWEEP_STATUS_TABLE).update(recs[0].id, recordData);
    } else {
      await base(SWEEP_STATUS_TABLE).create(recordData);
    }
    console.log(`[sweep-cron] Done: ${total} processed (${created} created, ${updated} updated)`);
  } catch (err) {
    console.error('[sweep-cron] Sweep failed:', err.message);
    process.exitCode = 1;
  }
}

main();
