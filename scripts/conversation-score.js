/**
 * Read how a client's old LinkedIn conversations ended and store the conversation score
 * (services/conversationScore.js - Reconnect, brick 2). Runs on the client's own Claude key.
 * Run as a Render one-off job. Needs the LinkedIn read first (scripts/linkedin-network-sync.js).
 *
 * Usage:
 *   node scripts/conversation-score.js --tenant=Client-Id --dry-run       # how many, and the estimated cost
 *   node scripts/conversation-score.js --tenant=Client-Id --sample=30     # read 30, print them, store nothing
 *   node scripts/conversation-score.js --tenant=Client-Id                 # read everyone not yet read
 *     --limit=N          read at most N
 *     --rescore          also re-read threads read under an older paragraph or guidance
 *     --who-b64=...      the client's "who I am looking for" paragraph, base64 (a job cannot take
 *                        free text safely) - how a draft paragraph is tried before it is saved
 *
 * Order for a new client: --dry-run, then --sample until the client agrees with the scores, then
 * the full read.
 */

require('dotenv').config();

const args = process.argv.slice(2);
const val = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : ''; };
const tenant = val('tenant');
if (!tenant) { console.error('[conversation-score] --tenant=Client-Id is required'); process.exit(1); }

(async () => {
  const { scoreConversations } = require('../services/conversationScore');
  const started = Date.now();
  const r = await scoreConversations(tenant, {
    who: val('who-b64') ? Buffer.from(val('who-b64'), 'base64').toString('utf8') : '',
    dryRun: args.includes('--dry-run'),
    sample: Number(val('sample')) || 0,
    limit: Number(val('limit')) || 0,
    rescore: args.includes('--rescore'),
  });
  const secs = Math.round((Date.now() - started) / 1000);
  if (!r.ok) { console.error(`[conversation-score] FAILED in ${secs}s - ${r.error}`); process.exit(1); }
  const { results, ...summary } = r;
  console.log(`[conversation-score] ${r.dryRun ? 'DRY RUN' : (r.sample ? 'SAMPLE' : 'DONE')} for ${tenant} in ${secs}s`);
  console.log(JSON.stringify(summary));
  for (const x of results || []) console.log(`SAMPLE ${JSON.stringify(x)}`);
  process.exit(0);
})().catch((e) => { console.error(`[conversation-score] FAILED - ${e.message}`); process.exit(1); });
