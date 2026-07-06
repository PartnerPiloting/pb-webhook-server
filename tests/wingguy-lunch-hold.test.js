/**
 * Regression test for the soft lunch hold in Wingguy booking.
 *
 * Bug (2026-06-29): a coach-noon slot was OFFERED to a same-timezone lead (Izack in Newcastle/NSW,
 * Guy in QLD — both AEST in July). Cause: check_availability only enforced start/finish hours, not
 * the lunch hold; only propose_times (the backstop) applied it. Fix: strip lunch at the source too,
 * via a shared inLunch() helper used by both.
 *
 * Run: node tests/wingguy-lunch-hold.test.js
 */
const assert = require('assert');
const { runWingguyChatTurn, inLunch } = require('../services/wingguyChat');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');

const prefs = getBookingPrefs('Guy-Wilson'); // lunch = 12:00 for 45m, soft
let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// All instants use +10:00 = AEST (July, no DST) — the real Izack/Guy scenario.
const NOON   = '2026-07-09T12:00:00+10:00';
const ELEVEN = '2026-07-09T11:00:00+10:00';
const Q_TO12 = '2026-07-09T11:45:00+10:00'; // 11:45–12:15 overlaps the 12:00 lunch start
const HALF1  = '2026-07-09T13:30:00+10:00'; // 1:30 pm
const NINE30 = '2026-07-09T09:30:00+10:00';

console.log('inLunch() — coach-timezone lunch detection:');
check('noon (Brisbane) is in lunch', () => assert.strictEqual(inLunch(NOON, 'Australia/Brisbane', prefs, 30), true));
check('same instant via Sydney (July AEST) is also lunch', () => assert.strictEqual(inLunch(NOON, 'Australia/Sydney', prefs, 30), true));
check('11:45 overlaps lunch start', () => assert.strictEqual(inLunch(Q_TO12, 'Australia/Brisbane', prefs, 30), true));
check('11:00 (ends 11:30) is NOT lunch', () => assert.strictEqual(inLunch(ELEVEN, 'Australia/Brisbane', prefs, 30), false));
check('1:30 pm is NOT lunch', () => assert.strictEqual(inLunch(HALF1, 'Australia/Brisbane', prefs, 30), false));
check('9:30 am is NOT lunch', () => assert.strictEqual(inLunch(NINE30, 'Australia/Brisbane', prefs, 30), false));

(async () => {
  console.log('\nEnd-to-end — a same-timezone lead is NEVER offered the coach-noon slot:');

  // Dates must be DYNAMIC (≥3 days out) — code now hard-drops past and too-soon slots, so a
  // hardcoded date would make this test rot the day after it passes.
  const { DateTime } = require('luxon');
  let day = DateTime.now().setZone('Australia/Brisbane').plus({ days: 3 }).startOf('day');
  while (day.weekday > 5) day = day.plus({ days: 1 }); // weekdays-only is code-enforced now
  const slotAt = (h, m) => day.set({ hour: h, minute: m }).toUTC().toISO();
  const dNINE30 = slotAt(9, 30);
  const dNOON = slotAt(12, 0);
  const dHALF1 = slotAt(13, 30);

  // Availability returns a day that INCLUDES the noon slot; both sides on Brisbane (same clock).
  const fakeAvail = async () => ({
    yourTimezone: 'Australia/Brisbane',
    leadTimezone: 'Australia/Brisbane',
    days: [{ date: day.toFormat('yyyy-MM-dd'), day: day.toFormat('ccc'), freeSlots: [
      { time: dNINE30, display: '9:30 am', leadDisplay: '9:30 am' },
      { time: dNOON,   display: '12:00 pm', leadDisplay: '12:00 pm' },
      { time: dHALF1,  display: '1:30 pm', leadDisplay: '1:30 pm' },
    ] }],
  });

  // Fake model: check availability, then DELIBERATELY try to propose all three (incl noon) to also
  // exercise the propose_times backstop, then finish.
  let call = 0;
  const fakeClient = { messages: { create: async () => {
    call++;
    if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'check_availability', input: {} }] };
    if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_times',
      input: { intro: 'A few times that suit:', slotTimes: [dNINE30, dNOON, dHALF1], outro: 'Let me know.' } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
  } } };

  const res = await runWingguyChatTurn({
    coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
    profile: { name: 'Izack', location: 'Newcastle, New South Wales' },
    messages: [{ role: 'user', content: 'draft a reply offering some times' }],
    leadEmail: 'izack@example.com',
    deps: { client: fakeClient, getAvailabilityForCoach: fakeAvail, createBookingEvent: async () => ({ ok: true }) },
  });

  check('a draft was produced', () => assert.ok(res && res.draft, `no draft: ${JSON.stringify(res)}`));
  check('draft does NOT offer 12:00 (lunch held)', () => assert.ok(!/12:00/.test(res.draft), `draft offered noon:\n${res.draft}`));
  check('draft still offers 9:30 am', () => assert.ok(/9:30\s*am/i.test(res.draft), `missing 9:30:\n${res.draft}`));
  check('draft still offers 1:30 pm', () => assert.ok(/1:30\s*pm/i.test(res.draft), `missing 1:30:\n${res.draft}`));

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all lunch-hold tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
