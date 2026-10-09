/**
 * Lead booking-link reader (2026-09-15, Candace Ngok: "here's a link to my calendar"; TidyCal added
 * 2026-10-09, Sam Trattles: "https://tidycal.com/thepowertoask/consultation").
 *
 * WHAT IT DOES: when a lead hands over a Calendly or TidyCal link, read the free slots that link
 * would show a visitor, in the coach's clock, so check_availability can return ONLY the times both
 * sides are free. Both providers answer plain unauthenticated calls - no login, no API key.
 *
 * CALENDLY (proven with curl from Guy's laptop the day this shipped - no bot wall):
 *
 *   GET /api/booking/event_types/lookup?event_type_slug=<event>&profile_slug=<profile>
 *       -> { uuid, duration, scheduling_link: { uid }, availability_timezone, name, profile.name }
 *   GET /api/booking/event_types/<uuid>/calendar/range?timezone=<tz>&range_start=..&range_end=..
 *       &scheduling_link_uuid=<uid>   (ranges over ~5 weeks are refused -> paged in 28-day chunks)
 *       -> { days: [{ date, status, spots: [{ status:'available', start_time }] }] }
 *
 * TIDYCAL (proven with curl from Guy's machine, 9 Oct 2026 - no cookies, no login). Every call needs
 * browser-style headers (Accept: application/json, X-Requested-With: XMLHttpRequest, Referer = the
 * booking page, a Mozilla user agent) or the slots call answers 405:
 *
 *   GET <booking page>?json
 *       -> { bookingType: { id, title, duration_minutes, padding_minutes, url_slug, ... } }
 *   GET <booking page>            (plain HTML) -> carries "booking-types/<short code>" somewhere in
 *       the page. The slots call wants THIS short code, not the numeric id.
 *   GET /booking-types/<code>/available-bookings?start=<ISO UTC>&end=<ISO UTC>
 *       -> [ { starts_at, ends_at, available_bookings }, ... ]   (UTC, one per open start time)
 *
 * TidyCal sits behind Cloudflare. A bot-check page (HTML where JSON was expected) is reported as
 * { ok:false, reason } like any other failure.
 *
 * All of these calls are UNDOCUMENTED. When a provider changes them the reader returns { ok:false,
 * reason } and the caller falls back to the coach-only slots with a plain "could not read the link"
 * line - exactly what happened before this existed. Never throw out of here.
 *
 * WHAT IT DOES NOT DO: book through the lead's page. The booking door stays wingguy_book_meeting
 * (coach's own invite, Zoom room, lead record) - the lead's link only tells us WHEN.
 *
 * Supported today: calendly.com/<profile>/<event>[?...] and tidycal.com/<profile>/<booking-type>.
 * Other providers (cal.com, HubSpot, Google appointment pages) parse as { provider:null } and the
 * caller says so.
 */

const { DateTime } = require('luxon');

const MAX_RANGE_DAYS = 28;   // Calendly refuses ~7 weeks (35 worked, 49 did not); TidyCal gets the same paging to be safe
const CALENDLY_MAX_RANGE_DAYS = MAX_RANGE_DAYS;
const FETCH_TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const PROVIDER_LABELS = { calendly: 'Calendly', tidycal: 'TidyCal' };

/** 'calendly' -> 'Calendly', 'tidycal' -> 'TidyCal', anything else -> 'booking' (as in "booking link"). */
function providerLabel(provider) {
  return PROVIDER_LABELS[String(provider || '').toLowerCase()] || 'booking';
}

/**
 * Pull a booking link out of free text (a LinkedIn message, an email). First match wins.
 *
 * The scheme is optional (Sam Trattles, 2026-10-09, second run): LinkedIn's full-thread view showed
 * her link as "tidycal.com/thepowertoask/consultation" with no https://, the scanner walked past it,
 * the panel offered a list, and the model's own attempt with the bare address was refused as "not a
 * URL". A bare host+path is returned with https:// put back so every caller sees one shape.
 */
