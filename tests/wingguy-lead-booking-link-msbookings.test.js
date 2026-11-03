/**
 * Microsoft Bookings ("Bookings with me") as a readable lead booking link (Michael Farag, 2026-11-03:
 * "https://outlook.office.com/bookwithme/user/f743d474fe5b4780b0c99e64d5f1862b＠52ndSolution.net?anonymous&ismsaljsauthenabled").
 *
 * What is proven here, with no network (the fake below replays the shapes recorded that day):
 *  - the link is found with its "@" as "@", "%40" or a full-width "＠", cut back to id + domain (query
 *    and anything glued onto it dropped), and parsed; mixed-case domains survive
 *  - per-meeting-type links (book/mbx:<id>@<tenant>/s/<code>) parse with the tenant and code; Bookings
 *    business pages are recognised but fall open without a network call
 *  - the reader: tenant from the domain's openid-configuration, then business + services, then
 *    getStaffAvailability asked in UTC with the fixed "Bookings with me" staff id; AVAILABLE ranges are
 *    cut into starts on the page's 30-minute grid; BUSY / OUT_OF_OFFICE are ignored
 *  - several meeting types and no /s/ code -> falls open (never choose for the lead); a /s/ code picks its type
 *  - an answer in a non-UTC zone, an unknown domain, a failing call, a throw -> { ok:false, reason }
 *  - the panel scan and the link-promise guard know Bookings
 *
 * Live (not in this file): node -e "require('./services/wingguyLeadBookingLink').readBookingLink('<link>').then(r=>console.log(r.ok, r.slots && r.slots.length))"
 * read 47 slots off Michael's real page on 3 Nov 2026.
 *
 * Run: node tests/wingguy-lead-booking-link-msbookings.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const link = require('../services/wingguyLeadBookingLink');
const { detectLeadBookingLink, linkBookingPromise } = require('../services/wingguyChat');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const ID = 'f743d474fe5b4780b0c99e64d5f1862b';
const TENANT = 'd419b40d-16fb-4cec-8c4e-6b02e774c9df';
const CLEAN = `https://outlook.office.com/bookwithme/user/${ID}@52ndSolution.net`;
const MICHAEL = `Thanks Guy, please book a time here https://outlook.office.com/bookwithme/user/${ID}＠52ndSolution.net?anonymous&ismsaljsauthenabled\n\nMichael`;
const STAFF = '1c1c7887-e0fc-479b-ac7d-6983d0f026ff';

const res = (status, body) => ({ status, headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const service = (over = {}) => ({ serviceId: 'eb437039-d0e1-4849-b1b0-13fe68d4c582', title: '30 minutes meeting', defaultDuration: 'PT30M', preBuffer: 'PT0S', postBuffer: 'PT0S', isHiddenFromCustomers: false, isPrivate: false, webUrl: `https://outlook.office.com/book/mbx:${ID}@${TENANT}/s/OXBD6-HQSUixsBP-aNTFgg2`, bookingsSchedulingPolicy: { timeSlotInterval: 'PT30M', minimumLeadTime: 'PT1H', maximumAdvance: 'P90D' }, ...over });
// A day a week out, so the lead-time and advance rules never bite.
const DAY = DateTime.now().setZone('Australia/Brisbane').plus({ days: 7 }).toISODate();
const utc = (hhmm) => DateTime.fromISO(`${DAY}T${hhmm}`, { zone: 'Australia/Brisbane' }).toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss");
const item = (status, from, to, tz = 'UTC') => ({ status: `BOOKINGSAVAILABILITYSTATUS_${status}`, startDateTime: { dateTime: utc(from), timeZone: tz }, endDateTime: { dateTime: utc(to), timeZone: tz }, serviceId: '' });

function fakeBookings({ calls = [], services = [service()], items = null, tz = 'UTC', oidStatus = 200, availStatus = 200, throwOn = null } = {}) {
  return async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (throwOn && url.includes(throwOn)) throw new Error('socket hang up');
    if (url.includes('login.microsoftonline.com')) return oidStatus === 200 ? res(200, { token_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/token` }) : res(oidStatus, { error: 'invalid_tenant' });
    if (url.endsWith(`mbx:${ID}@${TENANT}/`)) return res(200, { businessInfo: { displayName: 'Michael Farag', businessTimeZone: 'AUS Eastern Standard Time', isPublished: true, schedulingPolicy: { timeSlotInterval: 'PT30M' } } });
    if (url.endsWith('/services')) return res(200, { service: services, count: 0 });
    if (url.endsWith('/getStaffAvailability')) {
      if (availStatus !== 200) return res(availStatus, { error: 'Status(StatusCode="Internal")' });
      return res(200, { staffAvailabilityResponse: [{ staffId: STAFF, availabilityItems: items || [item('OUT_OF_OFFICE', '00:00', '12:30', tz), item('AVAILABLE', '12:30', '13:30', tz), item('BUSY', '13:30', '14:00', tz), item('OUT_OF_OFFICE', '14:00', '23:59', tz)] }] });
    }
    return res(404, { error: 'not found' });
  };
}

(async () => {
  console.log('Microsoft Bookings: finding and parsing:');
  check('Michael\'s message: full-width ＠ link found, cut back to id + domain', () => assert.strictEqual(link.findBookingLink(MICHAEL), CLEAN));
  check('the %40 form (what the redirect shows) comes back the same', () => assert.strictEqual(link.findBookingLink(`https://bookings.cloud.microsoft/bookwithme/user/${ID}%4052ndSolution.net?anonymous&ismsaljsauthenabled`), `https://bookings.cloud.microsoft/bookwithme/user/${ID}@52ndSolution.net`));
  check('text LinkedIn glued onto the query is dropped', () => assert.strictEqual(link.findBookingLink(`${CLEAN}?anonymous&ismsaljsauthenabledLook forward to it`), CLEAN));
  check('no https:// still found', () => assert.strictEqual(link.findBookingLink(`outlook.office.com/bookwithme/user/${ID}@52ndSolution.net thanks`), CLEAN));
  check('parses to mailbox id + domain', () => assert.deepStrictEqual(link.parseBookingLink(CLEAN), { provider: 'msbookings', url: CLEAN, profileSlug: ID, eventSlug: null, domain: '52ndSolution.net' }));
  check('a per-meeting-type link parses with tenant + code', () => { const p = link.parseBookingLink(`https://outlook.office.com/book/mbx:${ID}@${TENANT}/s/OXBD6-HQSUixsBP-aNTFgg2`); assert.strictEqual(p.tenantId, TENANT); assert.strictEqual(p.eventSlug, 'OXBD6-HQSUixsBP-aNTFgg2'); assert.strictEqual(p.profileSlug, ID); });
  check('a Bookings business page is recognised, not read', () => { const p = link.parseBookingLink(link.findBookingLink('https://outlook.office365.com/book/AcmeConsulting@acme.com/')); assert.strictEqual(p.provider, 'msbookings'); assert.ok(!p.profileSlug); assert.match(p.reason, /business page/); });
  check('an Outlook shared-calendar link is NOT a booking link', () => assert.strictEqual(link.findBookingLink('https://outlook.office365.com/owa/calendar/abc123@acme.com/def456/calendar.html'), null));
  check('providerLabel: Microsoft Bookings', () => assert.strictEqual(link.providerLabel('msbookings'), 'Microsoft Bookings'));
  check('the other-host reason names Microsoft Bookings', () => assert.match(link.parseBookingLink('https://cal.com/a/b').reason, /Microsoft Bookings/));

  console.log('reading Bookings (fake fetch, shapes recorded 3 Nov 2026):');
  await checkAsync('Michael\'s page: 12:30-13:30 free -> 12:30 and 1:00 starts, 30 min, BUSY ignored', async () => {
    const calls = [];
    const r = await link.readBookingLink(CLEAN, { timezone: 'Australia/Brisbane', rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeBookings({ calls }) });
    assert.ok(r.ok, r.reason);
    assert.strictEqual(r.provider, 'msbookings');
    assert.strictEqual(r.ownerName, 'Michael Farag');
    assert.strictEqual(r.eventName, '30 minutes meeting');
    assert.strictEqual(r.durationMins, 30);
    assert.strictEqual(r.leadTimezone, 'Australia/Sydney');
    assert.deepStrictEqual(r.slots.map((s) => DateTime.fromISO(s).setZone('Australia/Brisbane').toFormat('HH:mm')), ['12:30', '13:00']);
    const post = calls.find((c) => c.method === 'POST');
    assert.ok(post.url.endsWith(`/bookingBusinessesc2/mbx:${ID}@${TENANT}/getStaffAvailability`), post.url);
    assert.deepStrictEqual(post.body.staffIds, [STAFF]);
    assert.strictEqual(post.body.startDateTime.timeZone, 'UTC');
    assert.strictEqual(post.body.serviceId, 'eb437039-d0e1-4849-b1b0-13fe68d4c582');
  });
  await checkAsync('a per-type link skips the tenant lookup and picks its meeting type among several', async () => {
    const calls = [];
    const services = [service({ serviceId: 'other', title: '60 minutes', defaultDuration: 'PT1H', webUrl: `https://outlook.office.com/book/mbx:${ID}@${TENANT}/s/ZZZ` }), service()];
    const r = await link.readBookingLink(`https://outlook.office.com/book/mbx:${ID}@${TENANT}/s/OXBD6-HQSUixsBP-aNTFgg2`, { rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeBookings({ calls, services }) });
    assert.ok(r.ok, r.reason);
    assert.ok(!calls.some((c) => c.url.includes('login.microsoftonline.com')));
    assert.strictEqual(calls.find((c) => c.method === 'POST').body.serviceId, 'eb437039-d0e1-4849-b1b0-13fe68d4c582');
  });
  await checkAsync('several meeting types and no code: falls open, names them, no slots call', async () => {
    const calls = [];
    const r = await link.readBookingLink(CLEAN, { rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeBookings({ calls, services: [service(), service({ serviceId: 'b', title: 'Discovery call' })] }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /offers 2 meeting types .*choose one/);
    assert.ok(!calls.some((c) => c.method === 'POST'));
  });
  await checkAsync('a hidden meeting type does not count as a choice', async () => {
    const r = await link.readBookingLink(CLEAN, { rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeBookings({ services: [service(), service({ serviceId: 'h', isHiddenFromCustomers: true })] }) });
    assert.ok(r.ok, r.reason);
  });
  await checkAsync('an answer in a Windows display zone is refused, not guessed', async () => {
    const r = await link.readBookingLink(CLEAN, { rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeBookings({ tz: '(UTC+10:00) Brisbane' }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /time zone/);
  });
  await checkAsync('a domain Microsoft does not know -> plain reason', async () => {
    const r = await link.readBookingLink(CLEAN, { rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeBookings({ oidStatus: 400 }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /52ndSolution\.net/);
  });
  await checkAsync('availability failing -> plain reason', async () => {
    const r = await link.readBookingLink(CLEAN, { rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeBookings({ availStatus: 500 }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /Microsoft Bookings availability failed \(HTTP 500\)/);
  });
  await checkAsync('a throw mid-read is caught', async () => {
    const r = await link.readBookingLink(CLEAN, { rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeBookings({ throwOn: '/services' }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /could not read the link/);
  });
  await checkAsync('a business page falls open with no network call', async () => {
    const calls = [];
    const r = await link.readBookingLink('https://outlook.office365.com/book/AcmeConsulting@acme.com/', { fetchImpl: fakeBookings({ calls }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(calls.length, 0);
  });
  await checkAsync('touching AVAILABLE items merge into one range; one day is one slots call', async () => {
    const calls = [];
    const items = [item('AVAILABLE', '09:00', '09:30'), item('AVAILABLE', '09:30', '10:30')];
    const r = await link.readBookingLink(CLEAN, { rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeBookings({ calls, items }) });
    assert.deepStrictEqual(r.slots.map((s) => DateTime.fromISO(s).setZone('Australia/Brisbane').toFormat('HH:mm')), ['09:00', '09:30', '10:00']);
    assert.strictEqual(calls.filter((c) => c.method === 'POST').length, 1);
  });

  console.log('panel thread scan + guards:');
  check('the panel scan finds Michael\'s Bookings link in his message', () => assert.strictEqual(detectLeadBookingLink([{ sender: 'Guy Wilson', text: 'Open to a chat?' }, { sender: 'Michael Farag', text: MICHAEL }], 'Guy'), CLEAN));
  check('the link-promise guard knows Bookings', () => assert.ok(linkBookingPromise("I'll grab a time through your Bookings page")));

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all Microsoft Bookings tests passed');
  process.exit(failures ? 1 : 0);
})();
