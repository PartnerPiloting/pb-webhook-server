#!/usr/bin/env node
/**
 * Prune old raw Recall.ai webhook payloads from `recall_webhook_events`.
 *
 * WHY: `recall_webhook_events` is a raw audit log — every real-time webhook
 * (one per speech chunk) is stored verbatim before processing. Once a meeting
 * is ingested, the clean transcript lives in `recall_meetings` and the timed
 * segments in `recall_utterances`. The old raw payloads are never read again,
 * so they just grow the DB. This deletes events older than RETENTION_DAYS.
 *
 * SAFETY:
 *   - DRY RUN by default: counts/reports only, changes nothing. Pass --commit
 *     to actually delete.
 *   - Only ever touches `recall_webhook_events`. It contains no reference to
 *     `recall_meetings` / `recall_utterances`, so it cannot affect transcripts.
 *   - Deletes by age only (RETENTION_DAYS), far beyond any processing window.
 *
 * USAGE (run on Render where DATABASE_URL is set, or locally with it exported):
 *   node scripts/prune-recall-webhook-events.js            # dry run (default)
 *   node scripts/prune-recall-webhook-events.js --commit   # actually delete
 *   RETENTION_DAYS=14 node scripts/prune-recall-webhook-events.js --commit
 *
 * Mirrors the repo's existing cleanup-*.js scripts and is intended to be run
 * daily by a Render dashboard cron (matching the existing cron fleet).
 */

const { Pool } = require('pg');

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const COMMIT = process.argv.includes('--commit');

if (!process.env.DATABASE_URL) {
  throw new Error('FATAL: DATABASE_URL environment variable not set');
}
if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS < 1) {
  throw new Error(`FATAL: RETENTION_DAYS must be a number >= 1 (got "${process.env.RETENTION_DAYS}")`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.trim(),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const mode = COMMIT ? 'COMMIT (will delete)' : 'DRY RUN (no changes)';
  console.log(`\n🧹 Prune recall_webhook_events`);
  console.log(`   retention : keep last ${RETENTION_DAYS} days`);
  console.log(`   mode      : ${mode}\n`);

  const client = await pool.connect();
  try {
    // Report current footprint + how much is prunable.
    const stats = await client.query(`
      SELECT
        count(*)                                                          AS total_rows,
        count(*) FILTER (WHERE received_at < now() - ($1 || ' days')::interval) AS prunable_rows,
        pg_size_pretty(pg_total_relation_size('recall_webhook_events'))   AS table_size
      FROM recall_webhook_events
    `, [String(RETENTION_DAYS)]);

    const { total_rows, prunable_rows, table_size } = stats.rows[0];
    console.log(`   table size now      : ${table_size}`);
    console.log(`   total events        : ${total_rows}`);
    console.log(`   older than ${RETENTION_DAYS}d (prunable): ${prunable_rows}\n`);

    if (Number(prunable_rows) === 0) {
      console.log('   Nothing to prune. ✅\n');
      return;
    }

    if (!COMMIT) {
      console.log(`   DRY RUN — would delete ${prunable_rows} events. Re-run with --commit to apply.\n`);
      return;
    }

    const del = await client.query(`
      DELETE FROM recall_webhook_events
      WHERE received_at < now() - ($1 || ' days')::interval
    `, [String(RETENTION_DAYS)]);
    console.log(`   Deleted ${del.rowCount} events.`);

    // Reclaim freed space for reuse (plain VACUUM — does not lock out reads/writes).
    await client.query('VACUUM recall_webhook_events');

    const after = await client.query(
      `SELECT pg_size_pretty(pg_total_relation_size('recall_webhook_events')) AS table_size`
    );
    console.log(`   table size after    : ${after.rows[0].table_size}`);
    console.log(`\n   ✅ Done.\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
