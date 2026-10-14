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
 * Supported today: calendly.com/<profile>/<event>[?...], tidycal.com/<profile>/<booking-type> and
 * TimeTrade (my.timetrade.com/book/<code>, my-schedule.timetrade.com/app/<td>/workflows/<wf>/...).
 * Other providers (cal.com, HubSpot) parse as { provider:null } and the caller says so.
 *
 * TIMETRADE (Steve Brossman, 14 Oct 2026: "https://bit.ly/StevePPcall"; proven with plain curl the same
 * day - no browser, no bot wall). TimeTrade is a step-by-step booking wizard held together by a session
 * id ("wfsid") the page hands out, and the slots call answers only once that session has walked past the
 * welcome step (a fresh session asking for slots straight away gets {"errors":null,"code":null}):
 *
 *   GET my.timetrade.com/book/<code>  -> 301 -> my-schedule.timetrade.com/app/<td>/workflows/<wf>/schedule
 *       -> a JavaScript shell whose script carries "wfsid=<session id>"
 *   GET .../schedule/index/deviceformat?wfsid=<sid>&dd=b&view=full&d=<IANA tz>  -> the welcome step
 *   POST .../schedule/welcome/submit?wfsid=<sid>  (X-Requested-With: XMLHttpRequest)
 *       -> { data: { nextUrl } }; nextUrl 301s through appointment-type and resource to availability
 *       when those steps hold no real choice. A step that DOES want a choice (pick a meeting type, pick
 *       a person) falls open - Wingguy never chooses on the lead's behalf.
 *   GET .../schedule/availability/range/?wfsid=<sid>&view=full&start=YYYY-MM-DD&end=YYYY-MM-DD&tz=<IANA>
 *       -> { data: { "2026-10-15": { options: [{ date, id: "<UTC ISO start>", time }] } } }
 *       Date-only start/end (an ISO time part came back empty). Days past the lead's booking window
 *       simply have no entry.
 *   The meeting length is NOT on any of these pages, so durationMins comes back null and the fit uses
 *   the coach's own length (the READ line says so).
 *
 * SHORT LINKS (bit.ly, tinyurl and friends - Steve's link above): findBookingLink stays synchronous and
 * never matches one, because a short link can point anywhere and a plain article link must not set off
 * the booking-link guards. findBookingLinkResolved follows a short link's redirects (without fetching
 * the destination) and returns the destination ONLY when it is a booking page; readBookingLink does the
 * same for a short link the model passes.
 *
 * GOOGLE APPOINTMENT PAGES (calendar.app.google/<code>, calendar.google.com/calendar/appointments/
 * schedules/<token>) are RECOGNISED BUT NOT READ (Laura Gardner, 2026-10-10). The page is a JavaScript
 * shell: the slots come from a private Google API (calendar-pa.clients6.google.com) whose request the
 * app assembles from protobuf descriptors and whose answers are positional nested arrays - nothing a
 * plain fetch can read, and nothing stable enough to decode. Investigated for two hours, written up in
 * docs/wingguy.md (2026-10-10). The link is still FOUND by findBookingLink so the panel's thread scanner
 * sees it and the no-promise / no-confession guards engage; parseBookingLink returns provider 'google'
 * with no slugs, so readBookingLink answers { ok:false, reason } without a network call and the caller
 * offers the coach's own times.
 */

const { DateTime } = require('luxon');

