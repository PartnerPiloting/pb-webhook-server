#!/usr/bin/env node
/**
 * Backfill the client touch record (services/clientTouchStore.js) from a JSON file of touches
 * that already happened before the record existed.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --apply is passed. The dry run prints exactly
 * what would be recorded, per client, so Guy can approve the real run.
 *
 * Usage (server environment - DATABASE_URL - so via a Render one-off job, see
 * memory reference_render_jobs_exec):
 *   node scripts/backfill-client-touches.js scripts/data/client-touches-backfill-2026-10-22.json
 *   node scripts/backfill-client-touches.js scripts/data/client-touches-backfill-2026-10-22.json --apply
 *
 * File shape: { "touches": [ { clientId, kind, key, form, sentAt, recipient, reason, meta } ] }
 * - the same fields clientTouchStore.record takes. Every row is written with source "backfill".
 *
 * Safe to re-run: the store refuses a duplicate (same client, kind, key, moment), so a second
 * --apply records nothing new and says so.
 *
 * First use (2026-10-22): the habit emails to Rick Wong (14 Oct) and Steve Nelson (16 Oct), and
 * every Mindset Mastery edition each client received, read from the BCC lists in Guy's Gmail Sent.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const store = require('../services/clientTouchStore');

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node scripts/backfill-client-touches.js <touches.json> [--apply]');
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const touches = Array.isArray(data) ? data : data.touches;
  if (!Array.isArray(touches)) throw new Error('file has no "touches" array');

  // Validate everything first - a bad row fails the whole run before anything is written.
  const rows = touches.map((t, i) => {
    try { return store.normaliseTouch({ ...t, source: 'backfill' }); }
    catch (e) { throw new Error(`row ${i} (${t.clientId || '?'} ${t.kind || '?'} ${t.key || '?'}): ${e.message}`); }
  });

  console.log(`${apply ? 'APPLY' : 'DRY RUN'} - ${rows.length} touches in ${path.basename(file)}${data.note ? `\n${data.note}` : ''}\n`);

  const byClient = new Map();
  for (const r of rows) {
    if (!byClient.has(r.clientId)) byClient.set(r.clientId, []);
    byClient.get(r.clientId).push(r);
  }
  for (const [clientId, list] of [...byClient.entries()].sort()) {
    const kinds = {};
    for (const r of list) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    const first = list.map((r) => r.sentAt).sort((a, b) => a - b)[0];
    const last = list.map((r) => r.sentAt).sort((a, b) => b - a)[0];
    console.log(`• ${clientId}: ${list.length} (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}) ${first.toISOString().slice(0, 10)} -> ${last.toISOString().slice(0, 10)}`);
    for (const r of list) {
      if (r.kind !== 'mindset') console.log(`    ${r.sentAt.toISOString().slice(0, 10)}  ${r.kind}  ${r.key}  -> ${r.recipient || '-'}`);
    }
  }

  if (!apply) {
    console.log('\nDry run - nothing written. Re-run with --apply to record these.');
    return;
  }
  if (!(process.env.DATABASE_URL || '').trim()) {
    console.error('\nDATABASE_URL is not set - this has to run in the server environment.');
    process.exit(1);
  }

  let inserted = 0; let skipped = 0; let failed = 0;
  for (const r of rows) {
    const res = await store.record({ ...r, sentAt: r.sentAt.toISOString() });
    if (!res.ok) failed++;
    else if (res.inserted) inserted++;
    else skipped++;
  }
  console.log(`\nDone: ${inserted} recorded, ${skipped} already there, ${failed} failed.`);
  if (failed) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
