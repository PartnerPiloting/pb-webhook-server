#!/usr/bin/env node
/**
 * Test harness: sample N Airtable leads with non-empty "Raw Profile Data" and check JSON health.
 * Same logic as GET /admin/audit-raw-profile-json (Bearer auth) on Render.
 *
 *   node scripts/audit-raw-profile-data-json.js --client Guy-Wilson --limit 1000
 */

require('dotenv').config();
const { runRawProfileDataAudit } = require('../services/auditRawProfileDataService');

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { client: 'Guy-Wilson', limit: 1000, pageSize: 100 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--client' && argv[i + 1]) out.client = argv[++i];
    else if (a === '--limit' && argv[i + 1]) out.limit = Math.max(1, parseInt(argv[++i], 10) || 1000);
    else if (a === '--page-size' && argv[i + 1]) out.pageSize = Math.min(100, Math.max(1, parseInt(argv[++i], 10) || 100));
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

(async () => {
  const args = parseArgs();
  if (args.help) {
    console.log(`
Usage:
  node scripts/audit-raw-profile-data-json.js --client Guy-Wilson --limit 1000

Or on production:
  curl -s -H "Authorization: Bearer SECRET" "https://YOUR_HOST/admin/audit-raw-profile-json?clientId=Guy-Wilson&limit=1000"
`);
    process.exit(0);
  }

  if (!process.env.AIRTABLE_API_KEY) {
    console.error('Missing AIRTABLE_API_KEY');
    process.exit(1);
  }

  const result = await runRawProfileDataAudit({
    clientId: args.client,
    limit: args.limit,
    pageSize: args.pageSize,
    sampleErrors: 25,
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.parse_fail > 0) {
    console.error(`\n${result.parse_fail} record(s) failed JSON checks — see sample_errors above.`);
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
