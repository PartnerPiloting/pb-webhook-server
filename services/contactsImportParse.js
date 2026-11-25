/**
 * Reading an address-book file into people (contacts step 2, Guy, 24 Nov 2026).
 *
 * A client exports their contacts from Google Contacts, Outlook or a phone and uploads the file -
 * and they will upload newsletter and event lists the same way. So this reads:
 *   - Google Contacts CSV   (both header styles Google has used)
 *   - Outlook CSV
 *   - vCard (.vcf), versions 2.1 / 3.0 / 4.0 - what a phone exports
 *   - any plain CSV with obvious columns: name, email, phone, company, linkedin
 *
 * PURE: text in, people out. No database, no network. Each person is
 *   { name, firstName, lastName, emails: [..], phone, company, linkedin, labels: [..] }
 * labels (25 Nov 2026) are the lists the FILE says the person is on: Google's "Labels" (or the older
 * "Group Membership") column, Outlook's "Categories", a vCard's CATEGORIES. Google's own system
 * labels ("* myContacts", "* starred" - they start with an asterisk) are not lists and are dropped.
 * with emails lower-cased, de-duplicated and shape-checked. Nothing is guessed: a column this does
 * not recognise is ignored, never squeezed into a field.
 */

const EMAIL_SHAPE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const cleanEmail = (v) => { const e = String(v || '').trim().toLowerCase(); return EMAIL_SHAPE.test(e) ? e : ''; };
const tidy = (v) => String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- CSV

/** RFC 4180 CSV -> rows of cells. Quoted cells may hold commas, quotes ("") and line breaks. */
function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** Comma, semicolon or tab - whichever the header line uses most (Excel in some countries saves ';'). */
function sniffDelimiter(text) {
  const first = String(text || '').replace(/^﻿/, '').split(/\r?\n/)[0] || '';
  const count = (d) => first.split(d).length - 1;
  const [c, sc, t] = [count(','), count(';'), count('\t')];
  if (t > c && t > sc) return '\t';
  return sc > c ? ';' : ',';
}

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Which column is which. Keys are normalised header names (lower case, punctuation -> space).
 * Order inside each list matters only for single-value fields (the first non-blank wins).
 */
