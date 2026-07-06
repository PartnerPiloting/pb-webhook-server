/**
 * Regression tests for Wingguy booking guards: MANUAL holds + past/too-soon slot enforcement.
 *
 * History (all 2026-07-06):
 * - A slot offered to Rebecca was booked over by a later booking for Mary Anne → automatic holds
 *   shipped... and were PULLED the same afternoon (diary clutter, duplicates). Guy's ruling: HE
 *   creates "HOLD: <lead name>" events manually; code respects and clears them but never creates.
 * - Sarah was offered a time that had ALREADY PASSED that morning → past/too-soon became code rules.
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

// First tool_result payload out of a finished turn (what the model actually saw).
function firstToolResult(res) {
  const msg = (res.messages || []).find((m) => m.role === 'user' && Array.isArray(m.content) && m.content[0] && m.content[0].type === 'tool_result');
  return msg ? JSON.parse(msg.content[0].content) : null;
}

(async () => {
  console.log('\npropose_times drops past and too-soon slots (the Sarah 2026-07-06 bug):');
  {
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Sarah Cann', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'offer her some times' }],
      leadEmail: 'sarah@example.com',
      deps: {
        client: fakeClientForTool('propose_times', { intro: 'Great, Sarah -', slotTimes: [PAST, TOMORROW, ELEVEN], outro: 'Let me know.' }),
        getAvailabilityForCoach: async () => ({ yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane', days: [] }),
      },
    });
    const result = firstToolResult(res);
    check('a draft was still produced (one valid slot)', () => assert.ok(res && res.draft));
    check('only the valid slot survives', () => assert.strictEqual(result && result.offered, 1, JSON.stringify(result)));
    check('the past slot was dropped as past', () => assert.ok(result && result.dropped.some((d) => d.iso === PAST && /past/.test(d.why)), JSON.stringify(result && result.dropped)));
    check('the tomorrow slot was dropped as too soon', () => assert.ok(result && result.dropped.some((d) => d.iso === TOMORROW && /too soon/.test(d.why)), JSON.stringify(result && result.dropped)));
  }
  {
    // includeSoon (Guy explicitly asked for tomorrow) lifts the notice rule — but never the past rule.
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Sarah Cann', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'she said tomorrow is fine' }],
      leadEmail: 'sarah@example.com',
      deps: {
        client: fakeClientForTool('propose_times', { intro: 'Great -', slotTimes: [PAST, TOMORROW], outro: 'Let me know.', includeSoon: true }),
        getAvailabilityForCoach: async () => ({ yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane', days: [] }),
      },
    });
    const result = firstToolResult(res);
    check('includeSoon lets tomorrow through (past still dropped)', () => assert.strictEqual(result && result.offered, 1, JSON.stringify(result)));
  }

  console.log('\ncheck_availability strips past/too-soon days and CAPPED days at the source:');
  {
    const today = bris().toFormat('yyyy-MM-dd');
    const tomorrow = bris().plus({ days: 1 }).toFormat('yyyy-MM-dd');
    const okDay = bris().plus({ days: 4 }).toFormat('yyyy-MM-dd');
    const fullDay = bris().plus({ days: 5 }).toFormat('yyyy-MM-dd');
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
            { date: today, day: 'D0', meetingCount: 0, freeSlots: [{ time: at(0, 15, 0), display: '3:00 pm', leadDisplay: '3:00 pm' }] },
            { date: tomorrow, day: 'D1', meetingCount: 0, freeSlots: [{ time: TOMORROW, display: '11:00 am', leadDisplay: '11:00 am' }] },
            { date: okDay, day: 'D4', meetingCount: 2, freeSlots: [{ time: ELEVEN, display: '11:00 am', leadDisplay: '11:00 am' }] },
            // The 6-meeting-Thursday case: at Guy's maxMeetingsPerDay (4) the day must vanish entirely.
            { date: fullDay, day: 'D5', meetingCount: 4, freeSlots: [{ time: at(5, 15, 0), display: '3:00 pm', leadDisplay: '3:00 pm' }] },
          ],
        }),
      },
    });
    const availResult = firstToolResult(res);
    check('today and tomorrow are gone from availability', () => assert.ok(availResult && availResult.days.every((d) => d.date >= bris().plus({ days: 2 }).toFormat('yyyy-MM-dd')), JSON.stringify(availResult && availResult.days.map((d) => d.date))));
    check('a day at the daily meeting cap is withheld', () => assert.ok(availResult && !availResult.days.some((d) => d.date === fullDay), JSON.stringify(availResult && availResult.days.map((d) => `${d.date}:${d.meetingCount}`))));
    check('a light valid future day survives', () => assert.ok(availResult && availResult.days.some((d) => d.date === okDay)));
  }

  console.log('\nbook_meeting vs MANUAL holds:');
  {
    // The lead's OWN hold at the picked time must NOT block the booking, and their holds clear after.
    let booked = false; let cleanup = null;
    await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
      profile: { name: 'Rebecca Marlor', location: 'Brisbane' },
      messages: [{ role: 'user', content: 'book her in' }],
      leadEmail: 'bec@example.com',
      deps: {
        client: fakeClientForTool('book_meeting', { startISO: ELEVEN }),
        getClashesForISO: async () => [{ summary: holdTitle('Rebecca Marlor'), display: 'Fri, 11:00 am' }],
        createBookingEvent: async () => { booked = true; return { ok: true, eventId: 'ev1', title: 'Rebecca Marlor & Guy Wilson', start: ELEVEN, durationMins: 30 }; },
        deleteOfferHolds: async (coach, args) => { cleanup = args; return { removed: 2 }; },
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
        getClashesForISO: async () => [{ summary: holdTitle('Angela Mager'), display: 'Thu, 10:30 am' }],
        createBookingEvent: async () => { booked = true; return { ok: true }; },
        deleteOfferHolds: async () => ({ removed: 0 }),
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
        getClashesForISO: async () => [{ summary: 'Mary Anne Lamssies & Guy Wilson', display: 'Thu, 10:30 am' }],
        createBookingEvent: async () => { booked = true; return { ok: true }; },
        deleteOfferHolds: async () => ({ removed: 0 }),
      },
    });
    check('a real meeting clash still blocks the booking', () => assert.strictEqual(booked, false));
  }

  console.log('\nshared bookMeetingGuarded (the one booking door — connector path):');
  {
    const { bookMeetingGuarded } = require('../services/wingguyCalendar');
    const coach = { clientId: 'Guy-Wilson', clientName: 'Guy Wilson' };
    // Own hold → books; holds cleared.
    let cleanup = null;
    const ok = await bookMeetingGuarded(coach, { startISO: ELEVEN, leadEmail: 'bec@example.com', leadName: 'Rebecca Marlor' }, {
      getClashesForISO: async () => [{ summary: holdTitle('Rebecca Marlor'), display: 'Fri, 11:00 am' }],
      createBookingEvent: async () => ({ ok: true, eventId: 'e1', title: 'Rebecca Marlor & Guy Wilson', start: ELEVEN, durationMins: 30 }),
      deleteOfferHolds: async (c, args) => { cleanup = args; return { removed: 1 }; },
    });
    await new Promise((r) => setImmediate(r));
    check('books through the lead\'s own hold and clears it', () => assert.ok(ok.ok && cleanup && cleanup.leadName === 'Rebecca Marlor', JSON.stringify(ok)));
    // Another lead's hold → refused with the clash surfaced.
    const blocked = await bookMeetingGuarded(coach, { startISO: TEN30, leadEmail: 'bec@example.com', leadName: 'Rebecca Marlor' }, {
      getClashesForISO: async () => [{ summary: holdTitle('Angela Mager'), display: 'Thu, 10:30 am' }],
      createBookingEvent: async () => ({ ok: true }),
      deleteOfferHolds: async () => ({ removed: 0 }),
    });
    check('refuses another lead\'s held slot (clash surfaced)', () => assert.ok(!blocked.ok && blocked.clash && /Angela Mager/.test(blocked.error), JSON.stringify(blocked)));
    // confirmDoubleBook overrides.
    const forced = await bookMeetingGuarded(coach, { startISO: TEN30, leadEmail: 'bec@example.com', leadName: 'Rebecca Marlor', confirmDoubleBook: true }, {
      getClashesForISO: async () => { throw new Error('should not be called when confirmed'); },
      createBookingEvent: async () => ({ ok: true, eventId: 'e2', title: 't', start: TEN30, durationMins: 30 }),
      deleteOfferHolds: async () => ({ removed: 0 }),
    });
    check('explicit confirmDoubleBook books over a clash', () => assert.ok(forced.ok, JSON.stringify(forced)));
    // No email → refused before any calendar call.
    const noEmail = await bookMeetingGuarded(coach, { startISO: ELEVEN, leadName: 'Rebecca Marlor' }, {
      getClashesForISO: async () => [], createBookingEvent: async () => ({ ok: true }), deleteOfferHolds: async () => ({ removed: 0 }),
    });
    check('no lead email refuses cleanly', () => assert.ok(!noEmail.ok && /email/.test(noEmail.error)));
  }

  console.log('\nshared filterAvailability (the one offer pipeline — connector path):');
  {
    const { filterAvailability } = require('../services/wingguyCalendar');
    const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
    const prefs = getBookingPrefs('Guy-Wilson');
    const okDay = bris().plus({ days: 4 });
    const avail = {
      yourTimezone: 'Australia/Brisbane',
      leadTimezone: 'Australia/Sydney',
      days: [
        { date: bris().toFormat('yyyy-MM-dd'), day: 'D0', meetingCount: 0, freeSlots: [{ time: at(0, 15, 0), display: '3:00 pm' }] },
        { date: okDay.toFormat('yyyy-MM-dd'), day: 'D4', meetingCount: 2, freeSlots: [
          { time: at(4, 9, 0), display: '9:00 am' },    // below the 9:30 floor → dropped
          { time: at(4, 12, 0), display: '12:00 pm' },  // lunch hold → dropped
          { time: at(4, 11, 0), display: '11:00 am' },  // survives
        ] },
        { date: bris().plus({ days: 5 }).toFormat('yyyy-MM-dd'), day: 'D5', meetingCount: 4, freeSlots: [{ time: at(5, 11, 0), display: '11:00 am' }] },
      ],
    };
    const out = filterAvailability(avail, prefs, {});
    check('one day survives (today gone, capped day gone)', () => assert.strictEqual(out.days.length, 1, JSON.stringify(out.days.map((d) => d.date))));
    check('floor + lunch slots dropped, 11:00 kept with a lead-tz label', () => {
      assert.strictEqual(out.days[0].freeSlots.length, 1, JSON.stringify(out.days[0].freeSlots));
      assert.ok(out.days[0].freeSlots[0].label, 'label missing');
    });
  }

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all booking-guard tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
