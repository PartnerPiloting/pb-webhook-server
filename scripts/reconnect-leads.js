/**
 * Carry the conversation score onto a client's leads, and create leads for the people worth
 * working who are not in the base yet (services/reconnectLeads.js - Reconnect, brick 3).
 * Run as a Render one-off job, after scripts/conversation-score.js.
 *
 * Usage:
 *   node scripts/reconnect-leads.js --tenant=Client-Id          # COUNT ONLY - writes nothing
 *   node scripts/reconnect-leads.js --tenant=Client-Id --go     # write to the leads base
 *
 * The count-only run is the default on purpose. Show the client the counts before --go.
 */

require('dotenv').config();

const args = process.argv.slice(2);
const val = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : ''; };
const tenant = val('tenant');
if (!tenant) { console.error('[reconnect-leads] --tenant=Client-Id is required'); process.exit(1); }

(async () => {
  const { syncReconnectLeads } = require('../services/reconnectLeads');
  const started = Date.now();
  const r = await syncReconnectLeads(tenant, { dryRun: !args.includes('--go') });
  const secs = Math.round((Date.now() - started) / 1000);
  if (!r.ok) { console.error(`[reconnect-leads] FAILED in ${secs}s - ${r.error}`); process.exit(1); }
  console.log(`[reconnect-leads] ${r.dryRun ? 'COUNT ONLY' : 'DONE'} for ${tenant} in ${secs}s`);
  console.log(`RESULT ${JSON.stringify(r)}`);
  process.exit(0);
})().catch((e) => { console.error(`[reconnect-leads] FAILED - ${e.message}`); process.exit(1); });