const COLUMNS = {
  name: ['name', 'full name', 'fullname', 'display name', 'contact name', 'contact'],
  first: ['first name', 'given name', 'firstname', 'first', 'forename'],
  middle: ['middle name', 'additional name'],
  last: ['last name', 'family name', 'lastname', 'surname', 'last'],
  company: ['company', 'organization name', 'organization 1 name', 'organisation', 'organization', 'organisation name', 'company name', 'employer', 'business', 'business name'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin profile url', 'linkedin address', 'profile url'],
};
const isEmailColumn = (h) => /^e ?mail( \d+)?( value| address)?$/.test(h) || /^(e ?mail|email) (address )?\d*$/.test(h) || /^e ?mail \d+ address$/.test(h)
  || ['email', 'e mail', 'email address', 'e mail address', 'primary email', 'work email', 'personal email', 'email 1', 'email 2', 'e mail 2 address', 'e mail 3 address', 'other email'].includes(h);
// Phones in the order a person would want them: mobile first, then the rest.
const PHONE_ORDER = [/^mobile( phone)?$/, /^(cell|cell phone|cellphone)$/, /^phone 1 value$/, /^(phone|phone number|telephone|tel|contact number)$/, /^primary phone$/, /^business phone$/, /^work phone$/, /^home phone$/, /^phone \d+ value$/, /^(business|home|other|company main) phone( \d)?$/, /^other phone$/];
const isWebsiteColumn = (h) => /^website( \d+)?( value)?$/.test(h) || h === 'web page' || h === 'url' || h === 'personal web page';
const LABEL_COLUMNS = ['labels', 'group membership', 'groups', 'categories'];

/**
 * The lists in one cell. Google separates with " ::: ", Outlook and vCard with ; or ,. A label that
 * starts with an asterisk is one of Google's own ("* myContacts", "* starred", "* friends") - not a
 * list the client made. Trimmed, de-duplicated (case-insensitively), 60 characters at most.
 */
function labelsFrom(cell, { commaToo = false } = {}) {
  const parts = String(cell || '').split(commaToo ? /\s*(?::::|;|,)\s*/ : /\s*(?::::|;)\s*/);
  const out = [];
  const seen = new Set();
  for (const raw of parts) {
    const l = tidy(raw).slice(0, 60);
    if (!l || l.startsWith('*') || /^(my ?contacts|starred|imported on .*)$/i.test(l)) continue;
    if (seen.has(l.toLowerCase())) continue;
    seen.add(l.toLowerCase());
    out.push(l);
  }
  return out;
}

function peopleFromCsv(text) {
  const rows = parseCsv(text, sniffDelimiter(text));
  if (rows.length < 2) return { people: [], format: 'csv', problem: rows.length ? 'The file has a heading row but no people under it.' : 'The file is empty.' };
  const headers = rows[0].map(norm);
  const find = (names) => names.map((n) => headers.indexOf(n)).filter((i) => i >= 0);
  const col = {
    name: find(COLUMNS.name), first: find(COLUMNS.first), middle: find(COLUMNS.middle), last: find(COLUMNS.last),
    company: find(COLUMNS.company), linkedin: find(COLUMNS.linkedin),
    emails: headers.map((h, i) => (isEmailColumn(h) ? i : -1)).filter((i) => i >= 0),
    phones: PHONE_ORDER.flatMap((rx) => headers.map((h, i) => (rx.test(h) ? i : -1)).filter((i) => i >= 0)).filter((v, i, a) => a.indexOf(v) === i),
    websites: headers.map((h, i) => (isWebsiteColumn(h) ? i : -1)).filter((i) => i >= 0),
    labels: headers.map((h, i) => (LABEL_COLUMNS.includes(h) ? i : -1)).filter((i) => i >= 0),
  };
  const hasName = col.name.length || col.first.length || col.last.length;
  if (!col.emails.length && !col.phones.length) {
    return { people: [], format: 'csv', problem: 'No email or phone column was found. The first row must be headings such as Name, Email, Phone, Company.' };
  }
  const format = headers.includes('e mail 1 value') || headers.includes('given name') ? 'google-csv'
    : (headers.includes('e mail address') || headers.includes('business phone') ? 'outlook-csv' : 'csv');
  const firstOf = (r, idxs) => { for (const i of idxs) { const v = tidy(r[i]); if (v) return v; } return ''; };
  const people = [];
  for (const r of rows.slice(1)) {
    const firstName = firstOf(r, col.first);
    const lastName = firstOf(r, col.last);
    const name = firstOf(r, col.name) || [firstName, firstOf(r, col.middle), lastName].filter(Boolean).join(' ');
    // one cell can hold several addresses ("a@x.com ::: b@y.com" in Google's export, or ; separated)
    const emails = [...new Set(col.emails.flatMap((i) => String(r[i] || '').split(/\s*(?::::|;|,|\s)\s*/)).map(cleanEmail).filter(Boolean))];
    const phone = firstOf(r, col.phones).split(/\s*:::\s*/)[0];
    let linkedin = firstOf(r, col.linkedin);
    if (!linkedin) linkedin = col.websites.map((i) => tidy(r[i])).find((v) => /linkedin\.com\/in\//i.test(v)) || '';
    const labels = labelsFrom(col.labels.map((i) => String(r[i] || '')).join(' ::: '));
    people.push({ name, firstName, lastName, emails, phone, company: firstOf(r, col.company), linkedin: /linkedin\.com\/in\//i.test(linkedin) ? linkedin : '', labels });
  }
  return { people, format, hasName: !!hasName };
}

// ---------------------------------------------------------------- vCard

const unescapeV = (v) => String(v || '').replace(/\\n/gi, ' ').replace(/\\([,;:\\])/g, '$1');
function decodeQuotedPrintable(v) {
  const joined = String(v || '').replace(/=\r?\n/g, '');
  try {
    const bytes = [];
    for (let i = 0; i < joined.length; i++) {
      if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) { bytes.push(parseInt(joined.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(...Buffer.from(joined[i], 'utf8'));
    }
    return Buffer.from(bytes).toString('utf8');
  } catch (_) { return joined; }
}

function peopleFromVcard(text) {
  // unfold: a line starting with a space or tab continues the one before
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const people = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/^BEGIN:VCARD/i.test(line)) { cur = { name: '', firstName: '', lastName: '', emails: [], phones: [], company: '', linkedin: '', labels: [] }; continue; }
    if (/^END:VCARD/i.test(line)) {
      if (cur) {
        if (!cur.name) cur.name = [cur.firstName, cur.lastName].filter(Boolean).join(' ');
        // mobile first, then whatever came first
        const phone = (cur.phones.find((p) => p.mobile) || cur.phones[0] || {}).value || '';
        people.push({ name: cur.name, firstName: cur.firstName, lastName: cur.lastName, emails: [...new Set(cur.emails)], phone, company: cur.company, linkedin: cur.linkedin, labels: labelsFrom(cur.labels.join(' ::: ')) });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    let value = line.slice(colon + 1);
    const params = head.toUpperCase();
    // quoted-printable (vCard 2.1, older phones): soft line breaks end in "="
    if (/ENCODING=QUOTED-PRINTABLE/.test(params)) {
      while (/=$/.test(value) && i + 1 < lines.length) { i++; value = value.slice(0, -1) + lines[i]; }
      value = decodeQuotedPrintable(value);
    }
    const prop = params.split(';')[0].replace(/^ITEM\d+\./, '');
    if (prop === 'FN') cur.name = tidy(unescapeV(value));
    else if (prop === 'N') {
      const parts = value.split(';').map((x) => tidy(unescapeV(x)));
      cur.lastName = parts[0] || ''; cur.firstName = parts[1] || '';
    } else if (prop === 'EMAIL') { const e = cleanEmail(unescapeV(value)); if (e) cur.emails.push(e); }
    else if (prop === 'TEL') { const v = tidy(unescapeV(value)).replace(/^tel:/i, ''); if (v) cur.phones.push({ value: v, mobile: /CELL|MOBILE|IPHONE/.test(params) }); }
    else if (prop === 'ORG') cur.company = tidy(unescapeV(value.split(';')[0]));
    else if (prop === 'CATEGORIES') cur.labels.push(...value.split(/(?<!\\),/).map((x) => tidy(unescapeV(x))));
    else if ((prop === 'URL' || /^X-SOCIALPROFILE/.test(prop)) && /linkedin\.com\/in\//i.test(value) && !cur.linkedin) cur.linkedin = tidy(unescapeV(value));
  }
  return { people, format: 'vcard', hasName: true };
}

// ---------------------------------------------------------------- one door

const MAX_PEOPLE = 20000;

/**
 * A file's text -> { format, people, problem? }. `filename` only helps choose between vCard and CSV
 * when the text itself is ambiguous. Blank rows are dropped; nobody is dropped for lacking details
 * here - the planner decides who can be saved and reports the rest as skipped.
 */
function parseContactsFile(text, filename = '') {
  const s = String(text || '');
  if (!s.trim()) return { format: 'unknown', people: [], problem: 'The file is empty.' };
  const looksVcard = /BEGIN:VCARD/i.test(s.slice(0, 2000)) || /\.vcf$/i.test(filename);
  const out = looksVcard ? peopleFromVcard(s) : peopleFromCsv(s);
  const people = (out.people || []).filter((p) => p.name || p.emails.length || p.phone || p.linkedin);
  if (people.length > MAX_PEOPLE) return { format: out.format, people: [], problem: `That file holds ${people.length} people - the most that can be imported at once is ${MAX_PEOPLE}. Split it into smaller files.` };
  if (!out.problem && !people.length) return { format: out.format, people: [], problem: 'No people were found in that file.' };
  return { format: out.format, people, ...(out.problem ? { problem: out.problem } : {}) };
}

module.exports = { parseContactsFile, parseCsv, peopleFromCsv, peopleFromVcard, sniffDelimiter, cleanEmail, labelsFrom, MAX_PEOPLE };
