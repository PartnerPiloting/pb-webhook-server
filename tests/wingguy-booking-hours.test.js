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
  const david = await prefsMod.getBookingPrefsFor('David-Gould', { getBookingHours: async () => DAVID, getVariables: async () => ({}) });
  const guy = await prefsMod.getBookingPrefsFor('Guy-Wilson', { getBookingHours: async () => null, getVariables: async () => ({}) });
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
  const failed = await prefsMod.getBookingPrefsFor('X', { getBookingHours: async () => { throw new Error('db down'); }, getVariables: async () => { throw new Error('db down'); } });
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

  console.log('\nthe old setup-page answers now count:');
  const L = prefsMod.legacyFromVariables;
  check('Dean: 8am floor, 9am normal start, 3 a day', () => {
    assert.deepStrictEqual(L({ earliest_meeting_time: '8:00am', preferred_start_time: '9:00am', max_meetings_per_day: '3', default_meeting_length: '30 minutes' }),
      { earliestStart: '08:00', preferredStart: '09:00', maxMeetingsPerDay: 3, meetingLengthMins: 30 });
  });
  check('free text: "9.00am NSW", Sam\'s two-campaign answers, "45 minutes", "1 hour"', () => {
    assert.strictEqual(L({ earliest_meeting_time: '9.00am NSW' }).earliestStart, '09:00');
    const sam = L({ earliest_meeting_time: '10am - both FindMe First and Barclayss', preferred_start_time: 'FindMe First: 11am. Owners are usually on the tools. Barclayss: 10:30am.' });
    assert.strictEqual(sam.earliestStart, '10:00');
    assert.strictEqual(sam.preferredStart, '10:30');
    assert.strictEqual(L({ default_meeting_length: '45 minutes' }).meetingLengthMins, 45);
    assert.strictEqual(L({ default_meeting_length: '1 hour' }).meetingLengthMins, 60);
  });
  check('Guy\'s own answers change nothing', () => {
    const g = L({ earliest_meeting_time: '9:30am AEST', preferred_start_time: '10:00am AEST', max_meetings_per_day: '4', default_meeting_length: '30 minutes' });
    const base = prefsMod.getBookingPrefs('Guy-Wilson');
    assert.strictEqual(g.earliestStart, base.earliestStart);
    assert.strictEqual(g.preferredStart, base.preferredStart);
    assert.strictEqual(g.maxMeetingsPerDay, base.maxMeetingsPerDay);
    assert.strictEqual(g.meetingLengthMins, base.meetingLengthMins);
  });
  check('junk and nonsense keep the defaults', () => {
    assert.deepStrictEqual(L({ earliest_meeting_time: 'whenever suits', max_meetings_per_day: 'lots' }), {});
    assert.deepStrictEqual(L({ earliest_meeting_time: '7pm' }), {}, 'a floor after the last start is ignored');
  });
  const dean = await prefsMod.getBookingPrefsFor('Dean-Hobin', { getBookingHours: async () => null, getVariables: async () => ({ earliest_meeting_time: '8:00am', max_meetings_per_day: '3' }) });
  check('Dean is offered 8am now, and the page shows where it came from', () => {
    assert.strictEqual(cal.bookingHoursProblem(iso(MON, 8, 0), TZ, dean), null);
    assert.ok(cal.bookingHoursProblem(iso(MON, 7, 30), TZ, dean));
    const view = prefsMod.effectiveBookingHours(dean);
    assert.strictEqual(view.source, 'setup');
    assert.deepStrictEqual(view.week.mon, { first: '08:00', last: '16:30' });
    assert.strictEqual(view.week.sat, null);
    assert.strictEqual(view.maxMeetingsPerDay, 3);
  });
  const both = await prefsMod.getBookingPrefsFor('David-Gould', { getBookingHours: async () => DAVID, getVariables: async () => ({ earliest_meeting_time: '7:00am', default_meeting_length: '45 minutes' }) });
  check('saved hours win over setup answers; meeting length still comes from setup', () => {
    assert.strictEqual(both.earliestStart, '08:30');
    assert.strictEqual(both.meetingLengthMins, 45);
    assert.strictEqual(prefsMod.effectiveBookingHours(both).source, 'saved');
  });
  check('the page no longer shows the three old boxes, and cannot write them', () => {
    const f = require('../config/wingguySetupFields');
    const shown = f.PAGE_VARIABLE_FIELDS.map((x) => x.key);
    for (const k of ['earliest_meeting_time', 'preferred_start_time', 'max_meetings_per_day']) {
      assert.ok(!shown.includes(k), k);
      assert.ok(!f.VARIABLE_KEYS.has(k), k);
    }
    assert.ok(shown.includes('default_meeting_length'));
  });

  console.log('\nthe chat tool (wingguy_booking_hours):');
  const saved = {};
  const store = {
    getBookingHours: async (t) => saved[t] || null,
    setBookingHours: async (t, v) => { saved[t] = v; return v; },
    clearBookingHours: async (t) => { const had = !!saved[t]; delete saved[t]; return had; },
  };
  const vars = {};
  const rulesStore = { setVariable: async ({ tenantId, varKey, value }) => { vars[`${tenantId}/${varKey}`] = value; } };
  const getVariables = async (t) => Object.fromEntries(Object.entries(vars).filter(([k]) => k.startsWith(`${t}/`)).map(([k, v]) => [k.split('/')[1], v]));
  const toolDeps = { store, rulesStore, getVariables, prefsDeps: { getBookingHours: store.getBookingHours, getVariables } };
  const set = await runBookingHours({ action: 'set', monday: '5:30pm', tuesday: '5:30pm', wednesday: '9:00-17:00', thursday: '5:30pm', friday: 'off', saturday: '8:30-16:30', sunday: '8:30-16:30', gap_between_meetings_mins: 60, max_meetings_per_day: 3, daily_limit_is_hard: true }, 'David-Gould', toolDeps);
  check('set saves and reads back in plain words', () => {
    assert.ok(!set.isError, set.text);
    assert.match(set.text, /Monday: 5:30pm start only/);
    assert.match(set.text, /Friday: no meetings/);
    assert.match(set.text, /Gap between meetings: 60 minutes/);
    assert.match(set.text, /3 - a hard limit/);
  });
  const tweak = await runBookingHours({ action: 'set', friday: '10:00-12:00' }, 'David-Gould', toolDeps);
  check('a save writes the booking wording through (earliest start, meetings a day)', () => {
    assert.strictEqual(vars['David-Gould/earliest_meeting_time'], '8:30am');
    assert.strictEqual(vars['David-Gould/preferred_start_time'], '8:30am');
    assert.strictEqual(vars['David-Gould/max_meetings_per_day'], '3');
  });
  check('a later set changes only what was passed', () => {
    assert.match(tweak.text, /Friday: first start 10am, last start 12pm/);
    assert.match(tweak.text, /Monday: 5:30pm start only/);
    assert.match(tweak.text, /60 minutes/);
  });
  const bad = await runBookingHours({ action: 'set', monday: 'whenever' }, 'David-Gould', toolDeps);
  check('nonsense is refused and nothing changes', () => {
    assert.ok(bad.isError);
    assert.match(bad.text, /NOTHING SAVED/);
    assert.deepStrictEqual(saved['David-Gould'].week.mon, { first: '17:30', last: '17:30' });
  });
  const reset = await runBookingHours({ action: 'reset' }, 'David-Gould', toolDeps);
  check('reset goes back to the hours from before', () => {
    assert.match(reset.text, /cleared/);
    assert.ok(!saved['David-Gould']);
  });
  const fresh = await runBookingHours({ action: 'set', saturday: '9:00-11:00' }, 'Dean-Hobin', { ...toolDeps, prefsDeps: { getBookingHours: store.getBookingHours, getVariables: async () => ({ earliest_meeting_time: '8:00am', max_meetings_per_day: '3' }) } });
  check('a first chat save keeps the days not mentioned (from setup answers), never switches them off', () => {
    assert.ok(!fresh.isError, fresh.text);
    assert.match(fresh.text, /Monday: first start 8am, last start 4:30pm/);
    assert.match(fresh.text, /Saturday: first start 9am, last start 11am/);
    assert.match(fresh.text, /Sunday: no meetings/);
  });
  check('the tool is registered for both connector paths', () => {
    const { legacyToolList } = require('../services/wingguyBookingMcp');
    assert.ok(legacyToolList().some((t) => t.name === 'wingguy_booking_hours'));
  });

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all booking-hours tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
