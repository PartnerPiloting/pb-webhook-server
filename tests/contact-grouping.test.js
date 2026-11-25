/**
 * Tests for ONE ROW PER PERSON (services/contactGrouping.js + services/leadSearchContacts.js,
 * 2026-11-25). The contacts store keeps a row per address; a name search showed one person three
 * times.
 *
 * What must hold:
 *   - same full name PLUS a shared detail (company, phone or LinkedIn address) = one person
 *   - same name with nothing else in common stays SEPARATE - never two John Smiths merged on a name
 *   - addresses one file entry listed together are one person, whatever else differs
 *   - a search that matched only ONE of a person's addresses still shows every address on the card
 *   - "Make this contact a lead" carries every address onto the lead: the first as the main email,
 *     the rest as alternates; every one of their rows stops being offered
 *   - editing a person shown once still works, and cannot split them back into two
 * Fakes only. Made-up people. Run: node tests/contact-grouping.test.js
 */
const assert = require('assert');
const { groupPeople, nameKey, companyKey, phoneKey } = require('../services/contactGrouping');
const lsc = require('../services/leadSearchContacts');

let failures = 0;
const pending = [];
const check = (name, fn) => pending.push(async () => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
});

const row = (id, email, name, extra = {}) => ({ id, coach: 'A', email, name, company: null, phone: null, linkedin_slug: null, lead_record_id: null, sources: ['mail-to'], lists: [], manual: false, person_ref: null, ...extra });
const ROWS = () => [
  // one person, three addresses, the same company on each (how a Google contact with three emails arrives)
  row(1, 'avon@work.example', 'Avon Example', { company: 'Relevate', phone: '+61 400 111 222', linkedin_slug: 'avonexample', sources: ['import'], lists: ['CC Results Group'], manual: true }),
  row(2, 'avon@home.example', 'Avon Example', { company: 'Relevate Pty Ltd', sources: ['import', 'mail-from'], manual: true }),
  row(3, 'avon@old.example', 'avon  example', { company: 'relevate', sources: ['import'], lists: ['Evercontact'], manual: true }),
  // two DIFFERENT John Smiths: nothing in common but the name
  row(4, 'john@acme.example', 'John Smith', { company: 'Acme' }),
  row(5, 'john@bravo.example', 'John Smith', { company: 'Bravo' }),
  row(6, 'johnsmith@mail.example', 'John Smith'),
  // the same phone ties two addresses, written two ways
  row(7, 'kim@one.example', 'Kim Phone', { phone: '0412 345 678' }),
  row(8, 'kim@two.example', 'Kim Phone', { phone: '+61 412 345 678' }),
  // a file listed these together - the names differ, the file still said one person
  row(9, 'lou@a.example', 'Lou Filed', { person_ref: 'lou@a.example' }),
  row(10, 'l.filed@b.example', 'L Filed', { person_ref: 'lou@a.example' }),
  // a first name alone is never a name to match on
  row(11, 'sam@x.example', 'Sam', { company: 'Solo' }),
  row(12, 'sam@y.example', 'Sam', { company: 'Solo' }),
  // someone else entirely, and another client's row
  row(13, 'zed@z.example', 'Zed Other', { company: 'Relevate' }),
  { ...row(14, 'avon@theirs.example', 'Avon Example', { company: 'Relevate' }), coach: 'B' },
  // a lead with the same name and company is NOT folded into the contact
  row(15, 'avon@lead.example', 'Avon Example', { company: 'Relevate', lead_record_id: 'recAVON', sources: ['lead'] }),
];

