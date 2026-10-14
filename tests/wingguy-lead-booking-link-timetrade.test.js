/**
 * TimeTrade as a readable lead booking link, and short links resolved before detection (Steve
 * Brossman, 2026-10-14: "https://bit.ly/StevePPcall" -> my.timetrade.com/book/V4KFJ).
 *
 * What is proven here, with no network (the fake below replays the shapes recorded with curl that day):
 *  - TimeTrade links are found (upper-case code intact) and parsed, in both the /book/<code> and the
 *    my-schedule /app/<td>/workflows/<wf> forms
 *  - a bit.ly is never a booking link by itself (sync scan), but resolves to one: the redirect is
 *    followed without fetching the destination, and a short link to anywhere else is ignored
 *  - the reader walks the wizard: page -> wfsid, deviceformat -> welcome, POST welcome/submit ->
 *    nextUrl -> availability, then the range call with date-only start/end; slots are the UTC ids
 *  - a step that wants a choice (appointment type), a session that never reaches the calendar, and a
 *    fetch that throws all degrade to { ok:false, reason } - never a throw
 *  - no length on the page -> durationMins null, and the fit uses the coach's own 30 minutes
 *  - the panel's async scan finds the TimeTrade page behind a lead's bit.ly, never the coach's
 *
 * Run: node tests/wingguy-lead-booking-link-timetrade.test.js
 */
const assert = require('assert');
const link = require('../services/wingguyLeadBookingLink');
const { detectLeadBookingLink, detectLeadBookingLinkResolved, linkBookingPromise } = require('../services/wingguyChat');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const SHORT = 'https://bit.ly/StevePPcall';
const BOOK = 'https://my.timetrade.com/book/V4KFJ';
const HOST = 'https://my-schedule.timetrade.com';
const BASE = `${HOST}/app/td-3408889/workflows/v4kfj/schedule`;
const SID = '64qbd9fivl6utdhfmq16sqlia1etvkmt';
const STEVE = 'Hi Guy, thanks for reaching out. Happy to have a chat - easiest is to grab a time here: https://bit.ly/StevePPcall\n\nCheers, Steve';

const res = (status, text, headers = {}) => ({
  status,
  headers: { get: (n) => headers[n.toLowerCase()] || null, getSetCookie: () => (headers['set-cookie'] ? [].concat(headers['set-cookie']) : []) },
  text: async () => text,
});
const redirect = (to, extra = {}) => res(301, '', { location: to, ...extra });

/**
 * A fake TimeTrade. `steps` is the wizard after welcome (the redirect chain nextUrl walks); the last
 * entry is where it lands. `range` maps a start date to the JSON body the range call answers.
 */
function fakeTimeTrade({ calls = [], landing = 'availability', range = null, rangeStatus = 200, bitlyTo = BOOK, throwOn = null } = {}) {
  return async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, redirect: opts.redirect });
    if (throwOn && url.includes(throwOn)) throw new Error('socket hang up');
    const u = new URL(url);
    if (u.hostname === 'bit.ly') return u.pathname === '/StevePPcall' ? redirect(bitlyTo) : res(404, 'not found');
    if (url === BOOK) return redirect(`${BASE}?view=full`, { 'set-cookie': 'AWSALB=sticky1; Path=/' });
    if (url === `${BASE}?view=full`) return res(200, `<html><script>var u="/app/td-3408889/workflows/v4kfj/schedule/index/deviceformat?wfsid=${SID}&dd="+x;</script></html>`);
    if (u.pathname.endsWith('/schedule/index/deviceformat')) return redirect(`${BASE}/welcome?wfsid=${SID}&view=full&fs=1`);
    if (u.pathname.endsWith('/schedule/welcome')) return res(200, '<title>Prominence and Persuasion Review with Steve  - TimeTrade - Prominence and Persuasion Review with Steve </title><p>Step 1 of 3</p>');
    if (u.pathname.endsWith('/schedule/welcome/submit')) return res(200, JSON.stringify({ data: { nextUrl: `/app/td-3408889/workflows/v4kfj/schedule/appointment-type?view=full&wfsid=${SID}` }, code: 200 }));
    if (u.pathname.endsWith('/schedule/appointment-type')) return landing === 'appointment-type' ? res(200, '<title>Appointment Type - TimeTrade - X</title>') : redirect(`${BASE}/resource?wfsid=${SID}&view=full`);
    if (u.pathname.endsWith('/schedule/resource')) return redirect(`${BASE}/availability?wfsid=${SID}&view=full`);
    if (u.pathname.endsWith('/schedule/availability')) return res(200, '<title>Date and Time - TimeTrade - Prominence and Persuasion Review with Steve </title>');
    if (u.pathname.endsWith('/schedule/availability/range/')) {
      if (rangeStatus !== 200) return res(rangeStatus, '');
      const body = range ? range(u.searchParams.get('start'), u.searchParams.get('end')) : { data: [] };
      return res(200, JSON.stringify(body));
    }
    return res(404, '');
  };
}
const STEVE_RANGE = (start) => (start === '2026-10-14' ? { data: {
  '2026-10-15': { options: [{ date: '15-Oct-2026', id: '2026-10-14T23:00:00.000Z', time: '9:00 AM' }, { date: '15-Oct-2026', id: '2026-10-15T01:00:00.000Z', time: '11:00 AM' }] },
  '2026-10-23': { options: [{ date: '23-Oct-2026', id: '2026-10-23T01:15:00.000Z', time: '11:15 AM' }, { date: '23-Oct-2026', id: '2026-10-23T01:15:00.000Z', time: '11:15 AM' }] },
} } : { data: [] });

