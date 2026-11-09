// config/wingguyBookingPrefs.js
// Per-tenant BOOKING PREFERENCES — the "seam" (Option A, 2026-06-26).
//
// Booking reads a tenant's preferences through ONE function (getBookingPrefs) so that WHERE they're
// stored can change later without touching the booking logic. Today they're code defaults (Guy =
// tenant 0); the next slice swaps the source to Postgres — the Wingguy store — where each user sets
// and changes them conversationally (migrated from Guy's Notion). Multi-tenant in SHAPE now (keyed by
// clientId), single-tenant only in VALUE.
//
// ⚠ These are PREFERENCES (soft, user-owned), NOT the hard rules. Timezone-correctness (a slot must
// work for BOTH the lead's and the client's timezone) and no-double-booking are GUARANTEES that live
// in the calendar code (config/calendarServiceAccount.js + the /api/calendar logic) and are never
// user-editable. Preferences only choose WHICH valid slots to prefer/offer.

const DEFAULT_PREFS = {
  // Time-of-day bounds (soft).
  preferredStart: '10:00',   // Guy's DEFAULT day start — offer 10:00-or-later slots unless the week can't fill the options
  earliestStart: '09:30',    // the at-a-pinch floor (Guy 2026-07-06): only offer 9:30 when 10:00+ can't fill the options or the lead can only do then; NEVER earlier
  lastStart: '16:30',        // last meeting may START by this time
  slotsToOffer: 3,           // how many options to put in the "here are some times" message
  meetingLengthMins: 30,     // default meeting length
  excludeWeekends: true,     // weekdays only unless explicitly overridden
  // How the options are chosen — Guy's locked prefs (2026-06-28). The agent applies these as a
  // FALLBACK LADDER: (best) spread across the next working week on the least-busy days, varied
  // times of day, ≥1 clear day's notice → (then) allow back-to-back / same-day → (then) drop toward
  // the 9:30 earliest. Always fill slotsToOffer if availability allows.
  minLeadDays: 1,            // at least one CLEAR day's notice — earliest option = the day AFTER tomorrow (never today/tomorrow)
  maxMeetingsPerDay: 4,      // his PREFERRED daily load, NOT a hard cap (Guy 2026-07-10, after the hard version — the
                             // 2026-07-06 "withhold capped days entirely" rule — emptied next week and pulled an offer a
                             // fortnight out, the Vikas mis-offer). Days at/over it stay in check_availability flagged
                             // busyDay: agents prefer lighter days, but STACK a busy near day (never double-booking)
                             // before spilling into a fallback week, and tell Guy how loaded the day is.
  preferSpreadOverWeek: true,// spread the options across the next working week, not clustered on adjacent days
  preferLeastBusyDays: true, // bias toward days with the FEWEST existing meetings (availability gives each day's meetingCount)
  spreadAcrossDay: true,     // vary the time of day across the options (a morning, a midday, an afternoon) — not all mornings
  bufferMins: 0,             // no enforced gap — back-to-back is allowed only as a fallback (see ladder)
  yourZoom: 'https://us04web.zoom.us/j/9892817976', // coach's standing meeting room (goes on the invite)
  // Invite-template identity (the "variable" bucket) — used to build the calendar invite body the way
  // Guy lays his out. Per-tenant later; Guy's values are the shipped default + the seed for the template.
  coachLinkedIn: 'https://www.linkedin.com/in/guy-wilson-safeur/',
  coachPhone: '0414 975 509',
  // Calendar reminders on the invite (Guy's: a 20-min popup + a 1-day email).
  reminders: [
    { minutes: 20, method: 'popup' },
    { minutes: 1440, method: 'email' },
  ],
  // Soft lunch hold: keep this window free when AUTO-suggesting, but it's still bookable if a lead
  // specifically wants it (the human can take it and have lunch after).
  lunch: { start: '12:00', durationMins: 45, soft: true },
};

