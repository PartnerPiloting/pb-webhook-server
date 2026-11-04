/**
 * Tests for "a LinkedIn day label is recognised by what it says, and the just-sent message is
 * always today's" (wingguy-extension/content-wingguy.js 0.3.38, Craig Carolan 2026-11-04).
 *
 * On 4 Nov 2026 Craig replied at 1:33 PM and Guy answered at 1:56 PM. LinkedIn showed "Today" above
 * them; the scrape did not pick it up, so both were saved under the previous label's date, 19 Oct.
 * The record then read as "nothing for two weeks" and the inbox check told Guy the reply had not
 * arrived. Five other leads carried a borrowed date like that going back to July.
 *
 * The content script is one big IIFE that needs a LinkedIn DOM, so this test lifts the pure helpers
 * out of the REAL file (between marker comments) and runs that - what is tested is the code that
 * ships, not a copy.
 *
 * Contracts:
 *   1. dayLabelOf reads every shape LinkedIn uses and hands back the one shape the server parses.
 *   2. Text that is not a day label (a time, a name, a message, long text) is never taken for one.
 *   3. dayLabelDaysAgo resolves labels to days-ago, with a bare weekday meaning last week's.
 *   4. stampNewestAsToday stamps the coach's just-sent message Today when its label was missed or
 *      resolved to another day, and reports what the label said.
 *   5. It leaves a newest message from the LEAD alone (it may genuinely be older).
 *   6. It leaves a correctly-labelled newest message alone.
 *   7. The helpers really are in the shipping file and both scrapes and the formatter use them.
 *
 * Run: node tests/wingguy-extension-day-labels.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'wingguy-extension', 'content-wingguy.js');
const src = fs.readFileSync(FILE, 'utf8');

function lift(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker);
  assert.ok(a > 0 && b > a, `${startMarker} block not found in content-wingguy.js`);
  return src.slice(a, b);
}
const block = lift('// ---- dayLabels (pure;', '// ---- end dayLabels ----');
const { dayLabelOf, dayLabelDaysAgo, stampNewestAsToday } = new Function(
  block + '\nreturn { dayLabelOf, dayLabelDaysAgo, stampNewestAsToday };'
)();

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('dayLabelOf');
test('1. every LinkedIn day-label shape comes back in the server-parsable shape', () => {
  assert.strictEqual(dayLabelOf('Today'), 'Today');
  assert.strictEqual(dayLabelOf('TODAY'), 'Today');
  assert.strictEqual(dayLabelOf('  yesterday '), 'Yesterday');
  assert.strictEqual(dayLabelOf('Saturday'), 'Saturday');
  assert.strictEqual(dayLabelOf('Oct 19'), 'Oct 19');
  assert.strictEqual(dayLabelOf('OCT 19'), 'Oct 19');
  assert.strictEqual(dayLabelOf('Oct 19, 2025'), 'Oct 19, 2025');
  assert.strictEqual(dayLabelOf('Oct 19 2025'), 'Oct 19, 2025');
  assert.strictEqual(dayLabelOf('October 19'), 'Oct 19');
  assert.strictEqual(dayLabelOf('Sept. 4'), 'Sep 4');
  assert.strictEqual(dayLabelOf('19 Oct'), 'Oct 19');
  assert.strictEqual(dayLabelOf('19 October 2025'), 'Oct 19, 2025');
  assert.strictEqual(dayLabelOf('4 Nov'), 'Nov 4');
});
test('2. things that are not a day label are never taken for one', () => {
  for (const t of ['1:33 PM', '9:27 AM', 'Craig Carolan', 'Guy Wilson', 'See you Monday at 3', 'Oct', '32 Oct',
    'Today I sent the invite', 'Sent at 10/19/2026, 9:27 AM', '', null, undefined, 'x'.repeat(40)]) {
    assert.strictEqual(dayLabelOf(t), '', `"${t}" should not be a day label`);
  }
});

console.log('dayLabelDaysAgo');
test('3. labels resolve to days-ago; a bare weekday is last week\'s; unreadable is null', () => {
  const wed = new Date(2026, 10, 4, 15, 0); // Wed 4 Nov 2026
  assert.strictEqual(dayLabelDaysAgo('Today', wed), 0);
  assert.strictEqual(dayLabelDaysAgo('Yesterday', wed), 1);
  assert.strictEqual(dayLabelDaysAgo('Monday', wed), 2);
  assert.strictEqual(dayLabelDaysAgo('Wednesday', wed), 7);
  assert.strictEqual(dayLabelDaysAgo('Oct 19', wed), 16);
  assert.strictEqual(dayLabelDaysAgo('19 October', wed), 16);
  assert.strictEqual(dayLabelDaysAgo('Nov 4', wed), 0);
  assert.strictEqual(dayLabelDaysAgo('Dec 1', wed), 338); // no year and in the future = last year's
  assert.strictEqual(dayLabelDaysAgo('', wed), null);
  assert.strictEqual(dayLabelDaysAgo('whenever', wed), null);
});

console.log('stampNewestAsToday');
const wed = new Date(2026, 10, 4, 14, 0);
function craigThread(lastDay) {
  return [
    { sender: 'Guy Wilson', text: 'Perfect, Craig - invite sent.', day: 'Oct 19', time: '9:53 AM' },
    { sender: 'Craig Carolan', text: 'Guy I am sorry. Can we reschedule?', day: lastDay, time: '1:33 PM' },
    { sender: 'Guy Wilson', text: 'Hi Craig - no worries at all.', day: lastDay, time: '1:56 PM' },
  ];
}
test('4. the coach\'s just-sent message gets Today when its label was missed (the Craig shape)', () => {
  const t = craigThread('Oct 19');
  assert.strictEqual(stampNewestAsToday(t, 'Craig Carolan', wed), 'Oct 19');
  assert.strictEqual(t[2].day, 'Today');
  assert.strictEqual(t[1].day, 'Oct 19', 'only the newest message is stamped - the rest is the parser\'s job');
  const t2 = craigThread('');
  assert.strictEqual(stampNewestAsToday(t2, 'Craig Carolan', wed), '(no label)');
  assert.strictEqual(t2[2].day, 'Today');
});
test('5. a newest message from the LEAD is left alone', () => {
  const t = craigThread('Oct 19').slice(0, 2); // Craig spoke last
  assert.strictEqual(stampNewestAsToday(t, 'Craig Carolan', wed), null);
  assert.strictEqual(t[1].day, 'Oct 19');
  const u = [{ sender: 'Unknown', text: 'hi', day: 'Oct 19', time: '1:00 PM' }];
  assert.strictEqual(stampNewestAsToday(u, 'Craig Carolan', wed), null, 'an unknown sender is not assumed to be the coach');
});
test('6. a correctly-labelled newest message is left alone', () => {
  const t = craigThread('Today');
  assert.strictEqual(stampNewestAsToday(t, 'Craig Carolan', wed), null);
  const n = craigThread('Nov 4');
  assert.strictEqual(stampNewestAsToday(n, 'Craig Carolan', wed), null);
  assert.strictEqual(stampNewestAsToday([], 'Craig', wed), null);
});

console.log('shipping file');
test('7. both scrapes and the formatter use the helpers', () => {
  assert.ok(/function scrapeNewUiThread[\s\S]*?dayLabelOf\(/.test(src), 'new-UI scrape uses dayLabelOf');
  assert.ok(/function scrapeOpenThread[\s\S]*?dayLabelOf\(/.test(src), 'classic scrape uses dayLabelOf');
  assert.ok(/function formatThreadForApi[\s\S]*?stampNewestAsToday\(/.test(src), 'formatter runs the backstop');
  assert.ok(/formatThreadForApi\(thread, \{ leadName: hdr\.name \}\)/.test(src), 'the Send capture passes the lead name');
  assert.ok(/thread day labels/.test(src), 'the labels read are logged for the next diagnosis');
});

console.log(`\n${passed} passed${process.exitCode ? ' - FAILURES above' : ''}`);
