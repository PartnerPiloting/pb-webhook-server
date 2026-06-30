/**
 * Tests for the multi-tenant Nylas availability read (2026-06-30).
 *
 * Gap closed: the booking WRITE was already per-tenant Nylas, but the availability READ only worked
 * via the Google service account (a calendar shared with us) — so a Nylas-only client (onboarded via
 * hosted auth, no service-account share) could be booked but their free/busy couldn't be read. This
 * adds a Nylas read path: busy events → free 30-min slots, business hours + day boundaries computed in
 * the coach's timezone (luxon, DST-correct). buildDaysFromBusy is the pure core, tested here directly.
 *
 * Run: node tests/wingguy-nylas-availability.test.js
 */
const assert = require('assert');
const { buildDaysFromBusy } = require('../services/wingguyCalendar');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const TZ = 'Australia/Brisbane'; // AEST, no DST in July
const busy = [
  { start: '2026-07-09T10:00:00+10:00', end: '2026-07-09T11:00:00+10:00' }, // 10:00–11:00
  { start: '2026-07-09T13:30:00+10:00', end: '2026-07-09T14:00:00+10:00' }, // 1:30–2:00
];

console.log('buildDaysFromBusy() — free slots computed from a coach\'s busy meetings:');
const days = buildDaysFromBusy({ busyEvents: busy, dates: ['2026-07-09'], yourTimezone: TZ, leadTimezone: TZ });
const d = days[0];
const times = d.freeSlots.map((s) => s.display);

check('returns one day, labelled Thu', () => assert.strictEqual(d.day, 'Thu'));
check('meetingCount reflects the two busy events', () => assert.strictEqual(d.meetingCount, 2));
check('business hours: first slot 9:00 am', () => assert.strictEqual(times[0], '9:00 am'));
check('last slot starts 4:30 pm (ends by 5:00)', () => assert.ok(times.includes('4:30 pm')));
check('never offers a 5:00 pm start (past business hours)', () => assert.ok(!times.includes('5:00 pm')));
check('blocks the 10:00 am busy slot', () => assert.ok(!times.includes('10:00 am')));
check('blocks the 10:30 am busy slot', () => assert.ok(!times.includes('10:30 am')));
check('11:00 am is free again', () => assert.ok(times.includes('11:00 am')));
check('blocks the 1:30 pm busy slot', () => assert.ok(!times.includes('1:30 pm')));
check('2:00 pm is free again', () => assert.ok(times.includes('2:00 pm')));
check('each slot carries an ISO time for booking', () => assert.ok(d.freeSlots.every((s) => !isNaN(Date.parse(s.time)))));
check('each slot carries a lead-timezone display', () => assert.ok(d.freeSlots.every((s) => typeof s.leadDisplay === 'string' && s.leadDisplay.length)));

// Cross-timezone: a Perth lead (AWST, UTC+8) sees the SAME instant 2h earlier.
const perth = buildDaysFromBusy({ busyEvents: [], dates: ['2026-07-09'], yourTimezone: TZ, leadTimezone: 'Australia/Perth' });
const nine = perth[0].freeSlots.find((s) => s.display === '9:00 am');
check('lead display is timezone-shifted (9:00 am Brisbane → 7:00 am Perth)', () => assert.ok(/7:00\s*am/i.test(nine.leadDisplay), nine.leadDisplay));

console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all nylas-availability tests passed');
process.exit(failures ? 1 : 0);