// Guy = tenant 0. Time-of-day + load preferences stay shared code defaults for now (safe, non-
// identifying; real per-tenant values arrive with the Postgres store). But the invite-IDENTITY
// fields (Zoom room, LinkedIn, phone) are Guy's PERSONAL contact details — they must NEVER fall
// through to another tenant's invite. So for any non-Guy tenant we blank them here: the invite
// builder (wingguyCalendar) reads `coach.bookingZoom || prefs.yourZoom`, so a blank fallback means
// a 2nd tenant's invite carries THEIR own record fields or nothing — never Guy's. Guy (or an
// unidentified caller, which is Guy) keeps his exact values, so nothing of his changes.
const GUY_TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
function getBookingPrefs(clientId) {
  const prefs = { ...DEFAULT_PREFS, lunch: { ...DEFAULT_PREFS.lunch } };
  if (clientId && clientId !== GUY_TENANT) {
    prefs.yourZoom = '';
    prefs.coachLinkedIn = '';
    prefs.coachPhone = '';
  }
  return prefs;
}

// ── Each person's OWN booking hours (David Gould, 10 Nov 2026) ──────────────────────────────────
// The defaults above are Guy's. A person who keeps different hours saves them once (chat tool
// wingguy_booking_hours -> services/bookingHoursStore.js) and every surface that offers or checks a
// time reads them through getBookingPrefsFor. Shape after normalising:
//   { week: { mon: { first: '17:30', last: '17:30' } | null, ... sun },   // null = no meetings that day
//     bufferMins: 60, maxMeetingsPerDay: 3, dailyLimitHard: true }
// `first`/`last` are the earliest and latest a meeting may START. Any part may be absent; an absent
// part keeps the default. With `week` set, the week decides weekends too (excludeWeekends is off).

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

// "5:30pm" / "17:30" / "9am" / "9" -> "17:30" | "09:00" | null
function parseClock(input) {
  const t = String(input == null ? '' : input).trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, ':');
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const clockMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// One day: "off" | "17:30" (that start only) | "9:00-17:00" (first-last START) | { first, last }.
// Returns { value } (null = no meetings) or { error }.
function parseDay(input) {
  if (input === null || input === false) return { value: null };
  if (typeof input === 'object') {
    const first = parseClock(input.first);
    const last = parseClock(input.last == null ? input.first : input.last);
    if (!first || !last) return { error: 'needs a first and last start time' };
    if (clockMin(last) < clockMin(first)) return { error: `the last start (${last}) is before the first (${first})` };
    return { value: { first, last } };
  }
  const t = String(input).trim().toLowerCase();
  if (!t || /^(off|none|no|closed|no appointments|no meetings|-)$/.test(t)) return { value: null };
  const parts = t.split(/\s*(?:-|–|—|\bto\b|\buntil\b)\s*/).filter(Boolean);
  if (parts.length === 1) {
    const one = parseClock(parts[0].replace(/^(at|start|only|starts?)\s*/, '').replace(/\s*(start|only|starts?)$/, ''));
    return one ? { value: { first: one, last: one } } : { error: `couldn't read "${input}" as a time` };
  }
  if (parts.length === 2) return parseDay({ first: parts[0], last: parts[1] });
  return { error: `couldn't read "${input}" - use "off", a single start time, or "first-last" start times` };
}

/**
 * Check and tidy a saved/submitted hours object. Returns { value, errors } - value is null when
 * nothing usable is left. Used on the way IN (the chat tool) and OUT (every read), so a bad row
 * can only fall back to the defaults.
 */
