#!/usr/bin/env node
/**
 * Fathom ingest launcher — the manual "run one meeting" command for the
 * Recall -> Fathom migration write-path test (go-live step c).
 *
 * This is the FIRST thing that actually calls services/fathomIngestService.
 * Until now the ingest pipeline had no caller — it was only ever exercised
 * inline in dry-run. This wraps it as a familiar CLI, modelled on
 * scripts/prune-recall-webhook-events.js (dry-run by default, --commit to act).
 *
 * SAFETY:
 *   - DRY RUN by default: fetches, splits, matches leads, prints the plan, and
 *     writes NOTHING. Safe to run anytime, anywhere.
 *   - A real save needs BOTH this flag (--commit) AND the service-level kill
 *     switch FATHOM_INGEST_ENABLED=true. Either one off = no write.
 *   - Every row it writes is tagged source='fathom-api' and is reversible in
 *     one step: --delete <meetingId> (children cascade). The delete is guarded
 *     to ONLY remove source='fathom-api' rows, so it can't touch a real Recall
 *     meeting even if you fat-finger an id.
 *   - The Recall path is never touched.
 *
 * USAGE (run on Render where DATABASE_URL + Airtable + Fathom key exist):
 *   node scripts/fathom-ingest.js --list                 # list recent Fathom meetings, pick an id
 *   node scripts/fathom-ingest.js <recordingId>          # DRY RUN one meeting (writes nothing)
 *   FATHOM_INGEST_ENABLED=true \
 *     node scripts/fathom-ingest.js <recordingId> --commit   # really save it
 *   node scripts/fathom-ingest.js --delete <meetingId>   # remove a test row (cleanup)
 *
 * Options:
 *   --client <id>   coach/tenant client id (default RECALL_COACH_CLIENT_ID or Guy-Wilson)
 */

