/**
 * Tests for multi-calendar read scope + all-day event handling (2026-07-17).
 *
 * Gap closed: every provider read exactly ONE calendar, so the no-double-book guarantee was blind
 * to a coach's other calendars; and all-day events were silently dropped everywhere — right for
 * availability (a "Leave" marker isn't a 30-min clash), wrong for listing ("what's on today?").
 * Now: read scope comes from `Calendar Read IDs` (blank = old behaviour | "all" | explicit ids),
 * writes stay pinned to `Calendar Write ID`, and all-day events map with allDay:true — surfaced by
 * the listing path (includeAllDay), still dropped by availability/clash/splitter paths.
 *
 * Run: node tests/wingguy-multi-calendar.test.js
 */
const assert = require('assert');
const {
  parseReadIds, dedupEvents, allDaySpan, zohoDateOnly,
  mapNylasEvent, mapZohoEvent, googleAllDayNormalise,
} = require('../services/calendarProvider');
const { buildDaysFromBusy } = require('../services/wingguyCalendar');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const TZ = 'Australia/Brisbane'; // AEST, UTC+10, no DST

console.log('parseReadIds() — the Calendar Read IDs field grammar:');
check('blank -> null (single default calendar, old behaviour)', () => assert.strictEqual(parseReadIds({}), null));
check('empty string -> null', () => assert.strictEqual(parseReadIds({ calendarReadIds: '  ' }), null));
check('"all" -> "all" (case-insensitive)', () => assert.strictEqual(parseReadIds({ calendarReadIds: 'ALL' }), 'all'));
check('comma list -> trimmed id array', () => assert.deepStrictEqual(parseReadIds({ calendarReadIds: ' a1 , b2,c3 ' }), ['a1', 'b2', 'c3']));
check('newline-separated also works', () => assert.deepStrictEqual(parseReadIds({ calendarReadIds: 'a1\nb2' }), ['a1', 'b2']));

console.log('\ndedupEvents() — same block of time on two calendars appears once:');
const dup = [
  { summary: 'Standup', start: 'A', end: 'B', calendarId: 'work' },
  { summary: 'Standup', start: 'A', end: 'B', calendarId: 'personal' },
  { summary: 'Standup', start: 'A', end: 'C', calendarId: 'personal' },
];
check('duplicate (summary,start,end) dropped; different end kept', () => assert.strictEqual(dedupEvents(dup).length, 2));

console.log('\nallDaySpan() — coach-local midnights, exclusive end:');
const oneDay = allDaySpan('2026-07-16', null, TZ);
check('one-day span starts at local midnight (UTC-10h)', () => assert.strictEqual(oneDay.start, '2026-07-15T14:00:00.000Z'));
check('one-day span ends at the NEXT local midnight', () => assert.strictEqual(oneDay.end, '2026-07-16T14:00:00.000Z'));
const multi = allDaySpan('2026-07-16', '2026-07-19', TZ);
check('multi-day span honours the exclusive end date', () => assert.strictEqual(multi.end, '2026-07-18T14:00:00.000Z'));
check('end<=start degrades to a one-day span', () => assert.strictEqual(allDaySpan('2026-07-16', '2026-07-16', TZ).end, '2026-07-16T14:00:00.000Z'));
check('garbage date -> null', () => assert.strictEqual(allDaySpan('not-a-date', null, TZ), null));

console.log('\nzohoDateOnly() — bare yyyyMMdd all-day dates:');
check('20260716 -> 2026-07-16', () => assert.strictEqual(zohoDateOnly('20260716'), '2026-07-16'));
check('timed datetime -> null', () => assert.strictEqual(zohoDateOnly('20260716T090000Z'), null));

