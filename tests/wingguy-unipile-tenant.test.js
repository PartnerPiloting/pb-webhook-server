/**
 * Tests for the Unipile-only tenant calendar path (2026-08-18).
 *
 * Gap closed: getCoachCalendarInfo never read `Unipile Account ID`, so a Unipile-only tenant
 * (no service-account share, no Nylas grant, no direct-provider token) threw "No calendar for
 * this client" before reaching the provider seam — and even past the guard, coachForCalendar
 * didn't carry unipileAccountId, so unipileEnv() fell through to the shared UNIPILE_ACCOUNT_ID
 * env var (deliberately unset on prod: a fallback there would read the WRONG tenant's calendar).
 * Found onboarding Matthew Bulat, the first Unipile-only calendar tenant; Guy's own row has
 * Calendar Email set, so his reads stay on the grandfathered Google path and never hit this.
 *
 * These tests exercise the pure resolution helpers with mocked Airtable fetch — no network.
 *
 * Run: node tests/wingguy-unipile-tenant.test.js
 */
const assert = require('assert');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// Mock the Airtable read BEFORE requiring the module under test.
const realFetch = global.fetch;
let mockFields = {};
global.fetch = async (url) => {
  if (String(url).includes('api.airtable.com')) {
    return { ok: true, json: async () => ({ records: [{ id: 'recTEST', fields: mockFields }] }) };
  }
  return realFetch(url);
};

const { getCoachCalendarInfo, providerForInfo, coachForCalendar } = require('../services/wingguyCalendar');
const { coachSelfEmail, mapUnipileEvent } = require('../services/calendarProvider');

