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
 * TimeTrade (my.timetrade.com/book/<code>, my-schedule.timetrade.com/app/<td>/workflows/<wf>/...) and
 * Microsoft Bookings "Bookings with me" pages (outlook.office.com/bookwithme/user/<id>@<domain>) and
 * OnceHub booking pages (go.oncehub.com/<PageName>).
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
 *
 * MICROSOFT BOOKINGS - "Bookings with me" (Michael Farag, 3 Nov 2026: "https://outlook.office.com/
 * bookwithme/user/f743d474fe5b4780b0c99e64d5f1862b@52ndSolution.net?anonymous&ismsaljsauthenabled";
 * worked out in a browser, then proven with plain Node fetch the same day - no sign-in, no browser).
 * The link carries the owner's Exchange mailbox id (32 hex) and their email domain. Every call is
 * unauthenticated JSON on bookings.cloud.microsoft:
 *
 *   GET login.microsoftonline.com/<domain>/.well-known/openid-configuration
 *       -> token_endpoint ".../<tenant GUID>/oauth2/token"  (the Bookings API wants the tenant GUID -
 *          "mbx:<hex>@<domain>" answers 400/404. The page itself makes this same call.)
 *   B = /BookingsService/api/V1/bookingBusinessesc2/mbx:<hex>@<tenant GUID>
 *   GET B/          -> { businessInfo: { displayName, businessTimeZone (Windows id), schedulingPolicy } }
 *   GET B/services  -> { service: [{ serviceId, title, defaultDuration "PT30M", webUrl ".../s/<code>",
 *          isHiddenFromCustomers, bookingsSchedulingPolicy: { timeSlotInterval, minimumLeadTime,
 *          maximumAdvance } }] }
 *   POST B/getStaffAvailability  { staffIds: [STAFF], serviceId, startDateTime: { dateTime, timeZone },
 *          endDateTime }  -> { staffAvailabilityResponse: [{ availabilityItems: [{ status:
 *          "BOOKINGSAVAILABILITYSTATUS_AVAILABLE" | _BUSY | _OUT_OF_OFFICE, startDateTime, endDateTime }] }] }
 *   STAFF is a FIXED id written into Microsoft's own page code for every "Bookings with me" page
 *   (1c1c7887-...; any other id answers 500). Asked in timeZone "UTC", the answers come back in UTC;
 *   anything else comes back with a Windows display label ("(UTC+10:00) Brisbane") that does not say
 *   whether daylight saving applies - so the reader always asks in UTC and refuses any other label.
 *   AVAILABLE items are free RANGES, cut here into starts every timeSlotInterval of the service length.
 *   Several visible meeting types and no /s/<code> in the link -> falls open (never choose for the lead).
 *   Bookings BUSINESS pages (outlook.office365.com/book/<Name>@<domain>/, owa/calendar/.../bookings/)
 *   are recognised but not read - they choose between staff, and none has been seen from a lead yet. *
 * ONCEHUB (Ivan Ang, 4 Nov 2026: "https://go.oncehub.com/IvanAng" in his signature; worked out in Guy's
 * Chrome, then every call repeated from the page with cookies OMITTED and no "id" header - all answered).
 * Plain unauthenticated JSON POSTs on go.oncehub.com/api/:
 *
 *   POST get-data/GetLandingPageLayout  { linkname: "<page name>", tzstring: "<IANA>" [, serviceid] }
 *       -> { status: 200, userId (67-char token), settingsId, meetmeLinkId, team, PooledAvailabilityType,
 *            TimeZone (OnceHub's own number - 17 = Brisbane), serviceId (set when the link pre-picks one),
 *            userInfo: { name }, errorstring }
 *   POST get-data/GetServiceDetail  { settingsId }
 *       -> { serviceDetails: [{ serviceId, serviceName, serviceStatus, serviceDuration (a CODE, not
 *            minutes - 6 was 30 min, 4 was 20 min) }] }
 *   POST get-availability/calc-ts  { userId, settingsId, serviceId, meetmelinkid, teamId, pooledType,
 *            timeZoneId, startDate, endDate }   (dates are epoch ms)
 *       -> { success: true, data: { slots: { "2026-10-6": { duration: 30, am: [{ startTime (epoch ms,
 *            true UTC), timeStr }], pm: [...] } } } }
 *       The day keys count months from ZERO ("2026-10-6" is 6 NOVEMBER) - never read dates from the
 *       keys; startTime is the truth. The length comes from each day's "duration".
 *   Several meeting types and no pre-picked one: the reader takes the one that is plainly a first chat
 *   (coffee / intro / chat / discovery / meet) when EXACTLY ONE is, and says which it read; otherwise it
 *   falls open like the others (Guy, 4 Nov 2026 - Ivan's page: "Virtual Coffee Meeting" and
 *   "Confidential Strategy Session").
 */

const { DateTime } = require('luxon');

const MAX_RANGE_DAYS = 28;   // Calendly refuses ~7 weeks (35 worked, 49 did not); TidyCal gets the same paging to be safe
const CALENDLY_MAX_RANGE_DAYS = MAX_RANGE_DAYS;
const FETCH_TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const PROVIDER_LABELS = { calendly: 'Calendly', tidycal: 'TidyCal', timetrade: 'TimeTrade', msbookings: 'Microsoft Bookings', oncehub: 'OnceHub', google: 'Google appointment' };
const READABLE = 'Calendly, TidyCal, TimeTrade, Microsoft Bookings or OnceHub only';
// Microsoft Bookings: the hosts a "Bookings with me" / Bookings page is served from.
const MS_BOOKINGS_HOSTS = new Set(['outlook.office.com', 'outlook.office365.com', 'outlook.live.com', 'bookings.cloud.microsoft']);
const MS_BOOKINGS_API = 'https://bookings.cloud.microsoft/BookingsService/api/V1/bookingBusinessesc2';
// The one staff id Microsoft's own "Bookings with me" page sends for every personal page (read out of
// its code, 3 Nov 2026). Any other id answers 500.
const MS_BWM_STAFF_ID = '1c1c7887-e0fc-479b-ac7d-6983d0f026ff';
const MS_AVAILABLE = 'BOOKINGSAVAILABILITYSTATUS_AVAILABLE';
// Bookings is slow: 5-8 seconds a call on 3 Nov 2026 (the first read timed out at the usual 8).
const MS_TIMEOUT_MS = 20000;
// Windows time zone ids Bookings reports for its owners -> IANA (informational only; the slots are read in UTC).
const WINDOWS_TZ = {
  'E. Australia Standard Time': 'Australia/Brisbane', 'AUS Eastern Standard Time': 'Australia/Sydney', 'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin', 'W. Australia Standard Time': 'Australia/Perth', 'Tasmania Standard Time': 'Australia/Hobart',
  'New Zealand Standard Time': 'Pacific/Auckland', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Singapore Standard Time': 'Asia/Singapore', 'India Standard Time': 'Asia/Kolkata', 'Arabian Standard Time': 'Asia/Dubai',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles',
  UTC: 'UTC',
};
const ONCEHUB_API = 'https://go.oncehub.com/api';
// Meeting-type names that plainly mean "a first chat" - the one OnceHub type the reader may pick.
const FIRST_CHAT_RE = /\b(coffee|intro|introduction|introductory|chat|discovery|meet(?:\s+and\s+|\s*&\s*)greet|get(?:ting)?\s+to\s+know)\b/i;
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
  const m = String(text || '').match(/(?:https?:\/\/)?(?:www\.)?(?:calendly\.com\/|tidycal\.com\/|(?:[a-z0-9-]+\.)?timetrade\.com\/(?:book|app)\/|calendar\.app\.google\/|calendar\.google\.com\/(?:calendar\/)?appointments\/|(?:outlook\.office(?:365)?\.com|outlook\.live\.com|bookings\.cloud\.microsoft)\/(?:bookwithme\/user\/|book\/|owa\/calendar\/[^\s/]+\/booking)|go\.oncehub\.com\/)[^\s<>"')\]]+/i);
  if (!m) return null;
  let raw = m[0];
  // Microsoft Bookings (Michael Farag, 2026-11-03): the owner's domain is mixed case (52ndSolution.net)
  // and the query (?anonymous&ismsaljsauthenabled) is not needed, so a "Bookings with me" link is cut
  // back to mailbox id + domain - which also drops anything LinkedIn glued onto the end of the query.
  // The "@" may arrive as %40 or a full-width "＠" (as Michael's did).
  if (/^(?:https?:\/\/)?(?:www\.)?(?:outlook\.|bookings\.cloud\.microsoft)/i.test(raw)) {
    const bwm = raw.match(/^(?:https?:\/\/)?([^/]+)\/bookwithme\/user\/([0-9a-f]{32})(?:@|＠|%40)([A-Za-z0-9.-]+[A-Za-z0-9])/i);
    if (bwm) return `https://${bwm[1]}/bookwithme/user/${bwm[2].toLowerCase()}@${bwm[3]}`;
    raw = raw.replace(/[.,;:!?]+$/, '');
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }
  // LinkedIn's full-thread view glues the next line onto the link with no space between
  // ("…/consultationLook forward to chatting", Sam Trattles 2026-10-09, third run - the reader then
  // fetched a page that does not exist). Slugs on Calendly and TidyCal are lower case, so the path
  // ends at the first capital letter after the host. Google's codes are mixed case (Rt3HARJvfXUBpviz7)
  // and TimeTrade's are upper case (my.timetrade.com/book/V4KFJ), so those are left as matched.
  // OnceHub page names are mixed case too (go.oncehub.com/IvanAng): keep the first path segment whole
  // and drop anything after it except a ?serviceid= that pre-picks a meeting type.
  if (/^(?:https?:\/\/)?go\.oncehub\.com\//i.test(raw)) {
    const oh = raw.match(/^(?:https?:\/\/)?go\.oncehub\.com\/([A-Za-z0-9_.-]+)(?:\/[^?\s]*)?(\?[^\s]*)?/i);
    if (!oh) return null;
    const name = oh[1].replace(/[.]+$/, '');
    const sid = oh[2] && oh[2].match(/[?&]serviceid=([A-Za-z0-9=_-]+)/i);
    return `https://go.oncehub.com/${name}${sid ? `?serviceid=${sid[1]}` : ''}`;
  }
  if (!/calendar\.(?:app\.)?google|timetrade\.com/i.test(raw)) raw = raw.replace(/^((?:https?:\/\/)?[^/]+\/[^A-Z]*)[A-Z].*$/, '$1');
  raw = raw.replace(/[.,;:!?]+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Parse a booking link into its provider parts. A bare "tidycal.com/..." is read as https. */
function parseBookingLink(url) {
  let u;
  const str = String(url || '').trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(str) ? str : (/^(?:www\.)?(?:calendly\.com|tidycal\.com|(?:[a-z0-9-]+\.)?timetrade\.com|calendar\.app\.google|calendar\.google\.com|outlook\.office(?:365)?\.com|outlook\.live\.com|bookings\.cloud\.microsoft|go\.oncehub\.com)\//i.test(str) || isShortLink(str) ? `https://${str}` : str);
  try { u = new URL(withScheme.replace(/＠/g, '@')); } catch (_) { return { provider: null, url, reason: 'not a URL' }; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (MS_BOOKINGS_HOSTS.has(host)) return parseMsBookings(u, url);
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
  if (host === 'go.oncehub.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts[0] || /^(?:api|m|signin|login|support)$/i.test(parts[0])) return { provider: 'oncehub', url, reason: 'a OnceHub address that is not a booking page - ask for the booking link' };
    const sid = u.searchParams.get('serviceid') || u.searchParams.get('serviceId') || null;
    return { provider: 'oncehub', url, profileSlug: parts[0], eventSlug: sid };
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

/**
 * A Microsoft Bookings address -> its parts. Readable: "Bookings with me" pages (bookwithme/user/<hex>@
 * <domain>) and the per-meeting-type links they hand out (book/mbx:<hex>@<tenant GUID>/s/<code>).
 * Bookings BUSINESS pages are recognised (so the guards fire) but carry no slugs, so they fall open.
 */
function parseMsBookings(u, url) {
  const parts = u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch (_) { return p; } });
  if (parts[0] === 'bookwithme' && parts[1] === 'user' && parts[2]) {
    const m = parts[2].match(/^([0-9a-f]{32})@([A-Za-z0-9.-]+)$/i);
    if (m) return { provider: 'msbookings', url, profileSlug: m[1].toLowerCase(), eventSlug: null, domain: m[2] };
    return { provider: 'msbookings', url, reason: 'a Microsoft Bookings address without the owner\'s id - ask for the full booking link' };
  }
  if (parts[0] === 'book' && parts[1]) {
    const m = parts[1].match(/^mbx:([0-9a-f]{32})@([0-9a-f-]{36})$/i);
    if (m) return { provider: 'msbookings', url, profileSlug: m[1].toLowerCase(), eventSlug: parts[2] === 's' && parts[3] ? parts[3] : null, tenantId: m[2].toLowerCase() };
  }
  if (parts[0] === 'book' || (parts[0] === 'owa' && parts[1] === 'calendar' && /^bookings?$/i.test(parts[3] || ''))) {
    return { provider: 'msbookings', url, reason: `a Microsoft Bookings business page (it chooses between staff) - Wingguy reads personal "Bookings with me" pages only (${READABLE})` };
  }
  return { provider: null, url, reason: `${u.hostname} is not a booking page Wingguy can read yet (${READABLE})` };
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
async function fetchPage(url, fetchImpl, headers, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl ? ctrl.signal : undefined });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { /* html or empty */ }
    return { status: res.status, text: String(text || ''), body };
  } finally { if (timer) clearTimeout(timer); }
}

async function getJson(url, fetchImpl, timeoutMs) {
  return fetchPage(url, fetchImpl, { Accept: 'application/json', 'User-Agent': UA }, timeoutMs);
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
    if (parsed.provider === 'msbookings') return await readMsBookings(parsed, { timezone, start, end, fetchImpl });
    if (parsed.provider === 'oncehub') return await readOnceHub(parsed, { timezone, start, end, fetchImpl });
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

/** An ISO 8601 duration ("PT30M", "PT1H30M", "P90D") in minutes, or null. */
function isoDurationMins(s) {
  const m = String(s || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m || !m[0] || m[0].toUpperCase() === 'P' || m[0].toUpperCase() === 'PT') return null;
  return (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) + (Number(m[4] || 0) / 60);
}

/** A Bookings { dateTime, timeZone } that was asked for in UTC -> epoch ms, or NaN for any other zone. */
function msUtcMs(dt) {
  if (!dt || !dt.dateTime) return NaN;
  const tz = String(dt.timeZone || '');
  if (!/^(?:UTC|\(UTC\) Coordinated Universal Time|Coordinated Universal Time|\(UTC\).*)$/i.test(tz)) return NaN;
  return parseUtcStamp(String(dt.dateTime).slice(0, 19));
}

async function msPostJson(url, body, fetchImpl) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), MS_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'x-req-source': 'BookWithMe', 'User-Agent': UA }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: res.status, text: String(text || ''), body: json };
  } finally { if (timer) clearTimeout(timer); }
}

