/**
 * Regression tests for the lead booking-link reader (2026-09-15, Candace Ngok: "here's a link to
 * my calendar ... send me an invite separately if 30 mins doesn't work").
 *
 * What is proven here, with no network:
 *  - a Calendly link is found in message text and parsed; share links / other hosts are refused
 *  - the reader pages Calendly in 28-day chunks, returns sorted unique ISO slots, and NEVER throws
 *  - the lead's 15-minute-grid spots merge into free intervals, and only coach slots that fit
 *    wholly inside one survive the intersection
 *  - wingguy_check_availability: not_before removes earlier days and switches off fallback flags;
 *    lead_booking_link narrows the slots to the overlap and says so; an unreadable link keeps the
 *    coach's slots and says THAT instead
 *  - TidyCal (Sam Trattles, 2026-10-09): the link is found and parsed, the three-call recipe runs
 *    with browser headers and the SHORT booking-type code, slots come back in UTC over the coach's
 *    window, and a 405 / Cloudflare bot check / missing code all degrade to { ok:false, reason }
 *  - the unreadable-link line names the provider and tells the model to offer the coach's own times,
 *    never to promise the lead a booking through their page
 *
 * Run: node tests/wingguy-lead-booking-link.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const link = require('../services/wingguyLeadBookingLink');
const wingguyCalendar = require('../services/wingguyCalendar');
const { runCheckAvailability } = require('../services/wingguyBookingMcp');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

console.log('finding and parsing the link:');
const candace = "I'm away in the next 1.5 week but happy to connect when I return. Here's a link to my calendar; feel free to send me an invite separately if 30-mins doesn't work https://calendly.com/candacengok/intro\n\nCheers,\nCandace";
check('the Calendly link is pulled out of a LinkedIn message', () => assert.strictEqual(link.findBookingLink(candace), 'https://calendly.com/candacengok/intro'));
check('a trailing full stop is not part of the link', () => assert.strictEqual(link.findBookingLink('book here https://calendly.com/a/b.'), 'https://calendly.com/a/b'));
check('no link → null', () => assert.strictEqual(link.findBookingLink('see you Tuesday'), null));
check('profile + event parse', () => assert.deepStrictEqual(link.parseBookingLink('https://calendly.com/candacengok/intro?month=2026-09'), { provider: 'calendly', url: 'https://calendly.com/candacengok/intro?month=2026-09', profileSlug: 'candacengok', eventSlug: 'intro' }));
check('a share link (calendly.com/d/...) is refused with a reason', () => { const p = link.parseBookingLink('https://calendly.com/d/3yp-4qk-rww/introductory-call'); assert.strictEqual(p.provider, 'calendly'); assert.ok(!p.profileSlug); assert.match(p.reason, /share link/); });
check('a bare profile page is refused', () => assert.match(link.parseBookingLink('https://calendly.com/candacengok').reason, /pick an event/));
check('another host is refused, naming it', () => { const p = link.parseBookingLink('https://cal.com/someone/30min'); assert.strictEqual(p.provider, null); assert.match(p.reason, /cal\.com/); });
check('junk is refused, not thrown', () => assert.strictEqual(link.parseBookingLink('not a url').provider, null));

console.log('TidyCal: finding and parsing (Sam Trattles, 2026-10-09):');
const SAM = 'Hi Guy, happy to chat. Grab a time that suits here: https://tidycal.com/thepowertoask/consultation. Cheers, Sam';
const TIDY_PAGE = 'https://tidycal.com/thepowertoask/consultation';
check('a TidyCal link is pulled out of a LinkedIn message, trailing full stop dropped', () => assert.strictEqual(link.findBookingLink(SAM), TIDY_PAGE));
check('profile + booking type parse, with the clean page address', () => assert.deepStrictEqual(link.parseBookingLink('https://www.tidycal.com/thepowertoask/consultation?month=2026-10#x'), { provider: 'tidycal', url: 'https://www.tidycal.com/thepowertoask/consultation?month=2026-10#x', profileSlug: 'thepowertoask', eventSlug: 'consultation', pageUrl: TIDY_PAGE }));
check('a bare TidyCal profile page is refused', () => { const p = link.parseBookingLink('https://tidycal.com/thepowertoask'); assert.strictEqual(p.provider, 'tidycal'); assert.ok(!p.profileSlug); assert.match(p.reason, /pick one/); });
check('an internal booking-types address is refused', () => assert.match(link.parseBookingLink('https://tidycal.com/booking-types/1rlrxwx').reason, /internal TidyCal address/));
// The full-thread view on LinkedIn showed Sam's link with no https:// (second run, 9 Oct 2026).
check('a link with no https:// is still found, and comes back with it', () => assert.strictEqual(link.findBookingLink('here is a link to my diary: tidycal.com/thepowertoask/consultation\n\nLook forward to chatting'), TIDY_PAGE));
// Third run, 9 Oct 2026: LinkedIn's full-thread view glued the next line straight onto the link.
check('the next line glued onto the link is cut off at its capital letter', () => assert.strictEqual(link.findBookingLink("To make it easy here's a link to my diary: https://tidycal.com/thepowertoask/consultationLook forward to chatting. :-)"), TIDY_PAGE));
check('a glued bare link is cut off too', () => assert.strictEqual(link.findBookingLink('diary: tidycal.com/thepowertoask/consultationLook forward'), TIDY_PAGE));
check('a query string survives the cut', () => assert.strictEqual(link.findBookingLink('https://calendly.com/candacengok/intro?month=2026-10 thanks'), 'https://calendly.com/candacengok/intro?month=2026-10'));
check('a bare www. Calendly link is found too', () => assert.strictEqual(link.findBookingLink('book me at www.calendly.com/candacengok/intro.'), 'https://www.calendly.com/candacengok/intro'));
check('a bare TidyCal address parses as https', () => assert.strictEqual(link.parseBookingLink('tidycal.com/thepowertoask/consultation').pageUrl, TIDY_PAGE));
check('a bare Calendly address parses', () => assert.strictEqual(link.parseBookingLink('calendly.com/candacengok/intro').eventSlug, 'intro'));
check('plain words are still not a link', () => assert.strictEqual(link.findBookingLink('see you on calendly sometime'), null));
check('the other-host reason now names both providers', () => assert.match(link.parseBookingLink('https://cal.com/someone/30min').reason, /Calendly or TidyCal only/));
check('providerLabel: Calendly / TidyCal / booking', () => { assert.strictEqual(link.providerLabel('calendly'), 'Calendly'); assert.strictEqual(link.providerLabel('tidycal'), 'TidyCal'); assert.strictEqual(link.providerLabel(null), 'booking'); });

console.log('reading Calendly (fake fetch):');
const fakeFetch = (calls, { lookupStatus = 200, rangeStatus = 200, spots = {} } = {}) => async (url) => {
  calls.push(url);
  const u = new URL(url);
  if (u.pathname.endsWith('/lookup')) {
    return { status: lookupStatus, text: async () => JSON.stringify({ uuid: 'UUID-1', duration: 30, name: 'Introductory Call', availability_timezone: 'Australia/Sydney', profile: { name: 'Candace Ngok' }, scheduling_link: { uid: 'LINK-1' } }) };
  }
  const start = u.searchParams.get('range_start'), end = u.searchParams.get('range_end');
  const days = Object.entries(spots).filter(([d]) => d >= start && d <= end).map(([date, times]) => ({ date, status: 'available', spots: times.map((t) => ({ status: 'available', start_time: t })) }));
  return { status: rangeStatus, text: async () => JSON.stringify({ days }) };
};
(async () => {
  await checkAsync('two calls, the range carries timezone + scheduling link, slots come back sorted and unique', async () => {
    const calls = [];
    const r = await link.readBookingLink('https://calendly.com/candacengok/intro', { timezone: 'Australia/Brisbane', rangeStart: '2026-09-15', rangeEnd: '2026-09-30', fetchImpl: fakeFetch(calls, { spots: { '2026-09-29': ['2026-09-29T13:15:00+10:00', '2026-09-29T12:45:00+10:00', '2026-09-29T12:45:00+10:00'] } }) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(calls.length, 2);
    assert.match(calls[0], /lookup\?event_type_slug=intro&profile_slug=candacengok/);
    assert.match(calls[1], /event_types\/UUID-1\/calendar\/range\?timezone=Australia%2FBrisbane.*range_start=2026-09-15&range_end=2026-09-30&scheduling_link_uuid=LINK-1/);
    assert.deepStrictEqual(r.slots, ['2026-09-29T02:45:00.000Z', '2026-09-29T03:15:00.000Z']);
    assert.strictEqual(r.ownerName, 'Candace Ngok'); assert.strictEqual(r.eventName, 'Introductory Call'); assert.strictEqual(r.durationMins, 30); assert.strictEqual(r.leadTimezone, 'Australia/Sydney');
  });
  await checkAsync('a 7-week window is paged in 28-day chunks (Calendly refuses longer ranges)', async () => {
    const calls = [];
    const r = await link.readBookingLink('https://calendly.com/candacengok/intro', { rangeStart: '2026-09-15', rangeEnd: '2026-11-02', fetchImpl: fakeFetch(calls) });
    assert.strictEqual(r.ok, true);
    const ranges = calls.slice(1).map((c) => { const u = new URL(c); return [u.searchParams.get('range_start'), u.searchParams.get('range_end')]; });
    assert.deepStrictEqual(ranges, [['2026-09-15', '2026-10-12'], ['2026-10-13', '2026-11-02']]);
  });
  await checkAsync('lookup failure → ok:false with the status, no throw', async () => {
    const r = await link.readBookingLink('https://calendly.com/x/y', { fetchImpl: fakeFetch([], { lookupStatus: 404 }) });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /lookup failed \(HTTP 404\)/);
  });
  await checkAsync('range failure → ok:false, no throw', async () => {
    const r = await link.readBookingLink('https://calendly.com/x/y', { rangeStart: '2026-09-15', rangeEnd: '2026-09-20', fetchImpl: fakeFetch([], { rangeStatus: 400 }) });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /availability failed \(HTTP 400\)/);
  });
  await checkAsync('fetch throwing → ok:false, no throw', async () => {
    const r = await link.readBookingLink('https://calendly.com/x/y', { fetchImpl: async () => { throw new Error('boom'); } });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /boom/);
  });
  await checkAsync('an unreadable link never reaches the network', async () => {
    const calls = [];
    const r = await link.readBookingLink('https://calendly.com/d/abc/intro', { fetchImpl: fakeFetch(calls) });
    assert.strictEqual(r.ok, false); assert.strictEqual(calls.length, 0);
  });

  // TidyCal (fake fetch). The three responses below follow the shapes Guy recorded with curl on
  // 9 Oct 2026 (bookingType fields, booking-types/<code> in the page, the available-bookings array)
  // - the recipe's field names, not captured bytes, so the live read from Render is still to prove.
  console.log('reading TidyCal (fake fetch):');
  const TIDY_JSON = { bookingType: { id: 1580287, title: 'Consultation', duration_minutes: 15, padding_minutes: 30, url_slug: 'consultation' } };
  const TIDY_HTML = '<!DOCTYPE html><html><head><title>Consultation</title></head><body><div id="app"></div><script>window.__tidy={"availableBookingsUrl":"https://tidycal.com/booking-types/1rlrxwx/available-bookings"}</script></body></html>';
  const TIDY_SLOTS = [
    { starts_at: '2026-10-15T00:00:00.000000Z', ends_at: '2026-10-15T00:15:00.000000Z', available_bookings: 1 },
    { starts_at: '2026-10-14T23:45:00.000000Z', ends_at: '2026-10-15T00:00:00.000000Z', available_bookings: 1 },
    { starts_at: '2026-10-14T23:45:00.000000Z', ends_at: '2026-10-15T00:00:00.000000Z', available_bookings: 1 }, // duplicate
    { starts_at: '2026-10-15 03:00:00', ends_at: '2026-10-15 03:15:00', available_bookings: 1 },               // Laravel shape: UTC, no marker
    { starts_at: '2026-10-15T05:00:00.000000Z', ends_at: '2026-10-15T05:15:00.000000Z', available_bookings: 0 }, // full
  ];
  const CF_CHALLENGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script><div id="cf-chl-widget"></div></body></html>';
  const fakeTidy = (calls, { jsonStatus = 200, jsonText = null, htmlStatus = 200, html = TIDY_HTML, slotsStatus = 200, slots = TIDY_SLOTS } = {}) => async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    if (url === `${TIDY_PAGE}?json`) return { status: jsonStatus, text: async () => (jsonText != null ? jsonText : JSON.stringify(TIDY_JSON)) };
    if (url === TIDY_PAGE) return { status: htmlStatus, text: async () => html };
    if (url.includes('/available-bookings')) return { status: slotsStatus, text: async () => (slotsStatus === 200 ? JSON.stringify(slots) : 'Method Not Allowed') };
    throw new Error(`unexpected call ${url}`);
  };
  const jsonHeadersOk = (h) => { assert.strictEqual(h.Accept, 'application/json'); assert.strictEqual(h['X-Requested-With'], 'XMLHttpRequest'); assert.strictEqual(h.Referer, TIDY_PAGE); assert.match(h['User-Agent'], /^Mozilla\/5\.0/); };
  await checkAsync('three calls: ?json, the HTML page, then available-bookings by SHORT code, browser headers on, UTC window, slots sorted/unique/pinned to UTC', async () => {
    const calls = [];
    const r = await link.readBookingLink(TIDY_PAGE, { timezone: 'Australia/Brisbane', rangeStart: '2026-10-14', rangeEnd: '2026-10-20', fetchImpl: fakeTidy(calls) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(calls.length, 3, JSON.stringify(calls.map((c) => c.url)));
    assert.strictEqual(calls[0].url, `${TIDY_PAGE}?json`); jsonHeadersOk(calls[0].headers);
    assert.strictEqual(calls[1].url, TIDY_PAGE); assert.match(calls[1].headers.Accept, /text\/html/); assert.match(calls[1].headers['User-Agent'], /^Mozilla\/5\.0/);
    const u = new URL(calls[2].url);
    assert.strictEqual(u.pathname, '/booking-types/1rlrxwx/available-bookings', calls[2].url);
    assert.ok(!calls[2].url.includes('1580287'), 'the numeric id must not be used for slots');
    assert.strictEqual(u.searchParams.get('start'), '2026-10-13T14:00:00.000Z'); // 2026-10-14 00:00 Brisbane
    assert.strictEqual(u.searchParams.get('end'), '2026-10-20T13:59:59.999Z');   // 2026-10-20 23:59 Brisbane
    jsonHeadersOk(calls[2].headers);
    assert.strictEqual(r.provider, 'tidycal'); assert.strictEqual(r.eventName, 'Consultation'); assert.strictEqual(r.durationMins, 15);
    assert.deepStrictEqual(r.slots, ['2026-10-14T23:45:00.000Z', '2026-10-15T00:00:00.000Z', '2026-10-15T03:00:00.000Z']);
  });
  await checkAsync('the short code already in the ?json text skips the HTML read', async () => {
    const calls = [];
    const jsonText = JSON.stringify({ ...TIDY_JSON, links: { availableBookings: 'https://tidycal.com/booking-types/1rlrxwx/available-bookings' } });
    const r = await link.readBookingLink(TIDY_PAGE, { rangeStart: '2026-10-14', rangeEnd: '2026-10-20', fetchImpl: fakeTidy(calls, { jsonText }) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(calls.map((c) => c.url.replace(/\?start=.*$/, '')), [`${TIDY_PAGE}?json`, 'https://tidycal.com/booking-types/1rlrxwx/available-bookings']);
  });
  await checkAsync('a 7-week window is paged in 28-day chunks, each chunk whole days in the coach\'s clock', async () => {
    const calls = [];
    const r = await link.readBookingLink(TIDY_PAGE, { timezone: 'Australia/Brisbane', rangeStart: '2026-10-14', rangeEnd: '2026-12-01', fetchImpl: fakeTidy(calls) });
    assert.strictEqual(r.ok, true);
    const ranges = calls.filter((c) => c.url.includes('/available-bookings')).map((c) => { const u = new URL(c.url); return [u.searchParams.get('start'), u.searchParams.get('end')]; });
    assert.deepStrictEqual(ranges, [['2026-10-13T14:00:00.000Z', '2026-11-10T13:59:59.999Z'], ['2026-11-10T14:00:00.000Z', '2026-12-01T13:59:59.999Z']]);
  });
  await checkAsync('slots answering 405 (the headers were wrong) → ok:false with the status', async () => {
    const r = await link.readBookingLink(TIDY_PAGE, { rangeStart: '2026-10-14', rangeEnd: '2026-10-20', fetchImpl: fakeTidy([], { slotsStatus: 405 }) });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /TidyCal availability failed \(HTTP 405\)/);
  });
  await checkAsync('a Cloudflare bot-check page instead of JSON → ok:false naming the bot check, nothing else called', async () => {
    const calls = [];
    const r = await link.readBookingLink(TIDY_PAGE, { fetchImpl: fakeTidy(calls, { jsonStatus: 403, jsonText: CF_CHALLENGE }) });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /Cloudflare bot check/); assert.strictEqual(calls.length, 1);
  });
  await checkAsync('page lookup 404 → ok:false with the status', async () => {
    const r = await link.readBookingLink(TIDY_PAGE, { fetchImpl: fakeTidy([], { jsonStatus: 404, jsonText: '{}' }) });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /page lookup failed \(HTTP 404\)/);
  });
  await checkAsync('JSON without a bookingType → ok:false', async () => {
    const r = await link.readBookingLink(TIDY_PAGE, { fetchImpl: fakeTidy([], { jsonText: '{"ok":true}' }) });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /no booking type/);
  });
  await checkAsync('HTML with no booking-types code → ok:false, no slots call', async () => {
    const calls = [];
    const r = await link.readBookingLink(TIDY_PAGE, { fetchImpl: fakeTidy(calls, { html: '<html><body>nothing here</body></html>' }) });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /no booking-type code/); assert.strictEqual(calls.length, 2);
  });
  await checkAsync('fetch throwing on TidyCal → ok:false, no throw', async () => {
    const r = await link.readBookingLink(TIDY_PAGE, { fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /ECONNRESET/);
  });

  console.log('intersection:');
  check('15-minute-grid spots merge into one free interval', () => {
    // Candace's real shape: 12:45, 13:15, 13:45, 14:15 (30 min each) = free 12:45-14:45
    const iv = link.leadFreeIntervals(['2026-09-29T02:45:00Z', '2026-09-29T03:15:00Z', '2026-09-29T03:45:00Z', '2026-09-29T04:15:00Z', '2026-09-29T11:15:00Z'], 30);
    assert.deepStrictEqual(iv.map(([s, e]) => [new Date(s).toISOString(), new Date(e).toISOString()]), [['2026-09-29T02:45:00.000Z', '2026-09-29T04:45:00.000Z'], ['2026-09-29T11:15:00.000Z', '2026-09-29T11:45:00.000Z']]);
  });
  check('only coach slots that fit WHOLLY inside the lead\'s free time survive; empty days drop', () => {
    const filtered = { yourTimezone: 'Australia/Brisbane', days: [
      { date: '2026-09-29', freeSlots: [{ time: '2026-09-29T00:00:00.000Z', label: '10:00' }, { time: '2026-09-29T03:30:00.000Z', label: '1:30 pm' }, { time: '2026-09-29T04:00:00.000Z', label: '2:00 pm' }, { time: '2026-09-29T04:30:00.000Z', label: '2:30 pm' }] },
      { date: '2026-09-30', freeSlots: [{ time: '2026-09-30T00:00:00.000Z', label: '10:00' }] },
    ] };
    const lead = { slots: ['2026-09-29T02:45:00Z', '2026-09-29T03:15:00Z', '2026-09-29T03:45:00Z', '2026-09-29T04:15:00Z'], durationMins: 30 };
    const out = link.intersectAvailability(filtered, lead, { meetingMins: 30 });
    assert.deepStrictEqual(out.days.map((d) => [d.date, d.freeSlots.map((s) => s.label)]), [['2026-09-29', ['1:30 pm', '2:00 pm']]]);
    assert.strictEqual(out.leadLinkSlotsBefore, 5);
    assert.strictEqual(out.yourTimezone, 'Australia/Brisbane');
  });
  check('the fit length is the SMALLER of the coach\'s meeting and the lead\'s event (a 60/90-minute coach meeting fits where the lead offers 30)', () => {
    // Until 9 Oct 2026 this demanded the coach's whole meeting inside the lead's run (the 90-minute
    // case used to drop the 1:30). That rule threw away every TidyCal slot - see the Sam Trattles
    // check below - so now the lead's own event length caps the fit test.
    const filtered = { days: [{ date: '2026-09-29', freeSlots: [{ time: '2026-09-29T03:30:00.000Z', label: '1:30 pm' }, { time: '2026-09-29T02:45:00.000Z', label: '12:45' }, { time: '2026-09-29T04:30:00.000Z', label: '2:30 pm' }] }] };
    const lead = { slots: ['2026-09-29T02:45:00Z', '2026-09-29T03:15:00Z', '2026-09-29T03:45:00Z', '2026-09-29T04:15:00Z'], durationMins: 30 }; // free 12:45-14:45
    const out = link.intersectAvailability(filtered, lead, { meetingMins: 60 });
    assert.deepStrictEqual(out.days[0].freeSlots.map((s) => s.label), ['1:30 pm', '12:45']); // 2:30 + 30 min overruns 2:45
    assert.strictEqual(out.fitMins, 30); assert.strictEqual(out.leadSlotMins, 30); assert.strictEqual(out.leadSlotsShorter, true);
    const out2 = link.intersectAvailability(filtered, lead, { meetingMins: 90 });
    assert.deepStrictEqual(out2.days[0].freeSlots.map((s) => s.label), ['1:30 pm', '12:45']);
    const same = link.intersectAvailability(filtered, lead, { meetingMins: 30 });
    assert.strictEqual(same.fitMins, 30); assert.strictEqual(same.leadSlotsShorter, false);
  });
  check('Sam Trattles\'s TidyCal shape: isolated 15-minute slots on the hour, coach at 30-minute steps, coach meeting 30 → the on-the-hour matches survive (live 9 Oct 2026: 0 of 7 came back)', () => {
    // Sam: one 15-minute slot on each hour, 8am-4pm Sydney (UTC+11), padding 30 -> no slot touches another.
    const leadSlots = [];
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-16']) for (let h = 21; h <= 23; h++) leadSlots.push(`${day === '2026-10-12' ? '2026-10-11' : day === '2026-10-13' ? '2026-10-12' : '2026-10-15'}T${String(h).padStart(2, '0')}:00:00Z`);
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-16']) for (let h = 0; h <= 5; h++) leadSlots.push(`${day}T0${h}:00:00Z`);
    const lead = { slots: leadSlots, durationMins: 15 };
    // Guy's offerable slots that week at 30-minute steps (the seven the peer check expected are on the hour).
    const mk = (iso) => ({ time: iso, label: iso });
    const filtered = { days: [
      { date: '2026-10-12', freeSlots: ['2026-10-12T01:00:00.000Z', '2026-10-12T01:30:00.000Z', '2026-10-12T04:00:00.000Z', '2026-10-12T04:30:00.000Z'].map(mk) },
      { date: '2026-10-13', freeSlots: ['2026-10-13T01:00:00.000Z', '2026-10-13T02:30:00.000Z'].map(mk) },
      { date: '2026-10-14', freeSlots: ['2026-10-14T00:30:00.000Z', '2026-10-14T03:30:00.000Z'].map(mk) },
      { date: '2026-10-16', freeSlots: ['2026-10-16T00:00:00.000Z', '2026-10-16T01:00:00.000Z', '2026-10-16T03:00:00.000Z', '2026-10-16T04:00:00.000Z', '2026-10-16T05:30:00.000Z'].map(mk) },
    ] };
    const out = link.intersectAvailability(filtered, lead, { meetingMins: 30 });
    assert.deepStrictEqual(out.days.map((d) => [d.date, d.freeSlots.map((s) => s.time)]), [
      ['2026-10-12', ['2026-10-12T01:00:00.000Z', '2026-10-12T04:00:00.000Z']],
      ['2026-10-13', ['2026-10-13T01:00:00.000Z']],
      ['2026-10-16', ['2026-10-16T00:00:00.000Z', '2026-10-16T01:00:00.000Z', '2026-10-16T03:00:00.000Z', '2026-10-16T04:00:00.000Z']],
    ]);
    assert.strictEqual(out.fitMins, 15); assert.strictEqual(out.leadSlotMins, 15); assert.strictEqual(out.leadSlotsShorter, true);
    assert.strictEqual(out.leadLinkSlotsBefore, 13);
  });

  console.log('wingguy_check_availability with not_before + lead_booking_link:');
  // Fixture: weekdays from 3 days out for 5 weeks, three coach slots a day (10:00, 1:30, 2:00 Brisbane).
  const tz = 'Australia/Brisbane';
  const days = [];
  for (let i = 3; i < 38; i++) {
    const d = DateTime.now().setZone(tz).plus({ days: i });
    if (d.weekday >= 6) continue;
    const date = d.toFormat('yyyy-MM-dd');
    const slot = (h, m) => { const t = DateTime.fromObject({ year: d.year, month: d.month, day: d.day, hour: h, minute: m }, { zone: tz }); return { time: t.toUTC().toISO(), display: t.toFormat('h:mm a').toLowerCase(), leadDisplay: t.toFormat('h:mm a').toLowerCase() }; };
    days.push({ date, day: d.toFormat('ccc d'), meetingCount: 1, freeSlots: [slot(10, 0), slot(13, 30), slot(14, 0)] });
  }
  const origGet = wingguyCalendar.getAvailabilityForCoach;
  wingguyCalendar.getAvailabilityForCoach = async () => ({ yourTimezone: tz, leadTimezone: tz, leadLocation: 'Brisbane', leadTzDetected: true, days });
  try {
    const notBefore = days[7].date; // well past next week
    await checkAsync('not_before drops earlier days, lifts the fallback flags, and says so', async () => {
      const r = await runCheckAvailability({ not_before: notBefore }, 'Guy-Wilson');
      const dates = [...r.text.matchAll(/^(\d{4}-\d{2}-\d{2}) \(/gm)].map((m) => m[1]);
      assert.ok(dates.length > 0, 'no days returned');
      assert.ok(dates.every((d) => d >= notBefore), `a day before ${notBefore} leaked: ${dates[0]}`);
      assert.ok(!/FALLBACK WEEK —/.test(r.text), 'fallback flags should be off when not_before is set');
      assert.match(r.text, new RegExp(`Days before ${notBefore} were removed`));
    });
    await checkAsync('a readable lead link narrows the slots to the overlap and tells the model to book ONE', async () => {
      const target = days[8];
      const readBookingLink = async (url, opts) => {
        assert.strictEqual(url, 'https://calendly.com/candacengok/intro');
        assert.strictEqual(opts.timezone, tz); assert.strictEqual(opts.rangeStart, notBefore);
        // lead free 1:15-2:15 that day only -> coach 1:30 fits, 2:00 does not, 10:00 does not
        const t = DateTime.fromISO(target.freeSlots[1].time).minus({ minutes: 15 });
        return { ok: true, ownerName: 'Candace Ngok', eventName: 'Introductory Call', durationMins: 30, slots: [t.toISO(), t.plus({ minutes: 30 }).toISO()] };
      };
      const r = await runCheckAvailability({ not_before: notBefore, lead_booking_link: 'https://calendly.com/candacengok/intro' }, 'Guy-Wilson', { readBookingLink });
      assert.match(r.text, /LEAD'S OWN CALENDAR READ: Candace Ngok's Calendly page \("Introductory Call", 30 min\) offered 2 slots/);
      assert.match(r.text, /pick ONE/);
      const slotLines = r.text.split('\n').filter((l) => /label=/.test(l));
      assert.strictEqual(slotLines.length, 1, r.text);
      assert.ok(slotLines[0].includes(target.freeSlots[1].time), slotLines[0]);
    });
    await checkAsync('no overlap → a plain "both free" no-slots message, not a coach-rules one', async () => {
      const r = await runCheckAvailability({ lead_booking_link: 'https://calendly.com/candacengok/intro' }, 'Guy-Wilson', { readBookingLink: async () => ({ ok: true, ownerName: 'X', eventName: 'Y', durationMins: 30, slots: [] }) });
      assert.match(r.text, /No time in the scan window where BOTH/);
      assert.match(r.text, /offered nothing/);
      assert.ok(!/label=/.test(r.text));
    });
    await checkAsync('an unreadable link keeps the coach\'s slots and says why', async () => {
      const r = await runCheckAvailability({ lead_booking_link: 'https://cal.com/x/y' }, 'Guy-Wilson', { readBookingLink: async () => ({ ok: false, reason: 'cal.com is not a booking page Wingguy can read yet (Calendly only)' }) });
      assert.match(r.text, /Could not read the lead's booking link \(cal\.com is not a booking page/);
      assert.match(r.text, /COACH'S ONLY/);
      assert.ok(r.text.split('\n').filter((l) => /label=/.test(l)).length > 3);
    });
    await checkAsync('a readable TidyCal link reads as the lead\'s TidyCal page and narrows to the overlap', async () => {
      const target = days[8];
      const t = DateTime.fromISO(target.freeSlots[1].time).minus({ minutes: 15 }); // lead free 1:15-2:00 -> only the coach's 1:30 fits
      const readBookingLink = async (url) => { assert.strictEqual(url, TIDY_PAGE); return { ok: true, provider: 'tidycal', ownerName: 'Sam Trattles', eventName: 'Consultation', durationMins: 15, slots: [t.toISO(), t.plus({ minutes: 15 }).toISO(), t.plus({ minutes: 30 }).toISO()] }; };
      const r = await runCheckAvailability({ not_before: notBefore, lead_booking_link: TIDY_PAGE }, 'Guy-Wilson', { readBookingLink });
      assert.match(r.text, /LEAD'S OWN CALENDAR READ: Sam Trattles's TidyCal page \("Consultation", 15 min\) offered 3 slots/);
      assert.match(r.text, /The lead's page offers 15-minute slots, shorter than the coach's usual 30 minutes/);
      assert.match(r.text, /invite still goes out at the coach's usual length/);
      const slotLines = r.text.split('\n').filter((l) => /label=/.test(l));
      assert.strictEqual(slotLines.length, 1, r.text);
      assert.ok(slotLines[0].includes(target.freeSlots[1].time), slotLines[0]);
    });
    await checkAsync('an isolated 15-minute TidyCal slot on the hour matches the coach\'s 30-minute slot at that hour (the live 9 Oct miss)', async () => {
      const target = days[8];
      const onTheHour = target.freeSlots[0].time; // 10:00 Brisbane, one 15-minute island, nothing either side
      const readBookingLink = async () => ({ ok: true, provider: 'tidycal', ownerName: 'Sam Trattles', eventName: 'Initial Consultation with Sam Trattles', durationMins: 15, slots: [onTheHour] });
      const r = await runCheckAvailability({ not_before: notBefore, lead_booking_link: TIDY_PAGE }, 'Guy-Wilson', { readBookingLink });
      assert.ok(!/No time in the scan window where BOTH/.test(r.text), r.text);
      const slotLines = r.text.split('\n').filter((l) => /label=/.test(l));
      assert.strictEqual(slotLines.length, 1, r.text);
      assert.ok(slotLines[0].includes(onTheHour), slotLines[0]);
    });
    await checkAsync('a Calendly 30-minute event against a 30-minute coach meeting: no slot-length note', async () => {
      const target = days[8];
      const t = DateTime.fromISO(target.freeSlots[1].time).minus({ minutes: 15 });
      const r = await runCheckAvailability({ not_before: notBefore, lead_booking_link: 'https://calendly.com/candacengok/intro' }, 'Guy-Wilson', { readBookingLink: async () => ({ ok: true, ownerName: 'Candace Ngok', eventName: 'Introductory Call', durationMins: 30, slots: [t.toISO(), t.plus({ minutes: 30 }).toISO()] }) });
      assert.ok(!/minute slots, shorter than/.test(r.text), r.text);
    });
    await checkAsync('an unreadable TidyCal link: the coach\'s slots, TidyCal named, offer the coach\'s own times, never "by hand"', async () => {
      const r = await runCheckAvailability({ lead_booking_link: TIDY_PAGE }, 'Guy-Wilson', { readBookingLink: async () => ({ ok: false, reason: 'TidyCal answered with a Cloudflare bot check instead of the page' }) });
      assert.match(r.text, /Could not read the lead's TidyCal link \(TidyCal answered with a Cloudflare bot check/);
      assert.match(r.text, /COACH'S ONLY/);
      assert.match(r.text, /offer the coach's own times from the list below/);
      assert.match(r.text, /NEVER tell the lead the coach will book through their link/);
      assert.ok(!/by hand/.test(r.text), r.text);
      assert.ok(r.text.split('\n').filter((l) => /label=/.test(l)).length > 3);
    });
    await checkAsync('an unreadable Calendly link names Calendly the same way', async () => {
      const r = await runCheckAvailability({ lead_booking_link: 'https://calendly.com/x/y' }, 'Guy-Wilson', { readBookingLink: async () => ({ ok: false, reason: 'Calendly lookup failed (HTTP 503)' }) });
      assert.match(r.text, /Could not read the lead's Calendly link \(Calendly lookup failed \(HTTP 503\)\)/);
    });
    await checkAsync('no link, no not_before → the result is exactly as before (no new lines)', async () => {
      const r = await runCheckAvailability({}, 'Guy-Wilson');
      assert.ok(!/booking link|not_before|LEAD'S OWN/.test(r.text));
    });
  } finally {
    wingguyCalendar.getAvailabilityForCoach = origGet;
  }

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all lead-booking-link tests passed');
  process.exit(failures ? 1 : 0);
})();
