/**
 * Tests for importing contacts from a file (services/contactsImport.js, 2026-11-24; lists from the
 * file, one entry = one person and the alert email, 2026-11-25).
 *
 * What must hold:
 *   - nothing is written by a preview; the same file confirmed writes exactly what was counted
 *   - match on email or LinkedIn address, never a name alone
 *   - new people become CONTACTS; an existing contact only has blanks filled; an existing LEAD only
 *     has blank lead fields filled and is never touched otherwise
 *   - no email and no phone = skipped and counted; the same person twice in a file = counted once
 *   - uploading the same file again changes nothing
 *   - LISTS come from the file (Google labels), system labels are ignored, a person on two lists
 *     keeps both, a list is never replaced; on a lead each list becomes a tag through the one tag
 *     writer, existing tags stay, and a tag the 15 cap refuses is counted
 *   - one entry in the file = one person, however many addresses
 *   - Guy is emailed once when a file is refused, mostly skipped, or fails on Confirm
 * Fakes only. Made-up people. Run: node tests/contacts-import.test.js
 */
const assert = require('assert');
const { importContacts, planImport, summaryLine, listsLine, nameFromEmail } = require('../services/contactsImport');
const { parseContactsFile, labelsFrom } = require('../services/contactsImportParse');
const contactsStore = require('../services/contactsStore');

let failures = 0;
const pending = [];
const check = (name, fn) => pending.push(async () => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
});

const FILE = [
  'Name,Email,Phone,Company,LinkedIn',
  'Nina New,nina@new.example,0400 000 001,New Co,',
  'Carl Contact,carl@held.example,0400 000 002,Carl Co,https://www.linkedin.com/in/carl-contact',
  'Lee Lead,lee@lead.example,0400 000 003,Lead Co,',
  'Same Name As A Lead,different@address.example,,,',
  'No Details,,,,',
  'Phone Only,,0400 000 004,,',
  'Nina New,nina@new.example,,,',
  'Full Already,full@held.example,0499 999 999,Other Co,',
].join('\n');

// A Google Contacts export: each contact carries its own labels, " ::: " between them.
const GOOGLE = [
  'First Name,Last Name,Organization Name,Labels,E-mail 1 - Value,E-mail 2 - Value,E-mail 3 - Value,Phone 1 - Value',
  'Avon,Example,Relevate,CC Results Group ::: * myContacts,avon@work.example,avon@home.example,avon@old.example,0400 111 222',
  'Bea,Both,,CC Results Group ::: Evercontact ::: * starred,bea@both.example,,,',
  'Lee,Lead,,CC Results Group ::: Evercontact,lee@lead.example,,,',
  'Tess,Tagged,,CC Results Group,tess@lead.example,,,',
  'Sys,Only,,* myContacts,sys@only.example,,,',
].join('\n');

