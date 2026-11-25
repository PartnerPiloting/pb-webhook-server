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
    linkedin: 'https://www.linkedin.com/in/pat-lee/', company: 'Acme', knownFrom: 'you emailed them', lists: [], headline: '', connectedOn: '', manual: false });
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

// ---------------------------------------------------------------- adding and editing a contact by hand
const contactsStore = require('../services/contactsStore');
const { runSaveContact } = require('../services/wingguyContactsMcp');

/** A contacts store in memory that keeps the real key + guard rules (addManualContact / upsert). */
function memStore(seed = []) {
  const rows = seed.map((r, i) => ({ id: i + 1, manual: false, sources: [], lead_record_id: null, ...r }));
  let nextId = rows.length + 1;
  const mine = (coach) => rows.filter((r) => r.coach === coach);
  return {
    rows,
    cleanEmail: contactsStore.cleanEmail,
    slugOf: contactsStore.slugOf,
    getContact: async (coach, id) => mine(coach).find((r) => String(r.id) === String(id)) || null,
    findByIdentity: async (coach, { email = '', linkedin = '' } = {}) => {
      const e = contactsStore.cleanEmail(email); const slug = contactsStore.slugOf(linkedin);
      return mine(coach).filter((r) => (e && String(r.email || '').toLowerCase() === e) || (slug && String(r.linkedin_slug || '').toLowerCase() === slug));
    },
    addManualContact: async (coach, input, { source = 'manual' } = {}) => {
      const row = { id: nextId++, coach, email: input.email || null, name: input.name || null, company: input.company || null, phone: input.phone || null,
        linkedin_slug: input.linkedin || null, lead_record_id: null, sources: [source], manual: true };
      rows.push(row);
      return { ok: true, created: true, row };
    },
    updateContactFields: async (coach, id, fields) => {
      const row = mine(coach).find((r) => String(r.id) === String(id));
      if (!row) return { ok: false, status: 404, error: 'That contact was not found.' };
      if (row.lead_record_id) return { ok: false, status: 409, error: 'lead' };
      for (const [k, v] of Object.entries(fields)) row[k === 'linkedin' ? 'linkedin_slug' : k] = v || null;
      row.manual = true;
      return { ok: true, row };
    },
    // what the nightly sweep does to a row, by the real rule
    sweepSees: (coach, incoming) => {
      const row = mine(coach).find((r) => r.email === incoming.email);
      for (const col of contactsStore.GUARDED_COLS) if (col in incoming || col in row) row[col] = contactsStore.mergedValue(row[col] === undefined ? null : row[col], incoming[col] === undefined ? null : incoming[col], row.manual);
      return row;
    },
  };
}
const noLeadsBase = { clientService: { getClientBase: () => () => ({ select: () => ({ firstPage: async () => [] }) }) }, wingguyLeads: { findLeadRecord: async () => null } };

check('add a contact by hand: a name plus an email OR a phone is enough - no LinkedIn address needed', async () => {
  const store = memStore();
  const deps = { store, ...noLeadsBase };
  const byPhone = await lsc.saveContact('A', 'baseA', { name: 'Jane Smith', phone: '0412 345 678' }, { deps });
  assert.ok(byPhone.ok && byPhone.created && byPhone.kind === 'contact', JSON.stringify(byPhone));
  assert.strictEqual(byPhone.contact.phone, '0412 345 678');
  assert.strictEqual(byPhone.contact.knownFrom, 'you added them');
  const byEmail = await lsc.saveContact('A', 'baseA', { firstName: 'Raj', lastName: 'Patel', email: 'Raj@Example.com' }, { deps });
  assert.ok(byEmail.created && byEmail.contact.email === 'raj@example.com' && byEmail.name === 'Raj Patel');
  // refused: no name; neither email nor phone; an email that is not one
  assert.strictEqual((await lsc.saveContact('A', 'baseA', { email: 'x@y.example' }, { deps })).status, 400);
  assert.strictEqual((await lsc.saveContact('A', 'baseA', { name: 'No Details' }, { deps })).status, 400);
  assert.strictEqual((await lsc.saveContact('A', 'baseA', { name: 'Bad Mail', email: 'not-an-email' }, { deps })).status, 400);
  assert.strictEqual(store.rows.length, 2);
});

