#!/usr/bin/env node
/**
 * Granola dry run — replay one or more notes through ingestGranolaNote({ dryRun: true }) and
 * print the per-chunk plan. Writes NOTHING. Reads the note from Granola with the coach's key,
 * the coach's calendar over the note's real span, and the lead records (all read-only).
 *
 *   node scripts/granola-dry-run.js --client Guy-Wilson not_abc not_def#2
 *
 * Runs on a deployed service (Render one-off job) — there is no local env with the keys.
 * A tombstoned (deleted) note is still replayed: the dry run reports the tombstone and shows
 * what WOULD happen.
 */

const args = process.argv.slice(2);
let client = 'Guy-Wilson';
const ids = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--client') { client = args[++i]; continue; }
  ids.push(args[i]);
}
if (!ids.length) { console.error('usage: node scripts/granola-dry-run.js --client <clientId> <noteId> [...]'); process.exit(2); }

const bris = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');

(async () => {
  const { ingestGranolaNote } = require('../services/granolaIngestService');
  for (const id of ids) {
    console.log(`\n==== DRY RUN ${id} (${client}) ====`);
    let r;
    try { r = await ingestGranolaNote({ noteId: id, coachClientId: client, dryRun: true }); }
    catch (e) { console.log(`THREW: ${e.message}`); continue; }
    if (!r.ok) { console.log(`NOT OK: ${r.error}`); if (r.plan) console.log(JSON.stringify(r.plan, null, 1)); continue; }
    if (r.skipped) { console.log(`SKIPPED: ${r.skipped}`); console.log(JSON.stringify(r.plan, null, 1)); continue; }
    if (r.wouldHold) { console.log(`WOULD HOLD ${r.holdMinutes} min`); console.log(JSON.stringify(r.plan, null, 1)); continue; }
    const p = r.plan;
    console.log(`note: "${p.title}"${p.tombstoned ? '  [TOMBSTONED - dry run only]' : ''}`);
    console.log(`created ${bris(p.noteCreatedAt)} | words ${p.span ? `${bris(p.span.start)} -> ${bris(p.span.end)}` : 'no span'} (${p.spanSource}) | mode ${p.mode}`);
    console.log(`granola linked event: ${p.linkedEvent ? `"${p.linkedEvent.title}" invitees ${p.linkedEvent.invitees.join(', ') || '-'}` : 'none'} | linked leads: ${p.linkedLeads.map((l) => l.name).join(', ') || '-'}`);
    console.log(`bookings overlapping the words: ${p.bookings.length ? p.bookings.map((b) => `"${b.summary}" ${bris(b.start)}-${bris(b.end).slice(-5)}`).join(' | ') : 'none'}`);
    for (const c of p.chunks) {
      console.log(`  chunk ${c.index} [${c.verdict.toUpperCase()}] "${c.title}"`);
      console.log(`     words ${bris(c.start)} -> ${bris(c.end)} (${c.durationSeconds != null ? Math.round(c.durationSeconds / 60) : '?'} min, ${c.transcriptLines} lines) | other voice ${c.themSeconds}s in ${c.themCount} lines, first at ${c.firstThemAt ? bris(c.firstThemAt) : '-'} | display names: ${c.speakerNames.join(', ') || '-'} (${c.nameCheck})`);
      console.log(`     leads: ${c.matchedLeads.map((m) => `${m.name} <${m.email}> via ${m.via}`).join('; ') || 'NONE'}${c.pendingLeads.length ? ` | pending: ${c.pendingLeads.map((x) => x.email).join(', ')}` : ''}`);
      if (c.reason) console.log(`     why: ${c.reason}`);
      console.log(`     would file as provider id: ${c.providerRecordingId}`);
    }
    for (const t of r.chunkTranscripts || []) {
      const head = String(t.transcriptText || '').split('\n').slice(0, 3).map((l) => l.slice(0, 140)).join('\n        ');
      const tail = String(t.transcriptText || '').split('\n').slice(-2).map((l) => l.slice(0, 140)).join('\n        ');
      console.log(`  chunk ${t.index} text (${t.verdict}):\n        ${head}\n        ...\n        ${tail}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