async function readMsBookings(parsed, { timezone, start, end, fetchImpl }) {
  // 1. The tenant GUID behind the owner's email domain - the same public lookup the page makes.
  let tenant = parsed.tenantId;
  if (!tenant) {
    const oid = await getJson(`https://login.microsoftonline.com/${encodeURIComponent(parsed.domain)}/.well-known/openid-configuration`, fetchImpl);
    const m = oid.body && String(oid.body.token_endpoint || oid.body.issuer || '').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (oid.status !== 200 || !m) return { ok: false, reason: `Microsoft did not recognise ${parsed.domain} as a Microsoft 365 organisation (HTTP ${oid.status})` };
    tenant = m[1].toLowerCase();
  }
  const base = `${MS_BOOKINGS_API}/mbx:${parsed.profileSlug}@${tenant}`;
  // 2. The owner (name, clock) and the meeting types on the page.
  const [biz, sv] = await Promise.all([getJson(`${base}/`, fetchImpl, MS_TIMEOUT_MS), getJson(`${base}/services`, fetchImpl, MS_TIMEOUT_MS)]);
  if (biz.status !== 200 || !biz.body || !biz.body.businessInfo) return { ok: false, reason: `Microsoft Bookings page lookup failed (HTTP ${biz.status})` };
  const info = biz.body.businessInfo;
  if (info.isPublished === false) return { ok: false, reason: 'the Microsoft Bookings page is switched off (not published)' };
  if (sv.status !== 200 || !sv.body || !Array.isArray(sv.body.service)) return { ok: false, reason: `Microsoft Bookings meeting types failed (HTTP ${sv.status})` };
  const visible = sv.body.service.filter((s) => s && s.serviceId && !s.isHiddenFromCustomers && !s.isPrivate);
  let service = null;
  if (parsed.eventSlug) {
    service = sv.body.service.find((s) => s && s.serviceId && String(s.webUrl || '').replace(/\/+$/, '').endsWith(`/s/${parsed.eventSlug}`)) || null;
    if (!service) return { ok: false, reason: 'the Microsoft Bookings link names a meeting type the page no longer offers' };
  } else if (visible.length === 1) {
    service = visible[0];
  } else {
    // Never choose for the lead (same rule as TimeTrade).
    return { ok: false, reason: visible.length ? `the Microsoft Bookings page offers ${visible.length} meeting types (${visible.map((s) => `"${s.title}"`).join(', ')}) and asks the visitor to choose one before it shows times` : 'the Microsoft Bookings page offers no meeting types' };
  }
  const policy = service.bookingsSchedulingPolicy || info.schedulingPolicy || {};
  const durationMins = isoDurationMins(service.defaultDuration) || 30;
  const stepMins = isoDurationMins(policy.timeSlotInterval) || durationMins;
  const preMs = (isoDurationMins(service.preBuffer) || 0) * 60000;
  const postMs = (isoDurationMins(service.postBuffer) || 0) * 60000;
  const earliest = Date.now() + (isoDurationMins(policy.minimumLeadTime) || 0) * 60000;
  const advance = isoDurationMins(policy.maximumAdvance);
  const latest = advance ? Date.now() + advance * 60000 : Infinity;
  // 3. Free ranges over the coach's window (whole days in the coach's clock), asked for in UTC so the
  //    answers come back in UTC too. The chunks go out together - each call takes seconds.
  const ranges = [];
  const chunks = [];
  for (let chunkStart = start; chunkStart <= end;) {
    const chunkEnd = [addDays(chunkStart, MAX_RANGE_DAYS - 1), end].sort()[0];
    chunks.push([chunkStart, chunkEnd]);
    chunkStart = addDays(chunkEnd, 1);
  }
  const answers = await Promise.all(chunks.map(([chunkStart, chunkEnd]) => {
    const from = DateTime.fromISO(chunkStart, { zone: timezone }).startOf('day').toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss");
    const to = DateTime.fromISO(chunkEnd, { zone: timezone }).endOf('day').toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss");
    return msPostJson(`${base}/getStaffAvailability`, { staffIds: [MS_BWM_STAFF_ID], startDateTime: { dateTime: from, timeZone: 'UTC' }, endDateTime: { dateTime: to, timeZone: 'UTC' }, serviceId: service.serviceId }, fetchImpl);
  }));
  for (const av of answers) {
    const list = av.body && Array.isArray(av.body.staffAvailabilityResponse) ? av.body.staffAvailabilityResponse : null;
    if (av.status !== 200 || !list) return { ok: false, reason: `Microsoft Bookings availability failed (HTTP ${av.status})` };
    for (const staff of list) {
      for (const item of (staff && Array.isArray(staff.availabilityItems) ? staff.availabilityItems : [])) {
        if (!item || item.status !== MS_AVAILABLE) continue;
        const s = msUtcMs(item.startDateTime);
        const e = msUtcMs(item.endDateTime);
        if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, reason: `Microsoft Bookings answered in a time zone Wingguy cannot pin down ("${(item.startDateTime && item.startDateTime.timeZone) || 'none'}")` };
        if (e > s) ranges.push([s, e]);
      }
    }
  }
  // 4. Merge touching ranges, then cut each into start times on the page's own grid.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const lenMs = durationMins * 60000;
  const stepMs = stepMins * 60000;
  const slots = [];
  for (const [s, e] of merged) {
    for (let t = s + preMs; t + lenMs + postMs <= e; t += stepMs) {
      if (t >= earliest && t <= latest) slots.push(new Date(t).toISOString());
    }
  }
  return {
    ok: true,
    provider: 'msbookings',
    eventName: service.title || '',
    ownerName: info.displayName || '',
    durationMins,
    leadTimezone: WINDOWS_TZ[info.businessTimeZone] || null,
    slots: [...new Set(slots)].sort(),
  };
}

