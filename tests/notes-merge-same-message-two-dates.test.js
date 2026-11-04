/**
 * Tests for "the same LinkedIn message never sits on a record under two dates"
 * (utils/notesSectionManager.js mergeAndSortMessages, 4 Nov 2026).
 *
 * The merge used to dedupe on the whole line, date stamp included. When the extension missed a day
 * label and saved a message under the previous day's date, the next capture (which read the label)
 * added a second copy under the right date and the wrong one could never be corrected: Kate Hughes'
 * 21 Aug reply sat on her record as 11 July AND 21 August; Chris White's, Kent Wilson's the same.
 *
 * Contracts:
 *   1. Same text + same clock time under two dates collapses to ONE line, and the later date wins.
 *   2. Different messages are all kept; a genuine repeat at a different time is kept.
 *   3. The existing clip-retirement still works (longer copy survives).
 *   4. Sort order is newest first.
 *   5. Lines that are not messages pass through unchanged.
 *
 * Run: node tests/notes-merge-same-message-two-dates.test.js
 */
const assert = require('assert');
const { mergeAndSortMessages } = require('../utils/notesSectionManager');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const KATE_OLD = '11-07-26 4:09 PM - Kate Hughes - Hi Guy, This is embarrassingly late and entirely my fault.';
const KATE_NEW = '21-08-26 4:09 PM - Kate Hughes - Hi Guy, This is embarrassingly late and entirely my fault.';
const GUY_JUL = '11-07-26 3:09 PM - Guy Wilson - Hi Kate, No worries at all - August works perfectly.';

test('1. same message under two dates collapses to one line, later date wins', () => {
  const merged = mergeAndSortMessages([GUY_JUL, KATE_OLD].join('\n'), [KATE_NEW].join('\n'));
  const lines = merged.split('\n');
  assert.deepStrictEqual(lines, [KATE_NEW, GUY_JUL]);
  // and the other way round: the right-dated copy is already stored, the wrong one arrives later
  const merged2 = mergeAndSortMessages([KATE_NEW, GUY_JUL].join('\n'), [KATE_OLD].join('\n'));
  assert.deepStrictEqual(merged2.split('\n'), [KATE_NEW, GUY_JUL]);
});

test('2. different messages are kept; a genuine repeat at a different time is kept', () => {
  const a = '19-10-26 9:27 AM - Guy Wilson - Thanks!';
  const b = '19-10-26 9:51 AM - Craig Carolan - Thanks!';
  const c = '04-11-26 1:33 PM - Craig Carolan - Can we reschedule?';
  const merged = mergeAndSortMessages([a, b].join('\n'), [c].join('\n'));
  assert.deepStrictEqual(merged.split('\n'), [c, b, a]);
});

test('3. clip retirement still works - the longer copy survives', () => {
  const full = '19-10-26 9:27 AM - Guy Wilson - ' + 'Hi Craig, thanks for connecting. I love your focus on understanding first and then providing the right solution.';
  const clip = '19-10-26 9:27 AM - Guy Wilson - ' + 'Hi Craig, thanks for connecting. I love your focus on understanding first and then';
  const merged = mergeAndSortMessages(clip, full);
  assert.deepStrictEqual(merged.split('\n'), [full]);
});

test('4. newest first', () => {
  const x = '01-01-26 9:00 AM - A B - one';
  const y = '02-01-26 9:00 AM - A B - two';
  assert.deepStrictEqual(mergeAndSortMessages(x, y).split('\n'), [y, x]);
  assert.deepStrictEqual(mergeAndSortMessages(x, y, false).split('\n'), [x, y]);
});

test('5. non-message lines pass through', () => {
  const note = 'Some stray line';
  const msg = '02-01-26 9:00 AM - A B - two';
  const merged = mergeAndSortMessages(note, msg);
  assert.ok(merged.includes(note) && merged.includes(msg));
});

console.log(`\n${passed} passed${process.exitCode ? ' - FAILURES above' : ''}`);
