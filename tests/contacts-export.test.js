/**
 * "Export everyone (leads + contacts)" (Guy, 26 Nov 2026) - services/contactsExport.js.
 *
 *   node tests/contacts-export.test.js
 */
const assert = require('assert');
const { buildExport, exportContacts, knownFrom, safeCell, COLUMNS } = require('../services/contactsExport');
const { parseContactsFile, parseCsv } = require('../services/contactsImportParse');

const rows = [
  // one person, two addresses from one imported entry
  { id: 1, contact_key: 'jane@work.example', email: 'jane@work.example', name: 'Jane Smith', company: 'Acme, Pty "Ltd"', phone: '+61 412 345 678', sources: ['import'], lists: ['Postcards', 'Family'], manual: true, person_ref: 'r1' },
  { id: 2, contact_key: 'jane@gmail.com', email: 'jane@gmail.com', name: 'Jane Smith', sources: ['import', 'mail-from'], lists: ['Postcards'], manual: true, person_ref: 'r1' },
  // a LinkedIn connection with no email or phone
  { id: 3, contact_key: 'li:zed-last', name: 'Zed Last', first_name: 'Zed', last_name: 'Last', headline: 'Founder', linkedin_slug: 'zed-last', sources: ['linkedin'], lists: [], linkedin_connected_at: '2024-03-05T00:00:00Z' },
  // someone from email only
  { id: 4, contact_key: 'amy@firm.example', email: 'amy@firm.example', name: 'Amy Adams', sources: ['mail-to'], lists: [] },
  // a lead is in the file too, as ONE person: main address + alternate share the lead's record id
  { id: 5, contact_key: 'lee@lead.example', email: 'lee@lead.example', name: 'Lee Lead', company: 'Lead Co', lead_record_id: 'recLEE', sources: ['lead'], lists: [] },
  { id: 7, contact_key: 'lee.other@gmail.com', email: 'lee.other@gmail.com', name: 'L. Lead', lead_record_id: 'recLEE', sources: ['lead-alt', 'mail-from'], lists: [] },
  // a name a spreadsheet would run as a formula
  { id: 6, contact_key: 'x@evil.example', email: 'x@evil.example', name: '=HYPERLINK("http://x","click") Bad', sources: ['manual'], lists: [], manual: true },
];

(async () => {
  const out = buildExport(rows);
  assert.strictEqual(out.people, 5, 'Jane is one person; so is the lead with two addresses');
  assert.strictEqual(out.leads, 1);
  assert.strictEqual(out.contacts, 4);
  assert.strictEqual(out.withDetails, 4);
  assert.ok(out.csv.startsWith('﻿"Lead or contact","How Wingguy knows them","First Name","Last Name","Organization Name","E-mail 1 - Value"'));

  const table = parseCsv(out.csv.replace(/^﻿/, ''));
  assert.deepStrictEqual(table[0], COLUMNS);
  const col = (name) => COLUMNS.indexOf(name);
  const body = table.slice(1).filter((r) => r.length > 1);
  assert.strictEqual(body.length, 5);

  // people with an email or phone come first, by surname; the LinkedIn-only person is last
  assert.deepStrictEqual(body.map((r) => r[col('Last Name')]), ['Adams', 'Bad', 'Lead', 'Smith', 'Last']);
  const lee = body[2];
  assert.strictEqual(lee[col('Lead or contact')], 'Lead');
  assert.strictEqual(lee[col('How Wingguy knows them')], 'from email', 'a lead also seen in email says so');
  assert.strictEqual(lee[col('E-mail 1 - Value')], 'lee@lead.example');
  assert.strictEqual(lee[col('E-mail 2 - Value')], 'lee.other@gmail.com');
  const jane = body[3];
  assert.strictEqual(jane[col('Lead or contact')], 'Contact');
  assert.strictEqual(jane[col('How Wingguy knows them')], 'imported, from email');
  assert.strictEqual(jane[col('E-mail 1 - Value')], 'jane@work.example', 'the work address leads');
  assert.strictEqual(jane[col('E-mail 2 - Value')], 'jane@gmail.com');
  assert.strictEqual(jane[col('Organization Name')], 'Acme, Pty "Ltd"', 'commas and quotes survive');
  assert.strictEqual(jane[col('Phone 1 - Value')], '+61 412 345 678', 'a phone keeps its plus');
  assert.strictEqual(jane[col('Labels')], 'Postcards ::: Family');
  const zed = body[4];
  assert.strictEqual(zed[col('How Wingguy knows them')], 'from LinkedIn');
  assert.strictEqual(zed[col('LinkedIn')], 'https://www.linkedin.com/in/zed-last/');
  assert.strictEqual(zed[col('Connected on LinkedIn')], '2024-03-05');
  assert.ok(body[1][col('First Name')].startsWith("'="), 'a formula is made plain text');

  // the pieces
  assert.strictEqual(knownFrom(['manual-claude']), 'added by hand');
  assert.strictEqual(knownFrom(['comms-log']), 'other');
  assert.strictEqual(knownFrom(['lead']), 'your leads list');
  assert.strictEqual(safeCell('+SUM(A1)'), "'+SUM(A1)");
  assert.strictEqual(safeCell('+61 412 345 678', { phone: true }), '+61 412 345 678');
  assert.strictEqual(safeCell('=1+1', { phone: true }), "'=1+1", 'a "phone" that is a formula is still made safe');

  // ROUND TRIP: Wingguy's own Import contacts reads the file back - names, addresses, phone, lists.
  const back = parseContactsFile(out.csv, 'wingguy-contacts-2026-11-26.csv');
  const people = back.people || back;
  const j = people.find((p) => /jane@work\.example/i.test(JSON.stringify(p)));
  assert.ok(j, 'Jane comes back');
  const flat = JSON.stringify(j).toLowerCase();
  assert.ok(flat.includes('jane@gmail.com') && flat.includes('smith') && flat.includes('postcards') && flat.includes('412'), `Jane comes back whole: ${flat}`);

  // the door: reads through the store, for that client only, and writes nothing
  const asked = [];
  const res = await exportContacts('Some-Client', { deps: { contactsStore: { listContactsForExport: async (id) => { asked.push(id); return rows; } } } });
  assert.deepStrictEqual(asked, ['Some-Client']);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.people, 5);
  assert.strictEqual((await exportContacts('')).ok, false);

  // nobody on file = a header and nothing else
  assert.strictEqual(buildExport([]).people, 0);

  console.log('contacts-export: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
