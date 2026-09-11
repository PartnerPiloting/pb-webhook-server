/**
 * Tests for the "offered times have passed" row flag (services/wingguyOfferedTimes.js, Guy
 * 2026-09-11 - the Simon Haines case: the stored suggestion was still floating Mon 7 / Wed 9 /
 * Thu 10 Sep on the 11th). Contracts:
 *   1. extractOfferedTimes reads AU-style slots (weekday + day + month [+ time]) and US-style
 *      (month day), with the year resolved from the send date (next year when the date reads
 *      earlier than the send date). Narrative dates without a weekday or time are NOT slots.
 *   2. offeredTimesSignal flags only when the coach spoke last, at least one slot was offered,
 *      and every slot is before today; the full email body is read when the timeline snippet
 *      is clipped.
 *
 * Pure. Synthetic content only. Run: node tests/wingguy-offered-times.test.js
 */
const assert = require('assert');
let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const { extractOfferedTimes, offeredTimesSignal } = require('../services/wingguyOfferedTimes');

const SIMON_EMAIL = `Hi Simon,

No apology needed - that one's on me for shuffling the time around in the first place.
Let's find a clean slot and get it in the diary properly.

Would any of the following times work for you?


Monday 7 September, 4:00 pm
Wednesday 9 September, 2:00 pm
Thursday 10 September, 11:00 am


(all times are Sydney time)

I've steered clear of Monday and Wednesday mornings as you asked.
Let me know which suits (or suggest an alternative) and I'll send a calendar invite with the Zoom link.

Cheers,
(I know a) Guy`;

console.log('wingguyOfferedTimes');

check('AU slots with times, year from the send date', () => {
  const s = extractOfferedTimes(SIMON_EMAIL, '2026-09-03');
  assert.deepStrictEqual(s.map((x) => x.iso), ['2026-09-07', '2026-09-09', '2026-09-10']);
  assert.deepStrictEqual(s.map((x) => x.label), ['Mon 7 Sep 4:00 pm', 'Wed 9 Sep 2:00 pm', 'Thu 10 Sep 11:00 am']);
});

check('short forms: "Mon 7 Sept 4pm", "Thu 10 Sept 11am", "Wed 26 August, 10:30 am"', () => {
  const s = extractOfferedTimes('- Mon 7 Sept 4pm\n- Thu 10 Sept 11am\nor Wed 26 August, 10:30 am', '2026-08-22');
  assert.deepStrictEqual(s.map((x) => x.label), ['Wed 26 Aug 10:30 am', 'Mon 7 Sep 4 pm', 'Thu 10 Sep 11 am']);
});

check('US order and an explicit year', () => {
  const s = extractOfferedTimes('How about Thursday, September 10 at 11am, or Friday September 11, 2026 10:00 am?', '2026-09-03');
  assert.deepStrictEqual(s.map((x) => `${x.iso} ${x.label}`), ['2026-09-10 Thu 10 Sep 11 am', '2026-09-11 Fri 11 Sep 10:00 am']);
});

check('a date earlier than the send date rolls to next year', () => {
  const s = extractOfferedTimes('Tuesday 6 January, 10:00 am or Wed 7 January 2pm', '2026-11-20');
  assert.deepStrictEqual(s.map((x) => x.iso), ['2027-01-06', '2027-01-07']);
});

check('narrative dates without a weekday or time are not slots', () => {
  assert.deepStrictEqual(extractOfferedTimes('Thanks for the call on 26 August - I went through all three links. Since 3 September nothing.', '2026-09-03'), []);
});

check('impossible dates are skipped', () => {
  assert.deepStrictEqual(extractOfferedTimes('Wednesday 31 September, 2pm', '2026-09-03'), []);
});

const simonSig = {
  lastOutbound: { date: '2026-09-03', subject: 'Re: Simon', text: SIMON_EMAIL },
  timelineTail: [
    { date: '2026-09-03', kind: 'email', dir: 'them', text: 'Sorry - thought this was 330.' },
    { date: '2026-09-03', kind: 'email', dir: 'you', text: 'Hi Simon, No apology needed - that one\'s on me for shuffling the time around in the first place. Let\'s find a clean slot and get it in the diary properly. Would any of the following times work for you? …[record clipped]' },
    { date: '2026-09-03', kind: 'linkedin', dir: 'you', text: 'Hi Simon, No apology needed ... - Monday 7 September, 4:00 pm - Wednesday 9 September, 2:00 pm - Thursday 10 September, 11:00 am ( …[record clipped]' },
  ],
};

check('Simon on 11 Sep: coach spoke last, all three slots passed -> flagged with the labels', () => {
  const r = offeredTimesSignal(simonSig, '2026-09-11');
  assert.ok(r && r.passed, JSON.stringify(r));
  assert.deepStrictEqual(r.times, ['Mon 7 Sep 4:00 pm', 'Wed 9 Sep 2:00 pm', 'Thu 10 Sep 11:00 am']);
  assert.strictEqual(r.offeredOn, '2026-09-03');
});

check('Simon on 8 Sep: two slots still ahead -> no flag', () => {
  assert.strictEqual(offeredTimesSignal(simonSig, '2026-09-08'), null);
});

check('the full email body is read when the timeline snippet is clipped before the times', () => {
  const sig = { lastOutbound: simonSig.lastOutbound, timelineTail: [simonSig.timelineTail[1]] };
  const r = offeredTimesSignal(sig, '2026-09-11');
  assert.ok(r && r.passed && r.times.length === 3, JSON.stringify(r));
});

check('they replied after the offer -> no flag (their reply supersedes it)', () => {
  const sig = { ...simonSig, timelineTail: [...simonSig.timelineTail, { date: '2026-09-09', kind: 'email', dir: 'them', text: 'None of those work, sorry.' }] };
  assert.strictEqual(offeredTimesSignal(sig, '2026-09-11'), null);
});

check('a calendar accept after the offer does not count as their reply', () => {
  const sig = { ...simonSig, timelineTail: [...simonSig.timelineTail, { date: '2026-09-04', kind: 'calendar', dir: 'them', text: 'Accepted' }] };
  assert.ok(offeredTimesSignal(sig, '2026-09-11'));
});

check('an older full email must not be read against a newer LinkedIn message', () => {
  const sig = {
    lastOutbound: { date: '2026-08-22', text: 'Would Wed 26 August, 10:30 am suit?' },
    timelineTail: [{ date: '2026-09-03', kind: 'linkedin', dir: 'you', text: 'Hope the move went well - talk soon.' }],
  };
  assert.strictEqual(offeredTimesSignal(sig, '2026-09-11'), null);
});

check('no material -> null', () => {
  assert.strictEqual(offeredTimesSignal(null, '2026-09-11'), null);
  assert.strictEqual(offeredTimesSignal({ lastOutbound: null, timelineTail: [] }, '2026-09-11'), null);
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
