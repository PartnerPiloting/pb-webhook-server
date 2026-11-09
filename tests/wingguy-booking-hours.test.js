/**
 * Each person's OWN booking hours (David Gould, 10 Nov 2026).
 *
 * Every client's time offers came from Guy's code defaults (10:00-4:30 weekdays, no gap, 4 a day as
 * a preference). David takes calls Mon/Tue/Thu at 5:30pm only, Wed 9-5:30, never Fridays, weekends
 * 8:30-5, with a 60-minute gap and at most 3 a day - and was offered Friday mornings, a Sunday
 * 10:30 half an hour after another call, and a Wednesday that already had 4 meetings.
 *
 * Run: node tests/wingguy-booking-hours.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const prefsMod = require('../config/wingguyBookingPrefs');
const cal = require('../services/wingguyCalendar');
const { runBookingHours } = require('../services/wingguyBookingMcp');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const TZ = 'Australia/Brisbane';

const DAVID = {
  week: { mon: '17:30', tue: '5:30pm', wed: '9:00-17:00', thu: '17:30', fri: 'off', sat: '8:30am-4:30pm', sun: '8:30-16:30' },
  bufferMins: 60, maxMeetingsPerDay: 3, dailyLimitHard: true,
};

(async () => {
  console.log('reading what a person says:');
  check('clock forms', () => {
    assert.strictEqual(prefsMod.parseClock('5:30pm'), '17:30');
    assert.strictEqual(prefsMod.parseClock('9am'), '09:00');
    assert.strictEqual(prefsMod.parseClock('12pm'), '12:00');
    assert.strictEqual(prefsMod.parseClock('12am'), '00:00');
    assert.strictEqual(prefsMod.parseClock('17:30'), '17:30');
    assert.strictEqual(prefsMod.parseClock('25:00'), null);
  });
  check('day forms', () => {
    assert.deepStrictEqual(prefsMod.parseDay('off'), { value: null });
    assert.deepStrictEqual(prefsMod.parseDay('17:30'), { value: { first: '17:30', last: '17:30' } });
    assert.deepStrictEqual(prefsMod.parseDay('9am to 4:30pm'), { value: { first: '09:00', last: '16:30' } });
    assert.ok(prefsMod.parseDay('5pm-9am').error, 'a backwards range is refused');
  });
  check('David\'s hours normalise cleanly', () => {
    const { value, errors } = prefsMod.normaliseBookingHours(DAVID);
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(value.week.fri, null);
    assert.deepStrictEqual(value.week.wed, { first: '09:00', last: '17:00' });
    assert.strictEqual(value.bufferMins, 60);
    assert.strictEqual(value.dailyLimitHard, true);
  });
  check('every day off is refused', () => {
    const { errors } = prefsMod.normaliseBookingHours({ week: { mon: 'off' } });
    assert.ok(errors.length);
  });
  check('a junk row falls back to the defaults', () => {
    const base = prefsMod.getBookingPrefs('David-Gould');
    assert.deepStrictEqual(prefsMod.applyBookingHours(base, 'nonsense'), base);
    assert.deepStrictEqual(prefsMod.applyBookingHours(base, null), base);
  });

  console.log('\nlaid over the defaults:');
  const david = await prefsMod.getBookingPrefsFor('David-Gould', { getBookingHours: async () => DAVID });
  const guy = await prefsMod.getBookingPrefsFor('Guy-Wilson', { getBookingHours: async () => null });
  check('David gets his week, gap and hard limit', () => {
    assert.ok(david.ownBookingHours);
    assert.strictEqual(david.excludeWeekends, false);
    assert.strictEqual(david.preferredStart, null);
    assert.strictEqual(david.earliestStart, '08:30');
    assert.strictEqual(david.lastStart, '17:30');
    assert.strictEqual(david.bufferMins, 60);
    assert.strictEqual(david.maxMeetingsPerDay, 3);
  });
  check('Guy is untouched', () => {
    assert.deepStrictEqual(guy, prefsMod.getBookingPrefs('Guy-Wilson'));
    assert.ok(!guy.weekHours && !guy.ownBookingHours);
  });
  const failed = await prefsMod.getBookingPrefsFor('X', { getBookingHours: async () => { throw new Error('db down'); } });
  check('a store failure means defaults, never a broken offer', () => assert.ok(!failed.ownBookingHours));
  check('the scan window reaches 8:30am and 5:30pm for David, stays 9-5 for Guy', () => {
    assert.deepStrictEqual(cal.scanHoursFor(david), { startHour: 8, endHour: 18 });
    assert.deepStrictEqual(cal.scanHoursFor(guy), { startHour: 9, endHour: 17 });
  });

  console.log('\none slot against his hours:');
  // Dates well past the notice period, found by weekday.
  const nextWd = (wd, minDays = 3) => { let d = DateTime.now().setZone(TZ).plus({ days: minDays }).startOf('day'); while (d.weekday !== wd) d = d.plus({ days: 1 }); return d; };
  const iso = (d, h, m) => d.set({ hour: h, minute: m }).toUTC().toISO();
  const MON = nextWd(1), WED = nextWd(3), FRI = nextWd(5), SAT = nextWd(6);
  check('Monday 10am is outside, Monday 5:30pm is fine', () => {
    assert.match(cal.bookingHoursProblem(iso(MON, 10, 0), TZ, david), /Monday hours \(5:30pm start only\)/);
    assert.strictEqual(cal.bookingHoursProblem(iso(MON, 17, 30), TZ, david), null);
  });
  check('Friday is never a meeting day', () => {
    assert.match(cal.bookingHoursProblem(iso(FRI, 11, 0), TZ, david), /Friday is not one of the coach's meeting days/);
  });
  check('Saturday 8:30am is fine for David', () => assert.strictEqual(cal.bookingHoursProblem(iso(SAT, 8, 30), TZ, david), null));
  check('Guy keeps his 9:30-4:30 bounds', () => {
    assert.ok(cal.bookingHoursProblem(iso(MON, 9, 0), TZ, guy));
    assert.strictEqual(cal.bookingHoursProblem(iso(MON, 11, 0), TZ, guy), null);
  });
  check('the gap: 30 minutes after a call is too close, 60 is fine, an overlap is a clash not a gap', () => {
    const busy = [{ start: iso(SAT, 9, 0), end: iso(SAT, 10, 0) }];
    assert.ok(cal.gapProblem(iso(SAT, 10, 30), 30, busy, 60));
    assert.strictEqual(cal.gapProblem(iso(SAT, 11, 0), 30, busy, 60), null);
    assert.strictEqual(cal.gapProblem(iso(SAT, 9, 0), 30, busy, 60), null);
    assert.strictEqual(cal.gapProblem(iso(SAT, 10, 30), 30, busy, 0), null);
  });

  console.log('\nthe offer pipeline (filterAvailability):');
  const slot = (d, h, m) => ({ time: iso(d, h, m), display: d.set({ hour: h, minute: m }).toFormat('h:mm a').toLowerCase() });
  const day = (d, slots, extra = {}) => ({ date: d.toFormat('yyyy-MM-dd'), day: d.toFormat('ccc'), meetingCount: 0, busy: [], freeSlots: slots, ...extra });
  const avail = {
    yourTimezone: TZ, leadTimezone: TZ,
    days: [
      day(MON, [slot(MON, 9, 0), slot(MON, 10, 30), slot(MON, 17, 30)]),
      day(WED, [slot(WED, 10, 0)], { meetingCount: 4 }),
      day(FRI, [slot(FRI, 10, 0), slot(FRI, 14, 0)]),
      day(SAT, [slot(SAT, 8, 30), slot(SAT, 10, 30), slot(SAT, 11, 30)], { busy: [{ start: iso(SAT, 9, 30), end: iso(SAT, 10, 0) }] }),
    ],
  };
  const out = cal.filterAvailability(avail, david, { includeFarWeeks: true });
  const byDate = Object.fromEntries(out.days.map((d) => [d.date, d.freeSlots.map((s) => s.time)]));
  check('Monday offers only 5:30pm', () => assert.deepStrictEqual(byDate[MON.toFormat('yyyy-MM-dd')], [iso(MON, 17, 30)]));
  check('a Wednesday already at 4 meetings is not offered (hard limit 3)', () => assert.ok(!byDate[WED.toFormat('yyyy-MM-dd')]));
  check('Friday is not offered at all', () => assert.ok(!byDate[FRI.toFormat('yyyy-MM-dd')]));
  check('Saturday: 8:30 is inside the gap before a 9:30 call, 10:30 is inside the gap after it, 11:30 survives', () => {
    assert.deepStrictEqual(byDate[SAT.toFormat('yyyy-MM-dd')], [iso(SAT, 11, 30)]);
  });
  const guyOut = cal.filterAvailability(avail, guy, { includeFarWeeks: true });
  const guyDates = guyOut.days.map((d) => d.date);
  check('Guy\'s defaults: weekdays, busy day kept and flagged, Saturday dropped', () => {
    assert.ok(guyDates.includes(MON.toFormat('yyyy-MM-dd')) && guyDates.includes(FRI.toFormat('yyyy-MM-dd')));
    assert.ok(!guyDates.includes(SAT.toFormat('yyyy-MM-dd')));
    assert.strictEqual(guyOut.days.find((d) => d.date === WED.toFormat('yyyy-MM-dd')).busyDay, true);
  });

  console.log('\nthe chat tool (wingguy_booking_hours):');
  const saved = {};
  const store = {
    getBookingHours: async (t) => saved[t] || null,
    setBookingHours: async (t, v) => { saved[t] = v; return v; },
    clearBookingHours: async (t) => { const had = !!saved[t]; delete saved[t]; return had; },
  };
  const set = await runBookingHours({ action: 'set', monday: '5:30pm', tuesday: '5:30pm', wednesday: '9:00-17:00', thursday: '5:30pm', friday: 'off', saturday: '8:30-16:30', sunday: '8:30-16:30', gap_between_meetings_mins: 60, max_meetings_per_day: 3, daily_limit_is_hard: true }, 'David-Gould', { store });
  check('set saves and reads back in plain words', () => {
    assert.ok(!set.isError, set.text);
    assert.match(set.text, /Monday: 5:30pm start only/);
    assert.match(set.text, /Friday: no meetings/);
    assert.match(set.text, /Gap between meetings: 60 minutes/);
    assert.match(set.text, /3 - a hard limit/);
  });
  const tweak = await runBookingHours({ action: 'set', friday: '10:00-12:00' }, 'David-Gould', { store });
  check('a later set changes only what was passed', () => {
    assert.match(tweak.text, /Friday: first start 10am, last start 12pm/);
    assert.match(tweak.text, /Monday: 5:30pm start only/);
    assert.match(tweak.text, /60 minutes/);
  });
  const bad = await runBookingHours({ action: 'set', monday: 'whenever' }, 'David-Gould', { store });
  check('nonsense is refused and nothing changes', () => {
    assert.ok(bad.isError);
    assert.match(bad.text, /NOTHING SAVED/);
    assert.deepStrictEqual(saved['David-Gould'].week.mon, { first: '17:30', last: '17:30' });
  });
  const reset = await runBookingHours({ action: 'reset' }, 'David-Gould', { store });
  check('reset goes back to the standard hours', () => {
    assert.match(reset.text, /cleared/);
    assert.match(reset.text, /standard hours/);
    assert.ok(!saved['David-Gould']);
  });
  check('the tool is registered for both connector paths', () => {
    const { legacyToolList } = require('../services/wingguyBookingMcp');
    assert.ok(legacyToolList().some((t) => t.name === 'wingguy_booking_hours'));
  });

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all booking-hours tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
