/**
 * Tests for the dates the drafter is given on a LinkedIn thread (utils/threadDates.js and
 * buildConversationBlock in routes/wingguyRoutes.js, 5 Nov 2026).
 *
 * David Gould, 5 Nov 2026: nine reconnect drafts in two days answered messages from 2017-2019 as
 * if they had just arrived. The extension had sent every message's date; the server dropped them.
 *
 * Contracts:
 *   1. Day labels resolve: Today, Yesterday, a weekday, "Aug 13, 2018", "13 Aug 2018", "JUN 17".
 *   2. A label with no year is the most recent such day NOT after today (never a future date).
 *   3. An unreadable label is null - never today, never a guess.
 *   4. The Tracy Jeffrey shape: every line carries its date, and the note on top says the newest
 *      message was 13 Aug 2018, 8 years ago, and that nothing in it is current.
 *   5. A fresh thread gets dates but no "old thread" warning.
 *   6. A thread with no readable dates says the age is unknown - it does not pass as recent.
 *   7. No conversation = empty block, as before.
 *
 * Run: node tests/wingguy-thread-dates.test.js
 */
const assert = require('assert');
const { todayIn, resolveDayLabel, formatDay, agoWords, threadDatesNote } = require('../utils/threadDates');
const { buildConversationBlock } = require('../routes/wingguyRoutes');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const today = new Date(2026, 10, 5); // Thu 5 Nov 2026
const ymd = (d) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// 6:08pm Brisbane on 5 Nov 2026 - still 5 Nov in Brisbane, and 5 Nov in UTC.
const now = new Date(Date.UTC(2026, 10, 5, 8, 8));
const opts = { timeZone: 'Australia/Brisbane', now };

test('labels with a year resolve, month-first and day-first', () => {
  assert.strictEqual(ymd(resolveDayLabel('Aug 13, 2018', today)), '2018-08-13');
  assert.strictEqual(ymd(resolveDayLabel('13 Aug 2018', today)), '2018-08-13');
  assert.strictEqual(ymd(resolveDayLabel('August 13, 2018', today)), '2018-08-13');
  assert.strictEqual(ymd(resolveDayLabel('FEB 11, 2018', today)), '2018-02-11');
});

test('Today, Yesterday and a weekday resolve against today', () => {
  assert.strictEqual(ymd(resolveDayLabel('Today', today)), '2026-11-05');
  assert.strictEqual(ymd(resolveDayLabel('YESTERDAY', today)), '2026-11-04');
  assert.strictEqual(ymd(resolveDayLabel('Monday', today)), '2026-11-02');
  assert.strictEqual(ymd(resolveDayLabel('Thursday', today)), '2026-11-05');
  assert.strictEqual(ymd(resolveDayLabel('Friday', today)), '2026-10-30');
});

test('a label with no year is never in the future', () => {
  assert.strictEqual(ymd(resolveDayLabel('Oct 19', today)), '2026-10-19');
  assert.strictEqual(ymd(resolveDayLabel('JUN 17', today)), '2026-06-17');
  assert.strictEqual(ymd(resolveDayLabel('Nov 5', today)), '2026-11-05');
  assert.strictEqual(ymd(resolveDayLabel('Dec 4', today)), '2025-12-04');
  assert.strictEqual(ymd(resolveDayLabel('Nov 6', today)), '2025-11-06');
});

test('an unreadable label is null, not today', () => {
  assert.strictEqual(resolveDayLabel('', today), null);
  assert.strictEqual(resolveDayLabel('2:15 PM', today), null);
  assert.strictEqual(resolveDayLabel('New messages', today), null);
  assert.strictEqual(resolveDayLabel('Feb 31, 2018', today), null);
});

test('ago words read like a person would say them', () => {
  assert.strictEqual(agoWords(new Date(2018, 7, 13), today), '8 years 2 months ago');
  assert.strictEqual(agoWords(new Date(2025, 10, 5), today), '1 year ago');
  assert.strictEqual(agoWords(new Date(2026, 6, 20), today), '3 months ago');
  assert.strictEqual(agoWords(new Date(2026, 10, 2), today), '3 days ago');
  assert.strictEqual(agoWords(new Date(2026, 10, 5), today), 'today');
});

