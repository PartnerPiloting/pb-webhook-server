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
  maxMeetingsPerDay: 4,      // CODE-ENFORCED at offer time (Guy 2026-07-06, after a 6-meeting Thursday): days already at
                             // this many meetings are withheld from check_availability entirely — spread beats stacking.
                             // Guy naming a specific time (check_time → book) still works; that's his conscious call.
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

// Guy = tenant 0. Until the Postgres store lands, every client resolves to Guy's defaults. Keyed by
// clientId so going per-tenant later is just this function reading Postgres instead of the constant.
function getBookingPrefs(clientId) { // eslint-disable-line no-unused-vars
  return { ...DEFAULT_PREFS, lunch: { ...DEFAULT_PREFS.lunch } };
}

module.exports = { getBookingPrefs, DEFAULT_PREFS };
