/**
 * Auto-split service for Recall transcripts.
 *
 * When a recording finishes, this service checks the coach's Google Calendar
 * for that time window. If there were multiple back-to-back appointments,
 * it uses participant join/leave events to create overlapping child transcripts
 * — one per appointment — each linked to the relevant lead.
 *
 * Split rules:
 *   1 calendar event  → no split
 *   2+ events, but no new participant joined near the next event start → no-show, no split
 *   2+ events, new participant joined ≥15 min past next event start → split using
 *     overlapping windows (Dean's transcript ends when Dean leaves; Julia's starts when Julia joins)
 */

const { listCalendarEventsWithAttendeesInRange } = require('../config/calendarServiceAccount');
const clientService = require('./clientService');
const { createSafeLogger } = require('../utils/loggerHelper');

const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const HANDOVER_BUFFER_MS = 5 * 60 * 1000;
const MIN_MEETING_DURATION_MS = 15 * 60 * 1000;

const log = createSafeLogger('SYSTEM', null, 'recall_auto_split');

/**
 * Determine whether a meeting should be split and compute the split windows.
 *
 * @param {object} meeting  - recall_meetings row (must have meeting_start, meeting_end, id)
 * @param {object[]} presenceRows - recall_participant_presence rows for this meeting
 *   Each row: { platform_participant_id, event_kind, abs_ts, rel_seconds }
 * @param {object[]} participants - recall_meeting_participants rows
 * @param {string} [coachClientId] - defaults to env / 'Guy-Wilson'
 *
 * @returns {Promise<{ shouldSplit: boolean, reason: string, windows?: object[] }>}
 *   windows[]: { calendarEvent, startRel, endRel, participants: number[] }
 */
async function evaluateAutoSplit(meeting, presenceRows, participants, coachClientId, opts) {
  const cid = coachClientId || DEFAULT_COACH_CLIENT_ID;
  const calendarEventsOverride = opts?.calendarEvents || null;

  if (!meeting.meeting_start || !meeting.meeting_end) {
    return { shouldSplit: false, reason: 'no meeting_start/meeting_end on recording' };
  }

  const recStart = new Date(meeting.meeting_start);
  const recEnd = new Date(meeting.meeting_end);
  if (isNaN(recStart) || isNaN(recEnd)) {
    return { shouldSplit: false, reason: 'invalid meeting times' };
  }

  let calEvents;
  if (calendarEventsOverride) {
    calEvents = calendarEventsOverride;
  } else {
    let calendarEmail = '';
    try {
      const coach = await clientService.getClientById(cid);
      calendarEmail = coach?.googleCalendarEmail || '';
    } catch (_) { /* optional */ }

    if (!calendarEmail) {
      return { shouldSplit: false, reason: 'no calendar email for coach' };
    }

    const padBefore = new Date(recStart.getTime() - 10 * 60 * 1000);
    const padAfter = new Date(recEnd.getTime() + 10 * 60 * 1000);
    const calResult = await listCalendarEventsWithAttendeesInRange(
      calendarEmail, padBefore, padAfter,
    );

    if (calResult.error) {
      log.warn(`calendar lookup failed: ${calResult.error}`);
      return { shouldSplit: false, reason: `calendar error: ${calResult.error}` };
    }
    calEvents = calResult.events;
  }

  const relevant = calEvents.filter(ev => {
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    return s < recEnd && e > recStart;
  });

  if (relevant.length <= 1) {
    return { shouldSplit: false, reason: `${relevant.length} calendar event(s) in window — no split needed` };
  }

  relevant.sort((a, b) => new Date(a.start) - new Date(b.start));

  const coachPids = new Set();
  for (const p of participants) {
    if (p.role === 'coach') coachPids.add(Number(p.platform_participant_id));
  }

  const joinsByPid = new Map();
  const leavesByPid = new Map();
  for (const pr of presenceRows) {
    const pid = Number(pr.platform_participant_id);
    if (coachPids.has(pid)) continue;
    const ts = pr.abs_ts ? new Date(pr.abs_ts) : null;
    const rel = pr.rel_seconds != null ? Number(pr.rel_seconds) : null;
    if (pr.event_kind === 'join') {
      if (!joinsByPid.has(pid)) joinsByPid.set(pid, []);
      joinsByPid.get(pid).push({ ts, rel });
    } else if (pr.event_kind === 'leave') {
      if (!leavesByPid.has(pid)) leavesByPid.set(pid, []);
      leavesByPid.get(pid).push({ ts, rel });
    }
  }

  // Pass 1: assign participants to each calendar event
  const slots = [];
  for (let i = 0; i < relevant.length; i++) {
    const calEv = relevant[i];
    const calStart = new Date(calEv.start);
    const nextCalStart = i < relevant.length - 1 ? new Date(relevant[i + 1].start) : null;
    const windowEndAbs = nextCalStart || new Date(calEv.end);

    const pidsInSlot = [];
    for (const [pid, joins] of joinsByPid) {
      const joinedDuringSlot = joins.some(j => {
        if (!j.ts) return false;
        return j.ts >= new Date(calStart.getTime() - HANDOVER_BUFFER_MS) &&
               j.ts <= new Date(windowEndAbs.getTime() + HANDOVER_BUFFER_MS);
      });
      if (joinedDuringSlot) pidsInSlot.push(pid);
    }

    if (i > 0 && pidsInSlot.length === 0) {
      log.info(`calendar event "${calEv.summary}" appears to be a no-show (no participant joins)`);
      slots.push(null);
      continue;
    }

    slots.push({ calEv, pids: pidsInSlot });
  }

  // Pass 2: build overlapping windows using leave/join times
  const activeSlots = slots.filter(Boolean);
  const windows = [];
  for (let idx = 0; idx < activeSlots.length; idx++) {
    const slot = activeSlots[idx];
    const nextSlot = idx < activeSlots.length - 1 ? activeSlots[idx + 1] : null;

    let startRel = null;
    let endRel = null;

    if (idx === 0) {
      startRel = 0;
    } else {
      let earliestJoin = Infinity;
      for (const pid of slot.pids) {
        const joins = joinsByPid.get(pid) || [];
        for (const j of joins) {
          if (j.rel != null && j.rel < earliestJoin) earliestJoin = j.rel;
        }
      }
      startRel = earliestJoin === Infinity ? null : earliestJoin;
    }

    if (!nextSlot) {
      endRel = null;
    } else {
      // Departing pids: in this slot but not in the next
      const nextPidSet = new Set(nextSlot.pids);
      const departingPids = slot.pids.filter(pid => !nextPidSet.has(pid));

      let latestLeave = -Infinity;
      for (const pid of departingPids) {
        const leaves = leavesByPid.get(pid) || [];
        for (const lv of leaves) {
          if (lv.rel != null && lv.rel > latestLeave) latestLeave = lv.rel;
        }
      }

      if (latestLeave > -Infinity) {
        endRel = latestLeave;
      } else {
        const calEnd = new Date(slot.calEv.end);
        const offsetMs = calEnd.getTime() - recStart.getTime();
        endRel = Math.max(0, offsetMs / 1000);
      }
    }

    windows.push({
      calendarEvent: {
        summary: slot.calEv.summary,
        start: slot.calEv.start,
        end: slot.calEv.end,
        attendees: slot.calEv.attendees || [],
      },
      startRel,
      endRel,
      participants: slot.pids,
    });
  }

  if (windows.length <= 1) {
    return { shouldSplit: false, reason: 'only one active appointment (others were no-shows)' };
  }

  return {
    shouldSplit: true,
    reason: `${windows.length} appointments with participants in window`,
    windows,
  };
}

