/**
 * Tests for the save-time date guard on LinkedIn conversation captures (utils/captureDateGuard.js,
 * 4 Nov 2026). The guard is what makes a wrong date LOUD: Craig Carolan's reply was saved as 19 Oct
 * on 4 Nov and nobody was told for four months.
 *
 * Contracts:
 *   1. The Craig shape - newest message of a Send capture not dated today - is a problem.
 *   2. A clean Send capture (newest message today) passes.
 *   3. A hand-pasted old conversation (not on-Send) is NOT flagged for being old.
 *   4. A future date is a problem, Send or not.
 *   5. The same message under two dates in the merged record is a problem.
 *   6. The email names the lead and says what to check; the throttle allows one per key per day.
 *
 * Run: node tests/capture-date-guard.test.js
 */
const assert = require('assert');
const { checkCaptureDates, captureAlertEmail, shouldAlert, resetAlertThrottle } = require('../utils/captureDateGuard');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const today = new Date(2026, 10, 4, 14, 0); // 4 Nov 2026, Brisbane afternoon
const msg = (date, time, sender, message) => ({ date, time, sender, message });

test('1. newest message of a Send capture not dated today = problem (the Craig shape)', () => {
  const problems = checkCaptureDates({
    today,
    messages: [
      msg('19-10-26', '9:53 AM', 'Guy Wilson', 'Perfect, Craig - invite sent.'),
      msg('19-10-26', '1:33 PM', 'Craig Carolan', 'Can we reschedule?'),
      msg('19-10-26', '1:56 PM', 'Guy Wilson', 'Hi Craig - no worries at all.'),
    ],
    justSent: true,
  });
  assert.deepStrictEqual(problems.map((p) => p.code), ['newest_not_today']);
  assert.ok(/19-10-26/.test(problems[0].detail) && /04-11-26/.test(problems[0].detail));
});

test('2. a clean Send capture passes', () => {
  const problems = checkCaptureDates({
    today,
    messages: [
      msg('19-10-26', '9:53 AM', 'Guy Wilson', 'Perfect, Craig - invite sent.'),
      msg('04-11-26', '1:33 PM', 'Craig Carolan', 'Can we reschedule?'),
      msg('04-11-26', '1:56 PM', 'Guy Wilson', 'Hi Craig - no worries at all.'),
    ],
    mergedSection: ['04-11-26 1:56 PM - Guy Wilson - Hi Craig - no worries at all.', '04-11-26 1:33 PM - Craig Carolan - Can we reschedule?', '19-10-26 9:53 AM - Guy Wilson - Perfect, Craig - invite sent.'].join('\n'),
    justSent: true,
  });
  assert.deepStrictEqual(problems, []);
});

test('3. a hand-pasted old conversation is not flagged for being old', () => {
  const problems = checkCaptureDates({ today, messages: [msg('19-10-26', '9:53 AM', 'Guy Wilson', 'old')], justSent: false });
  assert.deepStrictEqual(problems, []);
});

test('4. a future date is a problem', () => {
  const problems = checkCaptureDates({ today, messages: [msg('05-11-26', '9:00 AM', 'Guy Wilson', 'tomorrow?')], justSent: false });
  assert.deepStrictEqual(problems.map((p) => p.code), ['future_date']);
});

test('5. the same message under two dates in the record is a problem', () => {
  const problems = checkCaptureDates({
    today,
    messages: [msg('04-11-26', '4:09 PM', 'Kate Hughes', 'This is embarrassingly late.')],
    mergedSection: [
      '04-11-26 4:09 PM - Kate Hughes - This is embarrassingly late.',
      '11-07-26 4:09 PM - Kate Hughes - This is embarrassingly late.',
    ].join('\n'),
    justSent: true,
  });
  assert.deepStrictEqual(problems.map((p) => p.code), ['same_message_two_dates']);
});

test('6. the email names the lead and what to check; one alert per key per day', () => {
  const mail = captureAlertEmail({ leadName: 'Craig Carolan', clientName: 'Guy Wilson', problems: [{ code: 'newest_not_today', detail: 'newest is 19-10-26' }] });
  assert.ok(/Craig Carolan/.test(mail.subject));
  assert.ok(/newest is 19-10-26/.test(mail.text) && /day label/.test(mail.text));
  assert.ok(!/—/.test(mail.text), 'house style: no em dashes');
  resetAlertThrottle();
  assert.strictEqual(shouldAlert('Guy-Wilson:rec1', 1000), true);
  assert.strictEqual(shouldAlert('Guy-Wilson:rec1', 1000 + 3600 * 1000), false);
  assert.strictEqual(shouldAlert('Guy-Wilson:rec2', 1000), true);
  assert.strictEqual(shouldAlert('Guy-Wilson:rec1', 1000 + 25 * 3600 * 1000), true);
});

console.log(`\n${passed} passed${process.exitCode ? ' - FAILURES above' : ''}`);