const MAX_RANGE_DAYS = 28;   // Calendly refuses ~7 weeks (35 worked, 49 did not); TidyCal gets the same paging to be safe
const CALENDLY_MAX_RANGE_DAYS = MAX_RANGE_DAYS;
const FETCH_TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const PROVIDER_LABELS = { calendly: 'Calendly', tidycal: 'TidyCal', timetrade: 'TimeTrade', google: 'Google appointment' };
const READABLE = 'Calendly, TidyCal or TimeTrade only';
const GOOGLE_REASON = `a Google Calendar appointment page - Google only serves its slots to a browser, so Wingguy cannot read it (${READABLE})`;
// Hosts that only ever redirect somewhere else. LinkedIn's own lnkd.in is one: it wraps links in posts.
const SHORTENER_HOSTS = new Set(['bit.ly', 'bitly.com', 'tinyurl.com', 'ow.ly', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'is.gd', 't.ly', 'rb.gy', 'tiny.cc', 'shorturl.at', 'lnkd.in', 'bl.ink', 's.id']);
const SHORT_LINK_RE = /(?:https?:\/\/)?(?:www\.)?(?:bit\.ly|bitly\.com|tinyurl\.com|ow\.ly|buff\.ly|rebrand\.ly|cutt\.ly|is\.gd|t\.ly|rb\.gy|tiny\.cc|shorturl\.at|lnkd\.in|bl\.ink|s\.id)\/[A-Za-z0-9_\-/]+/gi;
const MAX_SHORT_HOPS = 5;

