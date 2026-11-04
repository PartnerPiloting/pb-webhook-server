/**
 * recentCalls - "who has this coach had a recorded call with lately?", read from the transcript
 * store (recall_meetings + recall_meeting_leads; "recall_" = the store, not Recall.ai).
 *
 * WHY (Guy 4 Nov 2026, the Bernard Kassab call): on a call Bernard said "let's reconnect in about
 * three weeks" and Guy said he was overseas until the end of November. Nothing picked that up,
 * because the follow-up sweep only ever looked at messages. The sweep now asks this module which
 * leads had a call in the last few days, and puts them in front of the overnight triage as
 * "AFTER A CALL". The triage reads the call (callForTriage below) and recommends park / draft /
 * drop like any other entry. Nothing here writes anything.
 *
 * SWITCH: FOLLOWUP_AFTERCALL = off (default) | on, plus FOLLOWUP_AFTERCALL_CLIENTS = a comma list of
 * client ids that get it while the main switch is off (Guy first). Read per call, so an env change
 * takes effect on the next deploy without code.
 *
 * Best-effort everywhere: no database, or a failed query, returns an empty map / null and the sweep
 * carries on exactly as before.
 */

const { Pool } = require('pg');

let pool;
function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
  pool.on('error', () => { /* a dropped idle connection must never crash the server */ });
  return pool;
}
/** Test seam. */
function _setPool(fake) { pool = fake; }