console.log('\nmapNylasEvent() — all-day shapes map with allDay:true; timed events untouched:');
const nylasTimed = mapNylasEvent({ title: 'Call', when: { start_time: 1752624000, end_time: 1752625800 }, participants: [] }, 'me@x.com', TZ);
check('timed event maps without allDay', () => assert.ok(nylasTimed && !nylasTimed.allDay));
const nylasDate = mapNylasEvent({ title: 'Leave', when: { object: 'date', date: '2026-07-16' }, participants: [] }, 'me@x.com', TZ);
check('when.object=date maps as allDay', () => assert.ok(nylasDate && nylasDate.allDay === true));
check('all-day start is the coach-local midnight', () => assert.strictEqual(nylasDate.start, '2026-07-15T14:00:00.000Z'));
const nylasSpan = mapNylasEvent({ title: 'Conf', when: { object: 'datespan', start_date: '2026-07-16', end_date: '2026-07-18' }, participants: [] }, 'me@x.com', TZ);
check('datespan maps as allDay across the span', () => assert.ok(nylasSpan.allDay && nylasSpan.end === '2026-07-17T14:00:00.000Z'));
check('no usable time shape -> null', () => assert.strictEqual(mapNylasEvent({ title: 'x', when: {} }, 'me@x.com', TZ), null));

console.log('\nmapZohoEvent() — sentinel + bare-date all-day:');
check('the "No events found." sentinel maps to null', () => assert.strictEqual(mapZohoEvent({ message: 'No events found.' }, 'me@x.com', TZ), null));
check('null event maps to null', () => assert.strictEqual(mapZohoEvent(null, 'me@x.com', TZ), null));
const zohoAllDay = mapZohoEvent({ title: 'Leave', dateandtime: { start: '20260716', end: '20260717' } }, 'me@x.com', TZ);
check('bare-date event maps as allDay at local midnights', () => assert.ok(zohoAllDay && zohoAllDay.allDay && zohoAllDay.start === '2026-07-15T14:00:00.000Z'));
const zohoTimed = mapZohoEvent({ title: 'Call', dateandtime: { start: '20260716T000000Z', end: '20260716T003000Z' } }, 'me@x.com', TZ);
check('timed Zoho event still maps without allDay', () => assert.ok(zohoTimed && !zohoTimed.allDay));

console.log('\ngoogleAllDayNormalise() — date-only Google events get flagged + pinned:');
const gAllDay = googleAllDayNormalise({ summary: 'Leave', start: '2026-07-16', end: '2026-07-17' }, TZ, 'cal@x.com');
check('date-only start flags allDay + local midnights', () => assert.ok(gAllDay.allDay && gAllDay.start === '2026-07-15T14:00:00.000Z'));
check('carries its source calendar id', () => assert.strictEqual(gAllDay.calendarId, 'cal@x.com'));
const gTimed = googleAllDayNormalise({ summary: 'Call', start: '2026-07-16T09:00:00+10:00', end: '2026-07-16T09:30:00+10:00' }, TZ, 'cal@x.com');
check('timed event passes through unflagged', () => assert.ok(!gTimed.allDay && gTimed.start === '2026-07-16T09:00:00+10:00'));

console.log('\nbuildDaysFromBusy() — an all-day event must never blanket-block a day:');
const days = buildDaysFromBusy({
  busyEvents: [
    { start: '2026-07-15T14:00:00.000Z', end: '2026-07-16T14:00:00.000Z', allDay: true }, // all-day Leave (16th)
    { start: '2026-07-16T10:00:00+10:00', end: '2026-07-16T11:00:00+10:00' },             // real meeting
  ],
  dates: ['2026-07-16'], yourTimezone: TZ, leadTimezone: TZ,
});
const times = days[0].freeSlots.map((s) => s.display);
check('9:00 am is still free despite the all-day marker', () => assert.ok(times.includes('9:00 am')));
check('the real 10:00 meeting still blocks its slot', () => assert.ok(!times.includes('10:00 am')));
check('meetingCount counts only the timed meeting', () => assert.strictEqual(days[0].meetingCount, 1));

console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all multi-calendar tests passed');
process.exit(failures ? 1 : 0);
