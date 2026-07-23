/**
 * Overnight preparation of the Wingguy follow-up brief (see services/wingguyFollowupBrief.js).
 *
 * Runs the full pre-computation — sweep, read each top person's messages, triage, pre-write reply
 * drafts — and stores the finished brief so the chat can serve it INSTANTLY. Scheduled as a Render
 * cron (early morning Perth time); also runnable ad hoc as a one-off job.
 *
 * Usage:
 *   node scripts/prepare-followup-brief.js                     # default tenant (Guy-Wilson)
 *   node scripts/prepare-followup-brief.js --tenant=Client-Id  # one specific tenant
 *
 * Multi-tenant note: deliberately single-tenant-per-run for now (only tenants live on the Wingguy
 * chat get value from a prepared brief). When more clients come onto chat, either add cron entries
 * or extend this to iterate an opt-in list from Client Master.
 */

require('dotenv').config();

const arg = process.argv.slice(2).find((a) => a.startsWith('--tenant='));
const tenant = arg ? arg.split('=')[1] : 'Guy-Wilson';

(async () => {
  console.log(`[prepare-followup-brief] starting for ${tenant} at ${new Date().toISOString()}`);
  const { prepareFollowupBrief } = require('../services/wingguyFollowupBrief');
  const started = Date.now();
  const r = await prepareFollowupBrief(tenant);
  const secs = Math.round((Date.now() - started) / 1000);
  if (r.ok) {
    console.log(`[prepare-followup-brief] DONE in ${secs}s — ${r.items} prepared of ${r.totalSurfaced} surfaced.`);
    process.exit(0);
  }
  console.error(`[prepare-followup-brief] FAILED in ${secs}s — ${r.error}`);
  process.exit(1);
})();
