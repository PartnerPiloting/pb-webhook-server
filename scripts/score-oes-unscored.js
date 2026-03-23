#!/usr/bin/env node
/**
 * Score the next N leads that are still unscored (blank "Outbound Email Score"),
 * using "Raw Profile Data" + Gemini. Default N=10 for safe pilots.
 *
 * Dry run (no Airtable writes):
 *   node scripts/score-oes-unscored.js
 *
 * Write scores:
 *   node scripts/score-oes-unscored.js --apply
 *
 *   node scripts/score-oes-unscored.js --apply --limit 25 --client Guy-Wilson
 */

require('dotenv').config();
const clientService = require('../services/clientService');
const { runOutboundEmailScoringBatch, RAW_FIELD, OES_FIELD } = require('../services/outboundEmailScoringBatchService');

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {
    client: 'Guy-Wilson',
    apply: false,
    limit: 10,
    pageSize: 50,
    delayMs: 400,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--client' && argv[i + 1]) out.client = argv[++i];
    else if (a === '--apply') out.apply = true;
    else if (a === '--limit' && argv[i + 1]) out.limit = Math.max(1, parseInt(argv[++i], 10) || 10);
    else if (a === '--page-size' && argv[i + 1]) out.pageSize = Math.min(100, Math.max(1, parseInt(argv[++i], 10) || 50));
    else if (a === '--delay-ms' && argv[i + 1]) out.delayMs = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

(async () => {
  const args = parseArgs();
  if (args.help) {
    console.log(`
Score up to N unscored leads (blank Outbound Email Score, non-empty Raw Profile Data).

  node scripts/score-oes-unscored.js              # dry run, limit 10
  node scripts/score-oes-unscored.js --apply    # write scores, limit 10
  node scripts/score-oes-unscored.js --apply --limit 50

Options: --client Guy-Wilson  --limit N  --delay-ms M  --page-size P
`);
    process.exit(0);
  }

  if (!process.env.AIRTABLE_API_KEY) {
    console.error('Missing AIRTABLE_API_KEY');
    process.exit(1);
  }

  const client = await clientService.getClientById(args.client);
  if (!client) {
    console.error(`Client not found: ${args.client}`);
    process.exit(1);
  }

  console.log(`[OES pilot] Client: ${args.client} | Base: ${client.airtableBaseId}`);
  console.log(`[OES pilot] Mode: ${args.apply ? 'APPLY (writes)' : 'DRY RUN'} | limit: ${args.limit} | unscored only`);
  console.log(`[OES pilot] ${RAW_FIELD} → ${OES_FIELD}\n`);

  const summary = await runOutboundEmailScoringBatch({
    clientId: args.client,
    limit: args.limit,
    apply: args.apply,
    rescoreAll: false,
    pageSize: args.pageSize,
    delayMs: args.delayMs,
  });

  console.log(`Filter: ${summary.formula}`);
  console.log(
    `\n[OES pilot] Done. processed=${summary.processed} scored_ok=${summary.scored} failed=${summary.failed} skipped_empty=${summary.skippedEmpty}`
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
