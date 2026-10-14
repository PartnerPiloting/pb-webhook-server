/**
 * Named weekdays look ahead (Ashley Knowles, 2026-10-14): "let's find the next Tuesday or Wednesday"
 * - both were full next week, and the panel stopped and handed him options instead of looking at
 * the week after. filterAvailability({ weekdays }) keeps only the named weekdays, looks about three
 * weeks ahead, and names the nearer ones that were full.
 *
 * Run: node tests/wingguy-named-weekdays.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const { filterAvailability, parseWeekdays, firstFarWeekDate } = require('../services/wingguyCalendar');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const TZ = 'Australia/Brisbane';
const prefs = getBookingPrefs('Guy-Wilson');
const nextMon = DateTime.now().setZone(TZ).startOf('week').plus({ weeks: 1 });
// One day of availability: open = a 10:30 and 14:00 slot; full = nothing.
const day = (dt, open, meetings = 2) => ({
  date: dt.toFormat('yyyy-MM-dd'), day: dt.toFormat('ccc d LLL'), meetingCount: meetings,
  freeSlots: open ? [10, 14].map((h) => ({ time: dt.set({ hour: h, minute: h === 10 ? 30 : 0 }).toUTC().toISO(), display: `${h}:00` })) : [],
});
// Weeks 1-4 from next Monday, Mon-Fri. Next week's Tue + Wed are full; Thu/Fri/Mon are open.
const days = [];
for (let w = 0; w < 4; w++) for (let i = 0; i < 5; i++) {
  const dt = nextMon.plus({ weeks: w, days: i });
  const full = w === 0 && (i === 1 || i === 2);
  days.push(day(dt, !full, full ? 6 : 1));
}
const avail = { yourTimezone: TZ, leadTimezone: TZ, leadTzDetected: true, days };

console.log('parseWeekdays:');
check('names, short names and numbers', () => {
  assert.deepStrictEqual([...parseWeekdays(['Tuesday', 'wed'])].sort(), [2, 3]);
  assert.deepStrictEqual([...parseWeekdays('Tue or Wed')].sort(), [2, 3]);
  assert.deepStrictEqual([...parseWeekdays([5])], [5]);
});
check('nothing usable -> null (old behaviour)', () => {
  assert.strictEqual(parseWeekdays(null), null);
  assert.strictEqual(parseWeekdays([]), null);
  assert.strictEqual(parseWeekdays(['soon']), null);
});

console.log('\nnext Tuesday or Wednesday, both full next week:');
const out = filterAvailability(avail, prefs, { weekdays: ['Tue', 'Wed'] });
check('only Tuesdays and Wednesdays come back', () => {
  assert.ok(out.days.length > 0, 'no days');
  for (const d of out.days) assert.ok([2, 3].includes(DateTime.fromISO(d.date, { zone: TZ }).weekday), d.date);
});
check('the first one offered is the Tuesday of the week after next', () => {
  assert.strictEqual(out.days[0].date, nextMon.plus({ weeks: 1, days: 1 }).toFormat('yyyy-MM-dd'));
  assert.strictEqual(out.days[0].laterWeek, true);
});
check('next week\'s full Tuesday and Wednesday are named', () => {
  assert.deepStrictEqual(out.fullRequestedDays.map((d) => d.date), [1, 2].map((i) => nextMon.plus({ days: i }).toFormat('yyyy-MM-dd')));
  assert.ok(/were full/.test(out.lookAhead) && /FIRST clear one/.test(out.lookAhead), out.lookAhead);
});
check('looks no further than two weeks past next week', () => {
  const horizon = DateTime.fromISO(firstFarWeekDate(TZ), { zone: TZ }).plus({ weeks: 2 }).toFormat('yyyy-MM-dd');
  assert.ok(out.days.every((d) => d.date < horizon), JSON.stringify(out.days.map((d) => d.date)));
  assert.ok(!out.days.some((d) => d.date >= nextMon.plus({ weeks: 3 }).toFormat('yyyy-MM-dd')));
});

console.log('\nnamed day free next week:');
const thu = filterAvailability(avail, prefs, { weekdays: ['Thursday'] });
check('next Thursday comes first, nothing reported full', () => {
  assert.strictEqual(thu.days[0].date, nextMon.plus({ days: 3 }).toFormat('yyyy-MM-dd'));
  assert.strictEqual(thu.fullRequestedDays.length, 0);
});

console.log('\nno named day free anywhere in the window:');
const none = filterAvailability({ ...avail, days: avail.days.map((d) => ({ ...d, freeSlots: [] })) }, prefs, { weekdays: ['Tue'] });
check('empty, with a plain "tell the coach" note', () => {
  assert.strictEqual(none.days.length, 0);
  assert.ok(/no clear Tuesday/.test(none.lookAhead), none.lookAhead);
});

console.log('\nwithout weekdays nothing changes:');
const plain = filterAvailability(avail, prefs, {});
check('no lookAhead fields, nearness rule still trims to the near window', () => {
  assert.strictEqual(plain.lookAhead, undefined);
  assert.ok(plain.days.every((d) => d.date < firstFarWeekDate(TZ)), JSON.stringify(plain.days.map((d) => d.date)));
});

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