test('today is taken in the coach timezone, not the server one', () => {
  // 11pm UTC on 4 Nov is already 9am on 5 Nov in Brisbane.
  const lateUtc = new Date(Date.UTC(2026, 10, 4, 23, 0));
  assert.strictEqual(ymd(todayIn('Australia/Brisbane', lateUtc)), '2026-11-05');
  assert.strictEqual(ymd(todayIn('America/New_York', lateUtc)), '2026-11-04');
});

const tracy = [
  { sender: 'David Gould', text: 'Hi Tracy, would you be open to a coffee?', day: 'Aug 9, 2018', time: '10:02 AM' },
  { sender: 'Tracy L. Jeffrey', text: 'Heading overseas for a month or so. Perhaps later in the year.', day: 'Aug 13, 2018', time: '4:41 PM' },
];

test('the Tracy Jeffrey thread: every line dated, and the note says 2018 and 8 years', () => {
  const block = buildConversationBlock(tracy, 'Tracy L. Jeffrey', null, opts);
  assert.ok(block.includes('[Thu 9 Aug 2018] David Gould: Hi Tracy'), block);
  assert.ok(block.includes('[Mon 13 Aug 2018] Tracy L. Jeffrey: Heading overseas'), block);
  assert.ok(block.includes('today is Thu 5 Nov 2026'), block);
  assert.ok(block.includes('is from Tracy L. Jeffrey, sent Mon 13 Aug 2018 - 8 years 2 months ago'), block);
  assert.ok(block.includes("David Gould's newest: Thu 9 Aug 2018"), block);
  assert.ok(/THIS THREAD IS YEARS OLD/.test(block), block);
  assert.ok(/with the year named/.test(block), block);
  // The dates note comes BEFORE the messages, and the who-is-who line is still last.
  assert.ok(block.indexOf('MESSAGE DATES') < block.indexOf('[Thu 9 Aug 2018]'));
  assert.ok(block.trim().endsWith('draft Guy\'s next message.)'), block.slice(-120));
});

test('a fresh thread carries dates but no old-thread warning', () => {
  const fresh = [
    { sender: 'David Gould', text: 'Thanks for connecting, Sam.', day: 'Monday' },
    { sender: 'Sam Lee', text: 'Likewise - happy to chat.', day: 'Today' },
  ];
  const block = buildConversationBlock(fresh, 'Sam Lee', null, opts);
  assert.ok(block.includes('[Mon 2 Nov 2026] David Gould:'), block);
  assert.ok(block.includes('[Thu 5 Nov 2026] Sam Lee:'), block);
  assert.ok(block.includes('is from Sam Lee, sent Thu 5 Nov 2026 - today'), block);
  assert.ok(!/OLD|quiet for a while/.test(block), block);
});

test('a few months quiet gets the mild line, not the years-old one', () => {
  const block = buildConversationBlock([{ sender: 'Sam Lee', text: 'Flat out till the end of financial year.', day: 'Jun 17' }], 'Sam Lee', null, opts);
  assert.ok(/quiet for a while/.test(block), block);
  assert.ok(!/YEARS OLD/.test(block), block);
});

test('no readable dates: the age is stated as unknown, never assumed recent', () => {
  const undated = [{ sender: 'Sam Lee', text: 'Sorry we did not get to catch up in Feb.' }];
  const block = buildConversationBlock(undated, 'Sam Lee', null, opts);
  assert.ok(/could not be read/.test(block), block);
  assert.ok(/Do not assume any of it is recent/.test(block), block);
  assert.ok(block.includes('\nSam Lee: Sorry we did not'), block);
});

test('a label that cannot be read is shown as written, and does not count as a date', () => {
  const odd = [{ sender: 'Sam Lee', text: 'Hello', day: 'Sometime' }];
  const block = buildConversationBlock(odd, 'Sam Lee', null, opts);
  assert.ok(block.includes('[Sometime] Sam Lee: Hello'), block);
  assert.ok(/could not be read/.test(block), block);
});

test('no conversation is still an empty block', () => {
  assert.strictEqual(buildConversationBlock([], 'Sam Lee', null, opts), '');
  assert.strictEqual(buildConversationBlock(null, 'Sam Lee', null, opts), '');
  assert.strictEqual(threadDatesNote([], today), '');
  assert.strictEqual(formatDay(new Date(2018, 7, 13)), 'Mon 13 Aug 2018');
});

console.log(`\n${passed} passed${process.exitCode ? ' - WITH FAILURES' : ''}`);
