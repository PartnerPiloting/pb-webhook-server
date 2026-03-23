#!/usr/bin/env node
/**
 * Score Airtable Leads "Outbound Email Score" (0–10) from "Raw Profile Data" using Gemini (Vertex).
 *
 * Default: only records where Outbound Email Score is blank and Raw Profile Data is non-empty.
 *
 *   node scripts/score-outbound-email-readiness.js --client Guy-Wilson --limit 5
 *   node scripts/score-outbound-email-readiness.js --client Guy-Wilson --apply --limit 20
 *   node scripts/score-outbound-email-readiness.js --client Guy-Wilson --apply --rescore-all
 *
 * For a small default batch of 10 unscored, use: scripts/score-oes-unscored.js
 */

require('dotenv').config();
const clientService = require('../services/clientService');
const { runOutboundEmailScoringBatch, RAW_FIELD, OES_FIELD } = require('../services/outboundEmailScoringBatchService');

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {
    client: 'Guy-Wilson',
    apply: false,
    limit: Infinity,
    rescoreAll: false,
    pageSize: 50,
    delayMs: 400,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--client' && argv[i + 1]) out.client = argv[++i];
    else if (a === '--apply') out.apply = true;
    else if (a === '--limit' && argv[i + 1]) out.limit = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--rescore-all') out.rescoreAll = true;
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
Usage:
  node scripts/score-outbound-email-readiness.js --client Guy-Wilson [--apply] [--limit N] [--rescore-all]

  --apply        Write scores to Airtable (default: dry run, logs only)
  --limit N      Stop after N leads (default: no limit)
  --rescore-all  Include leads that already have Outbound Email Score set
  --delay-ms M   Pause between Gemini calls (default 400)

Pilot (10 unscored by default): node scripts/score-oes-unscored.js
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

  console.log(`Client: ${args.client} | Base: ${client.airtableBaseId}`);
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'} | rescoreAll: ${args.rescoreAll} | limit: ${Number.isFinite(args.limit) ? args.limit : '∞'}`);
  console.log(`Fields: ${RAW_FIELD} → ${OES_FIELD}\n`);

  const summary = await runOutboundEmailScoringBatch({
    clientId: args.client,
    limit: args.limit,
    apply: args.apply,
    rescoreAll: args.rescoreAll,
    pageSize: args.pageSize,
    delayMs: args.delayMs,
  });

  console.log(`Filter: ${summary.formula}`);
  console.log(`\nDone. processed=${summary.processed} scored_ok=${summary.scored} failed=${summary.failed} skipped_empty=${summary.skippedEmpty}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
