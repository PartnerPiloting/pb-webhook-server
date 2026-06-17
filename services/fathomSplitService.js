/**
 * Fathom back-to-back splitter — pure "where to cut" logic.
 *
 * Recall's splitter (services/recallAutoSplitService.js) cuts a lumped recording using
 * participant join/leave PRESENCE events. Fathom doesn't emit those — but it does give a
 * per-line timestamp + speaker display_name. So this module reproduces the same outcome
 * (one segment per back-to-back meeting, each tied to the right lead) using:
 *
 *   absolute line time = recording_start_time + line.timestamp
 *   boundary           = when the NEXT meeting's lead first speaks (speaker-name transition)
 *
 * Decision (2026-06-12, Guy): SERIAL cut, overlap ACCEPTED. A segment runs from when its
 * lead first speaks until the next lead first speaks. No leave-detection; a little tail of
 * the previous person is fine (each segment is majority-correct and every line is labelled).
 *
 * PURE: no I/O. Caller supplies the Fathom meeting (with transcript[]) and the calendar
 * events overlapping the recording window (already filtered to real meetings, as Recall's
 * splitter does). Output is segments ready to be filed as separate meetings.
 */

function tsToSeconds(t) {
  const p = String(t || '').split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return 0;
}

/** First-name-tolerant match of a transcript speaker to a meeting's lead name. */
function speakerMatchesLead(speaker, leadName) {
  const s = String(speaker || '').trim().toLowerCase();
  const l = String(leadName || '').trim().toLowerCase();
  if (!s || !l) return false;
  if (s.includes(l) || l.includes(s)) return true;
  return s.split(/\s+/)[0] === l.split(/\s+/)[0]; // "Hrishekesh" ~ "Hrishekesh Shinde"
}

/**
 * Best-guess the lead's name for a calendar event:
 *   1. a non-coach attendee's displayName, else
 *   2. parse the summary "<Lead> and <Coach> meeting".
 */
function eventLeadName(ev, coachNames) {
  const coachSet = new Set((coachNames || []).map((n) => String(n).toLowerCase()));
  const att = (ev.attendees || []).find(
    (a) => a.displayName && !coachSet.has(String(a.displayName).toLowerCase()) && !a.self && !a.organizer,
  );
  if (att && att.displayName) return att.displayName.trim();
  const sum = String(ev.summary || '');
  const m = sum.match(/^(.*?)\s+and\s+/i); // "Tom Butler and Guy Wilson meeting"
  if (m) return m[1].trim();
  return sum.trim();
}

/** Lead emails for an event = attendee emails that aren't the coach's. */
function eventLeadEmails(ev, coachEmails) {
  const coachSet = new Set((coachEmails || []).map((e) => String(e).toLowerCase()));
  return [...new Set(
    (ev.attendees || [])
      .map((a) => (a.email || '').toLowerCase())
      .filter((e) => e && !coachSet.has(e)),
  )];
}

/**
 * Does this calendar event's expected lead ACTUALLY SPEAK in the recording?
 * Guard against false splits: if a call overruns into the next booked slot, or a calendar event
 * is a phantom/duplicate, the "second meeting" never really happened — its lead (cancelled/no-show)
 * never speaks. We use this to drop such events before deciding to split, so we never carve a
 * segment under the wrong person's name. (Real case 2026-06-17: Al's call overran into Courtney's
 * still-booked-but-cancelled slot → Courtney never spoke, yet a bogus "Courtney" segment was cut.)
 */
function eventLeadSpeaks(meeting, ev, coachNames) {
  const leadName = eventLeadName(ev, coachNames);
  if (!leadName) return false;
  const segs = Array.isArray(meeting.transcript) ? meeting.transcript : [];
  return segs.some((u) => {
    const speaker = (u && u.speaker && (u.speaker.display_name || u.speaker.name))
      || (typeof u?.speaker === 'string' ? u.speaker : '');
    return speakerMatchesLead(speaker, leadName);
  });
}