/** 'calendly' -> 'Calendly', 'tidycal' -> 'TidyCal', 'timetrade' -> 'TimeTrade', anything else -> 'booking' (as in "booking link"). */
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
  const m = String(text || '').match(/(?:https?:\/\/)?(?:www\.)?(?:calendly\.com\/|tidycal\.com\/|(?:[a-z0-9-]+\.)?timetrade\.com\/(?:book|app)\/|calendar\.app\.google\/|calendar\.google\.com\/(?:calendar\/)?appointments\/)[^\s<>"')\]]+/i);
  if (!m) return null;
  let raw = m[0];
  // LinkedIn's full-thread view glues the next line onto the link with no space between
  // ("…/consultationLook forward to chatting", Sam Trattles 2026-10-09, third run - the reader then
  // fetched a page that does not exist). Slugs on Calendly and TidyCal are lower case, so the path
  // ends at the first capital letter after the host. Google's codes are mixed case (Rt3HARJvfXUBpviz7)
  // and TimeTrade's are upper case (my.timetrade.com/book/V4KFJ), so those are left as matched.
  if (!/calendar\.(?:app\.)?google|timetrade\.com/i.test(raw)) raw = raw.replace(/^((?:https?:\/\/)?[^/]+\/[^A-Z]*)[A-Z].*$/, '$1');
  raw = raw.replace(/[.,;:!?]+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Parse a booking link into its provider parts. A bare "tidycal.com/..." is read as https. */
function parseBookingLink(url) {
  let u;
  const str = String(url || '').trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(str) ? str : (/^(?:www\.)?(?:calendly\.com|tidycal\.com|(?:[a-z0-9-]+\.)?timetrade\.com|calendar\.app\.google|calendar\.google\.com)\//i.test(str) || isShortLink(str) ? `https://${str}` : str);
  try { u = new URL(withScheme); } catch (_) { return { provider: null, url, reason: 'not a URL' }; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  // A short link says nothing until it is followed - readBookingLink resolves it, then parses again.
  if (SHORTENER_HOSTS.has(host)) return { provider: null, url, short: true, reason: `a ${host} short link that did not lead to a booking page` };
  if (host === 'timetrade.com' || host.endsWith('.timetrade.com')) {
    const parts = u.pathname.split('/').filter(Boolean);
    // my-schedule.timetrade.com/app/<td>/workflows/<wf>/schedule... - the address the /book/ code
    // redirects to, and the one a lead copies out of the address bar.
    if (parts[0] === 'app' && parts[1] && parts[2] === 'workflows' && parts[3]) {
      const pageUrl = `https://${u.hostname}/app/${encodeURIComponent(parts[1])}/workflows/${encodeURIComponent(parts[3])}/schedule?view=full`;
      return { provider: 'timetrade', url, profileSlug: parts[1], eventSlug: parts[3], pageUrl };
    }
    if (parts[0] === 'book' && parts[1]) {
      return { provider: 'timetrade', url, profileSlug: parts[1], eventSlug: parts[1], pageUrl: `https://${u.hostname}/book/${encodeURIComponent(parts[1])}` };
    }
    return { provider: 'timetrade', url, reason: 'a TimeTrade address that is not a booking page - ask for the booking link' };
  }
  // Recognised, never read - see the header. No slugs, so readBookingLink falls open without a call.
  if (host === 'calendar.app.google' || (host === 'calendar.google.com' && /^\/(?:calendar\/)?appointments\//i.test(u.pathname))) {
    return { provider: 'google', url, reason: GOOGLE_REASON };
  }
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
  return { provider: null, url, reason: `${host} is not a booking page Wingguy can read yet (${READABLE})` };
}

/** True for a link on a known URL shortener (bit.ly, tinyurl, lnkd.in, ...), with or without https://. */
function isShortLink(url) {
  const str = String(url || '').trim();
  try { return SHORTENER_HOSTS.has(new URL(/^https?:\/\//i.test(str) ? str : `https://${str}`).hostname.replace(/^www\./, '').toLowerCase()); } catch (_) { return false; }
}

/** Every short link in free text, https:// put back, trailing punctuation dropped. */
function findShortLinks(text) {
  return (String(text || '').match(SHORT_LINK_RE) || [])
    .map((raw) => raw.replace(/[.,;:!?/]+$/, ''))
    .map((raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`));
}

/** A header from a fetch Response (or a test fake with a plain object), or ''. */
function headerOf(res, name) {
  const h = res && res.headers;
  if (!h) return '';
  if (typeof h.get === 'function') return h.get(name) || '';
  return h[name] || h[name.toLowerCase()] || '';
}

/**
 * Follow a short link's redirects until it lands off the shortener hosts, WITHOUT fetching the
 * destination (Steve Brossman, 14 Oct 2026: bit.ly/StevePPcall -> my.timetrade.com/book/V4KFJ). Returns
 * the destination URL, or null when it does not redirect anywhere. A shortener that answers with a page
 * instead of a redirect (an interstitial) is searched for a booking link. Never throws.
 */
async function resolveShortLink(url, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') return null;
  let cur = /^https?:\/\//i.test(String(url || '')) ? String(url) : `https://${url}`;
  try {
    for (let hop = 0; hop < MAX_SHORT_HOPS; hop++) {
      if (!isShortLink(cur)) return cur;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
      let res;
      try { res = await fetchImpl(cur, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: ctrl ? ctrl.signal : undefined }); } finally { if (timer) clearTimeout(timer); }
      const loc = headerOf(res, 'location');
      if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
      if (res.status !== 200 || typeof res.text !== 'function') return null;
      const text = await res.text();
      const refresh = String(text || '').match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i);
      if (refresh) { cur = new URL(refresh[1].replace(/&amp;/g, '&'), cur).href; continue; }
      return findBookingLink(text);
    }
    return isShortLink(cur) ? null : cur;
  } catch (_) { return null; }
}

/**
 * findBookingLink, plus short links: a bit.ly in the text that leads to a booking page returns that
 * booking page's address. A short link that leads anywhere else is ignored, so a plain article link
 * never sets off the booking-link guards. Network only when the text holds a short link.
 */
async function findBookingLinkResolved(text, { fetchImpl = global.fetch } = {}) {
  const direct = findBookingLink(text);
  if (direct) return direct;
  for (const shortUrl of findShortLinks(text).slice(0, 3)) {
    const dest = await resolveShortLink(shortUrl, fetchImpl);
    const found = dest ? findBookingLink(dest) : null;
    if (found) return found;
  }
  return null;
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
  let parsed = parseBookingLink(url);
  // A short link (bit.ly...): follow it first, then read whatever booking page it lands on.
  if (parsed.short) {
    const dest = await resolveShortLink(url, fetchImpl);
    const reparsed = dest ? parseBookingLink(dest) : null;
    if (!reparsed || !reparsed.provider) return { ok: false, reason: dest ? `a short link that leads to ${(() => { try { return new URL(dest).hostname; } catch (_) { return 'another site'; } })()}, not a booking page Wingguy can read (${READABLE})` : parsed.reason };
    parsed = reparsed;
  }
  if (!parsed.provider || !parsed.profileSlug) return { ok: false, provider: parsed.provider || undefined, reason: parsed.reason || 'unreadable link' };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no fetch available' };
  const today = new Date().toISOString().slice(0, 10);
  const start = rangeStart || today;
  const end = rangeEnd || addDays(start, 48);
  try {
    if (parsed.provider === 'tidycal') return await readTidyCal(parsed, { timezone, start, end, fetchImpl });
    if (parsed.provider === 'timetrade') return await readTimeTrade(parsed, { timezone, start, end, fetchImpl });
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
 * One TimeTrade request with redirects followed BY HAND, so cookies set on a redirect are kept (the
 * load balancer's AWSALB sticky cookie arrives on the /book/ 301) and the final address is known - it
 * says which wizard step the session landed on. Returns { status, url, text, body }.
 */
async function ttFetch(url, fetchImpl, jar, { method = 'GET', headers = {} } = {}) {
  let cur = url;
  let verb = method;
  for (let hop = 0; hop < 8; hop++) {
    const host = new URL(cur).hostname;
    const cookies = Object.entries(jar[host] || {}).map(([k, v]) => `${k}=${v}`).join('; ');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetchImpl(cur, { method: verb, redirect: 'manual', headers: { 'User-Agent': UA, ...headers, ...(cookies ? { Cookie: cookies } : {}) }, signal: ctrl ? ctrl.signal : undefined });
    } finally { if (timer) clearTimeout(timer); }
    const setCookies = res.headers && typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : String(headerOf(res, 'set-cookie') || '').split(/,(?=\s*[A-Za-z0-9_-]+=)/).filter(Boolean);
    for (const c of setCookies) {
      const m = String(c).match(/^\s*([^=;\s]+)=([^;]*)/);
      if (m) jar[host] = { ...(jar[host] || {}), [m[1]]: m[2] };
    }
    const loc = headerOf(res, 'location');
    if (res.status >= 300 && res.status < 400 && loc) {
      cur = new URL(loc, cur).href;
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && verb === 'POST')) verb = 'GET';
      continue;
    }
    const text = String((await res.text()) || '');
    let body = null;
    try { body = JSON.parse(text); } catch (_) { /* html */ }
    return { status: res.status, url: cur, text, body };
  }
  return { status: 0, url: cur, text: '', body: null };
}

/** The wizard step a TimeTrade address is on ("welcome", "appointment-type", "availability"...). */
function ttStep(url) {
  const m = String(url || '').match(/\/schedule\/([a-z-]+)/i);
  return m ? m[1].toLowerCase() : '';
}

/** The meeting name from a TimeTrade page title ("Prominence and Persuasion Review with Steve - TimeTrade - ..."). */
function ttTitle(html) {
  const m = String(html || '').match(/<title>\s*([^<]*?)\s*<\/title>/i);
  if (!m) return '';
  const parts = m[1].split(/\s+-\s+TimeTrade\s+-\s+/i).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

async function readTimeTrade(parsed, { timezone, start, end, fetchImpl }) {
  const jar = {};
  // 1. The page: follows /book/<code> to the wizard and hands out the session id.
  const page = await ttFetch(parsed.pageUrl, fetchImpl, jar, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  if (page.status !== 200) return { ok: false, reason: `TimeTrade page read failed (HTTP ${page.status})` };
  const wf = String(page.url).match(/^(https:\/\/[^/]+\/app\/[^/]+\/workflows\/[^/]+\/schedule)/i);
  if (!wf) return { ok: false, reason: 'the TimeTrade link did not lead to a booking page' };
  const base = wf[1];
  const sidM = (page.text + ' ' + page.url).match(/wfsid=([A-Za-z0-9]+)/);
  if (!sidM) return { ok: false, reason: 'the TimeTrade page carried no session id' };
  const sid = sidM[1];
  const xhr = { Accept: 'application/json, text/javascript, */*', 'X-Requested-With': 'XMLHttpRequest', Referer: page.url };
  // 2. Tell it the visitor's clock; it answers with the first wizard step.
  let step = await ttFetch(`${base}/index/deviceformat?wfsid=${sid}&dd=b&view=full&d=${encodeURIComponent(timezone)}`, fetchImpl, jar, { headers: { Accept: 'text/html', Referer: page.url } });
  let eventName = ttTitle(step.text) || ttTitle(page.text);
  // 3. Walk past the welcome step. Steps with nothing to choose redirect on to availability; a step
  //    that wants a choice (meeting type, person, location) stops the read - never choose for the lead.
  for (let i = 0; i < 4 && ttStep(step.url) !== 'availability'; i++) {
    const at = ttStep(step.url);
    if (step.status !== 200) return { ok: false, reason: `TimeTrade step "${at || 'start'}" failed (HTTP ${step.status})` };
    if (at !== 'welcome') return { ok: false, reason: `the TimeTrade page asks the visitor to choose ${at ? `an option ("${at.replace(/-/g, ' ')}")` : 'something'} before it shows times` };
    const sub = await ttFetch(`${base}/welcome/submit?wfsid=${sid}`, fetchImpl, jar, { method: 'POST', headers: xhr });
    const next = sub.body && sub.body.data && sub.body.data.nextUrl;
    if (sub.status !== 200 || !next) return { ok: false, reason: `TimeTrade welcome step failed (HTTP ${sub.status})` };
    step = await ttFetch(new URL(next, base).href, fetchImpl, jar, { headers: { Accept: 'text/html', Referer: page.url } });
    eventName = eventName || ttTitle(step.text);
  }
  if (ttStep(step.url) !== 'availability') return { ok: false, reason: 'the TimeTrade page never reached its calendar' };
  // 4. The open start times: ids are UTC ISO starts. Date-only range, whole days.
  const slots = [];
  let chunkStart = start;
  while (chunkStart <= end) {
    const chunkEnd = [addDays(chunkStart, MAX_RANGE_DAYS - 1), end].sort()[0];
    const rg = await ttFetch(`${base}/availability/range/?wfsid=${sid}&view=full&start=${chunkStart}&end=${chunkEnd}&tz=${encodeURIComponent(timezone)}`, fetchImpl, jar, { headers: xhr });
    if (rg.status !== 200 || !rg.body || !('data' in rg.body)) return { ok: false, reason: `TimeTrade availability failed (HTTP ${rg.status})` };
    const data = rg.body.data && typeof rg.body.data === 'object' ? rg.body.data : {};
    for (const day of Object.values(data)) {
      for (const opt of (day && Array.isArray(day.options) ? day.options : [])) {
        const ms = Date.parse(opt && opt.id);
        if (Number.isFinite(ms)) slots.push(new Date(ms).toISOString());
      }
    }
    chunkStart = addDays(chunkEnd, 1);
  }
  slots.sort();
  return {
    ok: true,
    provider: 'timetrade',
    eventName,
    ownerName: '',
    durationMins: null, // TimeTrade never shows the meeting length - the fit uses the coach's own
    leadTimezone: null,
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
  const coachMins = Number(meetingMins) || 30;
  // No length on the lead's page (TimeTrade never shows one): each start counts as free for the
  // coach's own meeting length.
  const leadMins = Number(lead.durationMins) || coachMins;
  const intervals = leadFreeIntervals(lead.slots, leadMins);
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

module.exports = { findBookingLink, findBookingLinkResolved, findShortLinks, isShortLink, resolveShortLink, parseBookingLink, readBookingLink, leadFreeIntervals, intersectAvailability, providerLabel, CALENDLY_MAX_RANGE_DAYS, MAX_RANGE_DAYS };
