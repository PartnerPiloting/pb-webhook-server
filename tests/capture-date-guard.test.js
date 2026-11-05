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

// ---- dropForgedToday: a "sent today" date from an extension that cannot prove a send ----------
// Ashley Knowles, 5 Nov 2026. Real lines from his records.
const { dropForgedToday, isDroppedMessage } = require('../utils/captureDateGuard');
const ASH = 'Ashley Knowles';
const at = (h, m) => new Date(2026, 10, 5, h, m); // 5 Nov 2026, coach's clock
const PIERRE_OLD_IMPORT = "04-02-26 7:55 PM - Ashley Knowles - Hi Pierre, hope you're start to the year is going well! How's your calendar looking for a teams catchup in the next week or two? Cheers Ash";
const PIERRE_FORGED = "05-11-26 9:55 AM - Ashley Knowles - Hi Pierre, hope you're start to the year is going well! How's your calendar looking for a teams catchup in the next week or two?CheersAsh";
const PIERRE_REPLY = '11-12-25 4:33 PM - Pierre Fourie - Hey Ashley, I have been keenly following your rise.';

test('7. Pierre: an old message re-dated today is dropped - the record already has it under its real date', () => {
  const r = dropForgedToday({ incoming: `${PIERRE_FORGED}\n${PIERRE_REPLY}`, existingSection: `${PIERRE_OLD_IMPORT}\n${PIERRE_REPLY}`, coachName: ASH, now: at(10, 0), suspect: true });
  assert.strictEqual(r.action, 'dropped');
  assert.strictEqual(r.content, PIERRE_REPLY, 'only the forged line goes; the rest of the capture is kept');
  assert.ok(/04-02-26/.test(r.reason));
  assert.ok(isDroppedMessage({ date: '05-11-26', time: '9:55 AM', sender: ASH, message: "Hi Pierre, hope you're start to the year is going well! How's your calendar looking for a teams catchup in the next week or two?CheersAsh" }, r.dropped), 'the auto-cease is told which message to ignore');
  assert.ok(!isDroppedMessage({ date: '11-12-25', time: '4:33 PM', sender: 'Pierre Fourie', message: 'Hey Ashley, I have been keenly following your rise.' }, r.dropped));
});
test('8. Ed: never saved before, stamped 9:33 AM but saved at 10:13 - not a message just sent, dropped', () => {
  const forged = "05-11-26 9:33 AM - Ashley Knowles - I've got a flat out week this week, but would be great to jump on a call next week";
  const r = dropForgedToday({ incoming: forged, existingSection: '', coachName: ASH, now: at(10, 13), suspect: true });
  assert.strictEqual(r.action, 'dropped');
  assert.strictEqual(r.content, '');
  const evening = dropForgedToday({ incoming: "05-11-26 7:33 PM - Ashley Knowles - later than now", existingSection: '', coachName: ASH, now: at(10, 13), suspect: true });
  assert.strictEqual(evening.action, 'dropped', 'a clock time still to come today cannot have been sent');
});
test('9. a message really just sent is kept (clock time within minutes of the save)', () => {
  const sent = '05-11-26 10:06 AM - Ashley Knowles - Hi Pierre, saw the Sage Intacct AI masterclass you shared from Rockpool.';
  const r = dropForgedToday({ incoming: `${sent}\n${PIERRE_FORGED.replace('05-11-26', '04-02-26')}`, existingSection: PIERRE_OLD_IMPORT, coachName: ASH, now: at(10, 6), suspect: true });
  assert.strictEqual(r.action, 'none');
  assert.ok(r.content.includes(sent));
});
test('10. already on the record under today\'s date - left alone (a re-save of this morning\'s real send)', () => {
  const sent = '05-11-26 8:02 AM - Ashley Knowles - Morning Pierre, quick one before the day starts and gets away from us both.';
  const r = dropForgedToday({ incoming: sent, existingSection: sent, coachName: ASH, now: at(13, 0), suspect: true });
  assert.strictEqual(r.action, 'none');
});
test('11. the lead\'s messages, older dates and trusted extensions are never touched', () => {
  const lead = '05-11-26 6:00 AM - Pierre Fourie - Morning Ashley, sorry for the slow reply on this one.';
  assert.strictEqual(dropForgedToday({ incoming: lead, existingSection: '', coachName: ASH, now: at(13, 0), suspect: true }).action, 'none', 'the lead wrote last');
  assert.strictEqual(dropForgedToday({ incoming: PIERRE_OLD_IMPORT, existingSection: '', coachName: ASH, now: at(13, 0), suspect: true }).action, 'none', 'not dated today');
  assert.strictEqual(dropForgedToday({ incoming: PIERRE_FORGED, existingSection: PIERRE_OLD_IMPORT, coachName: ASH, now: at(10, 0), suspect: false }).action, 'none', '0.3.40+ states sendProven and is trusted');
  assert.strictEqual(dropForgedToday({ incoming: PIERRE_FORGED, existingSection: PIERRE_OLD_IMPORT, coachName: '', now: at(10, 0), suspect: true }).action, 'none', 'no coach name = cannot judge = hands off');
});
test('12. a short message is only a twin at the same clock time ("Yes" twice is two messages)', () => {
  const r = dropForgedToday({ incoming: '05-11-26 10:00 AM - Ashley Knowles - Yes', existingSection: '08-09-26 7:31 PM - Ashley Knowles - Yes', coachName: ASH, now: at(10, 0), suspect: true });
  assert.strictEqual(r.action, 'none');
  const same = dropForgedToday({ incoming: '05-11-26 10:00 AM - Ashley Knowles - Yes', existingSection: '08-09-26 10:00 AM - Ashley Knowles - Yes', coachName: ASH, now: at(10, 0), suspect: true });
  assert.strictEqual(same.action, 'dropped');
});
test('13. the route recognises the old extension and the new one states sendProven', () => {
  const fs = require('fs'), path = require('path');
  const route = fs.readFileSync(path.join(__dirname, '..', 'LinkedIn-Messaging-FollowUp', 'backend-extensions', 'routes', 'linkedinRoutesWithAuth.js'), 'utf8');
  assert.ok(route.includes('suspect: req.body.capturedOnSend === true && sendProven === null'));
  assert.ok(route.includes('parsedResult.messages.filter((m) => !isDroppedMessage(m, forged.dropped))'), 'the auto-cease never sees a dropped message');
  assert.ok(route.indexOf('dropForgedToday({') < route.indexOf('mergeAndSortMessages(existingSection, processedContent)'), 'checked before the merge');
  const bgSrc = fs.readFileSync(path.join(__dirname, '..', 'wingguy-extension', 'background.js'), 'utf8');
  assert.ok(bgSrc.includes('sendProven: extras.sendProven === true') && !bgSrc.includes('capturedOnSend: true'), 'the extension no longer claims every save is a send');
});

console.log(`\n${passed} passed in all${process.exitCode ? ' - FAILURES above' : ''}`);