check('dedupe first, on email or LinkedIn address - never on a name alone', async () => {
  const store = memStore([
    { coach: 'A', email: 'jane@acme.example', name: 'Jane Smith', sources: ['mail-to'] },
    { coach: 'A', email: 'lee@lead.example', name: 'Lee Lead', lead_record_id: 'recLEE', sources: ['lead'] },
    { coach: 'A', email: null, name: 'Sam Slug', linkedin_slug: 'sam-slug', lead_record_id: 'recSAM', sources: ['lead'] },
    { coach: 'B', email: 'other@b.example', name: 'Other Tenant', sources: ['mail-to'] },
  ]);
  const deps = { store, ...noLeadsBase };
  const contact = await lsc.saveContact('A', 'baseA', { name: 'J Smith', email: 'JANE@acme.example', phone: '0400' }, { deps });
  assert.ok(contact.ok && !contact.created && contact.exists && contact.kind === 'contact' && contact.name === 'Jane Smith', JSON.stringify(contact));
  const lead = await lsc.saveContact('A', 'baseA', { name: 'Lee', email: 'lee@lead.example' }, { deps });
  assert.ok(lead.exists && lead.kind === 'lead' && lead.leadRecordId === 'recLEE');
  const bySlug = await lsc.saveContact('A', 'baseA', { name: 'Sam', phone: '0400 111 222', linkedin: 'https://www.linkedin.com/in/sam-slug/' }, { deps });
  assert.ok(bySlug.exists && bySlug.kind === 'lead' && bySlug.leadRecordId === 'recSAM');
  // same NAME as an existing contact but a different email: a new person, not a match
  const sameName = await lsc.saveContact('A', 'baseA', { name: 'Jane Smith', email: 'jane.smith@elsewhere.example' }, { deps });
  assert.ok(sameName.created && sameName.kind === 'contact');
  // another client's contact with that email is invisible: this client gets their own
  const own = await lsc.saveContact('A', 'baseA', { name: 'Other', email: 'other@b.example' }, { deps });
  assert.ok(own.created);
  assert.strictEqual(store.rows.filter((r) => r.coach === 'B').length, 1);
});

check('a lead the sweep has not copied across yet is still caught - by asking the leads base', async () => {
  const store = memStore();
  const base = () => ({ select: ({ filterByFormula }) => ({ firstPage: async () => (filterByFormula.includes('fresh@lead.example') ? [{ id: 'recFRESH', fields: { 'First Name': 'Fresh', 'Last Name': 'Lead' } }] : []) }) });
  const r = await lsc.saveContact('A', 'baseA', { name: 'Fresh L', email: 'fresh@lead.example' }, { deps: { store, clientService: { getClientBase: () => base }, wingguyLeads: { findLeadRecord: async () => null } } });
  assert.ok(r.exists && r.kind === 'lead' && r.leadRecordId === 'recFRESH' && r.name === 'Fresh Lead', JSON.stringify(r));
  assert.strictEqual(store.rows.length, 0);
});

check('edit a contact: name, company, email, phone, LinkedIn - but never onto someone else\'s email, and never a lead', async () => {
  const store = memStore([
    { coach: 'A', email: 'jane@acme.example', name: 'Jane Smith', sources: ['mail-to'] },
    { coach: 'A', email: 'taken@acme.example', name: 'Tim Taken', sources: ['mail-to'] },
    { coach: 'A', email: 'lee@lead.example', name: 'Lee Lead', lead_record_id: 'recLEE', sources: ['lead'] },
  ]);
  const deps = { store };
  const ok = await lsc.editContact('A', 1, { name: 'Jane Smith-Jones', company: 'Acme Pty', phone: '0412 000 111', junk: 'ignored' }, { deps });
  assert.ok(ok.ok && ok.contact.name === 'Jane Smith-Jones' && ok.contact.company === 'Acme Pty' && ok.contact.phone === '0412 000 111' && ok.contact.manual === true, JSON.stringify(ok));
  assert.strictEqual(store.rows[0].junk, undefined);
  const clash = await lsc.editContact('A', 1, { email: 'taken@acme.example' }, { deps });
  assert.strictEqual(clash.status, 409);
  assert.ok(/Tim Taken already has that email address/.test(clash.error), clash.error);
  assert.strictEqual((await lsc.editContact('A', 3, { name: 'Changed' }, { deps })).status, 409);
  assert.strictEqual((await lsc.editContact('B', 1, { name: 'Wrong tenant' }, { deps })).status, 404);
  assert.strictEqual((await lsc.editContact('A', 1, {}, { deps })).status, 400);
});

