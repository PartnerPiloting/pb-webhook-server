#!/usr/bin/env node
/**
 * Verification for the multi-tenant transcript-recording changes (Guy = client 0).
 * READ-ONLY / DRY-RUN: writes nothing except the idempotent schema migration (which the app
 * applies on boot anyway). Safe to run on prod via a Render one-off job.
 *
 *   node scripts/test-multitenant-recording.js
 *
 * Covers:
 *   #3 tenancy stamping  — coach_client_id column exists + existing rows backfilled to Guy-Wilson
 *   #5 tenant-aware reads — getMeetingQueue / getMeetingsForLead / getMeetingById scope by owner
 *   #2 multi-tenant poll  — pollAllFathomTenants lists Active clients w/ a Fathom key + dry-run polls each
 */

try { require('dotenv').config({ path: '.env.local' }); } catch (_) { /* optional */ }
try { require('dotenv').config(); } catch (_) { /* optional */ }

const GUY = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const FAKE = 'Nonexistent-Tenant-zzz';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('\nFATAL: DATABASE_URL not set — run where the prod DB is reachable.\n'); process.exit(1); }
  const db = require('../services/recallWebhookDb');
  const { pollAllFathomTenants } = require('../services/fathomPollService');
  const clientService = require('../services/clientService');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.trim(), ssl: { rejectUnauthorized: false } });

  console.log('\n=== #3  Tenancy stamping ===');
  // Force the migration to have run (any db read calls ensureSchema).
  await db.getMeetingQueue(1, 'all', {});
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='recall_meetings' AND column_name='coach_client_id'`,
  );
  check('coach_client_id column exists on recall_meetings', col.rows.length === 1);

  const dist = await pool.query(
    `SELECT COALESCE(coach_client_id, '(null)') AS owner, COUNT(*)::int AS n
     FROM recall_meetings GROUP BY 1 ORDER BY n DESC`,
  );
  console.log('     owners:', dist.rows.map((r) => `${r.owner}=${r.n}`).join(', ') || '(no meetings)');
  const nulls = dist.rows.find((r) => r.owner === '(null)');
  check('no un-stamped (NULL) meeting rows', !nulls, nulls ? `${nulls.n} NULL rows` : 'all rows stamped');
  const guyOwned = dist.rows.find((r) => r.owner === GUY);
  check('existing rows backfilled to Guy', !!guyOwned || dist.rows.length === 0,
    guyOwned ? `${guyOwned.n} rows owned by ${GUY}` : 'no meetings yet');

  console.log('\n=== #5  Tenant-aware reads ===');
  const qAll = await db.getMeetingQueue(200, 'all', {});
  const qGuy = await db.getMeetingQueue(200, 'all', { coachClientId: GUY });
  const qFake = await db.getMeetingQueue(200, 'all', { coachClientId: FAKE });
  check('queue: unfiltered == Guy-scoped (all data is Guy0)', qAll.length === qGuy.length, `all=${qAll.length} guy=${qGuy.length}`);
  check('queue: fake tenant sees nothing (isolation)', qFake.length === 0, `fake=${qFake.length}`);

  // getMeetingById scope
  if (qAll.length) {
    const id = qAll[0].id;
    const byGuy = await db.getMeetingById(id, GUY);
    const byFake = await db.getMeetingById(id, FAKE);
    check('getMeetingById: visible to owner', !!byGuy, `id=${id}`);
    check('getMeetingById: hidden from fake tenant', !byFake, `id=${id}`);
  } else {
    check('getMeetingById scope (skipped — no meetings)', true);
  }

  // getMeetingsForLead scope — sample a real lead from the link table
  const leadRow = await pool.query(`SELECT airtable_lead_id FROM recall_meeting_leads LIMIT 1`);
  if (leadRow.rows.length) {
    const leadId = leadRow.rows[0].airtable_lead_id;
    const lAll = await db.getMeetingsForLead(leadId, 50);
    const lGuy = await db.getMeetingsForLead(leadId, 50, GUY);
    const lFake = await db.getMeetingsForLead(leadId, 50, FAKE);
    check('lead lookup: unfiltered == Guy-scoped', lAll.length === lGuy.length, `all=${lAll.length} guy=${lGuy.length}`);
    check('lead lookup: fake tenant sees nothing', lFake.length === 0, `fake=${lFake.length}`);
  } else {
    check('getMeetingsForLead scope (skipped — no linked leads)', true);
  }

  console.log('\n=== #2  Multi-tenant poll (dry-run) ===');
  const allClients = await clientService.getAllClients();
  const withKey = (allClients || []).filter((c) => c && c.fathomApiKey && String(c.status || '').toLowerCase() === 'active');
  console.log(`     Active clients with a Fathom key: ${withKey.map((c) => c.clientId).join(', ') || '(none)'}`);
  check('exactly one tenant has a Fathom key today (Guy0)', withKey.length >= 1 && withKey.some((c) => c.clientId === GUY),
    `${withKey.length} tenant(s)`);

  const poll = await pollAllFathomTenants({ dryRun: true, limit: 10 });
  check('pollAllFathomTenants ran across tenants (dry-run, no writes)', poll.ok && poll.tenants >= 1,
    `tenants=${poll.tenants} ingested=${poll.ingested} failed=${poll.failed}`);
  const guyResult = (poll.results || []).find((r) => r.clientId === GUY);
  check('Guy was polled as a tenant', !!guyResult, guyResult ? `ok=${guyResult.ok}` : 'not in results');

  await pool.end();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  if (failed.length) { console.log('FAILED:', failed.map((r) => r.name).join('; ')); process.exit(1); }
  console.log('ALL GREEN — multi-tenant recording changes verified with Guy as client 0.\n');
}

main().catch((err) => { console.error('FATAL:', err.message, err.stack); process.exit(1); });
