/**
 * Booking hours - ONE save, two doors (10 Nov 2026).
 *
 * The setup page's "Your booking hours" editor and the chat tool wingguy_booking_hours both save
 * through saveBookingHours, so whichever a client uses, the other shows the change. Saved hours live
 * in services/bookingHoursStore.js; every offer reads them via getBookingPrefsFor.
 *
 * WRITE-THROUGH: the booking instructions' wording still quotes {{earliest_meeting_time}},
 * {{preferred_start_time}} and {{max_meetings_per_day}} ("offer from 9:00am or later"). Those
 * boxes have left the setup page, so a save here writes them too - the words a draft is told and
 * the times the code offers can never disagree.
 */

const {
  normaliseBookingHours, getBookingPrefsFor, effectiveBookingHours, describeBookingHours, fmtClock, DAY_KEYS,
} = require('../config/wingguyBookingPrefs');

function earliestOpenStart(week) {
  const firsts = DAY_KEYS.map((k) => week && week[k]).filter(Boolean).map((d) => d.first).sort();
  return firsts[0] || null;
}

/**
 * Save (merging over what is saved) and write through. `raw` uses the saved shape:
 * { week: { mon: '17:30' | '9:00-17:00' | {first,last} | null ... }, bufferMins, maxMeetingsPerDay, dailyLimitHard }.
 * A `week` passed REPLACES the saved week (the page always sends all seven days); the chat tool
 * merges its own day changes before calling. Returns { ok, errors?, prefs }.
 */
async function saveBookingHours({ tenantId, raw, actor }, deps = {}) {
  const store = deps.store || require('./bookingHoursStore');
  const rules = deps.rulesStore || require('./wingguyRulesStore');
  const current = (await store.getBookingHours(tenantId)) || {};
  const next = { ...current, ...raw };
  const { value, errors } = normaliseBookingHours(next);
  if (errors.length) return { ok: false, errors };
  if (!value) return { ok: false, errors: ['nothing to save - no hours were given'] };
  await store.setBookingHours(tenantId, value);

  const writes = [];
  const first = value.week ? earliestOpenStart(value.week) : null;
  if (first) {
    writes.push(['earliest_meeting_time', fmtClock(first)]);
    writes.push(['preferred_start_time', fmtClock(first)]);
  }
  if (value.maxMeetingsPerDay) writes.push(['max_meetings_per_day', String(value.maxMeetingsPerDay)]);
  const writeFailures = [];
  for (const [varKey, v] of writes) {
    try {
      await rules.setVariable({ tenantId, varKey, value: v, actor: actor || `booking-hours:${tenantId}` });
    } catch (e) {
      // The hours themselves are saved and are what the code offers from; a failed wording sync
      // is logged, not fatal.
      writeFailures.push(`${varKey}: ${e.message}`);
    }
  }
  if (writeFailures.length) console.warn(`[bookingHours] saved for ${tenantId}, wording sync failed - ${writeFailures.join('; ')}`);

  const prefs = await getBookingPrefsFor(tenantId, { getBookingHours: async () => value, ...(deps.getVariables ? { getVariables: deps.getVariables } : {}) });
  return { ok: true, prefs };
}

async function clearBookingHours(tenantId, deps = {}) {
  const store = deps.store || require('./bookingHoursStore');
  return store.clearBookingHours(tenantId);
}

/** What the setup page shows: the hours in force now, where they came from, and the plain summary. */
async function bookingHoursView(tenantId, deps = {}) {
  const prefs = await getBookingPrefsFor(tenantId, deps);
  return { ...effectiveBookingHours(prefs), summary: describeBookingHours(prefs) };
}

module.exports = { saveBookingHours, clearBookingHours, bookingHoursView, earliestOpenStart };
