/**
 * One-off diagnostic — fetch ONE real Fathom meeting and dump its structure.
 *
 * READ-ONLY. Makes a single GET to the Fathom API. No DB writes, no Airtable
 * writes, touches nothing in the Recall pipeline. Purpose: confirm the exact
 * payload shape (per-line timestamps, speaker→email matching, calendar_invitees
 * emails, meeting start/end) before we build the Fathom ingest + splitter.
 *
 * Key resolution order:
 *   1. process.env.FATHOM_API_KEY  (e.g. add FATHOM_API_KEY=... to .env.local)
 *   2. Airtable Client Master "Fathom API Key" for the coach client (reuses
 *      the same key the Meeting Prep feature already uses).
 *
 * Usage:
 *   node scripts/fathom-inspect.js                 # auto-pick a likely back-to-back
 *   node scripts/fathom-inspect.js <recording_id>  # inspect a specific meeting
 */

try { require('dotenv').config({ path: '.env.local' }); } catch (_) { /* optional */ }
try { require('dotenv').config(); } catch (_) { /* optional */ }

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

async function resolveApiKey() {
  if (process.env.FATHOM_API_KEY && process.env.FATHOM_API_KEY.trim()) {
    return { key: process.env.FATHOM_API_KEY.trim(), from: 'env FATHOM_API_KEY' };
  }
  try {
    const clientService = require('../services/clientService');
    const coachId = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
    const client = await clientService.getClientById(coachId);
    if (client && client.fathomApiKey) {
      return { key: String(client.fathomApiKey).trim(), from: `Airtable Client Master (${coachId})` };
    }
  } catch (e) {
    console.error('  (Airtable fallback unavailable:', e.message, ')');
  }
  return { key: null, from: null };
}

function trimTranscript(meeting, keep = 4) {
  if (Array.isArray(meeting && meeting.transcript)) {
    const total = meeting.transcript.length;
    return {
      ...meeting,
      transcript: meeting.transcript.slice(0, keep),
      _transcript_total_lines: total,
      _transcript_note: `showing first ${keep} of ${total} lines`,
    };
  }
  return meeting;
}

function firstDefined(obj, keys) {
  for (const k of keys) if (obj && obj[k] != null) return obj[k];
  return undefined;
}

(async () => {
  const { key, from } = await resolveApiKey();
  if (!key) {
    console.error('\nNo Fathom API key found.');
    console.error('Fix: add  FATHOM_API_KEY=your_key  to .env.local, then re-run.');
    console.error('(Or ensure the coach record in Airtable Client Master has a "Fathom API Key".)\n');
    process.exit(1);
  }
  console.log(`Using key from: ${from}\n`);

  const targetId = process.argv[2] || null;

  const url = new URL(`${FATHOM_API_BASE}/meetings`);
  url.searchParams.set('limit', '25');
  url.searchParams.set('include_transcript', 'true');
  url.searchParams.set('include_summary', 'true');

  let res;
  try {
    res = await fetch(url.toString(), {
      headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Network error calling Fathom:', e.message);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Fathom API error ${res.status} ${res.statusText}`);
    console.error((await res.text().catch(() => '')).slice(0, 600));
    process.exit(1);
  }

  const data = await res.json();
  const items = Array.isArray(data)
    ? data
    : (data.items || data.meetings || data.results || data.data || []);

  console.log(`=== Fathom returned ${items.length} meetings ===\n`);

  items.forEach((m, i) => {
    const invitees = m.calendar_invitees || m.invitees || [];
    const domains = [...new Set(
      invitees.map((x) => x.email_domain || (x.email || '').split('@')[1]).filter(Boolean),
    )];
    const title = firstDefined(m, ['meeting_title', 'title']) || '';
    const start = firstDefined(m, ['recording_start_time', 'scheduled_start_time', 'created_at']) || '?';
    const lines = Array.isArray(m.transcript) ? m.transcript.length : 'n/a';
    console.log(
      `${String(i).padStart(2)}. ${firstDefined(m, ['recording_id', 'id']) || '?'} | ` +
      `"${String(title).slice(0, 38)}" | start=${start} | ` +
      `invitees=${invitees.length} domains=[${domains.join(', ')}] | lines=${lines}`,
    );
  });

  let chosen = null;
  if (targetId) {
    chosen = items.find((m) => String(firstDefined(m, ['recording_id', 'id'])) === String(targetId));
  }
  if (!chosen) {
    // Heuristic: most calendar invitees → most likely a back-to-back worth inspecting.
    chosen = [...items].sort(
      (a, b) => ((b.calendar_invitees || b.invitees || []).length)
              - ((a.calendar_invitees || a.invitees || []).length),
    )[0];
  }
  if (!chosen) { console.log('\nNothing to inspect.'); return; }

  console.log('\n=== FULL STRUCTURE of chosen meeting (transcript trimmed to 4 lines) ===\n');
  console.log(JSON.stringify(trimTranscript(chosen, 4), null, 2));

  console.log('\n=== Splitter-readiness checks ===');
  const t0 = Array.isArray(chosen.transcript) ? chosen.transcript[0] : null;
  console.log('transcript[0]:', JSON.stringify(t0));
  console.log('  • per-line timestamp present :', !!(t0 && firstDefined(t0, ['timestamp', 'time', 'start_time', 'start'])));
  console.log('  • speaker display name       :', !!(t0 && t0.speaker && (t0.speaker.display_name || t0.speaker.name)));
  console.log('  • speaker→email match        :', !!(t0 && t0.speaker && firstDefined(t0.speaker, ['matched_calendar_invitee_email', 'email'])));
  const inv = (chosen.calendar_invitees || chosen.invitees || [])[0];
  console.log('calendar_invitees[0]:', JSON.stringify(inv));
  console.log('  • invitee email present      :', !!(inv && inv.email));
  console.log('  • invitee→speaker match name :', !!(inv && inv.matched_speaker_display_name));
  console.log('  • recording_start_time       :', firstDefined(chosen, ['recording_start_time']) || '(missing)');
  console.log('  • recording_end_time         :', firstDefined(chosen, ['recording_end_time']) || '(missing)');
  console.log('  • scheduled_start_time       :', firstDefined(chosen, ['scheduled_start_time']) || '(missing)');
  console.log('\nDone. (read-only — nothing was written)\n');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