/** A contacts store + leads base in memory, applying the same rules as the real ones. */
function world() {
  const rows = [
    { id: 1, contact_key: 'carl@held.example', email: 'carl@held.example', linkedin_slug: null, lead_record_id: null, name: 'Carl Contact', company: null, phone: null, lists: [], person_ref: null },
    { id: 2, contact_key: 'lee@lead.example', email: 'lee@lead.example', linkedin_slug: null, lead_record_id: 'recLEE', name: 'Lee Lead', company: 'Lead Co', phone: null, lists: [], person_ref: null },
    { id: 3, contact_key: 'someone@lead.example', email: 'someone@lead.example', linkedin_slug: null, lead_record_id: 'recSAME', name: 'Same Name As A Lead', company: null, phone: null, lists: [], person_ref: null },
    { id: 4, contact_key: 'full@held.example', email: 'full@held.example', linkedin_slug: null, lead_record_id: null, name: 'Full Already', company: 'Full Co', phone: '0411 111 111', lists: ['Safe to Say'], person_ref: null },
    { id: 5, contact_key: 'tess@lead.example', email: 'tess@lead.example', linkedin_slug: null, lead_record_id: 'recTESS', name: 'Tess Tagged', company: null, phone: null, lists: [], person_ref: null },
    // an address Wingguy already knows from email - the Google file says it is Avon's too
    { id: 6, contact_key: 'avon@home.example', email: 'avon@home.example', linkedin_slug: null, lead_record_id: null, name: 'Avon E', company: null, phone: null, lists: [], person_ref: null },
  ];
  const fifteen = Array.from({ length: 14 }, (_, i) => `tag${i + 1}`).join(', ');
  const leads = {
    recLEE: { Phone: '', Email: 'lee@lead.example', 'Company Name': 'Lead Co (from LinkedIn)', 'Search Terms': 'Existing Tag', 'Search Tokens (canonical)': 'existing tag' },
    recSAME: { Phone: '', Email: 'someone@lead.example', 'Company Name': '' },
    recTESS: { Phone: '0400', Email: 'tess@lead.example', 'Company Name': 'T', 'Search Terms': `${fifteen}, cc results group`, 'Search Tokens (canonical)': `${fifteen}, cc results group` },
  };
  const leadUpdates = [];
  const emails = [];
  let nextId = 10;
  const addRow = (key, email, name, company, phone, slug, lists, ref) => {
    if (rows.some((r) => r.contact_key === key)) return;                 // ON CONFLICT DO NOTHING
    rows.push({ id: nextId++, contact_key: key, email, linkedin_slug: slug || null, lead_record_id: null, name, company: company || null, phone: phone || null, lists: [...(lists || [])], manual: true, person_ref: ref || null });
  };
  const store = {
    slugOf: contactsStore.slugOf,
    listForImport: async () => rows.map((r) => ({ ...r, lists: [...r.lists] })),
    applyImport: async (tenant, { newPeople, contactFills, extraRows = [] }) => {
      for (const p of newPeople) {
        addRow(p.email || `phone:${p.phone.replace(/\D/g, '')}`, p.email || null, p.name, p.company, p.phone, p.linkedin, p.lists, p.ref);
        for (const o of p.otherEmails || []) addRow(o, o, p.name, p.company, null, null, p.lists, p.ref);
      }
      for (const x of extraRows) addRow(x.email, x.email, x.name, x.company, null, null, x.lists, x.ref);
      for (const f of contactFills) {
        const r = rows.find((x) => x.id === f.id);
        for (const [k, v] of Object.entries(f.set)) if (r[k] === null || r[k] === undefined) r[k] = v;   // COALESCE(existing, new)
        for (const l of f.addLists || []) if (!r.lists.includes(l)) r.lists.push(l);
        if (!r.person_ref && f.ref) r.person_ref = f.ref;
      }
      return { ok: true, inserted: newPeople.length, filled: contactFills.length };
    },
  };
  const base = () => ({
    select: ({ filterByFormula }) => ({ all: async () => Object.entries(leads).filter(([id]) => filterByFormula.includes(id)).map(([id, fields]) => ({ id, fields })) }),
    find: async (id) => ({ id, fields: leads[id] }),
    update: async (batch) => { for (const u of batch) { leadUpdates.push(u); Object.assign(leads[u.id], u.fields); } return batch; },
  });
  const deps = { store, clientService: { getClientBase: () => base }, pauseMs: 0, waitForLeads: true, sendAlertEmail: async (subject, html) => { emails.push({ subject, html }); return { ok: true }; } };
  return { rows, leads, leadUpdates, emails, deps };
}
const counts = (s) => ({ inFile: s.inFile, new: s.new, contactsUpdated: s.contactsUpdated, leadsUpdated: s.leadsUpdated, updated: s.updated, unchanged: s.unchanged, skippedNoDetails: s.skippedNoDetails, repeated: s.repeated });

console.log('contacts-import tests');

check('a preview counts and writes NOTHING', async () => {
  const w = world();
  const before = JSON.stringify([w.rows, w.leads]);
  const r = await importContacts('A', 'baseA', { text: FILE, filename: 'list.csv', listName: 'Safe to Say' }, { apply: false, deps: w.deps });
  assert.ok(r.ok && r.applied === false, JSON.stringify(r));
  assert.strictEqual(JSON.stringify([w.rows, w.leads]), before);
  // Lee is a lead: a blank phone to fill AND the list to add as a tag - one lead, counted once
  assert.deepStrictEqual(counts(r.summary), { inFile: 8, new: 3, contactsUpdated: 1, leadsUpdated: 1, updated: 2, unchanged: 1, skippedNoDetails: 1, repeated: 1 });
  assert.strictEqual(r.summary.line, '3 new, 2 updated, 1 already up to date, 1 skipped (no email or phone), 1 repeated in the file');
  assert.strictEqual(w.emails.length, 0);
});

