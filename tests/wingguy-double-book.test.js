/**
 * Tests for "warn, don't block" booking (2026-06-30).
 *
 * Product rule: Guy is the decision-maker. The agent never hard-blocks a time — it SURFACES a clash
 * and books only on his explicit yes. Code still enforces NO *ACCIDENTAL* double-book: book_meeting
 * refuses a clashing time unless confirmDoubleBook:true is passed. A conscious double-book is allowed.
 *
 * These exercise the tool-wiring via the deps seam (no network) — the model is faked.
 *
 * Run: node tests/wingguy-double-book.test.js
 */
const assert = require('assert');
const { runWingguyChatTurn } = require('../services/wingguyChat');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const CLASH_ISO = '2026-07-09T14:00:00+10:00'; // 2:00 pm — overlaps an existing meeting
const FREE_ISO  = '2026-07-09T15:00:00+10:00'; // 3:00 pm — free

// Fake the calendar seam: 2 pm clashes, everything else is free.
const fakeDeps = (counters) => ({
  getAvailabilityForCoach: async () => ({ yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane', days: [] }),
  getClashesForISO: async (_clientId, startISO) => {
    counters.clashChecks++;
    return startISO === CLASH_ISO ? [{ summary: 'Standup', display: '2:00 pm' }] : [];
  },
  checkProposedTime: async (_clientId, { date, time }) => ({
    ok: true, startISO: CLASH_ISO, durationMins: 30,
    yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane',
    display: '2:00 pm', leadDisplay: '2:00 pm',
    clashes: [{ summary: 'Standup', display: '2:00 pm' }],
  }),
  createBookingEvent: async (_coach, { startISO }) => { counters.books++; return { ok: true, eventId: 'evt_1', start: startISO }; },
});

const baseArgs = (client) => ({
  coach: { clientId: 'Guy-Wilson', clientName: 'Guy' },
  profile: { name: 'Tony', location: 'Brisbane' },
  messages: [{ role: 'user', content: 'book it' }],
  leadEmail: 'tony@example.com',
  deps: { ...fakeDeps(client._counters), client },
});

(async () => {
  // ── 1. Clashing time WITHOUT confirm → refused; the tool tells the model what it clashed with ───
  console.log('book_meeting guard — clashing time without confirm is refused:');
  {
    const counters = { books: 0, clashChecks: 0 };
    let toolResult = null;
    let call = 0;
    const client = { _counters: counters, messages: { create: async (req) => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b1', name: 'book_meeting', input: { startISO: CLASH_ISO } }] };
      // capture the tool_result the model received back
      const last = req.messages[req.messages.length - 1];
      if (last && Array.isArray(last.content) && last.content[0] && last.content[0].type === 'tool_result') {
        toolResult = JSON.parse(last.content[0].content);
      }
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'heads up, that clashes' }] };
    } } };
    const res = await runWingguyChatTurn(baseArgs(client));
    check('no booking was made', () => assert.strictEqual(counters.books, 0));
    check('tool reported a clash', () => assert.ok(toolResult && toolResult.clash === true, JSON.stringify(toolResult)));
    check('clash names the conflicting meeting', () => assert.ok(/Standup/.test(toolResult.error), toolResult.error));
    check('turn still completed (not an error)', () => assert.ok(res.ok));
  }

  // ── 2. Clash, then Guy confirms → confirmDoubleBook:true books it (conscious double-book) ────────
  console.log('\nbook_meeting guard — confirmDoubleBook:true allows a conscious double-book:');
  {
    const counters = { books: 0, clashChecks: 0 };
    let call = 0;
    const client = { _counters: counters, messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b1', name: 'book_meeting', input: { startISO: CLASH_ISO } }] };
      if (call === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b2', name: 'book_meeting', input: { startISO: CLASH_ISO, confirmDoubleBook: true } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'booked (double-booked as you asked)' }] };
    } } };
    const res = await runWingguyChatTurn(baseArgs(client));
    check('booked exactly once', () => assert.strictEqual(counters.books, 1));
    check('res.booked is set', () => assert.ok(res.booked && res.booked.ok));
    check('clash guard did NOT run on the confirmed call', () => assert.strictEqual(counters.clashChecks, 1)); // only the first (unconfirmed) attempt checks
  }

  // ── 3. A free time books first try (guard never false-triggers) ─────────────────────────────────
  console.log('\nbook_meeting guard — a free time books on the first try:');
  {
    const counters = { books: 0, clashChecks: 0 };
    let call = 0;
    const client = { _counters: counters, messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b1', name: 'book_meeting', input: { startISO: FREE_ISO } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'all set' }] };
    } } };
    const res = await runWingguyChatTurn(baseArgs(client));
    check('booked exactly once', () => assert.strictEqual(counters.books, 1));
    check('res.booked is set', () => assert.ok(res.booked && res.booked.ok));
  }

  // ── 4. check_time surfaces the clash + resolved both-side displays (no booking) ─────────────────
  console.log('\ncheck_time — surfaces a clash and resolved times without booking:');
  {
    const counters = { books: 0, clashChecks: 0 };
    let toolResult = null;
    let call = 0;
    const client = { _counters: counters, messages: { create: async (req) => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'check_time', input: { date: '2026-07-09', time: '2:00pm', side: 'coach' } }] };
      const last = req.messages[req.messages.length - 1];
      if (last && Array.isArray(last.content) && last.content[0] && last.content[0].type === 'tool_result') {
        toolResult = JSON.parse(last.content[0].content);
      }
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'that one clashes — want me to double-book?' }] };
    } } };
    await runWingguyChatTurn(baseArgs(client));
    check('check_time returned not-free', () => assert.ok(toolResult && toolResult.free === false, JSON.stringify(toolResult)));
    check('check_time surfaced the clash', () => assert.ok(toolResult.clashes && toolResult.clashes.length === 1));
    check('check_time returned a startISO to reuse', () => assert.strictEqual(toolResult.startISO, CLASH_ISO));
    check('nothing was booked', () => assert.strictEqual(counters.books, 0));
  }

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all warn-don\'t-block tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