function fakeStore(rows = ROWS()) {
  const marked = [];
  const mine = (coach) => rows.filter((r) => r.coach === coach);
  return {
    rows, marked,
    findPeople: async (coach, q, { notLeads } = {}) => mine(coach).filter((r) => (!notLeads || !r.lead_record_id) && `${r.name} ${r.email} ${r.company || ''}`.toLowerCase().includes(q.toLowerCase())),
    findSamePeople: async (coach, { names = [], refs = [] }) => mine(coach).filter((r) => !r.lead_record_id
      && (names.includes(String(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim()) || (r.person_ref && refs.includes(r.person_ref)))),
    getContact: async (coach, id) => mine(coach).find((r) => String(r.id) === String(id)) || null,
    markAsLead: async (coach, id, rec) => { marked.push([id, rec]); const r = mine(coach).find((x) => x.id === id); if (r) r.lead_record_id = rec; return true; },
    findByIdentity: async (coach, { email }) => mine(coach).filter((r) => email && r.email === email),
    updateContactFields: async (coach, id, fields) => {
      const r = mine(coach).find((x) => String(x.id) === String(id));
      for (const k of ['name', 'company', 'email', 'phone']) if (k in fields) r[k] = fields[k] || null;
      r.manual = true;
      return { ok: true, row: r };
    },
    updatePersonShared: async (coach, ids, { name, company, ref }) => {
      for (const r of mine(coach)) if (ids.map(String).includes(String(r.id)) && !r.lead_record_id) {
        if (name !== undefined) r.name = name;
        if (company !== undefined) r.company = company;
        if (!r.person_ref && ref) r.person_ref = ref;
      }
      return ids.length;
    },
  };
}
function fakeDeps(rows) {
  const created = [];
  const altEmails = [];
  const tagged = [];
  const base = () => ({ select: () => ({ firstPage: async () => [] }) });
  return {
    created, altEmails, tagged, store: fakeStore(rows),
    clientService: { getClientBase: () => base },
    wingguyLeads: {
      createLead: async (baseId, args) => { created.push(args); return { ok: true, created: true, leadRecordId: 'recNEW', fields: {} }; },
      updateLeadEmails: async (baseId, leadId, opts) => { altEmails.push([leadId, opts]); return { ok: true }; },
    },
    leadTags: { updateLeadTags: async (b, id, { add }) => { tagged.push([id, add]); return { ok: true, changed: true }; } },
    recallDb: { resolvePendingLeadByEmail: async () => ({ linked: [] }) },
  };
}

console.log('contact-grouping tests');

check('the rule: same full name PLUS a shared detail = one person; a name alone is never enough', () => {
  const people = groupPeople(ROWS().filter((r) => r.coach === 'A' && !r.lead_record_id));
  const by = (email) => people.find((p) => p.emails.includes(email));
  assert.deepStrictEqual(by('avon@work.example').emails, ['avon@work.example', 'avon@home.example', 'avon@old.example']);
  assert.deepStrictEqual(by('avon@work.example').ids, ['1', '2', '3']);
  // three John Smiths stay three
  assert.deepStrictEqual([by('john@acme.example').ids, by('john@bravo.example').ids, by('johnsmith@mail.example').ids], [['4'], ['5'], ['6']]);
  // the same phone, written two ways
  assert.deepStrictEqual(by('kim@one.example').emails, ['kim@one.example', 'kim@two.example']);
  // the file said so, though the names differ
  assert.deepStrictEqual(by('lou@a.example').emails, ['lou@a.example', 'l.filed@b.example']);
  // a first name alone is not a name to match on, even with the same company
  assert.deepStrictEqual([by('sam@x.example').ids, by('sam@y.example').ids], [['11'], ['12']]);
  // the same company with a different name is nobody's other address
  assert.deepStrictEqual(by('zed@z.example').ids, ['13']);
  assert.strictEqual(people.length, 9);
});

check('one person carries everything their rows know: phone, LinkedIn, lists, where from', () => {
  const [avon] = groupPeople(ROWS().slice(0, 3));
  assert.strictEqual(avon.phone, '+61 400 111 222');
  assert.strictEqual(avon.linkedin_slug, 'avonexample');
  assert.deepStrictEqual(avon.lists, ['CC Results Group', 'Evercontact']);
  assert.deepStrictEqual(avon.sources, ['import', 'mail-from']);
  assert.strictEqual(avon.name, 'Avon Example');
  // the helpers
  assert.strictEqual(nameKey('  Avon   EXAMPLE '), 'avon example');
  assert.strictEqual(nameKey('Avon'), '');
  assert.strictEqual(companyKey('The Relevate Company Pty. Ltd.'), 'relevate');
  assert.strictEqual(companyKey(''), '');
  assert.strictEqual(phoneKey('0412 345 678'), phoneKey('+61 412 345 678'));
  assert.strictEqual(phoneKey('1234'), '');
});

check('a name search shows the person ONCE, with every address', async () => {
  const deps = { store: fakeStore() };
  const r = await lsc.searchContacts('A', 'avon', { deps });
  assert.strictEqual(r.contacts.length, 1);
  const c = r.contacts[0];
  assert.strictEqual(c.id, '1');
  assert.strictEqual(c.email, 'avon@work.example');
  assert.deepStrictEqual(c.otherEmails, ['avon@home.example', 'avon@old.example']);
  assert.strictEqual(c.phone, '+61 400 111 222');
  assert.strictEqual(c.knownFrom, 'your lists CC Results Group and Evercontact, they emailed you');
  // the lead of the same name is not in the contact (and not among the contacts at all)
  assert.ok(!JSON.stringify(c).includes('avon@lead.example'));
  // John Smith: three people, three rows
  assert.strictEqual((await lsc.searchContacts('A', 'john smith', { deps })).contacts.length, 3);
});

check('a search that matched only ONE address still shows all of them', async () => {
  const r = await lsc.searchContacts('A', 'avon@old', { deps: { store: fakeStore() } });
  assert.strictEqual(r.contacts.length, 1);
  // whichever address was typed, the row shows the address that leads (see the ordering test)
  assert.strictEqual(r.contacts[0].email, 'avon@work.example');
  assert.deepStrictEqual(r.contacts[0].otherEmails, ['avon@old.example', 'avon@home.example']);
  // and another client's row with the same name and company never joins
  assert.ok(!JSON.stringify(r).includes('theirs'));
});

check('the cap counts PEOPLE: 25 people shown although they are 50 rows', async () => {
  const many = Array.from({ length: 30 }, (_, i) => [row(100 + i * 2, `d${i}@a.example`, `David Person${i} X`, { company: `Co ${i}` }), row(101 + i * 2, `d${i}@b.example`, `David Person${i} X`, { company: `Co ${i}` })]).flat();
  const store = fakeStore(many);
  const r = await lsc.searchContacts('A', 'david', { deps: { store } });
  assert.strictEqual(r.contacts.length, 25);
  assert.strictEqual(r.more, true);
  assert.ok(r.contacts.every((c) => c.otherEmails.length === 1));
});

check('"Make this contact a lead" carries EVERY address: the first as the main email, the rest as alternates', async () => {
  const deps = fakeDeps();
  const r = await lsc.addContactAsLead('A', 'baseA', 2, { deps });        // clicked from the row for the HOME address
  assert.ok(r.ok && r.created && r.leadRecordId === 'recNEW', JSON.stringify(r));
  assert.strictEqual(deps.created.length, 1);
  assert.strictEqual(deps.created[0].email, 'avon@work.example');      // the same address the row showed
  assert.strictEqual(deps.created[0].phone, '+61 400 111 222');
  assert.strictEqual(deps.created[0].linkedinUrl, 'https://www.linkedin.com/in/avonexample/');
  assert.strictEqual(deps.created[0].connected, undefined);
  assert.deepStrictEqual(deps.altEmails, [['recNEW', { addOthers: ['avon@home.example', 'avon@old.example'] }]]);
  // the lists they came in on become tags, through the one tag writer
  assert.deepStrictEqual(deps.tagged, [['recNEW', ['CC Results Group', 'Evercontact']]]);
  // all three rows stop being offered - not just the one clicked
  assert.deepStrictEqual(deps.store.marked.map((m) => m[0]).sort(), [1, 2, 3]);
  assert.strictEqual((await lsc.searchContacts('A', 'avon', { deps })).contacts.length, 0);
});

check('a lead already holding ANY of their addresses is found, and nothing new is made', async () => {
  const deps = fakeDeps();
  deps.clientService.getClientBase = () => () => ({ select: ({ filterByFormula }) => ({ firstPage: async () => (filterByFormula.includes('avon@old.example') ? [{ id: 'recHAS', fields: { 'First Name': 'Avon', 'Last Name': 'Example' } }] : []) }) });
  const r = await lsc.addContactAsLead('A', 'baseA', 1, { deps });
  assert.ok(r.ok && r.exists && r.leadRecordId === 'recHAS', JSON.stringify(r));
  assert.strictEqual(deps.created.length, 0);
  assert.strictEqual(deps.store.marked.length, 3);
});

check('editing a person shown once still works - and cannot split them back into two', async () => {
  const deps = fakeDeps();
  const r = await lsc.editContact('A', 1, { name: 'Avon J Example', company: 'Relevate Group', phone: '0400 999 000' }, { deps });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.contact.name, 'Avon J Example');
  assert.strictEqual(r.contact.company, 'Relevate Group');
  assert.strictEqual(r.contact.email, 'avon@work.example');
  assert.deepStrictEqual(r.contact.otherEmails, ['avon@home.example', 'avon@old.example']);
  // every one of their rows took the new name and company, and they are tied together
  const mine = deps.store.rows.filter((x) => [1, 2, 3].includes(x.id));
  assert.ok(mine.every((x) => x.name === 'Avon J Example' && x.company === 'Relevate Group'));
  assert.strictEqual(new Set(mine.map((x) => x.person_ref)).size, 1);
  assert.strictEqual((await lsc.searchContacts('A', 'avon', { deps })).contacts.length, 1);
  // changing the main address to one of their OWN other addresses is not "someone else's"
  const own = await lsc.editContact('A', 1, { email: 'avon@home.example' }, { deps });
  assert.notStrictEqual(own.status, 409);
  // but someone else's address is still refused
  const taken = await lsc.editContact('A', 4, { email: 'zed@z.example' }, { deps });
  assert.strictEqual(taken.status, 409);
  // a person with a single row is edited exactly as before - nothing else is touched
  const before = JSON.stringify(deps.store.rows.filter((x) => x.id !== 13));
  await lsc.editContact('A', 13, { company: 'Elsewhere' }, { deps });
  assert.strictEqual(JSON.stringify(deps.store.rows.filter((x) => x.id !== 13)), before);
});

