/**
 * Tests for importing contacts from a file (services/contactsImport.js, 2026-11-24).
 *
 * What must hold:
 *   - nothing is written by a preview; the same file confirmed writes exactly what was counted
 *   - match on email or LinkedIn address, never a name alone
 *   - new people become CONTACTS; an existing contact only has blanks filled; an existing LEAD only
 *     has blank lead fields filled and is never touched otherwise
 *   - no email and no phone = skipped and counted; the same person twice in a file = counted once
 *   - the list name is carried; uploading the same file again changes nothing
 * Fakes only. Made-up people. Run: node tests/contacts-import.test.js
 */
const assert = require('assert');
const { importContacts, planImport, summaryLine, nameFromEmail } = require('../services/contactsImport');
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

/** A contacts store + leads base in memory, applying the same rules as the real ones. */
function world() {
  const rows = [
    { id: 1, email: 'carl@held.example', linkedin_slug: null, lead_record_id: null, name: 'Carl Contact', company: null, phone: null, lists: [] },
    { id: 2, email: 'lee@lead.example', linkedin_slug: null, lead_record_id: 'recLEE', name: 'Lee Lead', company: 'Lead Co', phone: null, lists: [] },
    { id: 3, email: 'someone@lead.example', linkedin_slug: null, lead_record_id: 'recSAME', name: 'Same Name As A Lead', company: null, phone: null, lists: [] },
    { id: 4, email: 'full@held.example', linkedin_slug: null, lead_record_id: null, name: 'Full Already', company: 'Full Co', phone: '0411 111 111', lists: ['Safe to Say'] },
  ];
  const leads = { recLEE: { Phone: '', Email: 'lee@lead.example', 'Company Name': 'Lead Co (from LinkedIn)' }, recSAME: { Phone: '', Email: 'someone@lead.example', 'Company Name': '' } };
  const leadUpdates = [];
  let nextId = 10;
  const store = {
    slugOf: contactsStore.slugOf,
    listForImport: async () => rows.map((r) => ({ ...r })),
    applyImport: async (tenant, { newPeople, contactFills, list }) => {
      for (const p of newPeople) rows.push({ id: nextId++, email: p.email || null, linkedin_slug: p.linkedin || null, lead_record_id: null, name: p.name, company: p.company || null, phone: p.phone || null, lists: list ? [list] : [], manual: true, contact_key: p.email || `phone:${p.phone.replace(/\D/g, '')}` });
      for (const f of contactFills) {
        const r = rows.find((x) => x.id === f.id);
        for (const [k, v] of Object.entries(f.set)) if (r[k] === null || r[k] === undefined) r[k] = v;   // COALESCE(existing, new)
        if (list && !r.lists.includes(list)) r.lists.push(list);
      }
      return { ok: true, inserted: newPeople.length, filled: contactFills.length };
    },
  };
  const base = () => ({
    select: ({ filterByFormula }) => ({ all: async () => Object.entries(leads).filter(([id]) => filterByFormula.includes(id)).map(([id, fields]) => ({ id, fields })) }),
    update: async (batch) => { for (const u of batch) { leadUpdates.push(u); Object.assign(leads[u.id], u.fields); } },
  });
  return { rows, leads, leadUpdates, deps: { store, clientService: { getClientBase: () => base } } };
}
const settle = () => new Promise((r) => setTimeout(r, 400));

console.log('contacts-import tests');

check('a preview counts and writes NOTHING', async () => {
  const w = world();
  const before = JSON.stringify([w.rows, w.leads]);
  const r = await importContacts('A', 'baseA', { text: FILE, filename: 'list.csv', listName: 'Safe to Say' }, { apply: false, deps: w.deps });
  assert.ok(r.ok && r.applied === false, JSON.stringify(r));
  assert.strictEqual(JSON.stringify([w.rows, w.leads]), before);
  assert.deepStrictEqual({ ...r.summary, line: undefined }, { inFile: 8, new: 3, contactsUpdated: 1, leadsUpdated: 1, updated: 2, unchanged: 1, skippedNoDetails: 1, repeated: 1, line: undefined });
  assert.strictEqual(r.summary.line, '3 new, 2 updated, 1 already up to date, 1 skipped (no email or phone), 1 repeated in the file');
});

check('confirming the same file writes exactly that - new people are contacts, never leads', async () => {
  const w = world();
  const r = await importContacts('A', 'baseA', { text: FILE, filename: 'list.csv', listName: 'Safe to Say' }, { apply: true, deps: w.deps });
  await settle();
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
  await settle();
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
  await settle();
  assert.deepStrictEqual(w.leadUpdates, [{ id: 'recLEE', fields: { Phone: '0400 000 003' } }]);
  assert.strictEqual(w.leads.recLEE['Company Name'], 'Lead Co (from LinkedIn)');
  assert.ok(!('Date Connected' in w.leads.recLEE) && !('LinkedIn Connection Status' in w.leads.recLEE));
});

check('uploading the same file again changes nothing', async () => {
  const w = world();
  await importContacts('A', 'baseA', { text: FILE, filename: 'list.csv', listName: 'Safe to Say' }, { apply: true, deps: w.deps });
  await settle();
  const snapshot = JSON.stringify([w.rows, w.leads]);
  const again = await importContacts('A', 'baseA', { text: FILE, filename: 'list.csv', listName: 'Safe to Say' }, { apply: true, deps: w.deps });
  await settle();
  assert.strictEqual(again.summary.new, 0);
  assert.strictEqual(again.summary.updated, 0);
  assert.strictEqual(JSON.stringify([w.rows, w.leads]), snapshot);
});

check('a file that cannot be used is refused with a plain reason, and nothing is read or written', async () => {
  const w = world();
  const r = await importContacts('A', 'baseA', { text: 'Colour,Size\nblue,large\n', filename: 'x.csv' }, { apply: true, deps: w.deps });
  assert.strictEqual(r.status, 400);
  assert.ok(/No email or phone column/.test(r.error));
  assert.strictEqual(w.rows.length, 4);
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
