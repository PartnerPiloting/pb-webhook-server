/**
 * Tests for "Found in your contacts" on Lead Search (services/leadSearchContacts.js, 2026-11-23).
 *
 * What must hold:
 *   - contacts only ever come back for a typed name of 3+ characters, never for a pasted profile link
 *   - anyone who is already a lead is left out, including by an alternate address
 *   - Add as lead dedupes (already a lead in the warehouse, or the same email on a lead) and never
 *     makes a second record
 *   - the new lead is NOT marked as a LinkedIn connection, and a contact with no LinkedIn address
 *     is added on name + email
 *   - one client can never add another client's contact
 * No Postgres, no Airtable - fakes. Synthetic people.
 *
 * Run: node tests/lead-search-contacts.test.js
 */
const assert = require('assert');
const lsc = require('../services/leadSearchContacts');

let failures = 0;
const pending = [];
const check = (name, fn) => pending.push(async () => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
});

const ROWS = [
  { id: 1, coach: 'A', email: 'pat@acme.example', name: 'Pat Lee', company: 'Acme', phone: '0400 000 001', linkedin_slug: 'pat-lee', lead_record_id: null, sources: ['mail-to'] },
  { id: 2, coach: 'A', email: 'sam@lead.example', name: 'Sam Lead', lead_record_id: 'recLEAD1', sources: ['lead'] },
  { id: 3, coach: 'A', email: 'sam.alt@lead.example', name: 'Sam Lead', lead_record_id: 'recLEAD1', sources: ['lead-alt'] },
  { id: 4, coach: 'A', email: 'jo.okoro@nolinkedin.example', name: '', lead_record_id: null, sources: ['mail-from'] },
  { id: 5, coach: 'B', email: 'pat@other.example', name: 'Pat Other', lead_record_id: null, sources: ['mail-to'] },
  { id: 6, coach: 'A', email: 'dup@acme.example', name: 'Dee Dupe', lead_record_id: null, sources: ['mail-thread'] },
];
function fakeStore() {
  const marked = [];
  return {
    marked,
    findPeople: async (coach, q) => ROWS.filter((r) => r.coach === coach && `${r.name} ${r.email}`.toLowerCase().includes(q.toLowerCase())),
    getContact: async (coach, id) => ROWS.find((r) => r.coach === coach && String(r.id) === String(id)) || null,
    markAsLead: async (coach, id, rec) => { marked.push([coach, id, rec]); return true; },
  };
}
function fakeDeps({ emailOnLead = '' } = {}) {
  const created = [];
  const store = fakeStore();
  const base = () => ({ select: ({ filterByFormula }) => ({ firstPage: async () => (emailOnLead && filterByFormula.includes(emailOnLead) ? [{ id: 'recSAME', fields: { 'First Name': 'Dee', 'Last Name': 'Dupe' } }] : []) }) });
  return {
    created, store,
    clientService: { getClientBase: () => base },
    wingguyLeads: { createLead: async (baseId, args) => { created.push(args); return { ok: true, created: true, leadRecordId: 'recNEW', fields: {} }; } },
  };
}

console.log('lead-search-contacts tests');

check('only for a typed name of 3+ characters; never for a pasted LinkedIn link', async () => {
  const deps = { store: fakeStore() };
  const none = { contacts: [], more: false };
  assert.deepStrictEqual(await lsc.searchContacts('A', 'pa', { deps }), none);
  assert.deepStrictEqual(await lsc.searchContacts('A', '', { deps }), none);
  assert.deepStrictEqual(await lsc.searchContacts('A', 'https://www.linkedin.com/in/pat-lee', { deps }), none);
  assert.strictEqual((await lsc.searchContacts('A', 'pat', { deps })).contacts.length, 1);
});

check('a contact shows name, email, phone, LinkedIn and where Wingguy knows them from', async () => {
  const [c] = (await lsc.searchContacts('A', 'pat lee', { deps: { store: fakeStore() } })).contacts;
  assert.deepStrictEqual(c, { id: '1', name: 'Pat Lee', email: 'pat@acme.example', otherEmails: [], phone: '0400 000 001',
    linkedin: 'https://www.linkedin.com/in/pat-lee/', company: 'Acme', knownFrom: 'you emailed them' });
});