console.log('TimeTrade: finding and parsing:');
check('a my.timetrade.com/book link is found, upper-case code intact', () => assert.strictEqual(link.findBookingLink(`book here ${BOOK}.`), BOOK));
check('a bare my.timetrade.com/book link comes back with https://', () => assert.strictEqual(link.findBookingLink('my.timetrade.com/book/V4KFJ thanks'), BOOK));
check('the long my-schedule address is found', () => assert.strictEqual(link.findBookingLink(`${BASE}?view=full`), `${BASE}?view=full`));
check('/book/<code> parses to the page to open', () => assert.deepStrictEqual(link.parseBookingLink(BOOK), { provider: 'timetrade', url: BOOK, profileSlug: 'V4KFJ', eventSlug: 'V4KFJ', pageUrl: BOOK }));
check('the long form parses to td + workflow and the clean schedule page', () => { const p = link.parseBookingLink(`${BASE}/availability?wfsid=abc&view=full`); assert.strictEqual(p.provider, 'timetrade'); assert.strictEqual(p.profileSlug, 'td-3408889'); assert.strictEqual(p.eventSlug, 'v4kfj'); assert.strictEqual(p.pageUrl, `${BASE}?view=full`); });
check('a TimeTrade address that is not a booking page is refused with a reason', () => { const p = link.parseBookingLink('https://www.timetrade.com/pricing'); assert.strictEqual(p.provider, 'timetrade'); assert.ok(!p.profileSlug); assert.match(p.reason, /not a booking page/); });
check('providerLabel: TimeTrade', () => assert.strictEqual(link.providerLabel('timetrade'), 'TimeTrade'));

console.log('short links:');
check('a bit.ly is NOT a booking link to the sync scan (it could point anywhere)', () => assert.strictEqual(link.findBookingLink(STEVE), null));
check('findShortLinks pulls it out, with or without https://', () => { assert.deepStrictEqual(link.findShortLinks(STEVE), [SHORT]); assert.deepStrictEqual(link.findShortLinks('see bit.ly/abc123.'), ['https://bit.ly/abc123']); });
check('isShortLink: bit.ly / tinyurl / lnkd.in yes, calendly no', () => { assert.ok(link.isShortLink(SHORT)); assert.ok(link.isShortLink('tinyurl.com/x')); assert.ok(link.isShortLink('https://lnkd.in/gAbC')); assert.ok(!link.isShortLink('https://calendly.com/a/b')); });
check('parseBookingLink marks a short link, never reads it as a provider', () => { const p = link.parseBookingLink(SHORT); assert.strictEqual(p.provider, null); assert.strictEqual(p.short, true); });
check('the link-promise guard knows TimeTrade', () => assert.ok(linkBookingPromise("I'll book via your TimeTrade page")));

