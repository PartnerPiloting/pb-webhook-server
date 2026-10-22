#!/usr/bin/env node
/**
 * Give every client on the master Clients table an Email Unsubscribe Token (the link behind
 * every weekly email from Guy - services/clientUnsubscribe.js). New clients get one at join; this
 * is the one-off backfill for everyone who joined before 2026-10-22, and a safe re-run any time.
 *
 * DRY RUN BY DEFAULT - lists who would get a token and changes nothing. --apply writes them.
 * Never overwrites a token that already exists (a link already in someone's inbox must keep working).
 *
 * Run order: scripts/ensure-client-fields.js first (the field has to exist), then this.
 *
 * Usage (server environment - AIRTABLE_API_KEY + MASTER_CLIENTS_BASE_ID - via a Render one-off job,
 * or locally with the same two variables):
 *   node scripts/fill-client-unsub-tokens.js
 *   node scripts/fill-client-unsub-tokens.js --apply
 */

require('dotenv').config();
const Airtable = require('airtable');
const { newToken, TOKEN_FIELD } = require('../services/clientUnsubscribe');

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.AIRTABLE_API_KEY || !process.env.MASTER_CLIENTS_BASE_ID) {
    console.error('AIRTABLE_API_KEY and MASTER_CLIENTS_BASE_ID are required');
    process.exit(1);
  }
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_CLIENTS_BASE_ID);

  const rows = [];
  await base('Clients').select({ fields: ['Client ID', 'Client Name', 'Status', TOKEN_FIELD] }).eachPage((records, next) => {
    records.forEach((r) => rows.push({ id: r.id, clientId: r.get('Client ID') || '(no id)', name: r.get('Client Name') || '', status: r.get('Status') || '', token: r.get(TOKEN_FIELD) || '' }));
    next();
  });

  const missing = rows.filter((r) => !r.token);
  const have = rows.length - missing.length;
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} - ${rows.length} clients: ${have} already have a token, ${missing.length} need one\n`);
  for (const r of missing) console.log(`  + ${r.clientId} (${r.name}, ${r.status || 'no status'})`);

  if (!apply) { console.log('\nDry run - nothing written. Re-run with --apply.'); return; }

  // Airtable takes up to 10 updates per call.
  let written = 0;
  for (let i = 0; i < missing.length; i += 10) {
    const chunk = missing.slice(i, i + 10).map((r) => ({ id: r.id, fields: { [TOKEN_FIELD]: newToken() } }));
    await base('Clients').update(chunk);
    written += chunk.length;
  }
  console.log(`\nDone: ${written} tokens written. ${have} left as they were.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
