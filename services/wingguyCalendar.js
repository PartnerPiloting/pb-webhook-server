// services/wingguyCalendar.js
// Wingguy Slice 2 — calendar availability for the chat AGENT (the "hands" behind the
// check_availability tool). Thin wrapper over the PROVEN building blocks the Smart Booking
// Assistant + the /api/calendar/availability route already use:
//   - calendarServiceAccount.getBatchAvailability (Google service-account free/busy)
//   - the coach's Google Calendar Email + Timezone from the Master Clients base
//   - getTimezoneFromLocation for the lead's timezone (rule-based; falls back to the coach's tz)
//
// Returns timezone-correct DISPLAY STRINGS for both sides so the agent never does timezone math
// itself — it just picks slots and writes the message using `display` (coach) / `leadDisplay` (lead).
// Hard rules (no double-book, timezone correctness) stay here in code; soft prefs live in
// config/wingguyBookingPrefs.js and are applied by the agent.

const { DateTime } = require('luxon');
const { getTimezoneFromLocation } = require('../linkedin-messaging-followup-next/lib/timezoneFromLocation.js');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
const { createCalendarEvent, deleteCalendarEvent, getMeetingsInWindow } = require('./calendarProvider');

const DEFAULT_TZ = 'Australia/Brisbane';
const DAYS_TO_SCAN = 21;     // ~3 weeks ahead — enough for the working-week spread + fallback (smaller = faster fetch)
const DAY_START_HOUR = 9;    // business-hours window the free/busy scan considers
const DAY_END_HOUR = 17;

// Coach calendar identity from the Master Clients base. Returns BOTH the Google service-account
// share (calendarEmail) AND the per-tenant Nylas grant, so callers can pick the right read path:
//   - a client who shared their calendar with our service account (Guy) → Google read (proven, untouched)
//   - a Nylas-only client (onboarded via hosted auth — no service-account share) → Nylas read
// Does NOT throw on a missing Google email anymore — a Nylas-only client is valid. Throws only if
// NEITHER path is possible (no email and no grant).
async function getCoachCalendarInfo(clientId) {
  const url =
    `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients` +
    `?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')` +
    `&fields[]=Google Calendar Email&fields[]=Timezone&fields[]=Nylas Grant ID&fields[]=Calendar Provider`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  if (!resp.ok) throw new Error(`client calendar lookup failed (${resp.status})`);
  const data = await resp.json();
  const rec = data.records && data.records[0];
  if (!rec) throw new Error(`client "${clientId}" not found in Master Clients base`);
  const calendarEmail = rec.fields['Google Calendar Email'] || null;
  const timezone = rec.fields['Timezone'] || DEFAULT_TZ;
  const nylasGrantId = rec.fields['Nylas Grant ID'] || null;
  const calendarProvider = rec.fields['Calendar Provider'] || null;
  if (!calendarEmail && !nylasGrantId) {
    throw new Error('No calendar for this client — share a calendar with the service account (Google) or connect via Nylas first.');
  }
  return { calendarEmail, timezone, nylasGrantId, calendarProvider };
}

// Which read path a coach uses. ADDITIVE + Guy-safe: if the client shared a Google calendar with our
// service account, keep reading via Google (Guy's proven path) — even if the global provider flag is
// nylas. Only a Nylas-grant-ONLY client (no service-account share) reads via Nylas. So onboarding a new
// tenant via hosted auth gives them a working read+write without ever touching Guy's setup.
function readsViaNylas(info) {
  return !info.calendarEmail && !!info.nylasGrantId;
}

// Minimal coach-shaped object for calendarProvider.getMeetingsInWindow (per-tenant Nylas read).
function coachForNylas(info) {
  return { calendarProvider: 'nylas', nylasGrantId: info.nylasGrantId, googleCalendarEmail: info.calendarEmail || '' };
}

function formatInTz(isoTime, timezone) {
  return new Date(isoTime).toLocaleString('en-AU', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
  });
}

// today's date (YYYY-MM-DD) in a given timezone, so "today"/"tomorrow" are correct for the coach
function todayInTz(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

// Time-only display in a timezone, matching the Google path's slot.display style ("9:30 am").
function timeOnlyInTz(isoTime, timezone) {
  return new Date(isoTime).toLocaleTimeString('en-AU', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
  }).toLowerCase();
}