check('confirming the same file writes exactly that - new people are contacts, never leads', async () => {
  const w = world();
  const r = await importContacts('A', 'baseA', { text: FILE, filename: 'list.csv', listName: 'Safe to Say' }, { apply: true, deps: w.deps });
  assert.ok(r.ok && r.applied === true);
  const added = w.rows.filter((x) => x.id >= 10);
  assert.deepStrictEqual(added.map((x) => x.name), ['Nina New', 'Same Name As A Lead', 'Phone Only']);
  assert.ok(added.every((x) => x.lead_record_id === null && x.manual === true && x.lists[0] === 'Safe to Say'));
  assert.strictEqual(added[2].contact_key, 'phone:0400000004');
  // a NAME that matches a lead is not a match: that lead is untouched, and a separate contact exists
  assert.deepStrictEqual(w.leads.recSAME, { Phone: '', Email: 'someone@lead.example', 'Company Name': '' });
});

check('an existing contact only has BLANKS filled; what they already have is never overwritten', async () => {
  const w = world();
  await importContacts('A', 'baseA', { text: FILE, filename: 'list.csv', listName: 'Safe to Say' }, { apply: true, deps: w.deps });
  const carl = w.rows.find((x) => x.id === 1);
  assert.strictEqual(carl.phone, '0400 000 002');
  assert.strictEqual(carl.company, 'Carl Co');
  assert.strictEqual(carl.linkedin_slug, 'carl-contact');
  assert.deepStrictEqual(carl.lists, ['Safe to Say']);
  const full = w.rows.find((x) => x.id === 4);
  assert.strictEqual(full.phone, '0411 111 111');       // the file said 0499 999 999
  assert.strictEqual(full.company, 'Full Co');          // the file said Other Co
});

check('an existing LEAD only has blank lead fields filled - nothing overwritten, no connected date', async () => {
  const w = world();
  await importContacts('A', 'baseA', { text: FILE, filename: 'list.csv' }, { apply: true, deps: w.deps });
  assert.deepStrictEqual(w.leadUpdates, [{ id: 'recLEE', fields: { Phone: '0400 000 003' } }]);
  assert.strictEqual(w.leads.recLEE['Company Name'], 'Lead Co (from LinkedIn)');
  assert.ok(!('Date Connected' in w.leads.recLEE) && !('LinkedIn Connection Status' in w.leads.recLEE));
});

check('uploading the same file again changes nothing', async () => {
  for (const [text, listName] of [[FILE, 'Safe to Say'], [GOOGLE, '']]) {
    const w = world();
    await importContacts('A', 'baseA', { text, filename: 'list.csv', listName }, { apply: true, deps: w.deps });
    const snapshot = JSON.stringify([w.rows, w.leads]);
    const again = await importContacts('A', 'baseA', { text, filename: 'list.csv', listName }, { apply: true, deps: w.deps });
    assert.strictEqual(again.summary.new, 0);
    assert.strictEqual(again.summary.updated, 0);
    assert.strictEqual(JSON.stringify([w.rows, w.leads]), snapshot);
  }
});

check('a file that cannot be used is refused with a plain reason, and nothing is read or written', async () => {
  const w = world();
  const r = await importContacts('A', 'baseA', { text: 'Colour,Size\nblue,large\n', filename: 'x.csv' }, { apply: true, deps: w.deps });
  assert.strictEqual(r.status, 400);
  assert.ok(/No email or phone column/.test(r.error));
  assert.strictEqual(w.rows.length, 6);
});

