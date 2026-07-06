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

// Dynamic dates — code hard-drops past/too-soon slots, so hardcoded dates would rot.
const { DateTime } = require('luxon');
const bris = () => DateTime.now().setZone('Australia/Brisbane');
const at = (plusDays, h, m) => bris().plus({ days: plusDays }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toUTC().toISO();
const TEN30 = at(3, 10, 30);
const ELEVEN = at(4, 11, 0);
const TWO = at(7, 14, 0);
const PAST = at(0, Math.max(bris().hour - 1, 0), 0);  // earlier today
const TOMORROW = at(1, 11, 0);                        // inside hours, but breaks the one-clear-day rule

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

  console.log('\npropose_times drops past and too-soon slots (the Sarah 2026-07-06 bug):');
  {
    let holdsCall = null;
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Sarah Cann', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'offer her some times' }],
      leadEmail: 'sarah@example.com',
      deps: {
        client: fakeClientForTool('propose_times', { intro: 'Great, Sarah -', slotTimes: [PAST, TOMORROW, ELEVEN], outro: 'Let me know.' }),
        getAvailabilityForCoach: async () => ({ yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane', days: [] }),
        createOfferHolds: async (coach, args) => { holdsCall = args; return { ok: true, created: args.slotISOs.length }; },
        deleteOfferHolds: async () => ({ removed: 0 }),
      },
    });
    await new Promise((r) => setImmediate(r));
    check('a draft was still produced (one valid slot)', () => assert.ok(res && res.draft));
    check('the past slot is NOT in the holds', () => assert.ok(holdsCall && !holdsCall.slotISOs.includes(PAST), JSON.stringify(holdsCall)));
    check('the tomorrow slot is NOT in the holds (one-clear-day rule)', () => assert.ok(holdsCall && !holdsCall.slotISOs.includes(TOMORROW), JSON.stringify(holdsCall)));
    check('only the valid slot survives', () => assert.deepStrictEqual(holdsCall && holdsCall.slotISOs, [ELEVEN]));
  }
  {
    // includeSoon (Guy explicitly asked for tomorrow) lifts the notice rule — but never the past rule.
    let holdsCall = null;
    await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Sarah Cann', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'she said tomorrow is fine' }],
      leadEmail: 'sarah@example.com',
      deps: {
        client: fakeClientForTool('propose_times', { intro: 'Great -', slotTimes: [PAST, TOMORROW], outro: 'Let me know.', includeSoon: true }),
        getAvailabilityForCoach: async () => ({ yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane', days: [] }),
        createOfferHolds: async (coach, args) => { holdsCall = args; return { ok: true, created: args.slotISOs.length }; },
        deleteOfferHolds: async () => ({ removed: 0 }),
      },
    });
    await new Promise((r) => setImmediate(r));
    check('includeSoon lets tomorrow through', () => assert.deepStrictEqual(holdsCall && holdsCall.slotISOs, [TOMORROW]));
  }

  console.log('\ncheck_availability strips past/too-soon days at the source:');
  {
    const today = bris().toFormat('yyyy-MM-dd');
    const tomorrow = bris().plus({ days: 1 }).toFormat('yyyy-MM-dd');
    const okDay = bris().plus({ days: 4 }).toFormat('yyyy-MM-dd');
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Sarah Cann', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'what have we got?' }],
      leadEmail: 'sarah@example.com',
      deps: {
        client: fakeClientForTool('check_availability', {}),
        getAvailabilityForCoach: async () => ({
          yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane',
          days: [
            { date: today, day: 'Mon', freeSlots: [{ time: at(0, 15, 0), display: '3:00 pm', leadDisplay: '3:00 pm' }] },
            { date: tomorrow, day: 'Tue', freeSlots: [{ time: TOMORROW, display: '11:00 am', leadDisplay: '11:00 am' }] },
            { date: okDay, day: 'Fri', freeSlots: [{ time: ELEVEN, display: '11:00 am', leadDisplay: '11:00 am' }] },
          ],
        }),
        createOfferHolds: async () => ({ ok: true, created: 0 }),
        deleteOfferHolds: async () => ({ removed: 0 }),
      },
    });
    const toolResultMsg = (res.messages || []).find((m) => m.role === 'user' && Array.isArray(m.content) && m.content[0] && m.content[0].type === 'tool_result');
    const availResult = toolResultMsg ? JSON.parse(toolResultMsg.content[0].content) : null;
    check('today and tomorrow are gone from availability', () => assert.ok(availResult && availResult.days.every((d) => d.date >= bris().plus({ days: 2 }).toFormat('yyyy-MM-dd')), JSON.stringify(availResult && availResult.days.map((d) => d.date))));
    check('the valid future day survives', () => assert.ok(availResult && availResult.days.some((d) => d.date === okDay)));
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