(async () => {
  await checkAsync('resolveShortLink follows bit.ly to the TimeTrade page WITHOUT fetching it', async () => {
    const calls = [];
    assert.strictEqual(await link.resolveShortLink(SHORT, fakeTimeTrade({ calls })), BOOK);
    assert.deepStrictEqual(calls.map((c) => c.url), [SHORT]);
    assert.strictEqual(calls[0].redirect, 'manual');
  });
  await checkAsync('findBookingLinkResolved: Steve\'s message -> the TimeTrade page', async () => assert.strictEqual(await link.findBookingLinkResolved(STEVE, { fetchImpl: fakeTimeTrade() }), BOOK));
  await checkAsync('a short link to an article is ignored', async () => assert.strictEqual(await link.findBookingLinkResolved(STEVE, { fetchImpl: fakeTimeTrade({ bitlyTo: 'https://example.com/blog/post' }) }), null));
  await checkAsync('a dead short link is ignored, no throw', async () => assert.strictEqual(await link.findBookingLinkResolved('https://bit.ly/nothing-here', { fetchImpl: fakeTimeTrade() }), null));
  await checkAsync('a short link to a Calendly page resolves to it too', async () => assert.strictEqual(await link.findBookingLinkResolved(STEVE, { fetchImpl: fakeTimeTrade({ bitlyTo: 'https://calendly.com/candacengok/intro' }) }), 'https://calendly.com/candacengok/intro'));
  await checkAsync('no short link in the text -> no network at all', async () => {
    const calls = [];
    assert.strictEqual(await link.findBookingLinkResolved('see you Tuesday https://example.com', { fetchImpl: fakeTimeTrade({ calls }) }), null);
    assert.strictEqual(calls.length, 0);
  });

  console.log('reading TimeTrade (fake fetch, shapes recorded 14 Oct 2026):');
  await checkAsync('Steve\'s bit.ly: wizard walked, UTC slots back, sorted + unique, no length', async () => {
    const calls = [];
    const r = await link.readBookingLink(SHORT, { timezone: 'Australia/Brisbane', rangeStart: '2026-10-14', rangeEnd: '2026-10-30', fetchImpl: fakeTimeTrade({ calls, range: STEVE_RANGE }) });
    assert.strictEqual(r.ok, true, r.reason);
    assert.strictEqual(r.provider, 'timetrade');
    assert.strictEqual(r.eventName, 'Prominence and Persuasion Review with Steve');
    assert.strictEqual(r.durationMins, null);
    assert.deepStrictEqual(r.slots, ['2026-10-14T23:00:00.000Z', '2026-10-15T01:00:00.000Z', '2026-10-23T01:15:00.000Z']);
    const sub = calls.find((c) => c.url.includes('/welcome/submit'));
    assert.strictEqual(sub.method, 'POST');
    assert.strictEqual(sub.headers['X-Requested-With'], 'XMLHttpRequest');
    const dev = calls.find((c) => c.url.includes('/index/deviceformat'));
    assert.match(dev.url, new RegExp(`wfsid=${SID}&dd=b&view=full&d=Australia%2FBrisbane`));
    const rg = calls.find((c) => c.url.includes('/availability/range/'));
    assert.match(rg.url, /start=2026-10-14&end=2026-10-30&tz=Australia%2FBrisbane/);
    // The sticky cookie from the /book/ redirect is NOT sent to another host.
    assert.ok(!calls.some((c) => c.url.startsWith(HOST) && c.headers.Cookie), 'cookie leaked across hosts');
  });
  await checkAsync('a long window is read in 28-day chunks', async () => {
    const calls = [];
    const r = await link.readBookingLink(BOOK, { rangeStart: '2026-10-14', rangeEnd: '2026-12-01', fetchImpl: fakeTimeTrade({ calls, range: STEVE_RANGE }) });
    assert.strictEqual(r.ok, true, r.reason);
    assert.strictEqual(calls.filter((c) => c.url.includes('/availability/range/')).length, 2);
  });
  await checkAsync('the long my-schedule address reads the same way', async () => {
    const r = await link.readBookingLink(`${BASE}/welcome?wfsid=old&view=full`, { rangeStart: '2026-10-14', rangeEnd: '2026-10-20', fetchImpl: fakeTimeTrade({ range: STEVE_RANGE }) });
    assert.strictEqual(r.ok, true, r.reason);
    assert.strictEqual(r.slots.length, 3);
  });
  await checkAsync('an empty booking window -> ok with no slots (data: [])', async () => {
    const r = await link.readBookingLink(BOOK, { rangeStart: '2026-11-01', rangeEnd: '2026-11-10', fetchImpl: fakeTimeTrade({ range: STEVE_RANGE }) });
    assert.strictEqual(r.ok, true, r.reason);
    assert.deepStrictEqual(r.slots, []);
  });
  await checkAsync('a step that wants a choice (appointment type) falls open, naming it', async () => {
    const r = await link.readBookingLink(BOOK, { rangeStart: '2026-10-14', rangeEnd: '2026-10-20', fetchImpl: fakeTimeTrade({ landing: 'appointment-type' }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /asks the visitor to choose an option \("appointment type"\)/);
  });
  await checkAsync('a session the range call refuses ({"errors":null}) falls open', async () => {
    const r = await link.readBookingLink(BOOK, { rangeStart: '2026-10-14', rangeEnd: '2026-10-20', fetchImpl: fakeTimeTrade({ range: () => ({ errors: null, code: null }) }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /TimeTrade availability failed/);
  });
  await checkAsync('a fetch that throws mid-wizard -> ok:false, no throw', async () => {
    const r = await link.readBookingLink(BOOK, { rangeStart: '2026-10-14', rangeEnd: '2026-10-20', fetchImpl: fakeTimeTrade({ throwOn: '/welcome/submit' }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /socket hang up/);
  });
  await checkAsync('a short link to an article, read directly -> ok:false naming where it went', async () => {
    const r = await link.readBookingLink(SHORT, { fetchImpl: fakeTimeTrade({ bitlyTo: 'https://example.com/blog/post' }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /leads to example\.com, not a booking page/);
  });

  console.log('intersection with no length on the lead\'s page:');
  check('each TimeTrade start counts as free for the coach\'s 30 minutes - 11:15 fits, 11:30 does not', () => {
    const filtered = { days: [{ date: '2026-10-23', freeSlots: [{ time: '2026-10-23T11:00:00+10:00' }, { time: '2026-10-23T11:15:00+10:00' }, { time: '2026-10-23T11:30:00+10:00' }] }] };
    const out = link.intersectAvailability(filtered, { slots: ['2026-10-23T01:15:00.000Z'], durationMins: null }, { meetingMins: 30 });
    assert.deepStrictEqual(out.days[0].freeSlots.map((s) => s.time), ['2026-10-23T11:15:00+10:00']);
    assert.strictEqual(out.leadSlotsShorter, false);
    assert.strictEqual(out.fitMins, 30);
  });

  console.log('panel thread scan:');
  const convo = [{ sender: 'Guy Wilson', text: 'Thanks for connecting, Steve - open to a quick call?' }, { sender: 'Steve Brossman', text: STEVE }];
  check('the sync scan still sees nothing (a bit.ly is not a booking link on its own)', () => assert.strictEqual(detectLeadBookingLink(convo, 'Guy'), null));
  await checkAsync('the async scan finds the TimeTrade page behind the lead\'s bit.ly', async () => assert.strictEqual(await detectLeadBookingLinkResolved(convo, 'Guy', { fetchImpl: fakeTimeTrade() }), BOOK));
  await checkAsync('a bit.ly in the COACH\'s message is never followed', async () => {
    const calls = [];
    assert.strictEqual(await detectLeadBookingLinkResolved([{ sender: 'Guy Wilson', text: STEVE }, { sender: 'Steve Brossman', text: 'sounds good' }], 'Guy', { fetchImpl: fakeTimeTrade({ calls }) }), null);
    assert.strictEqual(calls.length, 0);
  });
  await checkAsync('a plain Calendly link still wins with no network', async () => {
    const calls = [];
    assert.strictEqual(await detectLeadBookingLinkResolved([{ sender: 'Candace Ngok', text: 'https://calendly.com/candacengok/intro and https://bit.ly/x' }], 'Guy', { fetchImpl: fakeTimeTrade({ calls }) }), 'https://calendly.com/candacengok/intro');
    assert.strictEqual(calls.length, 0);
  });

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all TimeTrade / short-link tests passed');
  process.exit(failures ? 1 : 0);
})();