check('a LINKEDIN CONNECTION is a contact: headline, profile link, the day they connected - and no email needed', async () => {
  const rows = [
    row(50, null, 'Lena Linked', { linkedin_slug: 'lena-linked', headline: 'Partner at Linked Law', sources: ['linkedin'], linkedin_connected_at: '2024-03-03T02:00:00.000Z' }),
    // the same person is also known by email: same name + same LinkedIn address = one person
    row(51, 'lena@law.example', 'Lena Linked', { linkedin_slug: 'lena-linked', phone: '0400 123 123', sources: ['mail-from'] }),
    row(52, null, 'Nodate Linked', { linkedin_slug: 'nodate-linked', sources: ['linkedin'] }),
  ];
  const deps = fakeDeps(rows);
  const r = await lsc.searchContacts('A', 'linked', { deps });
  assert.strictEqual(r.contacts.length, 2);
  const lena = r.contacts.find((c) => c.name === 'Lena Linked');
  assert.strictEqual(lena.headline, 'Partner at Linked Law');
  assert.strictEqual(lena.linkedin, 'https://www.linkedin.com/in/lena-linked/');
  assert.strictEqual(lena.connectedOn, '3 Mar 2024');
  assert.strictEqual(lena.knownFrom, 'connected on LinkedIn 3 Mar 2024, they emailed you');
  assert.strictEqual(lena.email, 'lena@law.example');           // another source knew her email
  assert.strictEqual(lena.phone, '0400 123 123');
  assert.strictEqual(r.contacts.find((c) => c.name === 'Nodate Linked').knownFrom, 'connected on LinkedIn');
  // making her a lead: the lead carries the REAL connection date, never today's
  await lsc.addContactAsLead('A', 'baseA', 50, { deps });
  assert.strictEqual(deps.created[0].connected, true);
  assert.strictEqual(deps.created[0].dateConnectedISO, '2024-03-03T02:00:00.000Z');
  assert.strictEqual(deps.created[0].linkedinUrl, 'https://www.linkedin.com/in/lena-linked/');
  assert.strictEqual(deps.created[0].email, 'lena@law.example');
  // a connection with no date known is NOT stamped as connected (the date would be made up)
  await lsc.addContactAsLead('A', 'baseA', 52, { deps });
  assert.strictEqual(deps.created[1].connected, undefined);
  assert.strictEqual(deps.created[1].dateConnectedISO, undefined);
  // and it is Guy only for now
  const sweep = require('../services/contactsSweep');
  assert.strictEqual(sweep.linkedinContactsOn('Guy-Wilson'), true);
  assert.strictEqual(sweep.linkedinContactsOn('Roland-Illyes'), false);
});

