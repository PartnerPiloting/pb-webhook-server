/**
 * Tests for the booking ADDRESS guard in wingguyCalendar.bookMeetingGuarded and the record-only
 * address rule in wingguyBookingMcp.runBookMeeting (Craig Carolan, 2026-10-19).
 *
 * Contracts - bookMeetingGuarded:
 *   1. An address with text glued to the front ("iscraig.carolan@") is refused with the likely fix;
 *      nothing is booked, no clash check or mailbox lookup runs.
 *   2. A mailbox the verification service calls 'invalid' is refused; 'unknown' and 'valid' book.
 *   3. confirmEmail:true books the refused address anyway (the human's explicit yes).
 * Contracts - runBookMeeting (the claude.ai connector door):
 *   4. lead_email that differs from the CRM record is refused and told to file it first.
 *   5. lead_email equal to the record (any case) books, on the record's address.
 *   6. No lead_email books on the record's address; a record with no email books on the given one.
 *
 * Run: node tests/booking-address-guard.test.js
 */
const assert = require('assert');
const wingguyCalendar = require('../services/wingguyCalendar');

let failures = 0;
const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const coach = { clientId: 'guy', clientName: 'Guy Wilson', timezone: 'Australia/Brisbane' };
function deps(verifyState = 'unknown') {
  const calls = { clashes: 0, booked: 0, verified: 0 };
  return {
    calls,
    getClashesForISO: async () => { calls.clashes++; return []; },
    createBookingEvent: async (c, args) => { calls.booked++; return { ok: true, title: `${args.leadName} & Guy`, start: args.startISO, durationMins: 30, leadEmail: args.leadEmail }; },
    deleteOfferHolds: async () => {},
    verifyMailbox: async () => { calls.verified++; return { state: verifyState, detail: `fake: ${verifyState}`, provider: 'fake' }; },
  };
}
const START = '2026-10-28T14:00:00+10:00';

(async () => {
  console.log('bookMeetingGuarded:');
  await acheck('1. glued-front address is refused with the fix, nothing booked', async () => {
    const d = deps('valid');
    const r = await wingguyCalendar.bookMeetingGuarded(coach, { startISO: START, leadEmail: 'iscraig.carolan@infocus.com.au', leadName: 'Craig Carolan' }, d);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.emailSuspect, true);
    assert.strictEqual(r.suggestedEmail, 'craig.carolan@infocus.com.au');
    assert.ok(/NOT booked/.test(r.error) && /confirmEmail:true/.test(r.error));
    assert.deepStrictEqual(d.calls, { clashes: 0, booked: 0, verified: 0 }, 'refused before any other check');
  });
  await acheck('2. invalid mailbox refused; unknown and valid book', async () => {
    const bad = deps('invalid');
    const r = await wingguyCalendar.bookMeetingGuarded(coach, { startISO: START, leadEmail: 'craig.carolan@infocus.com.au', leadName: 'Craig Carolan' }, bad);
    assert.strictEqual(r.ok, false);
    assert.ok(/does not exist/.test(r.error));
    assert.strictEqual(bad.calls.booked, 0);
    for (const state of ['unknown', 'valid']) {
      const d = deps(state);
      const ok = await wingguyCalendar.bookMeetingGuarded(coach, { startISO: START, leadEmail: 'craig.carolan@infocus.com.au', leadName: 'Craig Carolan' }, d);
      assert.strictEqual(ok.ok, true, `${state} should book`);
      assert.strictEqual(ok.leadEmail, 'craig.carolan@infocus.com.au');
    }
  });
  await acheck('3. confirmEmail:true books the refused address', async () => {
    const d = deps('invalid');
    const r = await wingguyCalendar.bookMeetingGuarded(coach, { startISO: START, leadEmail: 'iscraig.carolan@infocus.com.au', leadName: 'Craig Carolan', confirmEmail: true }, d);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(d.calls.verified, 0, 'no lookup once the human has confirmed');
    assert.strictEqual(r.leadEmail, 'iscraig.carolan@infocus.com.au');
  });

  console.log('runBookMeeting (connector door):');
  // Stub the CRM lookup (seeded into require's cache - the real module pulls in Airtable config this
  // test has no business needing) and the guard, so only the address rule is under test.
  let record = { leadName: 'Craig Carolan', email: 'craig.carolan@infocus.com.au', linkedinProfileUrl: 'https://www.linkedin.com/in/craigcarolan', location: 'Brisbane, Queensland, Australia' };
  let bookedWith = null;
  const lookupPath = require.resolve('../services/coachingClientLookupService');
  require.cache[lookupPath] = { id: lookupPath, filename: lookupPath, loaded: true, exports: { lookupLeadContactByName: async () => ({ lead: record, matches: [] }) } };
  const clientService = require('../services/clientService');
  const origGet = clientService.getClientById;
  const origGuard = wingguyCalendar.bookMeetingGuarded;
  clientService.getClientById = async () => coach;
  wingguyCalendar.bookMeetingGuarded = async (c, args) => { bookedWith = args; return { ok: true, title: 'Craig Carolan & Guy Wilson', start: args.startISO, durationMins: 30 }; };
  delete require.cache[require.resolve('../services/wingguyBookingMcp')];
  const { TOOL_DEFS } = require('../services/wingguyBookingMcp');
  const book = TOOL_DEFS.find((t) => t.name === 'wingguy_book_meeting').run;
  try {
    await acheck('4. lead_email that differs from the record is refused, told to file first', async () => {
      bookedWith = null;
      const r = await book({ start_iso: START, lead_name: 'Craig Carolan', lead_email: 'iscraig.carolan@infocus.com.au' }, 'guy');
      assert.strictEqual(r.isError, true);
      assert.ok(/NOT booked/.test(r.text) && /wingguy_update_lead/.test(r.text) && /craig\.carolan@infocus\.com\.au/.test(r.text));
      assert.strictEqual(bookedWith, null, 'nothing booked');
    });
    await acheck('5. lead_email equal to the record (any case) books on the record address', async () => {
      const r = await book({ start_iso: START, lead_name: 'Craig Carolan', lead_email: 'Craig.Carolan@Infocus.com.au' }, 'guy');
      assert.ok(!r.isError, r.text);
      assert.strictEqual(bookedWith.leadEmail, 'craig.carolan@infocus.com.au');
      assert.ok(/quote that address EXACTLY/i.test(r.text));
    });
    await acheck('6. no lead_email -> record address; no record email -> the given one', async () => {
      const r = await book({ start_iso: START, lead_name: 'Craig Carolan' }, 'guy');
      assert.strictEqual(bookedWith.leadEmail, 'craig.carolan@infocus.com.au');
      assert.ok(/email source: CRM/.test(r.text));
      record = { ...record, email: '' };
      const r2 = await book({ start_iso: START, lead_name: 'Craig Carolan', lead_email: 'craig.carolan@infocus.com.au', confirm_email: true }, 'guy');
      assert.strictEqual(bookedWith.leadEmail, 'craig.carolan@infocus.com.au');
      assert.strictEqual(bookedWith.confirmEmail, true, 'confirm_email passes through');
      assert.ok(/file it with wingguy_update_lead/.test(r2.text));
      const r3 = await book({ start_iso: START, lead_name: 'Craig Carolan' }, 'guy');
      assert.strictEqual(r3.isError, true, 'no email anywhere -> refused');
    });
  } finally {
    delete require.cache[lookupPath];
    clientService.getClientById = origGet;
    wingguyCalendar.bookMeetingGuarded = origGuard;
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
