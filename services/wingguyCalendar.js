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
const { createCalendarEvent, getMeetingsInWindow } = require('./calendarProvider');

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
function buildDaysFromBusy({ busyEvents, dates, yourTimezone, leadTimezone, startHour = DAY_START_HOUR, endHour = DAY_END_HOUR, slotMins = 30 }) {
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
    return {
      date,
      day: dayStart.toFormat('ccc'),
      meetingCount: busy.filter((b) => b.s < dayEndMs && b.e > dayStartMs).length,
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
    const days = buildDaysFromBusy({ busyEvents: events, dates, yourTimezone, leadTimezone });
    return { yourTimezone, leadTimezone, days };
  }

  // Google service-account read (Guy's proven path — unchanged).
  const calendarService = require('../config/calendarServiceAccount.js');
  const { days, error } = await calendarService.getBatchAvailability(
    info.calendarEmail, dates, DAY_START_HOUR, DAY_END_HOUR, yourTimezone
  );
  if (error) throw new Error(error);

  const mapped = (days || []).map((d) => ({
    date: d.date,
    day: d.day,
    // How many real meetings Guy already has that day (busy/opaque events only) — the agent prefers
    // the least-busy days, so it can spread bookings instead of stacking them.
    meetingCount: (d.events || []).filter((e) => !e.isFree).length,
    freeSlots: (d.freeSlots || []).map((s) => ({
      time: s.time,
      display: s.display || s.displayRange,
      leadDisplay: formatInTz(s.time, leadTimezone),
    })),
  }));

  return { yourTimezone, leadTimezone, days: mapped };
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

module.exports = { getAvailabilityForCoach, createBookingEvent, checkProposedTime, getClashesForISO, buildDaysFromBusy };