async function ohPost(path, body, fetchImpl) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    // The page sends an "id" header (time-random-random); the API answered without it on 4 Nov 2026,
    // but it is cheap to look like the page.
    const id = `${Date.now()}-${Math.floor(1e6 * Math.random())}-${Math.floor(1e6 * Math.random())}`;
    const res = await fetchImpl(`${ONCEHUB_API}/${path}`, { method: 'POST', headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json', id, Origin: 'https://go.oncehub.com', 'User-Agent': UA }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: res.status, text: String(text || ''), body: json };
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * Which OnceHub meeting type to read. A link that pre-picks one wins; one live type is read; several
 * -> the one that is plainly a first chat when exactly one is (Guy, 4 Nov 2026), else none.
 * Returns { service, chosen } or { reason }.
 */
function pickOnceHubService(services, wantedId) {
  const live = (services || []).filter((s) => s && s.serviceId && (s.serviceStatus == null || Number(s.serviceStatus) === 1));
  if (wantedId) {
    const hit = (services || []).find((s) => s && String(s.serviceId) === String(wantedId));
    return hit ? { service: hit, chosen: false } : { reason: 'the OnceHub link names a meeting type the page no longer offers' };
  }
  if (live.length === 1) return { service: live[0], chosen: false };
  if (!live.length) return { reason: 'the OnceHub page offers no meeting types' };
  const firstChat = live.filter((s) => FIRST_CHAT_RE.test(String(s.serviceName || '')));
  if (firstChat.length === 1) return { service: firstChat[0], chosen: true };
  return { reason: `the OnceHub page offers ${live.length} meeting types (${live.map((s) => `"${s.serviceName}"`).join(', ')}) and asks the visitor to choose one before it shows times` };
}

async function readOnceHub(parsed, { timezone, start, end, fetchImpl }) {
  // 1. The page: who owns it and the ids every later call keys on.
  const lpBody = { linkname: parsed.profileSlug, tzstring: timezone };
  if (parsed.eventSlug) lpBody.serviceid = parsed.eventSlug;
  const lp = await ohPost('get-data/GetLandingPageLayout', lpBody, fetchImpl);
  const page = lp.body;
  if (lp.status !== 200 || !page || typeof page !== 'object') return { ok: false, reason: `OnceHub page lookup failed (HTTP ${lp.status})` };
  if (!page.userId || !page.settingsId) return { ok: false, reason: page.errorstring ? `OnceHub says: ${page.errorstring}` : 'OnceHub did not recognise that booking page' };
  // 2. The meeting types on the page.
  const sd = await ohPost('get-data/GetServiceDetail', { settingsId: page.settingsId }, fetchImpl);
  const services = sd.body && Array.isArray(sd.body.serviceDetails) ? sd.body.serviceDetails : null;
  if (sd.status !== 200 || !services) return { ok: false, reason: `OnceHub meeting types failed (HTTP ${sd.status})` };
  const pick = pickOnceHubService(services, parsed.eventSlug || page.serviceId || null);
  if (!pick.service) return { ok: false, reason: pick.reason };
  const service = pick.service;
  // 3. Open start times over the coach's window (whole days in the coach's clock).
  const fromMs = DateTime.fromISO(start, { zone: timezone }).startOf('day').toMillis();
  const toMs = DateTime.fromISO(end, { zone: timezone }).endOf('day').toMillis();
  const slots = [];
  let durationMins = null;
  for (let chunkStart = start; chunkStart <= end;) {
    const chunkEnd = [addDays(chunkStart, MAX_RANGE_DAYS - 1), end].sort()[0];
    const av = await ohPost('get-availability/calc-ts', {
      userId: page.userId,
      settingsId: page.settingsId,
      serviceId: service.serviceId,
      meetmelinkid: page.meetmeLinkId || '',
      teamId: page.team != null ? page.team : -1,
      pooledType: page.PooledAvailabilityType != null ? page.PooledAvailabilityType : -1,
      timeZoneId: page.TimeZone != null ? page.TimeZone : 17,
      startDate: DateTime.fromISO(chunkStart, { zone: timezone }).startOf('day').toMillis(),
      endDate: DateTime.fromISO(chunkEnd, { zone: timezone }).endOf('day').toMillis(),
    }, fetchImpl);
    const data = av.body && av.body.data;
    if (av.status !== 200 || !av.body || av.body.success === false || !data || typeof data.slots !== 'object') return { ok: false, reason: `OnceHub availability failed (HTTP ${av.status})` };
    for (const day of Object.values(data.slots || {})) {
      if (!day || typeof day !== 'object') continue;
      if (!durationMins && Number(day.duration) > 0) durationMins = Number(day.duration);
      // am / pm (and any other part of the day OnceHub adds) - every array of { startTime }.
      for (const list of Object.values(day)) {
        if (!Array.isArray(list)) continue;
        for (const spot of list) {
          const ms = Number(spot && spot.startTime);
          if (Number.isFinite(ms) && ms >= fromMs && ms <= toMs) slots.push(new Date(ms).toISOString());
        }
      }
    }
    chunkStart = addDays(chunkEnd, 1);
  }
  return {
    ok: true,
    provider: 'oncehub',
    eventName: service.serviceName || '',
    eventChosen: pick.chosen || undefined,
    ownerName: (page.userInfo && page.userInfo.name) || '',
    durationMins: durationMins || 30,
    leadTimezone: null, // OnceHub reports its own zone number, not an IANA name
    slots: [...new Set(slots)].sort(),
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
