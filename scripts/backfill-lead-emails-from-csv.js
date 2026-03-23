#!/usr/bin/env node
/**
 * Backfill Airtable Leads {Email} from a CSV or XLSX (profile_url + email), matching on
 * normalized LinkedIn URL. Only updates rows where Email is currently empty.
 *
 * Uses services/backfillLeadEmailsFromExportService.js (same logic as
 * POST /admin/backfill-lead-emails on the deployed server).
 *
 * If you omit --csv and --sheet-url, the default path below is used (Guy Wilson Downloads export).
 *
 * Dry run:  node scripts/backfill-lead-emails-from-csv.js --preview-max 10
 * Apply:   node scripts/backfill-lead-emails-from-csv.js --apply --max-updates 50
 *
 * Online (after deploy): multipart POST to https://YOUR_HOST/admin/backfill-lead-emails
 * with Bearer PB_WEBHOOK_SECRET, field "file", optional clientId / apply / previewMax / maxUpdates.
 */

require('dotenv').config();
const path = require('path');
const {
  buildEmailMapFromFilePath,
  buildEmailMapFromPublicCsvUrl,
  runBackfillLeadEmails,
} = require('../services/backfillLeadEmailsFromExportService');

/** Used when --csv and --sheet-url are both omitted */
const DEFAULT_LOCAL_PROFILE_EMAIL_FILE =
  'C:\\Users\\guyra\\Downloads\\Profiles downloaded from lh-Guy-Wilson-#16045 at 2026-03-23T02-22-39.306Z.xlsx';

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {
    client: 'Guy-Wilson',
    csvPath: '',
    sheetUrl: '',
    apply: false,
    previewMax: 20,
    maxUpdates: Infinity,
    pageSize: 100,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--client' && argv[i + 1]) out.client = argv[++i];
    else if (a === '--csv' && argv[i + 1]) out.csvPath = path.resolve(argv[++i]);
    else if (a === '--sheet-url' && argv[i + 1]) out.sheetUrl = argv[++i];
    else if (a === '--apply') out.apply = true;
    else if (a === '--preview-max' && argv[i + 1]) out.previewMax = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '--max-updates' && argv[i + 1]) out.maxUpdates = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--page-size' && argv[i + 1]) out.pageSize = Math.min(100, Math.max(1, parseInt(argv[++i], 10) || 100));
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (!out.csvPath && !out.sheetUrl) {
    out.csvPath = DEFAULT_LOCAL_PROFILE_EMAIL_FILE;
  }
  return out;
}

async function loadEmailMap(args) {
  if (args.csvPath) {
    console.log(`Reading file: ${args.csvPath}`);
    return buildEmailMapFromFilePath(args.csvPath);
  }
  if (args.sheetUrl) {
    console.log(`Fetching CSV: ${args.sheetUrl}`);
    return buildEmailMapFromPublicCsvUrl(args.sheetUrl);
  }
  throw new Error('Provide --csv <file> or --sheet-url <published-csv-url>');
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(`
Backfill lead emails from CSV or XLSX (LinkedIn URL match).

  --client Guy-Wilson       Client ID in Master Clients (default: Guy-Wilson)
  --csv path/to/file        Optional; .csv or .xlsx. If omitted, uses DEFAULT path in script
  --sheet-url URL           Optional; must be publicly readable CSV
  --preview-max N           Dry run: print at most N sample rows (default 20)
  --apply                   Perform Airtable updates (default: dry run only)
  --max-updates N           Cap number of records updated (apply mode)
  --page-size N             Airtable page size when scanning blank emails (max 100)

  Or use POST /admin/backfill-lead-emails on Render with Bearer auth and multipart file.
`);
    process.exit(0);
  }

  if (!process.env.AIRTABLE_API_KEY) {
    console.error('Missing AIRTABLE_API_KEY in environment.');
    process.exit(1);
  }

  const { map: urlToEmail, warnings: parserWarnings } = await loadEmailMap(args);
  parserWarnings.forEach((w) => console.warn(`[warn] ${w}`));
  console.log(`Source: ${urlToEmail.size} row(s) with profile_url + valid email`);

  const result = await runBackfillLeadEmails({
    clientId: args.client,
    urlToEmail,
    parserWarnings,
    apply: args.apply,
    previewMax: args.previewMax,
    maxUpdates: args.maxUpdates,
    pageSize: args.pageSize,
  });

  console.log(`Client: ${result.clientId} (${result.clientName}) → base ${result.airtableBaseId}`);
  console.log(`Mode: ${args.apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  console.log(`\nMatched ${result.matchedLeads} Airtable lead(s) with blank Email and an email in the export.`);

  for (const row of result.preview) {
    console.log(`  would set ${row.id}  ${row.norm}  →  ${row.email}`);
  }
  if (result.previewTruncated) {
    console.log(`  … and ${result.matchedLeads - result.preview.length} more (use --preview-max to show more)`);
  }

  if (!args.apply) {
    console.log('\nDry run complete. Re-run with --apply to write. Optional: --max-updates 5 for a small live test.');
    process.exit(0);
  }

  console.log(`\nDone. Applied ${result.applied} email update(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