function flattenLines(lines) {
  return lines
    .map((l) => `${l.ts ? `[${l.ts}] ` : ''}${l.speaker}: ${l.text}`.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {object} meeting  Fathom meeting (recording_start_time + transcript[] of {speaker,text,timestamp})
 * @param {object[]} events Calendar events overlapping the recording (each {summary,start,end,attendees})
 * @param {object} [opts]   { coachNames:[], coachEmails:[] }
 * @returns {{ shouldSplit:boolean, reason:string, segments:object[] }}
 *   segments[]: { leadName, leadEmails, calendarEvent, startMs, endMs, lineCount,
 *                 transcriptText, speakerCounts, strayLines }
 */
function splitFathomMeeting(meeting, events, opts = {}) {
  const coachNames = opts.coachNames || ['Guy Wilson'];
  const coachEmails = opts.coachEmails || [];

  const recStartMs = Date.parse(meeting.recording_start_time || meeting.scheduled_start_time || 0);
  const segs = (Array.isArray(meeting.transcript) ? meeting.transcript : []).map((u) => ({
    absMs: recStartMs + tsToSeconds(u && u.timestamp) * 1000,
    ts: (u && typeof u.timestamp === 'string') ? u.timestamp : '',
    speaker: (u && u.speaker && (u.speaker.display_name || u.speaker.name)) || (typeof u?.speaker === 'string' ? u.speaker : 'Speaker'),
    text: (u && typeof u.text === 'string') ? u.text : '',
  }));

  const evs = (events || [])
    .map((ev) => ({ ev, leadName: eventLeadName(ev, coachNames), leadEmails: eventLeadEmails(ev, coachEmails) }))
    .sort((a, b) => Date.parse(a.ev.start) - Date.parse(b.ev.start));

  if (evs.length <= 1) {
    return { shouldSplit: false, reason: `${evs.length} meeting event(s) in window — no split`, segments: [] };
  }

  // Boundary per meeting = when its lead first speaks (fallback to scheduled start).
  const bounds = evs.map((e) => {
    const hit = segs.find((l) => speakerMatchesLead(l.speaker, e.leadName));
    return hit ? hit.absMs : Date.parse(e.ev.start);
  });
  const recEndMs = Date.parse(meeting.recording_end_time || meeting.scheduled_end_time || 0) || (segs.length ? segs[segs.length - 1].absMs + 1 : recStartMs + 1);

  const segments = evs.map((e, i) => {
    const lo = bounds[i];
    const hi = i + 1 < bounds.length ? bounds[i + 1] : recEndMs + 1;
    const lines = segs.filter((l) => l.absMs >= lo && l.absMs < hi);
    const speakerCounts = {};
    lines.forEach((l) => { speakerCounts[l.speaker] = (speakerCounts[l.speaker] || 0) + 1; });
    // stray = lines spoken by ANOTHER meeting's lead (overlap tail — accepted, just reported)
    const otherLeads = evs.filter((_, k) => k !== i).map((x) => x.leadName);
    const strayLines = lines.filter((l) => otherLeads.some((ol) => speakerMatchesLead(l.speaker, ol))).length;
    return {
      leadName: e.leadName,
      leadEmails: e.leadEmails,
      calendarEvent: { summary: e.ev.summary, start: e.ev.start, end: e.ev.end },
      startMs: lo,
      endMs: hi,
      lineCount: lines.length,
      transcriptText: flattenLines(lines),
      speakerCounts,
      strayLines,
    };
  });

  return { shouldSplit: true, reason: `${evs.length} back-to-back meetings — split on speaker transitions`, segments };
}

module.exports = {
  splitFathomMeeting,
  speakerMatchesLead,
  eventLeadName,
  eventLeadEmails,
  eventLeadSpeaks,
  tsToSeconds,
};