check('THE NIGHTLY SWEEP: a hand-added or hand-edited contact keeps what was typed; blanks may be filled; nothing is removed', async () => {
  const store = memStore([{ coach: 'A', email: 'pat@acme.example', name: 'P', company: null, phone: null, sources: ['mail-from'] }]);
  // an ordinary row: the feed's newer value wins
  assert.strictEqual(store.sweepSees('A', { email: 'pat@acme.example', name: 'Patricia Lee (from mail header)' }).name, 'Patricia Lee (from mail header)');
  // the client edits it by hand...
  await lsc.editContact('A', 1, { name: 'Pat Lee', phone: '0400 123 456' }, { deps: { store } });
  // ...and tonight's sweep sees the same address again, with different details
  const after = store.sweepSees('A', { email: 'pat@acme.example', name: 'PATRICIA LEE', phone: '+61 2 0000 0000', company: 'Acme Holdings' });
  assert.strictEqual(after.name, 'Pat Lee');
  assert.strictEqual(after.phone, '0400 123 456');
  assert.strictEqual(after.company, 'Acme Holdings');          // was blank: the sweep may fill it
  assert.strictEqual(store.rows.length, 1);
  // the SQL the sweep really runs carries that rule for every hand-editable column
  for (const col of ['email', 'name', 'first_name', 'last_name', 'company', 'phone', 'linkedin_slug']) {
    assert.ok(contactsStore.MANUAL_GUARD.includes(`${col} = CASE WHEN wingguy_contacts.manual THEN COALESCE(wingguy_contacts.${col}, EXCLUDED.${col}) ELSE COALESCE(EXCLUDED.${col}, wingguy_contacts.${col}) END`), col);
  }
  assert.ok(!/manual\s*=/.test(contactsStore.MANUAL_GUARD.replace(/wingguy_contacts\.manual/g, '')), 'an upsert must never reset the manual flag');
  assert.strictEqual(contactsStore.mergedValue('typed', 'scraped', true), 'typed');
  assert.strictEqual(contactsStore.mergedValue(null, 'scraped', true), 'scraped');
  assert.strictEqual(contactsStore.mergedValue('old', 'newer', false), 'newer');
  assert.strictEqual(contactsStore.mergedValue('old', null, false), 'old');
});

check('Claude\'s "save X to my contacts": create-only, says who already exists, and is off for clients not switched on', async () => {
  const store = memStore([{ coach: 'Guy-Wilson', email: 'lee@lead.example', name: 'Lee Lead', lead_record_id: 'recLEE', sources: ['lead'] }]);
  const deps = { clientService: { getClientById: async () => ({ airtableBaseId: 'baseG' }) }, inner: { store, ...noLeadsBase } };
  const saved = await runSaveContact({ name: 'Jane Smith', phone: '0412 345 678' }, 'Guy-Wilson', deps);
  assert.ok(/^Saved Jane Smith to your contacts \(0412 345 678\)\. They are a contact, not a lead/.test(saved.text), saved.text);
  assert.strictEqual(store.rows[1].sources[0], 'manual-claude');
  const again = await runSaveContact({ name: 'Jane S', phone: '0412 345 678', email: 'lee@lead.example' }, 'Guy-Wilson', deps);
  assert.ok(/Lee Lead is already one of your leads \(record recLEE\) - nothing new was saved/.test(again.text), again.text);
  const missing = await runSaveContact({ name: 'No Details' }, 'Guy-Wilson', deps);
  assert.ok(missing.isError && /email or a phone/.test(missing.text));
  const off = await runSaveContact({ name: 'Jane Smith', phone: '0412 345 678' }, 'Roland-Illyes', deps);
  assert.ok(/not switched on for this account yet/.test(off.text));
  assert.strictEqual(store.rows.length, 2);
});

(async () => {
  for (const run of pending) await run();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nAll lead-search-contacts tests passed');
  process.exit(0);
})();