/** Is the after-call tier on for this client? */
function aftercallOn(tenant) {
  const main = String(process.env.FOLLOWUP_AFTERCALL || '').trim().toLowerCase();
  if (main === 'on') return true;
  const listed = String(process.env.FOLLOWUP_AFTERCALL_CLIENTS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return listed.includes(String(tenant || '').trim().toLowerCase());
}

/**
 * Newest call per lead in the window: Map<airtableLeadId, { ms, meetingId }>.
 * Only calls filed for THIS coach - a lead record id belongs to one client's base, and the coach
 * filter keeps one client's calls out of another's sweep.
 */
async function recentCallsByLead(tenant, { days = 7, nowMs = Date.now() } = {}) {
  const out = new Map();
  const p = getPool();
  if (!p || !tenant) return out;
  try {
    const since = new Date(nowMs - days * 86400000).toISOString();
    const r = await p.query(
      `SELECT DISTINCT ON (l.airtable_lead_id) l.airtable_lead_id AS lead_id, m.id AS meeting_id, m.meeting_start
         FROM recall_meetings m
         JOIN recall_meeting_leads l ON l.meeting_id = m.id
        WHERE m.coach_client_id = $1
          AND m.meeting_start >= $2
          AND l.airtable_lead_id IS NOT NULL
        ORDER BY l.airtable_lead_id, m.meeting_start DESC`,
      [tenant, since],
    );
    for (const row of r.rows) {
      const ms = row.meeting_start ? new Date(row.meeting_start).getTime() : NaN;
      if (!Number.isNaN(ms)) out.set(row.lead_id, { ms, meetingId: row.meeting_id });
    }
  } catch (e) {
    console.warn(`[recentCalls] read failed for ${tenant} (after-call tier skipped this run): ${e.message}`);
  }
  return out;
}

// How much of the call the triage gets: THIS person's stretch, from the line where they first
// speak to the end, capped. The first dry run (4 Nov 2026) read only the last 9,000 characters and
// cut off Guy's "I'm overseas, back towards the end of the month" two lines above the cut - the
// triage then parked Bernard to his own "three weeks" (25 Nov) instead of after Guy's return. The
// person's own start line also keeps an earlier person on the same recording (Alex's Unipile fix
// before Bernard, one Zoom) out of it. ~30k chars is about a 35-minute call, ~8k tokens.
const SEGMENT_CHARS = 30000;
// No line found for them (their name isn't on the speaker labels): the closing stretch, which is
// where "how about we reconnect when..." is nearly always said.
const TAIL_CHARS = 15000;

/** Same first-name-tolerant rule the back-to-back splitter uses (fathomSplitService). */
function speakerIsLead(speaker, leadName) {
  const s = String(speaker || '').trim().toLowerCase();
  const l = String(leadName || '').trim().toLowerCase();
  if (!s || !l) return false;
  if (s.includes(l) || l.includes(s)) return true;
  return s.split(/\s+/)[0] === l.split(/\s+/)[0];
}

/**
 * The part of a "[hh:mm:ss] Speaker: text" transcript that belongs to this person: from their first
 * line to the end (a person's stretch runs until the recording ends or the next person starts - the
 * end is where the follow-up is agreed, so the start is what matters). Returns { text, from } where
 * from = 'segment' | 'tail' | 'whole'.
 */
function personSegment(transcript, leadName, { segmentChars = SEGMENT_CHARS, tailChars = TAIL_CHARS } = {}) {
  const t = String(transcript || '');
  if (!t) return { text: '', from: 'whole' };
  if (leadName) {
    const re = /^\[[\d:]+\]\s*([^:\n]+):/gm;
    let m;
    while ((m = re.exec(t))) {
      if (speakerIsLead(m[1], leadName)) {
        const seg = t.slice(m.index);
        // Over the cap: keep the END - that is where it was left.
        if (seg.length > segmentChars) return { text: seg.slice(-segmentChars), from: 'tail' };
        return { text: seg, from: m.index === 0 ? 'whole' : 'segment' };
      }
    }
  }
  if (t.length > tailChars) return { text: t.slice(-tailChars), from: 'tail' };
  return { text: t, from: 'whole' };
}

function summaryLines(summaryJson) {
  let s = null;
  try { s = typeof summaryJson === 'string' ? JSON.parse(summaryJson) : summaryJson; } catch (_) { return []; }
  if (!s || typeof s !== 'object') return [];
  const lines = [];
  if (s.purpose) lines.push(`what it was for: ${String(s.purpose).slice(0, 300)}`);
  const steps = Array.isArray(s.nextSteps) ? s.nextSteps : [];
  if (steps.length) lines.push(`agreed next steps: ${steps.map(String).join(' · ').slice(0, 600)}`);
  const acts = Array.isArray(s.actionItems) ? s.actionItems : [];
  if (acts.length) lines.push(`action items: ${acts.map((a) => `${a.owner || '?'}: ${a.task || ''}`).join(' · ').slice(0, 600)}`);
  return lines;
}

/**
 * The call itself, as triage lines - for an AFTER A CALL person, whose dossier (rebuilt AFTER the
 * triage each night) cannot know about it yet. null when the meeting can't be read.
 */
async function callForTriage(meetingId, { leadName = '' } = {}) {
  const p = getPool();
  if (!p || !meetingId) return null;
  try {
    const r = await p.query('SELECT title, meeting_start, summary_json, transcript_text FROM recall_meetings WHERE id = $1', [meetingId]);
    const m = r.rows[0];
    if (!m) return null;
    const date = m.meeting_start ? new Date(m.meeting_start).toISOString().slice(0, 10) : '?';
    const lines = [`THE CALL ${date} (just happened - decide from HOW IT WAS LEFT, in both people's words):`];
    for (const l of summaryLines(m.summary_json)) lines.push(`  ${l}`);
    const seg = personSegment(m.transcript_text, leadName);
    if (seg.text) {
      const label = {
        segment: 'TRANSCRIPT FROM WHERE THEY JOIN (an earlier, different conversation on the same recording is left out)',
        tail: 'END OF THE TRANSCRIPT (earlier part omitted)',
        whole: 'TRANSCRIPT',
      }[seg.from];
      lines.push(`  ${label}:\n${seg.text}`);
    }
    return lines;
  } catch (e) {
    console.warn(`[recentCalls] meeting ${meetingId} unreadable: ${e.message}`);
    return null;
  }
}

module.exports = { aftercallOn, recentCallsByLead, callForTriage, summaryLines, personSegment, _setPool, TAIL_CHARS, SEGMENT_CHARS };
