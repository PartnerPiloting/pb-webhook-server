/**
 * OnceHub as a readable lead booking link (Ivan Ang, 2026-11-04: "https://go.oncehub.com/IvanAng" in his
 * signature, on David Gould's introduction).
 *
 * What is proven here, with no network (the fake below replays the shapes recorded that day in Guy's
 * Chrome, every call repeated there with cookies omitted):
 *  - the link is found in free text with its mixed-case page name kept whole, with or without https://,
 *    and a ?serviceid= that pre-picks a meeting type survives; other query text is dropped
 *  - the reader: GetLandingPageLayout (linkname) -> GetServiceDetail (settingsId) -> calc-ts per chunk;
 *    slots come from startTime (true UTC), never from the zero-based-month day keys
 *  - one meeting type -> read; several -> the single plain first-chat one is read and flagged as chosen
 *    (Guy, 4 Nov 2026); several with no single first-chat one -> falls open; ?serviceid= picks its type
 *  - an unknown page, a failing call, a throw -> { ok:false, reason }
 *  - the link-promise guard knows OnceHub
 *
 * Live (not in this file, the workspace cannot reach oncehub.com): from a machine that can,
 * node -e "require('./services/wingguyLeadBookingLink').readBookingLink('https://go.oncehub.com/IvanAng').then(r=>console.log(r.ok, r.eventName, r.slots && r.slots.length))"
 *
 * Run: node tests/wingguy-lead-booking-link-oncehub.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const link = require('../services/wingguyLeadBookingLink');
const { linkBookingPromise } = require('../services/wingguyChat');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const IVAN = 'https://go.oncehub.com/IvanAng';
const COFFEE = { serviceId: 'NzM0MTU0', serviceName: 'Virtual Coffee Meeting', serviceStatus: 1, serviceDuration: 6 };
const STRATEGY = { serviceId: 'NjU1MDIx', serviceName: 'Confidential Strategy Session', serviceStatus: 1, serviceDuration: 4 };

const res = (status, body) => ({ status, headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const TZ = 'Australia/Brisbane';
const DAY = DateTime.now().setZone(TZ).plus({ days: 7 }).toISODate();
const at = (hhmm) => DateTime.fromISO(`${DAY}T${hhmm}`, { zone: TZ }).toMillis();
// OnceHub's day key counts months from zero - deliberately "wrong" here so a reader keyed on it fails.
const KEY = (() => { const d = DateTime.fromISO(DAY); return `${d.year}-${d.month - 1}-${d.day}`; })();
const spot = (hhmm) => ({ startTime: at(hhmm), timeStr: hhmm, summary: '', dateString: KEY.replace(/-/g, ','), isDstEnable: false });

function fakeOnceHub({ calls = [], services = [COFFEE, STRATEGY], page = {}, availStatus = 200, throwOn = null, unknown = false } = {}) {
  return async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || 'GET', body });
    if (throwOn && url.includes(throwOn)) throw new Error('socket hang up');
    if (url.endsWith('/get-data/GetLandingPageLayout')) {
      if (unknown) return res(200, { status: 404, errorstring: 'Page not found', userId: null, settingsId: null });
      return res(200, { status: 200, errorstring: '', userId: '9461BD' + 'A'.repeat(61), settingsId: 'ODA3MzEz', meetmeLinkId: 'OTc2NTY1', team: -1, PooledAvailabilityType: -1, TimeZone: 17, serviceId: null, userInfo: { name: 'Ivan Ang' }, ...page });
    }
    if (url.endsWith('/get-data/GetServiceDetail')) return res(200, { Status: 1, serviceDetails: services });
    if (url.endsWith('/get-availability/calc-ts')) {
      if (availStatus !== 200) return res(availStatus, 'Bad Gateway');
      return res(200, { success: true, data: { slots: { [KEY]: { duration: 30, am: [spot('08:00'), spot('08:30')], pm: [spot('13:00'), spot('15:30')] } }, lastAvailableDay: null, availabilityCode: 0 } });
    }
    return res(404, { error: 'not found' });
  };
}

(async () => {
  console.log('OnceHub: finding and parsing:');
  check('Ivan\'s signature: page name kept mixed case', () => assert.strictEqual(link.findBookingLink(`Ivan Ang\nMyPath Wealth\nBook a time: ${IVAN}\nM 0400 000 000`), IVAN));
  check('no https:// still found', () => assert.strictEqual(link.findBookingLink('grab a time at go.oncehub.com/IvanAng thanks'), IVAN));
  check('a ?serviceid= survives, other query dropped', () => assert.strictEqual(link.findBookingLink('https://go.oncehub.com/IvanAng?utm_source=sig&serviceid=NzM0MTU0'), `${IVAN}?serviceid=NzM0MTU0`));
  check('trailing full stop dropped', () => assert.strictEqual(link.findBookingLink(`Here it is: ${IVAN}.`), IVAN));
  check('parses to page name', () => assert.deepStrictEqual(link.parseBookingLink(IVAN), { provider: 'oncehub', url: IVAN, profileSlug: 'IvanAng', eventSlug: null }));
  check('parses ?serviceid=', () => assert.strictEqual(link.parseBookingLink(`${IVAN}?serviceid=NjU1MDIx`).eventSlug, 'NjU1MDIx'));
  check('the bare host is not a booking page', () => assert.ok(!link.parseBookingLink('https://go.oncehub.com/').profileSlug));
  check('providerLabel: OnceHub', () => assert.strictEqual(link.providerLabel('oncehub'), 'OnceHub'));
  check('the other-host reason names OnceHub', () => assert.match(link.parseBookingLink('https://cal.com/a/b').reason, /OnceHub/));

  console.log('reading OnceHub (fake fetch, shapes recorded 4 Nov 2026):');
  await checkAsync('Ivan\'s page: two types, "Virtual Coffee Meeting" read and flagged as chosen', async () => {
    const calls = [];
    const r = await link.readBookingLink(IVAN, { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub({ calls }) });
    assert.ok(r.ok, r.reason);
    assert.strictEqual(r.provider, 'oncehub');
    assert.strictEqual(r.ownerName, 'Ivan Ang');
    assert.strictEqual(r.eventName, 'Virtual Coffee Meeting');
    assert.strictEqual(r.eventChosen, true);
    assert.strictEqual(r.durationMins, 30);
    assert.deepStrictEqual(r.slots, ['08:00', '08:30', '13:00', '15:30'].map((t) => new Date(at(t)).toISOString()));
    assert.deepStrictEqual(calls[0].body, { linkname: 'IvanAng', tzstring: TZ });
    assert.deepStrictEqual(calls[1].body, { settingsId: 'ODA3MzEz' });
    const ts = calls[2].body;
    assert.strictEqual(ts.serviceId, 'NzM0MTU0');
    assert.strictEqual(ts.meetmelinkid, 'OTc2NTY1');
    assert.strictEqual(ts.timeZoneId, 17);
    assert.strictEqual(ts.startDate, DateTime.fromISO(DAY, { zone: TZ }).startOf('day').toMillis());
    assert.ok(calls.every((c) => c.method === 'POST' && c.url.startsWith('https://go.oncehub.com/api/')));
  });
  await checkAsync('one meeting type -> read, not flagged as chosen', async () => {
    const r = await link.readBookingLink(IVAN, { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub({ services: [STRATEGY] }) });
    assert.ok(r.ok, r.reason); assert.strictEqual(r.eventName, 'Confidential Strategy Session'); assert.ok(!r.eventChosen);
  });
  await checkAsync('?serviceid= picks its type over the first-chat one', async () => {
    const calls = [];
    const r = await link.readBookingLink(`${IVAN}?serviceid=NjU1MDIx`, { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub({ calls }) });
    assert.ok(r.ok, r.reason); assert.strictEqual(r.eventName, 'Confidential Strategy Session'); assert.ok(!r.eventChosen);
    assert.strictEqual(calls[0].body.serviceid, 'NjU1MDIx');
  });
  await checkAsync('several types, none plainly a first chat -> falls open naming them', async () => {
    const r = await link.readBookingLink(IVAN, { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub({ services: [STRATEGY, { ...STRATEGY, serviceId: 'X', serviceName: 'Board Review' }] }) });
    assert.ok(!r.ok); assert.match(r.reason, /2 meeting types/); assert.match(r.reason, /Board Review/);
  });
  await checkAsync('two first-chat types -> falls open (never guess between them)', async () => {
    const r = await link.readBookingLink(IVAN, { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub({ services: [COFFEE, { ...COFFEE, serviceId: 'Y', serviceName: 'Intro Chat' }] }) });
    assert.ok(!r.ok); assert.match(r.reason, /choose one/);
  });
  await checkAsync('a switched-off type is ignored', async () => {
    const r = await link.readBookingLink(IVAN, { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub({ services: [COFFEE, { ...STRATEGY, serviceStatus: 0 }] }) });
    assert.ok(r.ok, r.reason); assert.ok(!r.eventChosen);
  });
  await checkAsync('slots outside the window are dropped', async () => {
    const next = DateTime.fromISO(DAY).plus({ days: 1 }).toISODate();
    const r = await link.readBookingLink(IVAN, { timezone: TZ, rangeStart: next, rangeEnd: next, fetchImpl: fakeOnceHub() });
    assert.ok(r.ok, r.reason); assert.strictEqual(r.slots.length, 0);
  });
  await checkAsync('an unknown page -> ok:false with OnceHub\'s own words', async () => {
    const r = await link.readBookingLink('https://go.oncehub.com/NoSuchPerson', { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub({ unknown: true }) });
    assert.ok(!r.ok); assert.match(r.reason, /Page not found/);
  });
  await checkAsync('a failing slots call -> ok:false', async () => {
    const r = await link.readBookingLink(IVAN, { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub({ availStatus: 502 }) });
    assert.ok(!r.ok); assert.match(r.reason, /OnceHub availability failed \(HTTP 502\)/);
  });
  await checkAsync('a throw -> ok:false, never thrown', async () => {
    const r = await link.readBookingLink(IVAN, { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub({ throwOn: 'GetServiceDetail' }) });
    assert.ok(!r.ok); assert.match(r.reason, /socket hang up/);
  });
  await checkAsync('the coach\'s slots are cut to the times both are free', async () => {
    const lead = await link.readBookingLink(IVAN, { timezone: TZ, rangeStart: DAY, rangeEnd: DAY, fetchImpl: fakeOnceHub() });
    const iso = (t) => DateTime.fromISO(`${DAY}T${t}`, { zone: TZ }).toISO();
    const out = link.intersectAvailability({ days: [{ date: DAY, freeSlots: [{ time: iso('08:00') }, { time: iso('10:00') }, { time: iso('15:30') }] }] }, lead, { meetingMins: 30 });
    assert.deepStrictEqual(out.days[0].freeSlots.map((s) => s.time), [iso('08:00'), iso('15:30')]);
  });

  console.log('guards:');
  const { linkBookedDraftProblem } = require('../services/wingguyChat');
  check('Guy\'s wording passes the after-booking check', () => assert.strictEqual(linkBookedDraftProblem("Hi Ivan - I noticed Friday 11am was free on your calendar, and I'm free then too - so to make it easy, I've sent you a calendar invite for then. It's gone to ivan@mypathwealth.com.au. Look forward to seeing you then."), null));
  check('"it\'s now in your calendar" is still refused', () => assert.match(linkBookedDraftProblem("Hi Ivan - saw Friday 11am was free on your link. I've sent the invite and it's now in your calendar."), /in your calendar/));
  check('"I\'ll book through your OnceHub page" is caught', () => assert.ok(linkBookingPromise('I\'ll book a time through your OnceHub page now.')));

  if (failures) { console.error(`❌ ${failures} test(s) failed`); process.exit(1); }
  console.log('✅ all OnceHub tests passed');
})();
