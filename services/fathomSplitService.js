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
 *   2. parse the summary — split on the pairing separators ("X and Y", "X & Y", "X / Y",
 *      "X + Y"), clean each side, drop the coach, return the survivor.
 *
 * MUST return a name that never contains the coach — or '' when no lead can be parsed.
 * (2026-07-03: the old fallback returned the WHOLE title for "&"/"/" separators, so
 * "Luke Swithenbank & Guy Wilson" made the coach's own lines match as the lead: the
 * eventLeadSpeaks guard passed for phantom events and split bounds collapsed to line 0.
 * '' is the safe failure — the event can't claim speech, worst case we file as single.)
 */
function eventLeadName(ev, coachNames) {
  const coach = (coachNames || []).map((n) => String(n).trim()).filter(Boolean);
  const isCoachish = (name) => coach.some((c) => speakerMatchesLead(name, c));
  const att = (ev.attendees || []).find(
    (a) => a.displayName && !isCoachish(a.displayName) && !a.self && !a.organizer,
  );
  if (att && att.displayName) return att.displayName.trim();
  const sum = String(ev.summary || '').trim();
  const parts = sum.split(/\s+(?:and|&|\/|\+)\s+/i)
    .map((s) => s.split(/\s+-\s+/)[0].replace(/\s+meeting\s*$/i, '').trim()) // "Alasdair Bell - 45min Meeting" -> "Alasdair Bell"
    .filter(Boolean);
  const leads = parts.filter((s) => !isCoachish(s));
  return leads.length ? leads[0] : '';
}

/** The speaker's calendar-matched email on a Fathom transcript utterance, if Fathom supplied one. */
function speakerEmailOf(u) {
  const e = (u && u.speaker && typeof u.speaker === 'object')
    ? (u.speaker.matched_calendar_invitee_email || u.speaker.email || '')
    : '';
  return String(e).trim().toLowerCase();
}

/**
 * Drop duplicate calendar events (same lead, same start) before split decisions.
 * (2026-07-03: Guy duplicated an event on-screen mid-call to book the next one; the copy sat
 * on the same slot and the splitter treated one meeting as a back-to-back with itself.)
 */
function dedupeMeetingEvents(events, coachNames) {
  const seen = new Set();
  return (events || []).filter((ev) => {
    const lead = eventLeadName(ev, coachNames) || String(ev.summary || '');
    const key = `${lead.toLowerCase()}|${ev.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
function eventLeadSpeaks(meeting, ev, coachNames, coachEmails) {
  const leadName = eventLeadName(ev, coachNames);
  const leadEmails = new Set(eventLeadEmails(ev, coachEmails || []));
  if (!leadName && !leadEmails.size) return false;
  const segs = Array.isArray(meeting.transcript) ? meeting.transcript : [];
  return segs.some((u) => {
    // Zoom display names often differ from calendar names (2026-07-03: Andrew Bain spoke as
    // "bobba") — Fathom's speaker→invitee email match is the reliable identity when present.
    const email = speakerEmailOf(u);
    if (email && leadEmails.has(email)) return true;
    if (!leadName) return false;
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
    email: speakerEmailOf(u),
    text: (u && typeof u.text === 'string') ? u.text : '',
  }));

  const evs = dedupeMeetingEvents(events, coachNames)
    .map((ev) => ({ ev, leadName: eventLeadName(ev, coachNames), leadEmails: eventLeadEmails(ev, coachEmails) }))
    .sort((a, b) => Date.parse(a.ev.start) - Date.parse(b.ev.start));

  if (evs.length <= 1) {
    return { shouldSplit: false, reason: `${evs.length} meeting event(s) in window after dedupe — no split`, segments: [] };
  }

  // Boundary per meeting = when its lead first speaks (email match beats name match — Zoom
  // display names drift; fallback to scheduled start).
  const lineIsLead = (l, e) => (l.email && e.leadEmails.includes(l.email))
    || (e.leadName ? speakerMatchesLead(l.speaker, e.leadName) : false);
  const bounds = evs.map((e) => {
    const hit = segs.find((l) => lineIsLead(l, e));
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
    const others = evs.filter((_, k) => k !== i);
    const strayLines = lines.filter((l) => others.some((o) => lineIsLead(l, o))).length;
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
  dedupeMeetingEvents,
  speakerEmailOf,
  tsToSeconds,
};