check('LISTS FROM THE FILE: Google labels are read, system labels ignored, nothing typed', async () => {
  assert.deepStrictEqual(labelsFrom('CC Results Group ::: * myContacts ::: Evercontact ::: * starred ::: cc results group'), ['CC Results Group', 'Evercontact']);
  assert.deepStrictEqual(labelsFrom('* myContacts'), []);
  const people = parseContactsFile(GOOGLE, 'contacts.csv').people;
  assert.deepStrictEqual(people.map((p) => p.labels), [['CC Results Group'], ['CC Results Group', 'Evercontact'], ['CC Results Group', 'Evercontact'], ['CC Results Group'], []]);
  // the older Google header, Outlook's Categories and a vCard's CATEGORIES are read the same way
  assert.deepStrictEqual(parseContactsFile('Name,Group Membership,E-mail 1 - Value\nA B,* My Contacts ::: Golf,a@b.example\n', 'g.csv').people[0].labels, ['Golf']);
  assert.deepStrictEqual(parseContactsFile('First Name,Last Name,E-mail Address,Categories\nA,B,a@b.example,Clients;Golf\n', 'o.csv').people[0].labels, ['Clients', 'Golf']);
  assert.deepStrictEqual(parseContactsFile('BEGIN:VCARD\nVERSION:3.0\nFN:A B\nEMAIL:a@b.example\nCATEGORIES:Clients,Golf\nEND:VCARD\n', 'p.vcf').people[0].labels, ['Clients', 'Golf']);

  const w = world();
  const r = await importContacts('A', 'baseA', { text: GOOGLE, filename: 'contacts.csv' }, { apply: false, deps: w.deps });
  // shown BEFORE saving: how many lists were found, and their names
  assert.deepStrictEqual(r.summary.lists, [{ name: 'CC Results Group', people: 4 }, { name: 'Evercontact', people: 2 }]);
  assert.strictEqual(r.summary.listsLine, '2 lists found: CC Results Group (4 people), Evercontact (2 people)');
  assert.strictEqual(listsLine([]), '');
});

check('a person in two lists keeps BOTH, and a later list never replaces an earlier one', async () => {
  const w = world();
  await importContacts('A', 'baseA', { text: GOOGLE, filename: 'contacts.csv' }, { apply: true, deps: w.deps });
  const bea = w.rows.find((x) => x.email === 'bea@both.example');
  assert.deepStrictEqual(bea.lists, ['CC Results Group', 'Evercontact']);
  assert.deepStrictEqual(w.rows.find((x) => x.email === 'sys@only.example').lists, []);
  // a second file, typed name only: added to what she has
  await importContacts('A', 'baseA', { text: 'Name,Email\nBea Both,bea@both.example\n', filename: 'event.csv', listName: 'Spring Event' }, { apply: true, deps: w.deps });
  assert.deepStrictEqual(bea.lists, ['CC Results Group', 'Evercontact', 'Spring Event']);
  // and Full Already, on "Safe to Say" before, keeps it
  await importContacts('A', 'baseA', { text: 'Name,Email\nFull Already,full@held.example\n', filename: 'event.csv', listName: 'Spring Event' }, { apply: true, deps: w.deps });
  assert.deepStrictEqual(w.rows.find((x) => x.id === 4).lists, ['Safe to Say', 'Spring Event']);
});

check('on a LEAD each list becomes a tag through the one tag writer - existing tags stay, the cap is counted', async () => {
  const w = world();
  const pre = await importContacts('A', 'baseA', { text: GOOGLE, filename: 'contacts.csv' }, { apply: false, deps: w.deps });
  // Lee: two tags to add. Tess: already has "cc results group" and is at 15 - nothing to add, nothing refused.
  assert.strictEqual(pre.summary.leadsTagged, 1);
  assert.strictEqual(pre.summary.tagsCapped, 0);
  await importContacts('A', 'baseA', { text: GOOGLE, filename: 'contacts.csv' }, { apply: true, deps: w.deps });
  assert.strictEqual(w.leads.recLEE['Search Terms'], 'Existing Tag, CC Results Group, Evercontact');
  assert.strictEqual(w.leads.recLEE['Search Tokens (canonical)'], 'existing tag, cc results group, evercontact');
  assert.ok(/^tag1, /.test(w.leads.recTESS['Search Terms']) && w.leads.recTESS['Search Terms'].split(',').length === 15);
  // a lead already at 15 tags: the new list is refused by the cap, counted, and nothing is removed
  const w2 = world();
  const full = await importContacts('A', 'baseA', { text: 'Name,Email\nTess Tagged,tess@lead.example\n', filename: 'e.csv', listName: 'Spring Event' }, { apply: true, deps: w2.deps });
  assert.strictEqual(full.summary.tagsCapped, 1);
  assert.strictEqual(full.summary.leadsTagged, 0);
  assert.strictEqual(w2.leads.recTESS['Search Terms'].split(',').length, 15);
  // the lists are never written onto a lead's contact row
  assert.deepStrictEqual(w.rows.find((x) => x.id === 2).lists, []);
});

