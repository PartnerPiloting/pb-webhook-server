#!/usr/bin/env node
/**
 * Re-sort a Fireflies client's "People you've met" list with the 2026-09-24 rules:
 *   - only the calendar booking a recording BELONGS to supplies guests (no borrowing from an
 *     overlapping event - Rick's 16 AgentNexa guests stapled onto his Mikael call);
 *   - each waiting person is tagged booked (on the booking) or extra (just joined).
 *
 * For every Fireflies meeting with someone still waiting, it re-runs the ingest as a DRY RUN
 * (fetch from Fireflies + read the calendar, write nothing) and compares:
 *   - waiting entry the new rules still produce -> gets its role/with tag
 *   - waiting entry the new rules DON'T produce  -> removed from that meeting (it was borrowed)
 *   - resolved / skipped entries, and anyone now matching a lead -> untouched
 * A meeting whose dry run fails or is declined is left exactly as it is.
 *
 * Run on the server (needs prod env):
 *   node scripts/repair-pending-roles.js --client Rick-Wong           (report only)
 *   node scripts/repair-pending-roles.js --client Rick-Wong --apply   (write)
 */
require('dotenv').config();
const { getPool, findPendingLeadMeetings } = require('../services/recallWebhookDb');
const { ingestFirefliesTranscript } = require('../services/firefliesIngestService');

const args = process.argv.slice(2);
const clientId = args[args.indexOf('--client') + 1];
const apply = args.includes('--apply');
const isActive = (x) => !!x && !x.resolvedAt && !x.declinedAt;

(async () => {
  if (!clientId || clientId.startsWith('--')) { console.error('usage: --client <Client-ID> [--apply]'); process.exit(1); }
  const pool = getPool();
  const rows = (await findPendingLeadMeetings({ coachClientId: clientId, limit: 200, activeOnly: true }))
    .filter((m) => m.source === 'fireflies');
  console.log(`${clientId}: ${rows.length} Fireflies meeting(s) with someone waiting ${apply ? '(APPLY)' : '(report only)'}`);
  let removed = 0, tagged = 0, untouched = 0;
  for (const m of rows) {
    const full = await pool.query('SELECT provider_recording_id, pending_leads FROM recall_meetings WHERE id = $1', [m.id]);
    const recId = full.rows[0] && full.rows[0].provider_recording_id;
    let all = [];
    try { all = JSON.parse(full.rows[0].pending_leads) || []; } catch (_) { /* skip */ }
    if (!recId) { console.log(`  #${m.id} "${m.title}": no Fireflies id - left alone`); untouched++; continue; }
    const r = await ingestFirefliesTranscript({ transcriptId: recId, coachClientId: clientId, dryRun: true, bypassHold: true });
    if (!r.ok || !r.plan || !Array.isArray(r.plan.pendingLeads)) {
      console.log(`  #${m.id} "${m.title}": dry run ${r.skipped || r.error || 'gave no plan'} - left alone`);
      untouched++; continue;
    }
    const fresh = new Map(r.plan.pendingLeads.map((x) => [x.email, x]));
    const nowLeads = new Set((r.plan.matchedLeads || []).map((x) => String(x.email || '').toLowerCase()).filter(Boolean));
    const lines = [];
    const next = [];
    for (const x of all) {
      if (!isActive(x) || nowLeads.has(x.email)) { next.push(x); continue; }
      const f = fresh.get(x.email);
      if (!f) { lines.push(`remove ${x.email}`); removed++; continue; }
      const out = { ...x };
      if (f.role) out.role = f.role; else delete out.role;
      if (f.with) out.with = f.with; else delete out.with;
      if (out.role) { lines.push(`${out.role.padEnd(6)} ${x.email}${out.with ? ` (with ${out.with})` : ''}`); tagged++; }
      else lines.push(`keep   ${x.email} (no booking lined up)`);
      next.push(out);
    }
    console.log(`  #${m.id} ${m.meeting_start ? new Date(m.meeting_start).toISOString().slice(0, 16) : ''} "${m.title}"`);
    for (const l of lines) console.log(`      ${l}`);
    if (apply) {
      await pool.query('UPDATE recall_meetings SET pending_leads = $1, updated_at = now() WHERE id = $2',
        [next.length ? JSON.stringify(next) : null, m.id]);
    }
  }
  console.log(`done: ${removed} removed, ${tagged} tagged, ${untouched} meeting(s) left alone${apply ? '' : ' - REPORT ONLY, nothing written'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
