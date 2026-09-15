/**
 * Lead booking-link reader (2026-09-15, Candace Ngok: "here's a link to my calendar").
 *
 * WHAT IT DOES: when a lead hands over a Calendly link, read the free slots that link would show a
 * visitor, in the coach's clock, so check_availability can return ONLY the times both sides are
 * free. The public booking page pulls its slots from two plain unauthenticated calls (proven with
 * curl from Guy's laptop the day this shipped - no login, no bot wall):
 *
 *   GET /api/booking/event_types/lookup?event_type_slug=<event>&profile_slug=<profile>
 *       -> { uuid, duration, scheduling_link: { uid }, availability_timezone, name, profile.name }
 *   GET /api/booking/event_types/<uuid>/calendar/range?timezone=<tz>&range_start=..&range_end=..
 *       &scheduling_link_uuid=<uid>   (ranges over ~5 weeks are refused -> paged in 28-day chunks)
 *       -> { days: [{ date, status, spots: [{ status:'available', start_time }] }] }
 *
 * These calls are UNDOCUMENTED. When Calendly changes them the reader returns { ok:false, reason }
 * and the caller falls back to the coach-only slots with a plain "could not read the link" line -
 * exactly what happened before this existed. Never throw out of here.
 *
 * WHAT IT DOES NOT DO: book through the lead's page. The booking door stays wingguy_book_meeting
 * (coach's own invite, Zoom room, lead record) - the lead's link only tells us WHEN.
 *
 * Supported today: calendly.com/<profile>/<event>[?...]. Other providers (cal.com, HubSpot, Google
 * appointment pages) parse as { provider:null } and the caller says so.
 */

const CALENDLY_MAX_RANGE_DAYS = 28;   // the API refuses ~7 weeks; 35 worked, 49 did not
const FETCH_TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** Pull a booking link out of free text (a LinkedIn message, an email). First match wins. */
function findBookingLink(text) {
  const m = String(text || '').match(/https?:\/\/(?:www\.)?calendly\.com\/[^\s<>"')\]]+/i);
  return m ? m[0].replace(/[.,;:!?]+$/, '') : null;
}

/** Parse a booking link into its provider parts. */
function parseBookingLink(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (_) { return { provider: null, url, reason: 'not a URL' }; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'calendly.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    // /d/<uid>/<slug> is a share link - it does not carry the profile slug the lookup needs.
    if (parts[0] === 'd') return { provider: 'calendly', url, reason: 'share link (calendly.com/d/...) - ask for the profile link' };
    if (parts.length < 2) return { provider: 'calendly', url, reason: 'profile page without an event - the lead must pick an event type' };
    return { provider: 'calendly', url, profileSlug: parts[0], eventSlug: parts[1] };
  }
  return { provider: null, url, reason: `${host} is not a booking page Wingguy can read yet (Calendly only)` };
}

async function getJson(url, fetchImpl) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: ctrl ? ctrl.signal : undefined });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { /* html or empty */ }
    return { status: res.status, body };
  } finally { if (timer) clearTimeout(timer); }
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Read the free slots a Calendly link offers between rangeStart and rangeEnd (YYYY-MM-DD, inclusive),
 * expressed in `timezone` (the coach's - so the ISO times line up with check_availability's).
 *
 * Returns { ok:true, provider, eventName, ownerName, durationMins, leadTimezone, slots:[ISO...] }
 *      or { ok:false, reason }.
 */
