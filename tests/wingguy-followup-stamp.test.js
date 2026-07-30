/**
 * Tests for the DRAFT-TIME follow-up stamp — the queue's `Follow-Up Date` no longer depending on
 * the coach remembering the track@ BCC (services/wingguyMailMcp.js).
 *
 * Covers: chooseFollowUpStamp() (+14, never regressing a later date, idempotent re-stamp) ·
 * coachOwnEmails() (self-address set) · stampFollowUpForDraft() against injected fakes for
 * clientService + inboundEmailService — no Airtable, no network. ⚠ Synthetic content only.
 *
 * Run: node tests/wingguy-followup-stamp.test.js
 */
const assert = require('assert');
const path = require('path');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

// ---------------------------------------------------------------------------
// Stub the two lazily-required collaborators BEFORE wingguyMailMcp resolves them.
// Both are required inside the function body, so seeding require.cache is enough.
// ---------------------------------------------------------------------------
const writes = [];        // { id, fields }
let leadsByEmail = {};    // email -> lead record | null
let lookupError = null;

const stub = (relPath, exports) => {
  const full = require.resolve(relPath);
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

stub('../services/clientService', {
  getClientBase: (baseId) => {
    if (!baseId) throw new Error('Airtable Base ID is required');
    return (table) => ({
      update: async (id, fields) => { writes.push({ table, id, fields }); return { id, fields }; },
    });
  },
});
stub('../services/inboundEmailService', {
  findLeadByEmail: async (_client, email) => {
    if (lookupError) throw new Error(lookupError);
    return leadsByEmail[String(email).toLowerCase()] || null;
  },
});

const { chooseFollowUpStamp, coachOwnEmails, stampFollowUpForDraft } = require('../services/wingguyMailMcp');

const COACH = {
  clientId: 'Test-Coach',
  airtableBaseId: 'appTest',
  clientEmailAddress: 'Coach@Example.com',
  googleCalendarEmail: 'coach.calendar@example.com',
  rawRecord: { get: (f) => (f === 'Alternative Email Addresses' ? 'old-coach@example.com; me@example.com' : null) },
};
const NOW = new Date('2026-07-30T02:00:00Z'); // +14 = 2026-08-13

(async () => {
  console.log('chooseFollowUpStamp() — the +14 decision:');
  await check('stamps +14 days when the lead has no follow-up date', () => {
    assert.strictEqual(chooseFollowUpStamp(null, NOW), '2026-08-13');
    assert.strictEqual(chooseFollowUpStamp('', NOW), '2026-08-13');
  });
  await check('overwrites an EARLIER date (this email restarts the clock)', () => {
    assert.strictEqual(chooseFollowUpStamp('2026-08-01', NOW), '2026-08-13');
  });
  await check('leaves a LATER date alone — never pulls a longer promise back in', () => {
    assert.strictEqual(chooseFollowUpStamp('2026-09-15', NOW), null);
  });
  await check('re-stamping the same day is a no-op (the BCC copy arriving later)', () => {
    assert.strictEqual(chooseFollowUpStamp('2026-08-13', NOW), null);
  });
  await check('reads an ISO datetime value, not just YYYY-MM-DD', () => {
    assert.strictEqual(chooseFollowUpStamp('2026-09-15T00:00:00.000Z', NOW), null);
  });
  await check('an unreadable reference date stamps nothing', () => {
    assert.strictEqual(chooseFollowUpStamp(null, new Date('nonsense')), null);
  });
  await check('derives the same string as the inbound path does (setDate + ISO date part)', () => {
    const ref = new Date('2026-12-25T23:30:00Z');
    const inbound = new Date(ref); inbound.setDate(inbound.getDate() + 14);
    assert.strictEqual(chooseFollowUpStamp(null, ref), inbound.toISOString().split('T')[0]);
  });

  console.log('coachOwnEmails() — what counts as "my own address":');
  await check('collects primary + calendar + alternatives, lowercased', () => {
    const s = coachOwnEmails(COACH);
    assert.ok(s.has('coach@example.com'));
    assert.ok(s.has('coach.calendar@example.com'));
    assert.ok(s.has('old-coach@example.com'));
    assert.ok(s.has('me@example.com'));
    assert.ok(!s.has('lead@example.com'));
  });
  await check('survives a client record with no rawRecord', () => {
    const s = coachOwnEmails({ clientEmailAddress: 'x@y.com' });
    assert.deepStrictEqual([...s], ['x@y.com']);
  });

  console.log('stampFollowUpForDraft() — the write pass:');
  const reset = (leads) => { writes.length = 0; leadsByEmail = leads; lookupError = null; };

  await check('stamps a matched lead once, on the Leads table', async () => {
    reset({ 'lead@example.com': { id: 'recL1', followUpDate: null } });
    const r = await stampFollowUpForDraft({ coach: COACH, recipients: [{ email: 'Lead@Example.com' }], now: NOW });
    assert.deepStrictEqual(r.stamped, ['lead@example.com → 2026-08-13']);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].table, 'Leads');
    assert.strictEqual(writes[0].id, 'recL1');
    assert.deepStrictEqual(writes[0].fields, { 'Follow-Up Date': '2026-08-13' });
  });
  await check('skips the coach\'s own address (self-reminder, not a lead email)', async () => {
    reset({ 'coach@example.com': { id: 'recSelf', followUpDate: null } });
    const r = await stampFollowUpForDraft({ coach: COACH, recipients: [{ email: 'coach@example.com' }], now: NOW });
    assert.strictEqual(writes.length, 0);
    assert.ok(r.skipped[0].includes('your own address'));
  });
  await check('skips an address that is not a lead in the base', async () => {
    reset({});
    const r = await stampFollowUpForDraft({ coach: COACH, recipients: [{ email: 'stranger@example.com' }], now: NOW });
    assert.strictEqual(writes.length, 0);
    assert.ok(r.skipped[0].includes('not a lead'));
  });
  await check('does not write when a later date is already set', async () => {
    reset({ 'lead@example.com': { id: 'recL1', followUpDate: '2026-09-15' } });
    const r = await stampFollowUpForDraft({ coach: COACH, recipients: [{ email: 'lead@example.com' }], now: NOW });
    assert.strictEqual(writes.length, 0);
    assert.ok(r.skipped[0].includes('already due 2026-09-15'));
  });
  await check('two recipients = two stamps; a repeated address writes once', async () => {
    reset({ 'a@example.com': { id: 'recA', followUpDate: null }, 'b@example.com': { id: 'recB', followUpDate: null } });
    const r = await stampFollowUpForDraft({
      coach: COACH,
      recipients: [{ email: 'a@example.com' }, { email: 'b@example.com' }, { email: 'A@example.com' }],
      now: NOW,
    });
    assert.strictEqual(r.stamped.length, 2);
    assert.deepStrictEqual(writes.map((w) => w.id).sort(), ['recA', 'recB']);
  });
  await check('a lookup failure is reported, not thrown (the draft already exists)', async () => {
    reset({});
    lookupError = 'Airtable 503';
    const r = await stampFollowUpForDraft({ coach: COACH, recipients: [{ email: 'lead@example.com' }], now: NOW });
    assert.strictEqual(writes.length, 0);
    assert.ok(r.failed[0].includes('Airtable 503'));
  });
  await check('a client with no Airtable base stamps nothing and does not throw', async () => {
    reset({ 'lead@example.com': { id: 'recL1', followUpDate: null } });
    const r = await stampFollowUpForDraft({ coach: { clientId: 'X' }, recipients: [{ email: 'lead@example.com' }], now: NOW });
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(r.stamped.length, 0);
  });

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
  process.exit(failures ? 1 : 0);
})();