// Pure, testable: turn a coach's BUSY meetings into free 30-min slots across N days, in the SAME shape
// getBatchAvailability returns (so the Nylas read drops into getAvailabilityForCoach unchanged). Day
// boundaries + the business-hours window are computed in the COACH's timezone via luxon (DST-correct).
//   busyEvents: [{ start, end }] ISO instants (the coach's real meetings)
//   dates:      [YYYY-MM-DD] in the coach's timezone
// Returns [{ date, day, meetingCount, freeSlots: [{ time, display, leadDisplay }] }].
function buildDaysFromBusy({ busyEvents, dates, yourTimezone, leadTimezone, startHour = DAY_START_HOUR, endHour = DAY_END_HOUR, slotMins = 30, lunch = null }) {
  const busy = (busyEvents || [])
    .map((e) => ({ s: new Date(e.start).getTime(), e: new Date(e.end).getTime() }))
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s);
  const overlaps = (s, e) => busy.some((b) => b.s < e && b.e > s);
  const slotMs = slotMins * 60000;

  return dates.map((date) => {
    const dayStart = DateTime.fromISO(`${date}T00:00`, { zone: yourTimezone }).set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
    const dayEnd = dayStart.set({ hour: endHour, minute: 0 });
    const dayStartMs = dayStart.toMillis();
    const dayEndMs = dayEnd.toMillis();
    const freeSlots = [];
    for (let t = dayStartMs; t + slotMs <= dayEndMs; t += slotMs) {
      if (overlaps(t, t + slotMs)) continue;
      const iso = new Date(t).toISOString();
      freeSlots.push({ time: iso, display: timeOnlyInTz(iso, yourTimezone), leadDisplay: formatInTz(iso, leadTimezone) });
    }
    // meetingCount = REAL meetings (window-scoped already; also exclude the coach's own lunch block
    // so the daily cap means client calls — same rule as countRealMeetings on the Google path).
    const lunchStartMin = lunch ? hhmmToMin(lunch.start) : null;
    const lunchEndMin = lunchStartMin != null ? lunchStartMin + (lunch.durationMins || 0) : null;
    return {
      date,
      day: dayStart.toFormat('ccc'),
      meetingCount: busy.filter((b) => {
        if (!(b.s < dayEndMs && b.e > dayStartMs)) return false;
        if (lunchStartMin == null) return true;
        const sMin = minutesInTz(new Date(b.s).toISOString(), yourTimezone);
        return sMin == null || sMin < lunchStartMin || sMin >= lunchEndMin;
      }).length,
      freeSlots,
    };
  });
}

// Returns { yourTimezone, leadTimezone, days: [{ date, day, freeSlots: [{ time, display, leadDisplay }] }] }
// `time` is the slot's start as an ISO string — the agent passes it straight to book_meeting (no math).
async function getAvailabilityForCoach(clientId, leadLocation = '') {
  const info = await getCoachCalendarInfo(clientId);
  const yourTimezone = info.timezone;
  const leadTimezone = (leadLocation && getTimezoneFromLocation(leadLocation)) || yourTimezone;

  const dateStr = todayInTz(yourTimezone);
  const dates = [];
  for (let i = 0; i < DAYS_TO_SCAN; i++) {
    dates.push(DateTime.fromISO(`${dateStr}T12:00`, { zone: yourTimezone }).plus({ days: i }).toFormat('yyyy-MM-dd'));
  }

  // Nylas-only client (no service-account share) → read busy events via their grant and build slots.
  if (readsViaNylas(info)) {
    const windowStart = DateTime.fromISO(`${dates[0]}T00:00`, { zone: yourTimezone }).toJSDate();
    const windowEnd = DateTime.fromISO(`${dates[dates.length - 1]}T23:59`, { zone: yourTimezone }).toJSDate();
    const { events, error } = await getMeetingsInWindow(coachForNylas(info), windowStart, windowEnd);
    if (error) throw new Error(`nylas availability read failed: ${error}`);
    const nylasPrefs = getBookingPrefs(clientId);
    const days = buildDaysFromBusy({ busyEvents: events, dates, yourTimezone, leadTimezone, lunch: nylasPrefs.lunch });
    return { yourTimezone, leadTimezone, days };
  }

  // Google service-account read (Guy's proven path — unchanged).
  const calendarService = require('../config/calendarServiceAccount.js');
  const { days, error } = await calendarService.getBatchAvailability(
    info.calendarEmail, dates, DAY_START_HOUR, DAY_END_HOUR, yourTimezone
  );
  if (error) throw new Error(error);

  const prefs = getBookingPrefs(clientId);
  const mapped = (days || []).map((d) => ({
    date: d.date,
    day: d.day,
    // How many REAL meetings Guy already has that day — drives the "least busy" bias AND the hard
    // daily cap, so it must mean client calls, not calendar blocks (see countRealMeetings).
    meetingCount: countRealMeetings(d.events, yourTimezone, prefs),
    freeSlots: (d.freeSlots || []).map((s) => ({
      time: s.time,
      display: s.display || s.displayRange,
      leadDisplay: formatInTz(s.time, leadTimezone),
    })),
  }));

  return { yourTimezone, leadTimezone, days: mapped };
}