async function readBookingLink(url, { timezone = 'Australia/Brisbane', rangeStart, rangeEnd, fetchImpl = global.fetch } = {}) {
  const parsed = parseBookingLink(url);
  if (parsed.provider !== 'calendly' || !parsed.profileSlug) return { ok: false, reason: parsed.reason || 'unreadable link' };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no fetch available' };
  try {
    const lookupUrl = `https://calendly.com/api/booking/event_types/lookup?event_type_slug=${encodeURIComponent(parsed.eventSlug)}&profile_slug=${encodeURIComponent(parsed.profileSlug)}`;
    const lk = await getJson(lookupUrl, fetchImpl);
    if (lk.status !== 200 || !lk.body || !lk.body.uuid) return { ok: false, reason: `Calendly lookup failed (HTTP ${lk.status})` };
    const uuid = lk.body.uuid;
    const linkUid = lk.body.scheduling_link && lk.body.scheduling_link.uid;
    const durationMins = Number(lk.body.duration) || 30;
    const today = new Date().toISOString().slice(0, 10);
    let start = rangeStart || today;
    const end = rangeEnd || addDays(start, 48);
    const slots = [];
    while (start <= end) {
      const chunkEnd = [addDays(start, CALENDLY_MAX_RANGE_DAYS - 1), end].sort()[0];
      const rangeUrl = `https://calendly.com/api/booking/event_types/${encodeURIComponent(uuid)}/calendar/range?timezone=${encodeURIComponent(timezone)}&diagnostics=false&range_start=${start}&range_end=${chunkEnd}` + (linkUid ? `&scheduling_link_uuid=${encodeURIComponent(linkUid)}` : '');
      const rg = await getJson(rangeUrl, fetchImpl);
      if (rg.status !== 200 || !rg.body || !Array.isArray(rg.body.days)) return { ok: false, reason: `Calendly availability failed (HTTP ${rg.status})` };
      for (const day of rg.body.days) {
        for (const spot of day.spots || []) {
          if (spot.status === 'available' && spot.start_time) {
            const ms = Date.parse(spot.start_time);
            if (Number.isFinite(ms)) slots.push(new Date(ms).toISOString());
          }
        }
      }
      start = addDays(chunkEnd, 1);
    }
    slots.sort();
    return {
      ok: true,
      provider: 'calendly',
      eventName: lk.body.name || '',
      ownerName: (lk.body.profile && lk.body.profile.name) || '',
      durationMins,
      leadTimezone: lk.body.availability_timezone || (lk.body.profile && lk.body.profile.timezone) || null,
      slots: [...new Set(slots)],
    };
  } catch (e) {
    return { ok: false, reason: `could not read the link (${e && e.name === 'AbortError' ? 'timed out' : (e && e.message) || 'error'})` };
  }
}

/**
 * Merge the lead's bookable start times into free intervals [startMs, endMs). A spot means the lead
 * is free for `durationMins` from that start; adjacent/overlapping spots merge, so a coach slot that
 * straddles two of the lead's 15-minute grid points still counts as free.
 */
function leadFreeIntervals(slotsISO, durationMins) {
  const len = (Number(durationMins) || 30) * 60000;
  const starts = (slotsISO || []).map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);
  const out = [];
  for (const s of starts) {
    const e = s + len;
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Keep only the coach's slots the lead can also make: the whole coach meeting [t, t+meetingMins)
 * must sit inside one of the lead's free intervals. Days left with no slots are dropped.
 */
function intersectAvailability(filtered, lead, { meetingMins = 30 } = {}) {
  const intervals = leadFreeIntervals(lead.slots, lead.durationMins);
  const len = (Number(meetingMins) || 30) * 60000;
  const free = (iso) => {
    const t = Date.parse(iso);
    return intervals.some(([s, e]) => t >= s && t + len <= e);
  };
  const days = (filtered.days || [])
    .map((d) => ({ ...d, freeSlots: (d.freeSlots || []).filter((s) => free(s.time)) }))
    .filter((d) => d.freeSlots.length);
  return { ...filtered, days, leadLinkSlotsBefore: (filtered.days || []).reduce((n, d) => n + (d.freeSlots || []).length, 0) };
}

module.exports = { findBookingLink, parseBookingLink, readBookingLink, leadFreeIntervals, intersectAvailability, CALENDLY_MAX_RANGE_DAYS };
