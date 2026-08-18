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

  global.fetch = realFetch;
  if (failures) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); }
  console.log('\n✅ all unipile-tenant tests passed');
  process.exit(0);
})();
