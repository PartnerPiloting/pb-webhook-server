/**
 * Tests for "is this person from a recorded call already a lead?" (services/pendingPeopleMatch.js,
 * 2026-11-24). The Add button on "People you've met" used to create a lead with no check.
 *
 * What must hold:
 *   - their email on a lead (main or alternate address) = the same person: kind 'email'
 *   - only the full name matching = kind 'name' - reported, NEVER decided
 *   - a first name alone, or no name, is never a name match
 *   - nobody matching = kind null (Add works exactly as before)
 *   - a base that cannot be read = kind null, never an error (Add must keep working)
 *   - "same person" keeps the address on the lead and attaches the waiting transcripts; nothing new
 * Fakes only. Made-up people. Run: node tests/pending-people-match.test.js
 */
const assert = require('assert');
const { findExistingLead, attachToLead, nameKey } = require('../services/pendingPeopleMatch');

let failures = 0;
const pending = [];
const check = (name, fn) => pending.push(async () => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
});

const LEADS = [
  { id: 'recJANE0000000001', fields: { 'First Name': 'Jane', 'Last Name': 'Smith', 'Company Name': 'Acme', Email: 'jane@acme.example', 'Alt Emails': 'jane.smith@gmail.example\njs@old.example' } },
  { id: 'recJANE0000000002', fields: { 'First Name': 'Jane', 'Last Name': 'Smith', 'Company Name': 'Other Co', Email: 'jane@other.example' } },
  { id: 'recMARY0000000003', fields: { 'First Name': 'Mary Anne', 'Last Name': 'Jones', 'Company Name': '', Email: '' } },
];
/** A leads base that understands the two formulas the matcher uses. */
function fakeBase(leads = LEADS, { fail = false } = {}) {
  return () => ({
    select: ({ filterByFormula, maxRecords = 100 }) => ({
      firstPage: async () => {
        if (fail) throw new Error('Airtable is down');
        const f = String(filterByFormula);
        const email = (f.match(/LOWER\(TRIM\(\{Email\}\)\) = "([^"]*)"/) || [])[1];
        const first = (f.match(/LOWER\(TRIM\(\{First Name\}\)\) = "([^"]*)"/) || [])[1];
        const last = (f.match(/LOWER\(TRIM\(\{Last Name\}\)\) = "([^"]*)"/) || [])[1];
        let hits = [];
        if (email !== undefined) {
          hits = leads.filter((l) => String(l.fields.Email || '').toLowerCase() === email
            || (f.includes('Alt Emails') && String(l.fields['Alt Emails'] || '').toLowerCase().includes(email)));
        } else if (first !== undefined) {
          hits = leads.filter((l) => String(l.fields['First Name']).toLowerCase() === first && String(l.fields['Last Name']).toLowerCase() === last);
        }
        return hits.slice(0, maxRecords);
      },
    }),
    find: async (id) => { const l = leads.find((x) => x.id === id); if (!l) throw new Error('not found'); return l; },
  });
}

console.log('pending-people-match tests');

check('their email is already on a lead - main address or an alternate - the same person for certain', async () => {
  const main = await findExistingLead(fakeBase(), { email: 'JANE@acme.example', name: 'Somebody Else' });
  assert.deepStrictEqual(main, { kind: 'email', leads: [{ id: 'recJANE0000000001', name: 'Jane Smith', company: 'Acme', email: 'jane@acme.example' }] });
  const alt = await findExistingLead(fakeBase(), { email: 'jane.smith@gmail.example', name: '' });
  assert.strictEqual(alt.kind, 'email');
  assert.strictEqual(alt.leads[0].id, 'recJANE0000000001');
});

check('only the full name matches: reported with company and email, every candidate, never decided', async () => {
  const r = await findExistingLead(fakeBase(), { email: 'jane.personal@new.example', name: 'jane  SMITH' });
  assert.strictEqual(r.kind, 'name');
  assert.deepStrictEqual(r.leads.map((l) => `${l.name} | ${l.company} | ${l.email}`), ['Jane Smith | Acme | jane@acme.example', 'Jane Smith | Other Co | jane@other.example']);
  // a two-word first name: the last word is the surname, as the portal splits it
  assert.strictEqual((await findExistingLead(fakeBase(), { email: 'm@new.example', name: 'Mary Anne Jones' })).kind, 'name');
});

check('a first name alone, no name, or nobody like them = no match (Add works exactly as before)', async () => {
  assert.deepStrictEqual(await findExistingLead(fakeBase(), { email: 'x@new.example', name: 'Jane' }), { kind: null, leads: [] });
  assert.deepStrictEqual(await findExistingLead(fakeBase(), { email: 'x@new.example', name: '' }), { kind: null, leads: [] });
  assert.deepStrictEqual(await findExistingLead(fakeBase(), { email: 'x@new.example', name: 'Nobody Here' }), { kind: null, leads: [] });
  assert.strictEqual(nameKey('Jane'), null);
  assert.deepStrictEqual(nameKey('  Mary Anne   Jones '), { first: 'mary anne', last: 'jones' });
});

check('a leads base that cannot be read answers "no match", never an error - Add must keep working', async () => {
  assert.deepStrictEqual(await findExistingLead(fakeBase(LEADS, { fail: true }), { email: 'jane@acme.example', name: 'Jane Smith' }), { kind: null, leads: [] });
});

check('"Same person": the address is kept on the lead and the waiting transcripts attach - nothing new is made', async () => {
  const emailUpdates = [];
  const resolved = [];
  const deps = {
    clientService: { getClientBase: () => fakeBase() },
    wingguyLeads: { updateLeadEmails: async (baseId, leadId, opts) => { emailUpdates.push([leadId, opts]); return { ok: true }; } },
    db: { resolvePendingLeadByEmail: async (a) => { resolved.push(a); return { linked: ['m1', 'm2'] }; } },
  };
  const r = await attachToLead('Client-A', 'baseA', { email: 'Jane.Personal@new.example', leadId: 'recJANE0000000002' }, { deps });
  assert.deepStrictEqual(r, { ok: true, status: 200, attachedMeetings: 2, lead: { id: 'recJANE0000000002', name: 'Jane Smith' } });
  assert.deepStrictEqual(emailUpdates, [['recJANE0000000002', { addOthers: ['jane.personal@new.example'] }]]);
  assert.deepStrictEqual(resolved, [{ email: 'jane.personal@new.example', airtableLeadId: 'recJANE0000000002', coachClientId: 'Client-A', source: 'portal-same-person' }]);
  // an address the lead already holds is not written again
  emailUpdates.length = 0;
  await attachToLead('Client-A', 'baseA', { email: 'js@old.example', leadId: 'recJANE0000000001' }, { deps });
  assert.strictEqual(emailUpdates.length, 0);
  // a lead that does not exist, or a bad id, attaches nothing
  assert.strictEqual((await attachToLead('Client-A', 'baseA', { email: 'x@y.example', leadId: 'recNOPE000000000X' }, { deps })).status, 404);
  assert.strictEqual((await attachToLead('Client-A', 'baseA', { email: 'x@y.example', leadId: 'nonsense' }, { deps })).status, 400);
  assert.strictEqual(resolved.length, 2);
});

(async () => {
  for (const run of pending) await run();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nAll pending-people-match tests passed');
  process.exit(0);
})();