function findBookingLink(text) {
  const m = String(text || '').match(/(?:https?:\/\/)?(?:www\.)?(?:calendly\.com|tidycal\.com)\/[^\s<>"')\]]+/i);
  if (!m) return null;
  const raw = m[0].replace(/[.,;:!?]+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Parse a booking link into its provider parts. A bare "tidycal.com/..." is read as https. */
function parseBookingLink(url) {
  let u;
  const str = String(url || '').trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(str) ? str : (/^(?:www\.)?(?:calendly\.com|tidycal\.com)\//i.test(str) ? `https://${str}` : str);
  try { u = new URL(withScheme); } catch (_) { return { provider: null, url, reason: 'not a URL' }; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'calendly.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    // /d/<uid>/<slug> is a share link - it does not carry the profile slug the lookup needs.
    if (parts[0] === 'd') return { provider: 'calendly', url, reason: 'share link (calendly.com/d/...) - ask for the profile link' };
    if (parts.length < 2) return { provider: 'calendly', url, reason: 'profile page without an event - the lead must pick an event type' };
    return { provider: 'calendly', url, profileSlug: parts[0], eventSlug: parts[1] };
  }
  if (host === 'tidycal.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'booking-types') return { provider: 'tidycal', url, reason: 'an internal TidyCal address, not a booking page - ask for the page link' };
    if (parts.length < 2) return { provider: 'tidycal', url, reason: 'profile page without a booking type - the lead must pick one' };
    // The page address without query or fragment: the ?json lookup, the Referer header and the HTML
    // read all want exactly this.
    const pageUrl = `https://tidycal.com/${parts.map(encodeURIComponent).join('/')}`;
    return { provider: 'tidycal', url, profileSlug: parts[0], eventSlug: parts[1], pageUrl };
  }
  return { provider: null, url, reason: `${host} is not a booking page Wingguy can read yet (Calendly or TidyCal only)` };
}

/** One GET with a timeout. Returns { status, text, body } where body is the parsed JSON or null. */
async function fetchPage(url, fetchImpl, headers) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl ? ctrl.signal : undefined });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { /* html or empty */ }
    return { status: res.status, text: String(text || ''), body };
  } finally { if (timer) clearTimeout(timer); }
}

async function getJson(url, fetchImpl) {
  return fetchPage(url, fetchImpl, { Accept: 'application/json', 'User-Agent': UA });
}

/** Cloudflare's "Just a moment..." interstitial, or its block page, where a JSON answer was expected. */
function isBotCheck(text) {
  return /just a moment|cf-chl|cf_chl|challenge-platform|attention required/i.test(String(text || '').slice(0, 4000));
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A provider timestamp as epoch ms, or NaN. Laravel-style "2026-10-14 23:00:00" (no zone marker)
 * is UTC on TidyCal's side - Date.parse would read it as the server's local time, so pin it.
 */
function parseUtcStamp(s) {
  const str = String(s || '').trim();
  if (!str) return NaN;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(str)) return Date.parse(`${str.replace(' ', 'T')}Z`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(str)) return Date.parse(`${str}Z`);
  return Date.parse(str);
}

/**
 * Read the free slots a Calendly or TidyCal link offers between rangeStart and rangeEnd (YYYY-MM-DD,
 * inclusive), expressed in `timezone` (the coach's - so the ISO times line up with check_availability's).
 *
 * Returns { ok:true, provider, eventName, ownerName, durationMins, leadTimezone, slots:[ISO...] }
 *      or { ok:false, reason }.
 */
async function readBookingLink(url, { timezone = 'Australia/Brisbane', rangeStart, rangeEnd, fetchImpl = global.fetch } = {}) {
  const parsed = parseBookingLink(url);
  if (!parsed.provider || !parsed.profileSlug) return { ok: false, reason: parsed.reason || 'unreadable link' };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no fetch available' };
  const today = new Date().toISOString().slice(0, 10);
  const start = rangeStart || today;
  const end = rangeEnd || addDays(start, 48);
  try {
    if (parsed.provider === 'tidycal') return await readTidyCal(parsed, { timezone, start, end, fetchImpl });
    return await readCalendly(parsed, { timezone, start, end, fetchImpl });
  } catch (e) {
    return { ok: false, reason: `could not read the link (${e && e.name === 'AbortError' ? 'timed out' : (e && e.message) || 'error'})` };
  }
}

async function readCalendly(parsed, { timezone, start: rangeStart, end, fetchImpl }) {
  const lookupUrl = `https://calendly.com/api/booking/event_types/lookup?event_type_slug=${encodeURIComponent(parsed.eventSlug)}&profile_slug=${encodeURIComponent(parsed.profileSlug)}`;
  const lk = await getJson(lookupUrl, fetchImpl);
  if (lk.status !== 200 || !lk.body || !lk.body.uuid) return { ok: false, reason: `Calendly lookup failed (HTTP ${lk.status})` };
  const uuid = lk.body.uuid;
  const linkUid = lk.body.scheduling_link && lk.body.scheduling_link.uid;
  const durationMins = Number(lk.body.duration) || 30;
  let start = rangeStart;
  const slots = [];
  while (start <= end) {
    const chunkEnd = [addDays(start, MAX_RANGE_DAYS - 1), end].sort()[0];
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
}

/** The headers TidyCal wants on its JSON answers (without them the slots call is a 405). */
function tidyJsonHeaders(pageUrl) {
  return { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: pageUrl, 'User-Agent': UA };
}

/** The short booking-type code ("booking-types/1rlrxwx") from any text TidyCal served. */
function tidyCodeFrom(text) {
  const m = String(text || '').match(/booking-types\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function readTidyCal(parsed, { timezone, start, end, fetchImpl }) {
  const pageUrl = parsed.pageUrl;
  // 1. The booking type behind the page: title, length, numeric id.
  const lk = await fetchPage(`${pageUrl}?json`, fetchImpl, tidyJsonHeaders(pageUrl));
  if (isBotCheck(lk.text) && !lk.body) return { ok: false, reason: 'TidyCal answered with a Cloudflare bot check instead of the page' };
  if (lk.status !== 200 || !lk.body) return { ok: false, reason: `TidyCal page lookup failed (HTTP ${lk.status})` };
  const bt = lk.body.bookingType || lk.body.booking_type || null;
  if (!bt || typeof bt !== 'object') return { ok: false, reason: 'TidyCal page lookup returned no booking type' };
  // 2. The short code the slots call keys on. It is not in the JSON by name, so take it from
  //    wherever TidyCal wrote it - the JSON text when it happens to be there, else the HTML page.
  let code = tidyCodeFrom(lk.text);
  if (!code) {
    const html = await fetchPage(pageUrl, fetchImpl, { Accept: 'text/html,application/xhtml+xml', Referer: pageUrl, 'User-Agent': UA });
    if (isBotCheck(html.text)) return { ok: false, reason: 'TidyCal answered with a Cloudflare bot check instead of the page' };
    if (html.status !== 200) return { ok: false, reason: `TidyCal page read failed (HTTP ${html.status})` };
    code = tidyCodeFrom(html.text);
  }
  if (!code) return { ok: false, reason: 'TidyCal page carried no booking-type code' };
  // 3. The open start times, in UTC, over the coach's window (whole days in the coach's clock).
  const slots = [];
  let chunkStart = start;
  while (chunkStart <= end) {
    const chunkEnd = [addDays(chunkStart, MAX_RANGE_DAYS - 1), end].sort()[0];
    const startIso = DateTime.fromISO(chunkStart, { zone: timezone }).startOf('day').toUTC().toISO();
    const endIso = DateTime.fromISO(chunkEnd, { zone: timezone }).endOf('day').toUTC().toISO();
    const slotsUrl = `https://tidycal.com/booking-types/${encodeURIComponent(code)}/available-bookings?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
    const av = await fetchPage(slotsUrl, fetchImpl, tidyJsonHeaders(pageUrl));
    if (isBotCheck(av.text) && !av.body) return { ok: false, reason: 'TidyCal answered with a Cloudflare bot check instead of the slots' };
    const list = Array.isArray(av.body) ? av.body : (av.body && Array.isArray(av.body.data) ? av.body.data : null);
    if (av.status !== 200 || !list) return { ok: false, reason: `TidyCal availability failed (HTTP ${av.status})` };
    for (const item of list) {
      if (!item || !item.starts_at) continue;
      if (item.available_bookings != null && Number(item.available_bookings) <= 0) continue;
      const ms = parseUtcStamp(item.starts_at);
      if (Number.isFinite(ms)) slots.push(new Date(ms).toISOString());
    }
    chunkStart = addDays(chunkEnd, 1);
  }
  slots.sort();
  const owner = bt.user || bt.owner || lk.body.user || lk.body.owner || lk.body.profile || {};
  return {
    ok: true,
    provider: 'tidycal',
    eventName: bt.title || bt.name || parsed.eventSlug || '',
    ownerName: owner.name || owner.display_name || owner.full_name || '',
    durationMins: Number(bt.duration_minutes) || 30,
    leadTimezone: bt.timezone || owner.timezone || lk.body.timezone || null,
    slots: [...new Set(slots)],
  };
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
 * Keep only the coach's slots the lead can also make: a meeting of `fitMins` starting at the coach's
 * slot [t, t+fitMins) must sit inside one of the lead's free intervals. Days left with no slots are
 * dropped.
 *
 * fitMins is the SMALLER of the coach's meeting length and the lead's own event length (Sam
 * Trattles, live 9 Oct 2026). The first cut demanded the coach's whole 30 minutes. Right for Calendly,
 * whose 15-minute grid merges into long free runs - but TidyCal's padded booking types are 15-minute
 * islands, so a 30-minute test discarded all 306 of Sam's slots and "no time where BOTH are free"
 * went back when seven matched. A lead whose page offers 15-minute slots is free at those START
 * times; the coach's invite still goes out at his usual length (the callers say so in their note).
 */
function intersectAvailability(filtered, lead, { meetingMins = 30 } = {}) {
  const intervals = leadFreeIntervals(lead.slots, lead.durationMins);
  const coachMins = Number(meetingMins) || 30;
  const leadMins = Number(lead.durationMins) || coachMins;
  const fitMins = Math.min(coachMins, leadMins);
  const len = fitMins * 60000;
  const free = (iso) => {
    const t = Date.parse(iso);
    return intervals.some(([s, e]) => t >= s && t + len <= e);
  };
  const days = (filtered.days || [])
    .map((d) => ({ ...d, freeSlots: (d.freeSlots || []).filter((s) => free(s.time)) }))
    .filter((d) => d.freeSlots.length);
  return {
    ...filtered,
    days,
    leadLinkSlotsBefore: (filtered.days || []).reduce((n, d) => n + (d.freeSlots || []).length, 0),
    fitMins,
    leadSlotMins: leadMins,
    leadSlotsShorter: leadMins < coachMins,
  };
}

module.exports = { findBookingLink, parseBookingLink, readBookingLink, leadFreeIntervals, intersectAvailability, providerLabel, CALENDLY_MAX_RANGE_DAYS, MAX_RANGE_DAYS };
