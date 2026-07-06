/**
 * Regression test for offer HOLDS in Wingguy booking.
 *
 * Bug (2026-07-06): a slot offered to a lead (Rebecca, Thu 10:30) was booked over by a later
 * booking for another lead (Mary Anne) before the first lead replied — an offered slot was a
 * promise nothing recorded. Fix: propose_times places an attendee-less "HOLD: <lead>" event per
 * offered slot; book_meeting ignores the lead's OWN holds, treats other leads' holds as real
 * clashes, and clears the lead's holds once the meeting books.
 *
 * Run: node tests/wingguy-offer-holds.test.js
 */
const assert = require('assert');
const { runWingguyChatTurn } = require('../services/wingguyChat');
const { isHoldForLead, isHoldSummary, holdTitle } = require('../services/wingguyCalendar');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

console.log('hold title matching:');
check('holdTitle carries the prefix and the lead name', () => assert.ok(isHoldForLead(holdTitle('Rebecca Marlor'), 'Rebecca Marlor')));
check('a hold for another lead does NOT match this lead', () => assert.strictEqual(isHoldForLead(holdTitle('Mary Anne Lamssies'), 'Rebecca Marlor'), false));
check('an ordinary meeting title is not a hold', () => assert.strictEqual(isHoldSummary('Mary Anne Lamssies & Guy Wilson'), false));
check('matching is case-insensitive', () => assert.ok(isHoldForLead('HOLD: rebecca marlor (Wingguy offer - do not book over)', 'Rebecca Marlor')));
check('no lead name never matches', () => assert.strictEqual(isHoldForLead(holdTitle('Rebecca Marlor'), ''), false));

const TEN30 = '2026-07-09T10:30:00+10:00';
const ELEVEN = '2026-07-10T11:00:00+10:00';
const TWO = '2026-07-13T14:00:00+10:00';

// One fake-model turn that calls a single tool then ends.
function fakeClientForTool(name, input) {
  let call = 0;
  return { messages: { create: async () => {
    call++;
    if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name, input }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
  } } };
}

(async () => {
  console.log('\npropose_times places holds for the kept slots:');
  {
    let holdsCall = null;
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Rebecca Marlor', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'offer her some times' }],
      leadEmail: 'bec@example.com',
      deps: {
        client: fakeClientForTool('propose_times', { intro: 'Great, Rebecca -', slotTimes: [ELEVEN, TWO], outro: 'Let me know.' }),
        getAvailabilityForCoach: async () => ({ yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane', days: [] }),
        createOfferHolds: async (coach, args) => { holdsCall = args; return { ok: true, created: args.slotISOs.length }; },
        deleteOfferHolds: async () => ({ removed: 0 }),
      },
    });
    // fire-and-forget: give the microtask a beat to run
    await new Promise((r) => setImmediate(r));
    check('a draft was produced', () => assert.ok(res && res.draft));
    check('holds were requested for the lead', () => assert.strictEqual(holdsCall && holdsCall.leadName, 'Rebecca Marlor'));
    check('holds cover exactly the offered slots', () => assert.deepStrictEqual(holdsCall && holdsCall.slotISOs, [ELEVEN, TWO]));
  }

  console.log('\nbook_meeting vs holds:');
  {
    // The lead's OWN hold at the picked time must NOT block the booking, and holds clear after.
    let booked = false; let cleanup = null;
    await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Rebecca Marlor', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'book her in' }],
      leadEmail: 'bec@example.com',
      deps: {
        client: fakeClientForTool('book_meeting', { startISO: ELEVEN }),
        getClashesForISO: async () => [{ summary: holdTitle('Rebecca Marlor'), display: 'Fri 10 Jul, 11:00 am' }],
        createBookingEvent: async () => { booked = true; return { ok: true, eventId: 'ev1', title: 'Rebecca Marlor & Guy Wilson', start: ELEVEN, durationMins: 30 }; },
        deleteOfferHolds: async (coach, args) => { cleanup = args; return { removed: 3 }; },
        createOfferHolds: async () => ({ ok: true, created: 0 }),
      },
    });
    await new Promise((r) => setImmediate(r));
    check('own hold does NOT block the booking', () => assert.strictEqual(booked, true));
    check('the lead\'s holds are cleared after booking', () => assert.strictEqual(cleanup && cleanup.leadName, 'Rebecca Marlor'));
  }
  {
    // ANOTHER lead's hold at the picked time IS a clash — booking must be refused.
    let booked = false;
    await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Rebecca Marlor', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'book her in' }],
      leadEmail: 'bec@example.com',
      deps: {
        client: fakeClientForTool('book_meeting', { startISO: TEN30 }),
        getClashesForISO: async () => [{ summary: holdTitle('Angela Mager'), display: 'Thu 9 Jul, 10:30 am' }],
        createBookingEvent: async () => { booked = true; return { ok: true }; },
        deleteOfferHolds: async () => ({ removed: 0 }),
        createOfferHolds: async () => ({ ok: true, created: 0 }),
      },
    });
    check('another lead\'s hold DOES block the booking', () => assert.strictEqual(booked, false));
  }
  {
    // A real meeting clash still blocks (the original guard is untouched).
    let booked = false;
    await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Rebecca Marlor', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'book her in' }],
      leadEmail: 'bec@example.com',
      deps: {
        client: fakeClientForTool('book_meeting', { startISO: TEN30 }),
        getClashesForISO: async () => [{ summary: 'Mary Anne Lamssies & Guy Wilson', display: 'Thu 9 Jul, 10:30 am' }],
        createBookingEvent: async () => { booked = true; return { ok: true }; },
        deleteOfferHolds: async () => ({ removed: 0 }),
        createOfferHolds: async () => ({ ok: true, created: 0 }),
      },
    });
    check('a real meeting clash still blocks the booking', () => assert.strictEqual(booked, false));
  }

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all offer-hold tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
