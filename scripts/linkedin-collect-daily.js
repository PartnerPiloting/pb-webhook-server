/**
 * The daily LinkedIn history collect (services/linkedinCollect.js - Reconnect, client process
 * step 2). For every client with a LinkedIn connection on file it takes Wingguy's own copy of
 * whatever history has arrived, works out where that client is up to, and emails Guy when one
 * becomes ready for a session, finishes, or stalls. Run once a day as a Render cron job.
 *
 * Usage:
 *   node scripts/linkedin-collect-daily.js                    # every connected client
 *   node scripts/linkedin-collect-daily.js --dry-run          # count only: no writes, no email
 *   node scripts/linkedin-collect-daily.js --tenant=Client-Id # one client
 *
 * It never calls Unipile's sync route - Unipile fills the history by itself, 3,000 conversations
 * a day, and a run of that route would stop it.
 */

require('dotenv').config();

const args = process.argv.slice(2);
const arg = args.find((a) => a.startsWith('--tenant='));

(async () => {
  const { runCollectDaily } = require('../services/linkedinCollect');
  const started = Date.now();
  const r = await runCollectDaily({ dryRun: args.includes('--dry-run'), only: arg ? arg.slice('--tenant='.length) : '' });
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`[linkedin-collect-daily] ${r.dryRun ? 'DRY RUN' : 'DONE'} - ${r.clients} client(s) in ${secs}s`);
  for (const x of r.results) console.log(`RESULT ${JSON.stringify(x)}`);
  process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
})().catch((e) => { console.error(`[linkedin-collect-daily] FAILED - ${e.message}`); process.exit(1); });