check('anyone who is already a lead is left out - by their main or an alternate address', async () => {
  assert.deepStrictEqual((await lsc.searchContacts('A', 'sam', { deps: { store: fakeStore() } })).contacts, []);
  assert.deepStrictEqual((await lsc.searchContacts('A', 'sam.alt', { deps: { store: fakeStore() } })).contacts, []);
});

check('one client never sees or adds another client\'s contact', async () => {
  const deps = fakeDeps();
  assert.deepStrictEqual((await lsc.searchContacts('A', 'pat', { deps })).contacts.map((c) => c.id), ['1']);
  const r = await lsc.addContactAsLead('A', 'baseA', 5, { deps });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(deps.created.length, 0);
});

check('Add as lead: created through the shared door, NOT marked as a LinkedIn connection', async () => {
  const deps = fakeDeps();
  const r = await lsc.addContactAsLead('A', 'baseA', 1, { deps });
  assert.ok(r.ok && r.created && r.leadRecordId === 'recNEW', JSON.stringify(r));
  const sent = deps.created[0];
  assert.strictEqual(sent.firstName, 'Pat');
  assert.strictEqual(sent.lastName, 'Lee');
  assert.strictEqual(sent.email, 'pat@acme.example');
  assert.strictEqual(sent.linkedinUrl, 'https://www.linkedin.com/in/pat-lee/');
  assert.strictEqual(sent.connected, undefined);
  assert.strictEqual(sent.connectionStatus, undefined);
  assert.strictEqual(sent.source, 'Follow-Up Personally');
  assert.ok(/you emailed them/.test(sent.notes));
  assert.deepStrictEqual(deps.store.marked, [['A', 1, 'recNEW']]);   // it stops being offered at once
});

check('a contact with no LinkedIn address and no name is added on the name in their email', async () => {
  const deps = fakeDeps();
  const r = await lsc.addContactAsLead('A', 'baseA', 4, { deps });
  assert.ok(r.ok && r.created);
  assert.strictEqual(deps.created[0].firstName, 'Jo');
  assert.strictEqual(deps.created[0].lastName, 'Okoro');
  assert.strictEqual(deps.created[0].linkedinUrl, '');
  assert.strictEqual(deps.created[0].email, 'jo.okoro@nolinkedin.example');
});

check('never a duplicate: already a lead in the list, or the same email already on a lead', async () => {
  const a = fakeDeps();
  const already = await lsc.addContactAsLead('A', 'baseA', 2, { deps: a });
  assert.ok(already.ok && already.exists && already.leadRecordId === 'recLEAD1');
  assert.strictEqual(a.created.length, 0);
  const b = fakeDeps({ emailOnLead: 'dup@acme.example' });
  const same = await lsc.addContactAsLead('A', 'baseA', 6, { deps: b });
  assert.ok(same.ok && same.exists && same.leadRecordId === 'recSAME', JSON.stringify(same));
  assert.strictEqual(b.created.length, 0);
  assert.deepStrictEqual(b.store.marked, [['A', 6, 'recSAME']]);
});

check('capped at 25 contacts, and it says when more matched', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, coach: 'A', email: `david${i}@x.example`, name: `David Person${i}`, lead_record_id: null, sources: ['mail-to'] }));
  const store = { findPeople: async () => many };
  const r = await lsc.searchContacts('A', 'david', { deps: { store } });
  assert.strictEqual(r.contacts.length, 25);
  assert.strictEqual(r.more, true);
  const few = await lsc.searchContacts('A', 'david', { deps: { store: { findPeople: async () => many.slice(0, 7) } } });
  assert.strictEqual(few.contacts.length, 7);
  assert.strictEqual(few.more, false);
});

(async () => {
  for (const run of pending) await run();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nAll lead-search-contacts tests passed');
  process.exit(0);
})();