function normaliseBookingHours(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { value: null, errors };
  const out = {};
  if (raw.week && typeof raw.week === 'object') {
    const week = {};
    let any = false;
    for (const k of DAY_KEYS) {
      const given = Object.prototype.hasOwnProperty.call(raw.week, k) ? raw.week[k] : undefined;
      if (given === undefined) { week[k] = null; continue; }
      const r = parseDay(given);
      if (r.error) { errors.push(`${DAY_NAMES[k]}: ${r.error}`); week[k] = null; continue; }
      week[k] = r.value;
      if (r.value) any = true;
    }
    if (any) out.week = week;
    else if (!errors.length) errors.push('every day is off - that would leave no times to offer at all');
  }
  if (raw.bufferMins != null && raw.bufferMins !== '') {
    const n = Number(raw.bufferMins);
    if (Number.isFinite(n) && n >= 0 && n <= 240) out.bufferMins = Math.round(n);
    else errors.push('the gap between meetings must be 0-240 minutes');
  }
  if (raw.maxMeetingsPerDay != null && raw.maxMeetingsPerDay !== '') {
    const n = Number(raw.maxMeetingsPerDay);
    if (Number.isInteger(n) && n >= 1 && n <= 20) out.maxMeetingsPerDay = n;
    else errors.push('meetings a day must be a whole number from 1 to 20');
  }
  if (raw.dailyLimitHard != null) out.dailyLimitHard = !!raw.dailyLimitHard;
  return { value: Object.keys(out).length ? out : null, errors };
}

/** Pure: lay saved hours over a prefs object. */
function applyBookingHours(prefs, raw) {
  const { value } = normaliseBookingHours(raw);
  if (!value) return prefs;
  const next = { ...prefs };
  if (value.week) {
    next.weekHours = value.week;
    next.excludeWeekends = false;      // the week itself says which days are open
    next.preferredStart = null;        // no Guy-style "10:00 preferred, 9:30 at a pinch" on top of it
    const opens = DAY_KEYS.map((k) => value.week[k]).filter(Boolean);
    next.earliestStart = opens.map((d) => d.first).sort()[0];
    next.lastStart = opens.map((d) => d.last).sort().slice(-1)[0];
  }
  if (value.bufferMins != null) next.bufferMins = value.bufferMins;
  if (value.maxMeetingsPerDay != null) next.maxMeetingsPerDay = value.maxMeetingsPerDay;
  if (value.dailyLimitHard != null) next.dailyLimitHard = value.dailyLimitHard;
  next.ownBookingHours = true;
  return next;
}

function fmtClock(hhmm) {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3);
  return `${(h % 12) || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`;
}

/** Plain-English summary for a person ("Monday: 5:30pm start only ..."). */
function describeBookingHours(prefs) {
  const lines = [];
  if (prefs.weekHours) {
    for (const k of DAY_KEYS) {
      const d = prefs.weekHours[k];
      lines.push(`${DAY_NAMES[k]}: ${!d ? 'no meetings' : d.first === d.last ? `${fmtClock(d.first)} start only` : `first start ${fmtClock(d.first)}, last start ${fmtClock(d.last)}`}`);
    }
  } else {
    lines.push(`Weekdays${prefs.excludeWeekends ? ' only' : ' and weekends'}: first start ${fmtClock(prefs.earliestStart)}, last start ${fmtClock(prefs.lastStart)} (the standard hours)`);
  }
  lines.push(`Gap between meetings: ${prefs.bufferMins ? `${prefs.bufferMins} minutes` : 'none'}`);
  lines.push(`Meetings a day: ${prefs.maxMeetingsPerDay}${prefs.dailyLimitHard ? ' - a hard limit, a full day is never offered' : ' - a preference, lighter days are offered first'}`);
  return lines.join('\n');
}

/** Prefs for one person, with their own saved hours laid over the defaults. Never throws. */
async function getBookingPrefsFor(clientId, deps = {}) {
  const base = getBookingPrefs(clientId);
  if (!clientId) return base;
  try {
    const read = deps.getBookingHours || require('../services/bookingHoursStore').getBookingHours;
    return applyBookingHours(base, await read(clientId));
  } catch (e) {
    console.warn(`[bookingPrefs] own hours unavailable for ${clientId}: ${e.message} - using the defaults`);
    return base;
  }
}

module.exports = {
  getBookingPrefs, getBookingPrefsFor, DEFAULT_PREFS,
  normaliseBookingHours, applyBookingHours, describeBookingHours, parseClock, parseDay, DAY_KEYS,
};
