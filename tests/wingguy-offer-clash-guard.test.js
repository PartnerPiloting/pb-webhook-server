/**
 * Tests for the propose_times CALENDAR BACKSTOP (Guy, 2026-09-17 — the Tammie Lee message).
 *
 * The bug: propose_times filtered its slots on hours, lunch, weekends, notice and the past — all
 * arithmetic on the ISO itself. It never opened the diary. So a time the model invented to match
 * what the lead had asked for ("Friday PM suits me") passed every filter and was rendered into the
 * draft as a real offer, on a day Guy was blocked out all day to move house.
 *
 * Product rule (different from book_meeting's "warn, don't block"): a clash at BOOKING time is Guy's
 * call to make — he can consciously double-book. A clash at OFFERING time is not a decision, it's a
 * mistake: the slot was never on offer. So the list is refused outright and the model re-picks.
 *
 * These exercise the tool-wiring via the deps seam (no network) — the model is faked.
 *
 * Run: node tests/wingguy-offer-clash-guard.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const { runWingguyChatTurn } = require('../services/wingguyChat');
const { overlappingEvents } = require('../services/wingguyCalendar');
const { googleAllDayNormalise } = require('../services/calendarProvider');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// Slots must survive the arithmetic filters (future, weekday, inside hours, outside lunch, enough
// notice) so that the ONLY thing under test is the calendar read. Built from today, not hardcoded,
// so the suite doesn't rot the way a fixed 2026-07-09 would.
function weekdayAhead(days, hour) {
  let d = DateTime.now().setZone('Australia/Brisbane').plus({ days }).set({ hour, minute: 0, second: 0, millisecond: 0 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toISO();
}
const BUSY_ISO = weekdayAhead(7, 14);   // 2:00 pm — the invented one, Guy is booked
const FREE_ISO = weekdayAhead(8, 10);   // 10:00 am — genuinely free
const FREE_2_ISO = weekdayAhead(9, 11); // 11:00 am — genuinely free

const fakeCalendar = (counters) => ({
  getAvailabilityForCoach: async () => ({ yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane', leadTzDetected: true, days: [] }),
  // The seam under test. Mirrors the real signature: Map of ISO -> clashes, only clashing keys present.
  clashingSlots: async (_clientId, isos) => {
    counters.clashReads++;
    counters.lastChecked = [...isos];
    const m = new Map();
    for (const iso of isos) {
      if (iso === BUSY_ISO) m.set(iso, [{ summary: 'Moving in to our New Home', display: 'all day' }]);
    }
    return m;
  },
});

const baseArgs = (client) => ({
  coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
  profile: { name: 'Tammie', location: 'Sydney, New South Wales' },
  messages: [{ role: 'user', content: 'offer her some times' }],
  leadEmail: 'tammie@example.com',
  deps: { ...fakeCalendar(client._counters), client },
});

// Drive one propose_times call and hand back both the tool result the model saw and the turn result.
async function proposeTimes(slotTimes, overrides = {}) {
  const counters = { clashReads: 0, lastChecked: null };
  let toolResult = null;
  let call = 0;
  const client = { _counters: counters, messages: { create: async (req) => {
    call++;
    if (call === 1) {
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'p1', name: 'propose_times', input: { intro: 'Great to hear from you.', outro: 'Let me know what suits.', slotTimes } }] };
    }
    const last = req.messages[req.messages.length - 1];
    if (last && Array.isArray(last.content) && last.content[0] && last.content[0].type === 'tool_result') {
      try { toolResult = JSON.parse(last.content[0].content); } catch (_) { toolResult = { raw: last.content[0].content }; }
    }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'here you go' }] };
  } } };
  const args = baseArgs(client);
  const res = await runWingguyChatTurn({ ...args, deps: { ...args.deps, ...overrides } });
  return { res, toolResult, counters };
}

(async () => {
  // ── 1. THE TAMMIE CASE: a busy slot mixed in with a real one → the WHOLE list is refused ────────
  console.log('propose_times — a time Guy is not free for kills the whole list:');
  {
    const { res, toolResult } = await proposeTimes([BUSY_ISO, FREE_ISO]);
    check('propose_times refused', () => assert.ok(toolResult && toolResult.ok === false, JSON.stringify(toolResult)));
    check('the error names the clashing event', () => assert.ok(/Moving in to our New Home/.test(toolResult.error), toolResult.error));
    check('the error tells the model to re-read availability', () => assert.ok(/check_availability/.test(toolResult.error), toolResult.error));
    check('NO draft was set — the busy time never reaches Guy', () => assert.ok(!res.draft, `draft was: ${res.draft}`));
    check('the free slot was not offered on its own', () => assert.ok(!res.draft || !/\d:\d\d/.test(res.draft)));
    check('turn still completed cleanly', () => assert.ok(res.ok));
  }

  // ── 2. All slots free → the guard is invisible, the draft renders as before ─────────────────────
  console.log('\npropose_times — genuinely free slots still draft normally:');
  {
    const { res, toolResult, counters } = await proposeTimes([FREE_ISO, FREE_2_ISO]);
    check('propose_times succeeded', () => assert.ok(toolResult && toolResult.ok === true, JSON.stringify(toolResult)));
    check('both slots were offered', () => assert.strictEqual(toolResult.offered, 2));
    check('a draft was set', () => assert.ok(res.draft && res.draft.length > 0));
    check('the draft carries the code-owned connecting line', () => assert.ok(/Would any of the following times work for you\?/.test(res.draft), res.draft));
    check('the calendar was read exactly once for the whole list', () => assert.strictEqual(counters.clashReads, 1));
  }

  // ── 3. A FAILED calendar read must not read as "all clear" ──────────────────────────────────────
  console.log('\npropose_times — a calendar read that fails refuses, it does not assume free:');
  {
    const { res, toolResult } = await proposeTimes([FREE_ISO], {
      clashingSlots: async () => { throw new Error('freebusy 503'); },
    });
    check('propose_times refused', () => assert.ok(toolResult && toolResult.ok === false, JSON.stringify(toolResult)));
    check('the error says the read failed', () => assert.ok(/freebusy 503/.test(toolResult.error), toolResult.error));
    check('NO draft was set', () => assert.ok(!res.draft, `draft was: ${res.draft}`));
  }

  // ── 4. The read only pays for slots that survived the arithmetic filters ────────────────────────
  console.log('\npropose_times — already-dropped slots are not sent to the calendar:');
  {
    const PAST_ISO = DateTime.now().setZone('Australia/Brisbane').minus({ days: 3 }).set({ hour: 10 }).toISO();
    const { counters } = await proposeTimes([PAST_ISO, FREE_ISO]);
    check('the past slot was filtered before the calendar read', () => assert.ok(counters.lastChecked && !counters.lastChecked.includes(PAST_ISO), JSON.stringify(counters.lastChecked)));
    check('the surviving slot was checked', () => assert.ok(counters.lastChecked.includes(FREE_ISO)));
  }

  // ── 5. An ALL-DAY block covers the coach's day, not a UTC-shifted slice of it ───────────────────
  // The Google service account hands an all-day event through as a bare date, which new Date() reads
  // as UTC midnight — 10am Brisbane. Untreated, Guy's "Moving in to our New Home" would have blocked
  // 10am Fri to 10am Sat: catching the 2pm that started all this by luck, while leaving a 9am Friday
  // offerable and falsely blocking Saturday breakfast.
  console.log('\nall-day blocks land on the coach\'s own day, not UTC midnights:');
  {
    const TZ = 'Australia/Brisbane';
    const raw = { summary: 'Moving in to our New Home', start: '2026-09-18', end: '2026-09-19', isFree: false };
    const ev = [googleAllDayNormalise(raw, TZ)];
    const at = (d, h) => DateTime.fromObject({ year: 2026, month: 9, day: d, hour: h }, { zone: TZ }).toISO();
    check('blocks 9:00 am on the day (the case UTC midnights would have missed)', () => assert.strictEqual(overlappingEvents(ev, at(18, 9), 30, TZ).length, 1));
    check('blocks 2:00 pm on the day (the Tammie slot)', () => assert.strictEqual(overlappingEvents(ev, at(18, 14), 30, TZ).length, 1));
    check('blocks 4:00 pm on the day', () => assert.strictEqual(overlappingEvents(ev, at(18, 16), 30, TZ).length, 1));
    check('does NOT block 9:00 am the NEXT day', () => assert.strictEqual(overlappingEvents(ev, at(19, 9), 30, TZ).length, 0));
    check('does NOT block 4:00 pm the day BEFORE', () => assert.strictEqual(overlappingEvents(ev, at(17, 16), 30, TZ).length, 0));
    const free = [googleAllDayNormalise({ ...raw, isFree: true }, TZ)];
    check('an all-day marked FREE (birthdays, "available") blocks nothing', () => assert.strictEqual(overlappingEvents(free, at(18, 14), 30, TZ).length, 0));
  }

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all offer-clash-guard tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
