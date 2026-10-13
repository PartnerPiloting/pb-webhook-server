#!/usr/bin/env node
/**
 * One-off migration (13 Oct 2026): split every client's PREAMBLE row into the purpose statement
 * that stays in Airtable and the scoring workflow that now lives in code
 * (services/scoringWorkflow.js). See that file for the why.
 *
 * Dry run (default) prints, for every client with a leads base, what is in the row now and what
 * the statement would become. Nothing is written.
 *
 *   node scripts/migrate-scoring-purpose.js
 *   node scripts/migrate-scoring-purpose.js --client Matthew-Bulat
 *   node scripts/migrate-scoring-purpose.js --apply
 *
 * --apply first writes a JSON backup of every PREAMBLE row it is about to change (next to this
 * repo's other scoring backups, e.g. dean-scoring-backup-2026-10-05.json) and, when DATABASE_URL
 * is set, a row per client in wingguy_scoring_backups too - so wingguy_scoring_revert can undo it
 * from chat. Then it writes the statements.
 *
 * The 20 bases that still open with the starting template's "explore a side-venture with Partner
 * Piloting" are blanked, not migrated: that sentence is wrong for every one of them, and an empty
 * purpose (the portal shows a placeholder) is better than a misleading one. Pass
 * --keep-partner-piloting to carry the sentence across instead.
 *
 * Needs AIRTABLE_API_KEY and MASTER_CLIENTS_BASE_ID (from .env in the CWD).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Airtable = require('airtable');
const core = require('../services/scoringAttributes');
const { extractPurposeStatement } = require('../services/scoringWorkflow');

const KEY = process.env.AIRTABLE_API_KEY;
const MASTER = process.env.MASTER_CLIENTS_BASE_ID;
if (!KEY || !MASTER) { console.error('AIRTABLE_API_KEY and MASTER_CLIENTS_BASE_ID are required.'); process.exit(1); }

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const KEEP_PP = process.argv.includes('--keep-partner-piloting');
const ONLY = arg('client');

const PARTNER_PILOTING = /Partner Piloting/i;

function plan(oldText) {
  let statement = extractPurposeStatement(oldText);
  let note = '';
  if (!KEEP_PP && PARTNER_PILOTING.test(statement)) { statement = ''; note = 'template leftover - blanked'; }
  else if (statement === String(oldText || '').trim()) note = 'already a plain statement - unchanged';
  return { statement, note };
}

async function main() {
  const at = new Airtable({ apiKey: KEY });
  const clients = (await at.base(MASTER)('Clients').select().all())
    .map((r) => ({ id: r.get('Client ID'), name: r.get('Client Name'), status: r.get('Status'), baseId: r.get('Airtable Base ID') }))
    .filter((c) => c.id && c.baseId && (!ONLY || c.id === ONLY))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const work = [];
  for (const c of clients) {
    const base = at.base(c.baseId);
    let rows, kinds;
    try { ({ rows, kinds } = await core.readTable(base)); } catch (e) { console.log(`\n### ${c.id} (${c.status}) - could not read table: ${e.message}`); continue; }
    const pre = rows.find(core.isPurpose);
    if (!pre) { console.log(`\n### ${c.id} (${c.status}) - no PREAMBLE row, skipped`); continue; }
    const before = pre.instructions;
    const { statement, note } = plan(before);
    const changed = statement !== before.trim();
    console.log(`\n### ${c.id} (${c.status})${note ? ` - ${note}` : ''}`);
    console.log(`NOW (${before.length} chars): ${core.shortText(before, 140)}`);
    console.log(changed ? `BECOMES (${statement.length} chars):\n${statement || '(empty)'}` : 'BECOMES: (no change)');
    if (changed) work.push({ client: c, base, rows, kinds, pre, statement });
  }

  console.log(`\n${work.length} of ${clients.length} clients would change.`);
  if (!APPLY) { console.log('Dry run - nothing written. Re-run with --apply to write.'); return; }
  if (!work.length) return;

  // Backup 1: a file in the CWD, the same way dean-scoring-backup-2026-10-05.json was kept.
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.resolve(`scoring-purpose-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(work.map((w) => ({ clientId: w.client.id, baseId: w.client.baseId, row: w.pre, becomes: w.statement })), null, 2));
  console.log(`\nBackup written: ${file}`);

  // Backup 2: the scoring backup store, so wingguy_scoring_revert can undo it from chat.
  if ((process.env.DATABASE_URL || '').trim()) {
    const store = require('../services/scoringBackupStore');
    for (const w of work) {
      try {
        const b = await store.saveBackup({ tenantId: w.client.id, baseId: w.client.baseId, reason: 'before purpose/workflow split (migrate-scoring-purpose.js)', rows: [w.pre] });
        console.log(`  ${w.client.id}: backup #${b.id} saved`);
      } catch (e) {
        console.error(`  ${w.client.id}: backup store failed (${e.message}) - stopping before any write.`);
        process.exit(1);
      }
    }
  } else {
    console.log('DATABASE_URL not set - no backup-store rows (the JSON file above is the backup).');
  }

  for (const w of work) {
    await core.writeRows(w.base, [core.purposeWrite(w.rows, w.kinds, w.statement)]);
    console.log(`  ${w.client.id}: written`);
  }
  console.log('\nDone. The server caches attributes for up to 10 minutes, so the next scoring run after that uses the new text.');
}

main().catch((e) => { console.error(e); process.exit(1); });