// A "meeting" for the daily count = a BUSY event overlapping the booking-hours window (9–17) that
// isn't the coach's own lunch block (an event STARTING inside his lunch hold). Counting everything
// made maxMeetingsPerDay:4 mean "2 client calls" — the personal Lunch (in-window) and Dinner
// (out-of-window, but returned for the day) blocks ate the cap, and the live one-booking-door check
// (2026-07-06) showed only 3 offerable days in a 3-week window.
function countRealMeetings(events, tz, prefs) {
  const winStart = DAY_START_HOUR * 60;
  const winEnd = DAY_END_HOUR * 60;
  const lunchStart = hhmmToMin(prefs && prefs.lunch && prefs.lunch.start);
  const lunchEnd = lunchStart != null ? lunchStart + ((prefs.lunch && prefs.lunch.durationMins) || 0) : null;
  return (events || []).filter((e) => {
    if (e.isFree || !e.start || !e.end) return false;
    const sMin = minutesInTz(e.start, tz);
    const endMin = minutesInTz(e.end, tz);
    if (sMin == null || endMin == null) return false;
    if (!(sMin < winEnd && endMin > winStart)) return false;                      // outside booking hours (e.g. Dinner)
    if (lunchStart != null && sMin >= lunchStart && sMin < lunchEnd) return false; // his own lunch block
    return true;
  }).length;
}

// ── "Warn, don't block" booking (2026-06-30) ────────────────────────────────────────────────────
// Guy can propose ANY time (on/off the availability grid). Timezone correctness stays a HARD rule in
// code (luxon does the wall-clock→instant conversion so the model never does tz math); clash with an
// existing meeting is SURFACED, never silently blocked — a conscious double-book is allowed upstream.

// Build a DST-correct UTC ISO from a wall-clock date+time interpreted in a given IANA timezone.
// Accepts 24h ("14:00") or 12h ("2:00pm" / "2 pm") time. Returns null if it can't be parsed.
function wallClockToISO(date, time, timezone) {
  const t = String(time || '').trim().replace(/\s+/g, '').toLowerCase();
  const stamp = `${String(date || '').trim()} ${t}`;
  for (const fmt of ['yyyy-MM-dd H:mm', 'yyyy-MM-dd h:mma', 'yyyy-MM-dd ha', 'yyyy-MM-dd h:mm']) {
    const dt = DateTime.fromFormat(stamp, fmt, { zone: timezone });
    if (dt.isValid) return dt.toUTC().toISO();
  }
  return null;
}