(async () => {
  console.log('getCoachCalendarInfo() — a Unipile account id is a real calendar credential:');

  await checkAsync('Unipile-only tenant passes the no-calendar guard', async () => {
    mockFields = { 'Client ID': 'Matthew-Bulat', 'Calendar Provider': 'unipile', 'Unipile Account ID': 'acc123', Timezone: 'Australia/Brisbane' };
    const info = await getCoachCalendarInfo('Matthew-Bulat');
    assert.strictEqual(info.unipileAccountId, 'acc123');
  });

  await checkAsync('tenant with NO credential of any kind still throws', async () => {
    mockFields = { 'Client ID': 'Empty-Client', Timezone: 'Australia/Brisbane' };
    await assert.rejects(() => getCoachCalendarInfo('Empty-Client'), /No calendar for this client/);
  });

  await checkAsync('legacy Google tenant unchanged (Guy-shaped row)', async () => {
    mockFields = { 'Client ID': 'Guy-Wilson', 'Calendar Email': 'guy@example.com', 'Unipile Account ID': 'accGuy' };
    const info = await getCoachCalendarInfo('Guy-Wilson');
    assert.strictEqual(providerForInfo(info), 'google'); // service-account share still wins
  });

  console.log('\nproviderForInfo() — resolution order:');
  check('Calendar Provider=unipile resolves unipile', () =>
    assert.strictEqual(providerForInfo({ calendarProvider: 'unipile', unipileAccountId: 'a' }), 'unipile'));
  check('account id present but provider field blank still resolves unipile', () =>
    assert.strictEqual(providerForInfo({ unipileAccountId: 'a' }), 'unipile'));
  check('nylas grant outranks a unipile account id (explicit provider field decides otherwise)', () =>
    assert.strictEqual(providerForInfo({ nylasGrantId: 'g', unipileAccountId: 'a' }), 'nylas'));
  check('nothing at all falls back to google (old behaviour)', () =>
    assert.strictEqual(providerForInfo({}), 'google'));

  console.log('\ncoachForCalendar() — the seam receives what unipileEnv() reads:');
  check('unipileAccountId carried through', () => {
    const c = coachForCalendar({ calendarProvider: 'unipile', unipileAccountId: 'acc123', timezone: 'Australia/Brisbane' });
    assert.strictEqual(c.unipileAccountId, 'acc123');
    assert.strictEqual(c.calendarProvider, 'unipile');
  });
  check('calendarWriteId carried under its own name (unipileEnv reads coach.calendarWriteId)', () => {
    const c = coachForCalendar({ calendarProvider: 'unipile', unipileAccountId: 'acc123', calendarWriteId: 'calW', timezone: 'Australia/Brisbane' });
    assert.strictEqual(c.calendarWriteId, 'calW');
  });
  check('absent account id stays null, never undefined-to-env leakage', () => {
    const c = coachForCalendar({ calendarProvider: 'zoho', calendarProviderToken: 't', timezone: 'Australia/Brisbane' });
    assert.strictEqual(c.unipileAccountId, null);
  });

  // ---- "which attendee is me" on the Unipile lane (2026-08-27) -------------------------------
  // Calendar Email is blank BY DESIGN here (a value forces the legacy Google path), and that blank
  // used to leave every event without a self row -> isCoachAttending() false -> the Fathom/Granola/
  // Fireflies calendar fallback silently never ran. The client's own address is the stand-in.
  console.log('\ncoachSelfEmail() — the coach identity that survives a blank Calendar Email:');
  check('Calendar Email still wins when set (Google/Zoho tenants do not move)', () =>
    assert.strictEqual(coachSelfEmail({ googleCalendarEmail: 'cal@x.com', clientEmailAddress: 'rec@x.com' }), 'cal@x.com'));
  check('blank Calendar Email falls back to the client record address', () =>
    assert.strictEqual(coachSelfEmail({ googleCalendarEmail: '', clientEmailAddress: 'paul@delvr.ai' }), 'paul@delvr.ai'));
  check('nothing on file returns empty, not undefined', () =>
    assert.strictEqual(coachSelfEmail({}), ''));
  check('no coach object at all is tolerated', () =>
    assert.strictEqual(coachSelfEmail(null), ''));

  await checkAsync('a Unipile row carries the record email through to the seam', async () => {
    mockFields = { 'Client ID': 'Paul-Salvage', 'Calendar Provider': 'unipile', 'Unipile Account ID': 'acc999', 'Client Email Address': 'paul@delvr.ai', Timezone: 'Australia/Brisbane' };
    const info = await getCoachCalendarInfo('Paul-Salvage');
    assert.strictEqual(info.clientEmailAddress, 'paul@delvr.ai');
    const c = coachForCalendar(info);
    assert.strictEqual(c.googleCalendarEmail, '', 'Calendar Email must stay blank on this lane');
    assert.strictEqual(coachSelfEmail(c), 'paul@delvr.ai');
  });

  console.log('\nmapUnipileEvent() — the coach is found in their own meeting:');
  const unipileEvent = {
    id: 'ev1',
    title: 'Paul & a lead',
    start: { date_time: '2026-08-28T03:00:00Z' },
    end: { date_time: '2026-08-28T03:30:00Z' },
    organizer: { email: 'paul@delvr.ai' },
    attendees: [{ email: 'lead@example.com', response_status: 'accepted' }],
  };
  check('a self row is synthesised from the fallback address (was: no self row at all)', () => {
    const mapped = mapUnipileEvent(unipileEvent, coachSelfEmail({ clientEmailAddress: 'paul@delvr.ai' }).toLowerCase(), 'Australia/Brisbane');
    const self = mapped.attendees.find((a) => a.self);
    assert.ok(self, 'expected a self attendee row');
    assert.strictEqual(self.email, 'paul@delvr.ai');
    assert.strictEqual(self.organizer, true, 'organiser flag drives isCoachAttending()');
  });
  check('with no identity at all there is still no self row (the old, broken state)', () => {
    const mapped = mapUnipileEvent(unipileEvent, '', 'Australia/Brisbane');
    assert.strictEqual(mapped.attendees.some((a) => a.self), false);
  });

  global.fetch = realFetch;
  if (failures) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); }
  console.log('\n✅ all unipile-tenant tests passed');
  process.exit(0);
})();
