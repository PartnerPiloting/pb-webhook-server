/**
 * Tests for reading an address-book file (services/contactsImportParse.js, 2026-11-24).
 * Google CSV (old and new headings), Outlook CSV, vCard 2.1/3.0, and a plain newsletter-style CSV.
 * Made-up people. Run: node tests/contacts-import-parse.test.js
 */
const assert = require('assert');
const { parseContactsFile, parseCsv } = require('../services/contactsImportParse');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};
const by = (people, name) => people.find((p) => p.name === name);

console.log('contacts-import-parse tests');

check('CSV basics: quoted commas, doubled quotes, a line break inside a cell, a BOM, blank lines', () => {
  const rows = parseCsv('﻿Name,Note\r\n"Smith, Jane","said ""hi""\nand left"\r\n\r\nBob,ok\r\n');
  assert.deepStrictEqual(rows, [['Name', 'Note'], ['Smith, Jane', 'said "hi"\nand left'], ['Bob', 'ok']]);
});

check('Google Contacts CSV - the older headings (Given Name / E-mail 1 - Value / Phone 1 - Value)', () => {
  const csv = [
    'Name,Given Name,Additional Name,Family Name,Organization 1 - Name,E-mail 1 - Type,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Type,Phone 1 - Value,Website 1 - Value',
    'Jane Smith,Jane,,Smith,Acme Pty Ltd,* Work,Jane.Smith@Acme.example,jane@home.example,Mobile,0412 345 678,https://www.linkedin.com/in/jane-smith',
    ',Raj,,Patel,,,raj@patel.example ::: raj.p@work.example,,,+61 2 9000 0000 ::: 0400 111 222,',
  ].join('\n');
  const r = parseContactsFile(csv, 'contacts.csv');
  assert.strictEqual(r.format, 'google-csv');
  assert.deepStrictEqual(by(r.people, 'Jane Smith'), { name: 'Jane Smith', firstName: 'Jane', lastName: 'Smith', emails: ['jane.smith@acme.example', 'jane@home.example'], phone: '0412 345 678', company: 'Acme Pty Ltd', linkedin: 'https://www.linkedin.com/in/jane-smith' });
  const raj = by(r.people, 'Raj Patel');
  assert.deepStrictEqual(raj.emails, ['raj@patel.example', 'raj.p@work.example']);
  assert.strictEqual(raj.phone, '+61 2 9000 0000');
});

check('Google Contacts CSV - the newer headings (First Name / Organization Name)', () => {
  const csv = 'First Name,Middle Name,Last Name,Organization Name,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value\nMei,,Tanaka,Tanaka Design,Work,mei@tanaka.example,Mobile,0433 000 111\n';
  const r = parseContactsFile(csv, 'contacts.csv');
  assert.deepStrictEqual(r.people[0], { name: 'Mei Tanaka', firstName: 'Mei', lastName: 'Tanaka', emails: ['mei@tanaka.example'], phone: '0433 000 111', company: 'Tanaka Design', linkedin: '' });
});

check('Outlook CSV - mobile is preferred over business and home phone', () => {
  const csv = 'First Name,Middle Name,Last Name,Company,E-mail Address,E-mail 2 Address,Business Phone,Home Phone,Mobile Phone\r\nTom,,Nguyen,Nguyen & Co,tom@nguyen.example,tom2@nguyen.example,02 9000 1111,02 9000 2222,0455 666 777\r\n';
  const r = parseContactsFile(csv, 'outlook.csv');
  assert.strictEqual(r.format, 'outlook-csv');
  assert.deepStrictEqual(r.people[0], { name: 'Tom Nguyen', firstName: 'Tom', lastName: 'Nguyen', emails: ['tom@nguyen.example', 'tom2@nguyen.example'], phone: '0455 666 777', company: 'Nguyen & Co', linkedin: '' });
});

check('a plain list - a newsletter or event export with obvious columns, in any order, ; separated', () => {
  const csv = 'Email;Full Name;Organisation;Mobile;Favourite colour\nSAM@EVENT.example;Sam Okoro;Okoro Events;0477 888 999;blue\nno-name@event.example;;;;\n';
  const r = parseContactsFile(csv, 'safe-to-say.csv');
  assert.strictEqual(r.format, 'csv');
  assert.deepStrictEqual(r.people[0], { name: 'Sam Okoro', firstName: '', lastName: '', emails: ['sam@event.example'], phone: '0477 888 999', company: 'Okoro Events', linkedin: '' });
  assert.deepStrictEqual(r.people[1].emails, ['no-name@event.example']);
  assert.strictEqual(r.people[1].name, '');
});

check('vCard 3.0 from a phone: folded lines, several numbers (mobile wins), a LinkedIn URL', () => {
  const vcf = [
    'BEGIN:VCARD', 'VERSION:3.0', 'N:Smith;Jane;;;', 'FN:Jane Smith', 'ORG:Acme Pty Ltd;Sales',
    'EMAIL;TYPE=INTERNET;TYPE=WORK:Jane.Smith@acme.example', 'item1.EMAIL;type=INTERNET:jane@home.example',
    'TEL;TYPE=WORK,VOICE:02 9000 1111', 'TEL;TYPE=CELL:0412 345 678',
    'URL:https://www.linkedin.com/in/jane-', ' smith', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'N:Okoro;Sam', 'TEL:0477 888 999', 'END:VCARD',
  ].join('\r\n');
  const r = parseContactsFile(vcf, 'contacts.vcf');
  assert.strictEqual(r.format, 'vcard');
  assert.deepStrictEqual(r.people[0], { name: 'Jane Smith', firstName: 'Jane', lastName: 'Smith', emails: ['jane.smith@acme.example', 'jane@home.example'], phone: '0412 345 678', company: 'Acme Pty Ltd', linkedin: 'https://www.linkedin.com/in/jane-smith' });
  assert.deepStrictEqual(r.people[1], { name: 'Sam Okoro', firstName: 'Sam', lastName: 'Okoro', emails: [], phone: '0477 888 999', company: '', linkedin: '' });
});

check('vCard 2.1 with quoted-printable names (older phones)', () => {
  const vcf = 'BEGIN:VCARD\nVERSION:2.1\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Garc=C3=ADa;Jos=C3=A9\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa\nTEL;CELL:0400 000 000\nEND:VCARD\n';
  const r = parseContactsFile(vcf, 'old.vcf');
  assert.strictEqual(r.people[0].name, 'José García');
  assert.strictEqual(r.people[0].phone, '0400 000 000');
});

check('it says plainly when a file cannot be used', () => {
  assert.strictEqual(parseContactsFile('', 'x.csv').problem, 'The file is empty.');
  assert.ok(/No email or phone column/.test(parseContactsFile('Colour,Size\nblue,large\n', 'x.csv').problem));
  assert.ok(/no people under it/.test(parseContactsFile('Name,Email\n', 'x.csv').problem));
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nAll contacts-import-parse tests passed');