// Busy meetings on the candidate's day that overlap [start, end). Returns [{ summary, display }] —
// empty means the window is free. `display` is in the coach's timezone. Provider-aware: a Nylas-only
// client reads via their grant, Guy via the Google service account (proven path).
async function clashesForWindow(info, startISO, len) {
  const yourTimezone = info.timezone;
  const start = new Date(startISO);
  const end = new Date(start.getTime() + len * 60000);
  const dateInCoachTz = DateTime.fromJSDate(start).setZone(yourTimezone).toFormat('yyyy-MM-dd');

  let events;
  if (readsViaNylas(info)) {
    const dayStart = DateTime.fromISO(`${dateInCoachTz}T00:00`, { zone: yourTimezone }).toJSDate();
    const dayEnd = DateTime.fromISO(`${dateInCoachTz}T23:59`, { zone: yourTimezone }).toJSDate();
    const r = await getMeetingsInWindow(coachForNylas(info), dayStart, dayEnd);
    if (r.error) throw new Error(`nylas clash read failed: ${r.error}`);
    // Nylas events returned are real (busy) meetings — no transparency flag, treat all as busy.
    events = (r.events || []).map((e) => ({ ...e, isFree: false }));
  } else {
    const calendarService = require('../config/calendarServiceAccount.js');
    const { days, error } = await calendarService.getBatchAvailability(
      info.calendarEmail, [dateInCoachTz], DAY_START_HOUR, DAY_END_HOUR, yourTimezone
    );
    if (error) throw new Error(error);
    events = (days && days[0] && days[0].events) || [];
  }

  return events
    .filter((e) => !e.isFree && e.start && e.end)
    .filter((e) => {
      const es = new Date(e.start).getTime();
      const ee = new Date(e.end).getTime();
      return Number.isFinite(es) && Number.isFinite(ee) && es < end.getTime() && ee > start.getTime();
    })
    .map((e) => ({ summary: e.summary || '(busy)', display: formatInTz(e.start, yourTimezone) }));
}

// Verify a SPECIFIC proposed time (Guy's words → date/time/side). Code owns the timezone conversion
// and the clash read; returns both-side display strings + any clashes so the agent can WARN before
// booking. Returns { ok, startISO, durationMins, display, leadDisplay, yourTimezone, leadTimezone, clashes }.
async function checkProposedTime(clientId, { date, time, side = 'coach', leadLocation = '', durationMins }) {
  const info = await getCoachCalendarInfo(clientId);
  const yourTimezone = info.timezone;
  const leadTimezone = (leadLocation && getTimezoneFromLocation(leadLocation)) || yourTimezone;
  const tz = side === 'lead' ? leadTimezone : yourTimezone;
  const startISO = wallClockToISO(date, time, tz);
  if (!startISO) return { ok: false, error: `Couldn't read "${date} ${time}" as a time — give a date (YYYY-MM-DD) and a clock time (e.g. 14:00 or 2:00pm).` };
  const prefs = getBookingPrefs(clientId);
  const len = Number(durationMins) > 0 ? Number(durationMins) : (prefs.meetingLengthMins || 30);
  const clashes = await clashesForWindow(info, startISO, len);
  return {
    ok: true,
    startISO,
    durationMins: len,
    yourTimezone,
    leadTimezone,
    display: formatInTz(startISO, yourTimezone),
    leadDisplay: formatInTz(startISO, leadTimezone),
    clashes,
  };
}

// Clash check for an already-resolved ISO instant (used by book_meeting's no-accidental-double-book
// guard). Returns [{ summary, display }].
async function getClashesForISO(clientId, startISO, durationMins) {
  const info = await getCoachCalendarInfo(clientId);
  const prefs = getBookingPrefs(clientId);
  const len = Number(durationMins) > 0 ? Number(durationMins) : (prefs.meetingLengthMins || 30);
  if (isNaN(new Date(startISO).getTime())) return [];
  return clashesForWindow(info, startISO, len);
}

