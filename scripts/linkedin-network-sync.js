/**
 * Read one client's LinkedIn network and inbox from Unipile into our own store
 * (services/linkedinNetworkSync.js - Reconnect, brick 1). Read-only against Unipile.
 * Run as a Render one-off job; it is too slow for a chat tool call.
 *
 * Usage:
 *   node scripts/linkedin-network-sync.js --tenant=Client-Id --dry-run   # count only, write nothing
 *   node scripts/linkedin-network-sync.js --tenant=Client-Id             # read and store
 *     --no-relations          skip the connections list (inbox only)
 *     --sales-nav             also read the Sales Navigator inbox (off by default - not used)
 *     --relations-pages=N     stop the connections list after N pages (100 people a page)
 *
 * Always --dry-run first on a new account and read the counts.
 */

require('dotenv').config();

const args = process.argv.slice(2);
const val = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : ''; };
const tenant = val('tenant');
if (!tenant) { console.error('[linkedin-network-sync] --tenant=Client-Id is required'); process.exit(1); }

(async () => {
  const { syncLinkedinNetwork } = require('../services/linkedinNetworkSync');
  const started = Date.now();
  const r = await syncLinkedinNetwork(tenant, {
    dryRun: args.includes('--dry-run'),
    relations: !args.includes('--no-relations'),
    relationsMaxPages: Number(val('relations-pages')) || undefined,
    salesNav: args.includes('--sales-nav'),
  });
  const secs = Math.round((Date.now() - started) / 1000);
  if (!r.ok) { console.error(`[linkedin-network-sync] FAILED in ${secs}s - ${r.error}`); process.exit(1); }
  console.log(`[linkedin-network-sync] ${r.dryRun ? 'DRY RUN' : 'DONE'} for ${tenant} in ${secs}s`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error(`[linkedin-network-sync] FAILED - ${e.message}`); process.exit(1); });
