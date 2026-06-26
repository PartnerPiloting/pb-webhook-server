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
  preferredStart: '10:00',   // start offering from here normally
  earliestStart: '09:30',    // soft floor — only used if needed to fill the requested number of slots
  lastStart: '16:30',        // last meeting may START by this time
  slotsToOffer: 3,           // how many options to put in the "here are some times" message
  meetingLengthMins: 30,     // default meeting length
  bufferMins: 0,             // breathing room between meetings — none (back-to-back is fine)
  excludeWeekends: true,     // never offer Sat/Sun unless explicitly overridden
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