check('WHICH ADDRESS LEADS: supplied by the client, then work over free-mail, then most recently seen', async () => {
  const { leadOrder, isFreeMail } = require('../services/contactGrouping');
  const order = (rows) => leadOrder(rows).map((r) => r.email);
  // Guy's own case: one Google contact, three addresses, all imported - the work address leads, never gmail
  assert.deepStrictEqual(order([
    row(1, 'avoncollis@gmail.com', 'A C', { company: 'R', sources: ['import'], manual: true }),
    row(2, 'avon@relevate.example', 'A C', { company: 'R', sources: ['import'], manual: true, phone: '0400 1', linkedin_slug: 'ac' }),
    row(3, 'avon@relevate-old.example', 'A C', { company: 'R', sources: ['import'], manual: true }),
  ]), ['avon@relevate.example', 'avon@relevate-old.example', 'avoncollis@gmail.com']);
  // 1. an address the client imported or typed beats one only seen in email - even a free-mail one
  assert.deepStrictEqual(order([
    row(1, 'pat@work.example', 'P', { sources: ['mail-from'], last_seen_at: '2026-11-20' }),
    row(2, 'pat@hotmail.com', 'P', { sources: ['manual'], manual: true }),
  ]), ['pat@hotmail.com', 'pat@work.example']);
  // 2. neither supplied by hand: the work address beats free-mail, however recent the free-mail one
  assert.deepStrictEqual(order([
    row(1, 'pat@bigpond.com', 'P', { sources: ['mail-from'], last_seen_at: '2026-11-24' }),
    row(2, 'pat@work.example', 'P', { sources: ['mail-to'], last_seen_at: '2025-01-01' }),
  ]), ['pat@work.example', 'pat@bigpond.com']);
  // 3. two work addresses: the most recently seen
  assert.deepStrictEqual(order([
    row(1, 'pat@old-job.example', 'P', { sources: ['mail-to'], last_seen_at: '2024-01-01' }),
    row(2, 'pat@new-job.example', 'P', { sources: ['mail-to'], last_seen_at: '2026-11-01' }),
  ]), ['pat@new-job.example', 'pat@old-job.example']);
  // a row with no address never leads one that has one
  assert.deepStrictEqual(order([row(1, null, 'P', { sources: ['linkedin'], linkedin_slug: 'p' }), row(2, 'pat@gmail.com', 'P')]), ['pat@gmail.com', null]);
  for (const e of ['a@gmail.com', 'a@outlook.com', 'a@hotmail.com.au', 'a@yahoo.co.uk', 'a@icloud.com', 'a@bigpond.net.au', 'a@live.com.au', '']) assert.strictEqual(isFreeMail(e), true, e);
  for (const e of ['a@relevate.com.au', 'a@acme.example', 'a@me-and-co.com']) assert.strictEqual(isFreeMail(e), false, e);
  // a person who is a single row is untouched by any of this
  const [solo] = groupPeople([row(9, 'solo@gmail.com', 'Solo Person')]);
  assert.strictEqual(solo.email, 'solo@gmail.com');
});

check('lists on the card: one list, two lists, three', () => {
  assert.strictEqual(lsc.listsText([]), '');
  assert.strictEqual(lsc.listsText(['Safe to Say']), 'your list "Safe to Say"');
  assert.strictEqual(lsc.listsText(['Evercontact', 'CC Results Group']), 'your lists CC Results Group and Evercontact');
  assert.strictEqual(lsc.listsText(['C', 'A', 'B']), 'your lists A, B and C');
});

(async () => {
  for (const run of pending) await run();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nAll contact-grouping tests passed');
  process.exit(0);
})();