check('ONE ENTRY IN THE FILE = ONE PERSON: every address is tied together, a known address included', async () => {
  const w = world();
  const r = await importContacts('A', 'baseA', { text: GOOGLE, filename: 'contacts.csv' }, { apply: true, deps: w.deps });
  const avon = w.rows.filter((x) => /^avon@/.test(x.email || ''));
  assert.deepStrictEqual(avon.map((x) => x.email).sort(), ['avon@home.example', 'avon@old.example', 'avon@work.example']);
  assert.strictEqual(new Set(avon.map((x) => x.person_ref)).size, 1);
  assert.ok(avon[0].person_ref);
  // the address Wingguy already had keeps its own name, gains the company and the list
  const home = w.rows.find((x) => x.id === 6);
  assert.strictEqual(home.name, 'Avon E');
  assert.strictEqual(home.company, 'Relevate');
  assert.deepStrictEqual(home.lists, ['CC Results Group']);
  // Avon was already known by one address, so he is an update - and never three new people
  assert.strictEqual(r.summary.new, 2);   // Bea, Sys
  assert.strictEqual(r.summary.contactsUpdated, 1);
  // someone with a single address is not tied to anything
  assert.strictEqual(w.rows.find((x) => x.email === 'bea@both.example').person_ref, null);
});

check('GUY IS EMAILED - once - when a file is refused, mostly skipped, or fails on Confirm', async () => {
  const w = world();
  const bad = { text: 'Colour,Size\nblue,large\n', filename: 'colours.csv' };
  await importContacts('Client-X', 'baseA', bad, { apply: false, deps: w.deps });
  await importContacts('Client-X', 'baseA', bad, { apply: true, deps: w.deps });           // the same file again: no second email
  assert.strictEqual(w.emails.length, 1);
  assert.ok(/file refused \(Client-X\)/.test(w.emails[0].subject));
  assert.ok(/colours\.csv/.test(w.emails[0].html) && /No email or phone column/.test(w.emails[0].html) && /csv/.test(w.emails[0].html));

  const skipped = { text: 'Name,Email,Phone\nA One,,\nB Two,,\nC Three,c@three.example,\n', filename: 'phone.csv' };
  const r = await importContacts('Client-X', 'baseA', skipped, { apply: false, deps: w.deps });
  assert.ok(r.ok);                                                                           // the client still sees the summary
  assert.strictEqual(w.emails.length, 2);
  assert.ok(/more than half the file skipped/.test(w.emails[1].subject) && /2 of 3 people/.test(w.emails[1].html));

  // Confirm fails in the database, and when something throws outright
  const w2 = world();
  w2.deps.store.applyImport = async () => ({ ok: false, error: 'connection lost' });
  const failed = await importContacts('Client-Y', 'baseA', { text: FILE, filename: 'list.csv' }, { apply: true, deps: w2.deps });
  assert.strictEqual(failed.status, 500);
  assert.ok(/import failed on Confirm \(Client-Y\)/.test(w2.emails[0].subject) && /connection lost/.test(w2.emails[0].html) && /3 new/.test(w2.emails[0].html));
  const w3 = world();
  w3.deps.store.listForImport = async () => { throw new Error('boom'); };
  const threw = await importContacts('Client-Z', 'baseA', { text: FILE, filename: 'list.csv' }, { apply: true, deps: w3.deps });
  assert.strictEqual(threw.ok, false);
  assert.strictEqual(w3.emails.length, 1);
  // a clean import sends nothing
  const w4 = world();
  await importContacts('Client-Q', 'baseA', { text: FILE, filename: 'list.csv' }, { apply: true, deps: w4.deps });
  assert.strictEqual(w4.emails.length, 0);
});

check('small things: a name from an email, the summary line, a lead row wins a tie on the same address', () => {
  assert.strictEqual(nameFromEmail('jane.smith@x.example'), 'Jane Smith');
  assert.strictEqual(nameFromEmail('info123@x.example'), 'Info123');
  assert.strictEqual(summaryLine({ new: 312, updated: 48, unchanged: 0, skippedNoDetails: 9, repeated: 0 }), '312 new, 48 updated, 9 skipped (no email or phone)');
  const plan = planImport([{ name: 'X', emails: ['dual@x.example'], phone: '', company: '', linkedin: '' }],
    [{ id: 1, email: 'dual@x.example', lead_record_id: null }, { id: 2, email: 'dual@x.example', lead_record_id: 'recDUAL' }], {});
  assert.strictEqual(plan.counts.leadsMatched, 1);
  assert.strictEqual(plan.newPeople.length, 0);
});

(async () => {
  for (const run of pending) await run();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nAll contacts-import tests passed');
  process.exit(0);
})();