/**
 * Execute the auto-split: create child meetings with overlapping transcript windows.
 *
 * @param {number} meetingId
 * @param {object[]} windows - from evaluateAutoSplit().windows
 * @param {object} db - { getMeetingById, splitMeetingByUtteranceWindow } functions
 */
async function executeAutoSplit(meetingId, windows, db) {
  const parent = await db.getMeetingById(meetingId);
  if (!parent) return { ok: false, error: 'parent meeting not found' };

  // Resolve which attendee emails belong to each window's calendar event
  const coachEmails = new Set();
  try {
    const coach = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
    if (coach?.googleCalendarEmail) coachEmails.add(coach.googleCalendarEmail.toLowerCase());
    if (coach?.calendarEmail) coachEmails.add(coach.calendarEmail.toLowerCase());
  } catch (_) { /* optional */ }

  const children = [];
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const title = w.calendarEvent?.summary
      ? `${w.calendarEvent.summary}`
      : `${parent.title || 'Meeting'} (part ${i + 1})`;

    // Get non-coach attendee emails for this specific calendar event
    const attendeeEmails = (w.calendarEvent?.attendees || [])
      .map(a => (a.email || '').toLowerCase().trim())
      .filter(e => e && e.includes('@') && !coachEmails.has(e));

    const child = await db.createChildMeetingFromUtterances({
      parentId: meetingId,
      title,
      startRel: w.startRel,
      endRel: w.endRel,
      participantIds: w.participants,
      calendarStart: w.calendarEvent?.start || null,
      calendarEnd: w.calendarEvent?.end || null,
      attendeeEmails,
    });

    children.push({ ...child, window: w });
  }

  await db.markParentSplit(meetingId, children.map(c => c.childId));

  return { ok: true, parent_id: meetingId, children };
}

/**
 * One-call wrapper: load meeting + presence + participants from DB, evaluate, execute if needed.
 * @param {number|string} meetingId
 * @param {object} [opts] - { calendarEvents?: object[] } for testing
 */
async function tryAutoSplitForMeeting(meetingId, opts) {
  const db = require('./recallWebhookDb');
  const meeting = await db.getMeetingById(meetingId);
  if (!meeting) return { ok: false, error: 'meeting not found' };

  if (meeting.status === 'complete' || meeting.status === 'skipped') {
    return { ok: false, reason: 'meeting already processed', status: meeting.status };
  }

  const presenceRows = await db.getPresenceForMeeting(meetingId);
  const participants = await db.getParticipantsForMeeting(meetingId);

  const evaluation = await evaluateAutoSplit(meeting, presenceRows, participants, null, opts);
  log.info(`AUTO-SPLIT evaluate meeting=${meetingId}: shouldSplit=${evaluation.shouldSplit}, reason=${evaluation.reason}`);

  if (!evaluation.shouldSplit) {
    return { ok: true, split: false, reason: evaluation.reason };
  }

  const result = await executeAutoSplit(meetingId, evaluation.windows, {
    getMeetingById: db.getMeetingById,
    createChildMeetingFromUtterances: db.createChildMeetingFromUtterances,
    markParentSplit: db.markParentSplit,
  });

  log.info(`AUTO-SPLIT execute meeting=${meetingId}: ok=${result.ok}, children=${result.children?.length || 0}`);
  return { ok: result.ok, split: true, evaluation, result };
}

module.exports = {
  evaluateAutoSplit,
  executeAutoSplit,
  tryAutoSplitForMeeting,
  DEFAULT_COACH_CLIENT_ID,
};