try { require('dotenv').config({ path: '.env.local' }); } catch (_) { /* optional */ }
try { require('dotenv').config(); } catch (_) { /* optional */ }

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const COMMIT = process.argv.includes('--commit');
const LIST = process.argv.includes('--list');
const POLL = process.argv.includes('--poll');
const DELETE_ID = argVal('--delete');
const COACH = (argVal('--client') || process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
// First non-flag, non-consumed token = the recording id.
const RECORDING_ID = process.argv.slice(2).find((a, i, arr) =>
  !a.startsWith('--') && arr[i - 1] !== '--client' && arr[i - 1] !== '--delete');

async function resolveApiKey() {
  if (process.env.FATHOM_API_KEY && process.env.FATHOM_API_KEY.trim()) {
    return process.env.FATHOM_API_KEY.trim();
  }
  const clientService = require('../services/clientService');
  const client = await clientService.getClientById(COACH);
  if (client && client.fathomApiKey) return String(client.fathomApiKey).trim();
  return null;
}

/** --list : print recent Fathom meetings so you can pick a recording_id. */
async function listMeetings() {
  const key = await resolveApiKey();
  if (!key) { console.error(`\nNo Fathom API key (env FATHOM_API_KEY or Client Master for ${COACH}).\n`); process.exit(1); }
  const url = new URL(`${FATHOM_API_BASE}/meetings`);
  url.searchParams.set('limit', '25');
  url.searchParams.set('include_transcript', 'true');
  const res = await fetch(url.toString(), { headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' } });
  if (!res.ok) { console.error(`Fathom API ${res.status} ${res.statusText}`); process.exit(1); }
  const data = await res.json();
  const items = data.items || data.meetings || data.results || data.data || [];
  console.log(`\n=== ${items.length} recent Fathom meetings (newest first) ===\n`);
  items.forEach((m) => {
    const id = m.recording_id || m.id || '?';
    const title = (m.meeting_title || m.title || '').slice(0, 40);
    const start = m.recording_start_time || m.scheduled_start_time || m.created_at || '?';
    const inv = (m.calendar_invitees || m.invitees || []).length;
    const lines = Array.isArray(m.transcript) ? m.transcript.length : 'n/a';
    console.log(`  ${String(id).padEnd(14)} | ${start} | inv=${inv} lines=${lines} | "${title}"`);
  });
  console.log(`\nPick one, then:  node scripts/fathom-ingest.js <recordingId>   (dry run)\n`);
}

/** --delete : guarded cleanup of a test row (only source='fathom-api'; children cascade). */
async function deleteTestRow(id) {
  if (!process.env.DATABASE_URL) { console.error('\nFATAL: DATABASE_URL not set — run where the DB is reachable.\n'); process.exit(1); }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.trim(), ssl: { rejectUnauthorized: false } });
  try {
    const r = await pool.query(
      `DELETE FROM recall_meetings WHERE id = $1 AND source = 'fathom-api' RETURNING id, title`,
      [Number(id)],
    );
    if (r.rowCount === 0) {
      console.log(`\n   No source='fathom-api' meeting with id=${id} — nothing deleted (guard protects real rows).\n`);
    } else {
      console.log(`\n   ✅ Deleted test meeting id=${r.rows[0].id} ("${r.rows[0].title || ''}") + cascaded leads.\n`);
    }
  } finally {
    await pool.end();
  }
}

/** --poll : run one Fathom poll pass (dry-run unless --commit). Exercises the trigger end-to-end. */
async function runPoll() {
  const { pollFathomMeetings } = require('../services/fathomPollService');
  console.log(`\n🔁 Fathom poll pass (${COMMIT ? 'COMMIT' : 'DRY RUN'})`);
  console.log(`   FATHOM_LIVE_FROM      = ${process.env.FATHOM_LIVE_FROM || '(unset → nothing eligible)'}`);
  console.log(`   FATHOM_INGEST_ENABLED = ${process.env.FATHOM_INGEST_ENABLED || '(unset)'}\n`);
  const r = await pollFathomMeetings({ coachClientId: COACH, dryRun: !COMMIT });
  console.log(JSON.stringify(r, null, 2));
}

async function main() {
  if (LIST) return listMeetings();
  if (POLL) return runPoll();
  if (DELETE_ID) return deleteTestRow(DELETE_ID);

  if (!RECORDING_ID) {
    console.error('\nUsage: node scripts/fathom-ingest.js <recordingId> [--commit]');
    console.error('       node scripts/fathom-ingest.js --list');
    console.error('       node scripts/fathom-ingest.js --delete <meetingId>\n');
    process.exit(1);
  }

  const mode = COMMIT ? 'COMMIT (will write if FATHOM_INGEST_ENABLED=true)' : 'DRY RUN (writes nothing)';
  console.log(`\n🎯 Fathom ingest`);
  console.log(`   recording : ${RECORDING_ID}`);
  console.log(`   coach     : ${COACH}`);
  console.log(`   mode      : ${mode}`);
  console.log(`   kill sw   : FATHOM_INGEST_ENABLED=${process.env.FATHOM_INGEST_ENABLED || '(unset)'}\n`);

  const { ingestFathomMeeting } = require('../services/fathomIngestService');
  const result = await ingestFathomMeeting({ recordingId: RECORDING_ID, coachClientId: COACH, dryRun: !COMMIT });

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.log(`\n   ❌ ${result.error || 'failed'}\n`);
    process.exit(1);
  }
  if (result.dryRun) {
    console.log(`\n   DRY RUN — nothing written. Re-run with --commit (and FATHOM_INGEST_ENABLED=true) to save.\n`);
  } else if (result.mode === 'single') {
    console.log(`\n   ✅ Wrote meeting id=${result.meetingId}. Undo with: node scripts/fathom-ingest.js --delete ${result.meetingId}\n`);
  } else if (result.mode === 'split') {
    const ids = (result.filed || []).map((f) => f.meetingId).join(', ');
    console.log(`\n   ✅ Wrote ${result.filed?.length || 0} segment meetings (ids: ${ids}). Undo each with --delete <id>.\n`);
  }
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
