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

const { getTimezoneFromLocation } = require('../linkedin-messaging-followup-next/lib/timezoneFromLocation.js');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
const { createCalendarEvent } = require('./calendarProvider');

const DEFAULT_TZ = 'Australia/Brisbane';
const DAYS_TO_SCAN = 30;     // how far ahead to look (the agent filters "next week" etc. itself)
const DAY_START_HOUR = 9;    // business-hours window the free/busy scan considers
const DAY_END_HOUR = 17;

// Coach calendar identity (Google Calendar Email + Timezone) from the Master Clients base —
// same lookup the /api/calendar/availability route does, kept self-contained here.
async function getCoachCalendarInfo(clientId) {
  const url =
    `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients` +
    `?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')` +
    `&fields[]=Google Calendar Email&fields[]=Timezone`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  if (!resp.ok) throw new Error(`client calendar lookup failed (${resp.status})`);
  const data = await resp.json();
  const rec = data.records && data.records[0];
  if (!rec) throw new Error(`client "${clientId}" not found in Master Clients base`);
  const calendarEmail = rec.fields['Google Calendar Email'];
  const timezone = rec.fields['Timezone'] || DEFAULT_TZ;
  if (!calendarEmail) throw new Error('Google Calendar Email not set for this client — share the calendar with the service account first.');
  return { calendarEmail, timezone };
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

// Returns { yourTimezone, leadTimezone, days: [{ date, day, freeSlots: [{ time, display, leadDisplay }] }] }
// `time` is the slot's start as an ISO string — the agent passes it straight to book_meeting (no math).
async function getAvailabilityForCoach(clientId, leadLocation = '') {
  const { calendarEmail, timezone: yourTimezone } = await getCoachCalendarInfo(clientId);
  const leadTimezone = (leadLocation && getTimezoneFromLocation(leadLocation)) || yourTimezone;

  const start = new Date(`${todayInTz(yourTimezone)}T12:00:00`);
  const dates = [];
  for (let i = 0; i < DAYS_TO_SCAN; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const calendarService = require('../config/calendarServiceAccount.js');
  const { days, error } = await calendarService.getBatchAvailability(
    calendarEmail, dates, DAY_START_HOUR, DAY_END_HOUR, yourTimezone
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
  const zoom = prefs.yourZoom || '';

  // Invite body in the coach's layout (Zoom / lead's LinkedIn / coach contacts).
  const descLines = [];
  if (note) descLines.push(String(note));
  if (zoom) descLines.push(`Zoom: ${zoom}`);
  if (leadLinkedIn) descLines.push(`${leadName || 'Guest'}: ${leadLinkedIn}`);
  const coachContacts = [prefs.coachLinkedIn, prefs.coachPhone].filter(Boolean).join(' | ');
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

module.exports = { getAvailabilityForCoach, createBookingEvent };