// Build the invite the way the coach lays it out and create it via the proven seam (Nylas write).
// Shared by POST /book (the legacy form path) and the chat agent's book_meeting tool so there's ONE
// booking implementation. Returns { ok, eventId, title, start, durationMins } or { ok:false, error }.
async function createBookingEvent(coach, { startISO, durationMins, leadEmail, leadName, leadLinkedIn, title, note }) {
  if (!startISO) return { ok: false, error: 'startISO required' };
  if (!leadEmail) return { ok: false, error: 'leadEmail required (the invite needs a guest address)' };
  const start = new Date(startISO);
  if (isNaN(start.getTime())) return { ok: false, error: 'invalid startISO' };

  const prefs = getBookingPrefs(coach.clientId);
  const len = Number(durationMins) > 0 ? Number(durationMins) : (prefs.meetingLengthMins || 30);
  const end = new Date(start.getTime() + len * 60000);
  const coachName = coach.clientName || 'Guy Wilson';
  const finalTitle = (title && String(title).trim()) || `${leadName || 'Lead'} & ${coachName}`;
  // Per-client invite identity wins; the shared default (Guy's) is the fallback so Guy is unchanged
  // and a new tenant only needs these fields filled to make invites carry THEIR Zoom/contacts.
  const zoom = coach.bookingZoom || prefs.yourZoom || '';
  const coachLinkedIn = coach.coachLinkedInUrl || prefs.coachLinkedIn;
  const coachPhoneNo = coach.coachPhone || prefs.coachPhone;

  // Invite body in the coach's layout (Zoom / lead's LinkedIn / coach contacts).
  const descLines = [];
  if (note) descLines.push(String(note));
  if (zoom) descLines.push(`Zoom: ${zoom}`);
  if (leadLinkedIn) descLines.push(`${leadName || 'Guest'}: ${leadLinkedIn}`);
  const coachContacts = [coachLinkedIn, coachPhoneNo].filter(Boolean).join(' | ');
  if (coachContacts) descLines.push(`${coachName}: ${coachContacts}`);

  const reminders = Array.isArray(prefs.reminders) && prefs.reminders.length
    ? { use_default: false, overrides: prefs.reminders.map((r) => ({ reminder_minutes: r.minutes, reminder_method: r.method })) }
    : undefined;

  const result = await createCalendarEvent(coach, {
    title: finalTitle,
    description: descLines.join('\n'),
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    attendees: [{ email: leadEmail, name: leadName || '' }],
    location: zoom || undefined,
    reminders,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, eventId: result.eventId, title: finalTitle, start: start.toISOString(), durationMins: len };
}

// ── Shared offer-time pipeline + booking guard (2026-07-06, the "one booking door") ─────────────
// ONE implementation of Guy's rules-in-code, used by BOTH the extension panel agent
// (services/wingguyChat.js) and the claude.ai connector tools (services/wingguyBookingMcp.js) —
// so every surface that offers or books times goes through the same guarantees: booking-hours
// bounds, lunch hold, no past/too-soon slots, the daily meeting cap, and the clash/hold guard.

// Minutes-since-midnight from "9:30" / "09:30" (prefs) or a display string like "9:00 am".
function hhmmToMin(s) { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function minFromDisplay(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = (+m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
  return h * 60 + (+m[2]);
}
// HARD bounds: never surface slots before earliestStart or after lastStart (the agent doesn't reliably
// hold the soft floor on its own — enforce it on the data so a sub-9:30 / post-16:30 slot can't be offered).
function withinBounds(slot, eMin, lMin) {
  const m = minFromDisplay(slot.display);
  return m == null ? true : (m >= eMin && m <= lMin);
}
// Minutes-since-midnight of an ISO instant IN a given timezone (for coach-hours/lunch checks).
function minutesInTz(iso, tz) {
  const s = new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  return hhmmToMin(s);
}
// True if a slot START overlaps the coach's SOFT lunch hold, checked in the COACH's timezone.
// Centralised so check_availability (don't even offer the slot) and propose_times (backstop) agree —
// the bug was that only the backstop applied it, so a coach-noon slot could be surfaced and offered.
function inLunch(iso, tz, prefs, len) {
  if (!(prefs && prefs.lunch && prefs.lunch.soft)) return false;
  const lunchStart = hhmmToMin(prefs.lunch.start);
  if (lunchStart == null) return false;
  const lunchEnd = lunchStart + ((prefs.lunch && prefs.lunch.durationMins) || 0);
  const cMin = minutesInTz(iso, tz);
  if (cMin == null) return false;
  return cMin < lunchEnd && (cMin + (len || 0)) > lunchStart;
}
// Earliest date (yyyy-MM-dd, coach tz) a slot may fall on. Guy's "one CLEAR day's notice" rule was a
// soft instruction the model could (and did, 2026-07-06: Sarah was offered a time that had ALREADY
// PASSED that morning) ignore — now code enforces it. includeSoon (Guy explicitly asks for
// today/tomorrow) lifts the notice rule; nothing ever lifts the not-in-the-past rule.
function earliestOfferDate(tz, prefs, includeSoon) {
  const offsetDays = includeSoon ? 0 : ((Number.isFinite(prefs.minLeadDays) ? prefs.minLeadDays : 1) + 1);
  return DateTime.now().setZone(tz).plus({ days: offsetDays }).toFormat('yyyy-MM-dd');
}
function dateStrInTz(iso, tz) {
  return DateTime.fromMillis(Date.parse(iso)).setZone(tz).toFormat('yyyy-MM-dd');
}
function isWeekendInTz(iso, tz) {
  const wd = DateTime.fromMillis(Date.parse(iso)).setZone(tz).weekday;
  return wd === 6 || wd === 7;
}
// First date (yyyy-MM-dd) BEYOND the "near window" = this calendar week + next calendar week
// (weeks start Monday, coach tz). Guy's nearness rule (2026-07-06): book this week or next; later
// weeks only when the near window can't fill the options, or he explicitly asks (e.g. "book her for
// when I'm back from holidays").
function firstFarWeekDate(tz) {
  return DateTime.now().setZone(tz).startOf('week').plus({ weeks: 2 }).toFormat('yyyy-MM-dd');
}
// TODAY + week boundaries in the coach's timezone — the model's date anchor. Relative phrases
// ("next week") were being resolved by a model that was never told what today IS (the Vikas
// 2026-07-10 mis-offer: fallback-week days presented to the lead as "next week"), so code states
// it on every surface: the chat context, the check_availability result, and the MCP text.
function offerWindowInfo(tz) {
  const now = DateTime.now().setZone(tz);
  const thisMon = now.startOf('week');
  const span = (mon) => `Mon ${mon.toFormat('d LLL')} to Sun ${mon.plus({ days: 6 }).toFormat('d LLL')}`;
  return {
    today: now.toFormat('cccc d LLLL yyyy'),
    timezone: tz,
    thisWeek: span(thisMon),
    nextWeek: span(thisMon.plus({ weeks: 1 })),
    farWeeksStart: firstFarWeekDate(tz),
  };
}
// Format a slot for the LinkedIn message in the lead's timezone, Guy's style: "Wed 1 July, 1:30 pm".
function fmtSlot(iso, tz) {
  const d = new Date(iso);
  const wd = d.toLocaleString('en-AU', { weekday: 'short', timeZone: tz });
  const day = d.toLocaleString('en-AU', { day: 'numeric', timeZone: tz });
  const mo = d.toLocaleString('en-AU', { month: 'long', timeZone: tz });
  const tm = d.toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).toLowerCase();
  return `${wd} ${day} ${mo}, ${tm}`;
}

const AVAIL_MAX_DAYS = 14;         // bound the availability result (tokens) — ~2 working weeks
const AVAIL_MAX_SLOTS_PER_DAY = 8;

/**
 * The one offer-time pipeline: raw availability → what an agent is ALLOWED to offer. Drops days
 * before the one-clear-day notice date (unless includeSoon), slots already past, slots outside
 * booking hours, and lunch-hold slots (unless includeLunch); flags days at/over the coach's
 * preferred daily load (busyDay) and days beyond next week (fallbackWeek); labels every surviving
 * slot with EXACTLY how it will read in the lead's timezone. Also returns `window` (today +
 * this-week/next-week boundaries in the coach's tz) so agents resolve "next week" from data.
 */
function filterAvailability(avail, prefs, { includeLunch = false, includeSoon = false, includeWeekends = false, includeFarWeeks = false } = {}) {
  const eMin = hhmmToMin(prefs.earliestStart) ?? 0;
  const lMin = hhmmToMin(prefs.lastStart) ?? 24 * 60;
  const aTz = avail.yourTimezone || 'Australia/Brisbane';
  const leadTz = avail.leadTimezone || aTz;
  const aLen = prefs.meetingLengthMins || 30;
  const nowMs = Date.now();
  const earliestDate = earliestOfferDate(aTz, prefs, includeSoon);
  const maxPerDay = Number.isFinite(prefs.maxMeetingsPerDay) ? prefs.maxMeetingsPerDay : Infinity;
  const isWeekend = (dateStr) => { const wd = DateTime.fromISO(dateStr, { zone: aTz }).weekday; return wd === 6 || wd === 7; };
  const window = offerWindowInfo(aTz);
  const days = (avail.days || [])
    .filter((d) => String(d.date || '') >= earliestDate)
    // Weekdays only was a model-side rule until the live one-booking-door check (2026-07-06) showed
    // Sat/Sun slots offered to a chat that trusts "rules already applied" — now code, like the rest.
    .filter((d) => includeWeekends || !prefs.excludeWeekends || !isWeekend(d.date))
    .map((d) => ({ ...d, freeSlots: (d.freeSlots || []).filter((s) => Date.parse(s.time) > nowMs && withinBounds(s, eMin, lMin) && (includeLunch || !inLunch(s.time, aTz, prefs, aLen))) }))
    .filter((d) => d.freeSlots.length)
    .slice(0, AVAIL_MAX_DAYS)
    // DAILY LOAD IS A PREFERENCE, NOT A CAP (Guy 2026-07-10, after the hard version emptied next
    // week and pulled an offer a fortnight out — the Vikas mis-offer). Days at/over
    // maxMeetingsPerDay stay offerable, flagged busyDay so agents prefer lighter days, stack these
    // BEFORE reaching into fallback weeks, and tell the coach how loaded the day already is.
    // (The 2026-07-06 "6-meeting Thursday" hard-hide is superseded by this ladder.)
    .map((d) => ({ ...d, ...((d.meetingCount || 0) >= maxPerDay ? { busyDay: true } : {}), freeSlots: d.freeSlots.slice(0, AVAIL_MAX_SLOTS_PER_DAY).map((s) => ({ ...s, label: fmtSlot(s.time, leadTz) })) }));

  // NEARNESS RULE (Guy 2026-07-06, after a booking landed the week after next while nearer time
  // existed): the target window is THIS calendar week + NEXT. When the near window alone can fill
  // the options — counting slots on busy days too, since stacking a near day beats a far week —
  // later weeks don't appear at all; when it can't, later days are included but flagged
  // fallbackWeek so agents use them only to TOP UP. includeFarWeeks (the coach explicitly asks —
  // e.g. booking for after his holidays) lifts the rule. Note this deliberately outranks the
  // "least-busy days" bias, which otherwise pushes bookings toward the emptier far weeks.
  if (!includeFarWeeks) {
    const farStart = window.farWeeksStart;
    const near = days.filter((d) => d.date < farStart);
    const slotsWanted = prefs.slotsToOffer || 3;
    const nearSlotCount = near.reduce((n, d) => n + d.freeSlots.length, 0);
    if (nearSlotCount >= slotsWanted) {
      return { yourTimezone: avail.yourTimezone, leadTimezone: avail.leadTimezone, window, days: near };
    }
    return {
      yourTimezone: avail.yourTimezone,
      leadTimezone: avail.leadTimezone,
      window,
      days: days.map((d) => (d.date >= farStart ? { ...d, fallbackWeek: true } : d)),
    };
  }
  return { yourTimezone: avail.yourTimezone, leadTimezone: avail.leadTimezone, window, days };
}

/**
 * The one booking guard: refuse a clashing time unless explicitly confirmed (conscious double-
 * booking allowed), treat the lead's OWN "HOLD:" events as their reservation (not a clash), and
 * clear all the lead's holds once the booking lands. `deps` = test/caller injection.
 */
async function bookMeetingGuarded(coach, { startISO, durationMins, leadEmail, leadName, leadLinkedIn, confirmDoubleBook }, deps = {}) {
  const clashesFor = deps.getClashesForISO || getClashesForISO;
  const book = deps.createBookingEvent || createBookingEvent;
  const clearHolds = deps.deleteOfferHolds || deleteOfferHolds;
  if (!leadEmail) return { ok: false, error: 'No lead email on file — add the lead\'s email before booking.' };
  if (!confirmDoubleBook) {
    const clashes = (await clashesFor(coach.clientId, startISO, durationMins))
      .filter((c) => !isHoldForLead(c.summary, leadName));
    if (clashes.length) {
      return {
        ok: false,
        clash: true,
        clashes,
        error: `That time clashes with: ${clashes.map((c) => `${c.summary} (${c.display})`).join('; ')}. Tell the human and, if they still want it, call again with confirmDoubleBook:true.`,
      };
    }
  }
  const result = await book(coach, { startISO, durationMins, leadEmail, leadName, leadLinkedIn });
  if (result.ok && leadName) {
    // Offer resolved — clear the lead's manual holds. Fire-and-forget: cleanup must never fail a booking.
    Promise.resolve(clearHolds(coach, { leadName })).catch((e) => console.warn(`[wingguyCalendar] hold cleanup failed: ${e.message}`));
  }
  return result;
}

// ── Offer HOLDS (2026-07-06) ────────────────────────────────────────────────────────────────────
// An offered slot is a PROMISE nothing else records, so another booking (any door: panel, claude.ai
// chat, Calendly) can take it before the lead replies (the Rebecca/Mary Anne double-book). The
// AUTOMATIC hold experiment (propose_times creating holds) shipped and was PULLED the same afternoon
// (2026-07-06) — 8 HOLD blocks incl. duplicates piled up in half an hour; Guy's ruling: he creates
// "HOLD: <lead name>" events HIMSELF when a promise is worth protecting. Code still honours the
// convention: book_meeting ignores the lead's OWN holds (their pick must not clash with its own
// reservation) and clears ALL the lead's holds once their meeting books; holds carrying another
// lead's name are real clashes. Unused holds expire as their times pass.

const HOLD_PREFIX = 'HOLD:';

function holdTitle(leadName) {
  return `${HOLD_PREFIX} ${leadName || 'Lead'} (Wingguy offer - do not book over)`;
}

function isHoldSummary(summary) {
  return String(summary || '').trim().toUpperCase().startsWith(HOLD_PREFIX);
}

// A hold belonging to THIS lead (title carries the lead's name).
function isHoldForLead(summary, leadName) {
  const name = String(leadName || '').trim().toLowerCase();
  return !!name && isHoldSummary(summary) && String(summary).toLowerCase().includes(name);
}

// Holds are always read/written via the coach's Nylas grant (the write path; gives event ids for
// delete). The Google service-account read is read-only and id-less, so it can't manage holds.
function coachForHolds(coach) {
  return { ...coach, calendarProvider: 'nylas' };
}

/** Find this lead's HOLD events over the offer horizon. Throws on a read failure. */
async function findOfferHolds(coach, { leadName, windowDays = DAYS_TO_SCAN + 14 }) {
  const now = new Date();
  const end = new Date(now.getTime() + windowDays * 86400000);
  const { events, error } = await getMeetingsInWindow(coachForHolds(coach), now, end);
  if (error) throw new Error(`hold read failed: ${error}`);
  return (events || []).filter((e) => e.id && isHoldForLead(e.summary, leadName));
}

/** Delete all of this lead's HOLD events (offer resolved, superseded, or lapsed). Never throws. */
async function deleteOfferHolds(coach, { leadName }) {
  if (!leadName) return { removed: 0 };
  let holds = [];
  try {
    holds = await findOfferHolds(coach, { leadName });
  } catch (e) {
    console.warn(`[wingguyCalendar] deleteOfferHolds read failed for "${leadName}": ${e.message}`);
    return { removed: 0, error: e.message };
  }
  let removed = 0;
  for (const h of holds) {
    const r = await deleteCalendarEvent(coachForHolds(coach), h.id);
    if (r.ok) removed++;
    else console.warn(`[wingguyCalendar] hold delete failed (${h.id}): ${r.error}`);
  }
  return { removed };
}

// (createOfferHolds — the automatic hold writer — was REMOVED here 2026-07-06, same day it shipped.
// If auto-holds ever return, the git history of this file has the accumulate-and-dedupe version.)

module.exports = {
  getAvailabilityForCoach, createBookingEvent, checkProposedTime, getClashesForISO, buildDaysFromBusy,
  deleteOfferHolds, isHoldForLead, isHoldSummary, holdTitle,
  // shared offer-time pipeline + booking guard (used by the panel agent AND the connector tools)
  filterAvailability, bookMeetingGuarded, fmtSlot, inLunch, hhmmToMin, minutesInTz, earliestOfferDate, dateStrInTz, isWeekendInTz, firstFarWeekDate, offerWindowInfo,
};
