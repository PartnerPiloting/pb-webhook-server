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
  check('a 60-minute coach meeting needs 60 free minutes on the lead\'s side', () => {
    const filtered = { days: [{ date: '2026-09-29', freeSlots: [{ time: '2026-09-29T03:30:00.000Z', label: '1:30 pm' }, { time: '2026-09-29T02:45:00.000Z', label: '12:45' }] }] };
    const lead = { slots: ['2026-09-29T02:45:00Z', '2026-09-29T03:15:00Z', '2026-09-29T03:45:00Z', '2026-09-29T04:15:00Z'], durationMins: 30 }; // free 12:45-14:45
    const out = link.intersectAvailability(filtered, lead, { meetingMins: 60 });
    assert.deepStrictEqual(out.days[0].freeSlots.map((s) => s.label), ['1:30 pm', '12:45']);
    const out2 = link.intersectAvailability(filtered, lead, { meetingMins: 90 });
    assert.deepStrictEqual(out2.days[0].freeSlots.map((s) => s.label), ['12:45']);
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
