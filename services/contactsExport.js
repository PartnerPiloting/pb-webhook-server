/**
 * "Export everyone (leads + contacts)" (Guy, 26 Nov 2026): a client who keeps their people in Wingguy
 * can take a copy out again - the terms page says "they stay yours". It began the same morning as
 * "Export contacts" (contacts only); Guy's point was that two exports for "everyone I know" is
 * friction, and a spreadsheet can be sorted - so it is ONE file with everyone, and the first column
 * says Lead or Contact.
 *
 * One row per PERSON (services/contactGrouping.js - the same fold the search screen shows). A lead's
 * details here come from the lookup's nightly copy of the leads base, so a lead edited today shows
 * yesterday's details; "Export All to CSV" under the search stays the live one for leads, with their
 * score, status and Linked Helper data.
 *
 * The file is laid out as a Google Contacts CSV (First Name, Last Name, Organization Name,
 * E-mail 1 - Value ..., Phone 1 - Value, Labels), so it uploads into Google Contacts as it is and
 * Wingguy's own Import contacts reads it back (tests/contacts-export.test.js proves the round trip).
 * The first two columns, "Lead or contact" and "How Wingguy knows them", are ours: a client sorts or
 * filters on them to keep just the leads, or to set thousands of LinkedIn connections aside. People
 * with an email or phone come first.
 *
 * Read-only. Nothing here writes.
 */

const { groupPeople } = require('./contactGrouping');

// Three address columns as standard; the file grows more when someone has more (Guy's first real export,
// 26 Nov 2026, left ten addresses off because a few people had four or five). Nobody's address is dropped
// short of MAX_EMAILS, which is only there so one freak record cannot make the sheet absurdly wide.
const MIN_EMAILS = 3;
const MAX_EMAILS = 12;
const columnsFor = (emails) => ['Lead or contact', 'How Wingguy knows them', 'First Name', 'Last Name', 'Organization Name',
  ...Array.from({ length: emails }, (_, i) => `E-mail ${i + 1} - Value`),
  'Phone 1 - Value', 'Labels', 'LinkedIn', 'Connected on LinkedIn', 'Headline'];
const COLUMNS = columnsFor(MIN_EMAILS);

/** How the person got in, in the words the portal uses - most deliberate first. */
function knownFrom(sources = []) {
  const s = new Set(sources || []);
  const out = [];
  if (s.has('import')) out.push('imported');
  if (s.has('manual') || s.has('manual-claude')) out.push('added by hand');
  if (s.has('mail-to') || s.has('mail-from') || s.has('mail-thread')) out.push('from email');
  if (s.has('linkedin')) out.push('from LinkedIn');
  if (!out.length && (s.has('lead') || s.has('lead-alt'))) return 'your leads list';
  return out.length ? out.join(', ') : 'other';
}

function nameParts(p = {}) {
  let first = String(p.first_name || '').trim();
  let last = String(p.last_name || '').trim();
  if (!first && !last) {
    const parts = String(p.name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length) { first = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]; last = parts.length > 1 ? parts[parts.length - 1] : ''; }
  }
  return { first, last };
}

const dayOf = (v) => { if (!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); };

/**
 * A cell a spreadsheet would run as a formula is made plain text. A phone number may start with "+"
 * and is left alone - it is only ever digits, spaces and punctuation.
 */
function safeCell(v, { phone = false } = {}) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
  if (!s) return '';
  if (phone && /^[+\d(][\d\s()+.\-x]*$/i.test(s)) return s;
  return /^[=+\-@\t]/.test(s) ? `'${s}` : s;
}

const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;

/**
 * rows = every wingguy_contacts row for the client. Returns { csv, people, leads, contacts, withDetails }.
 * A lead's own addresses (main + alternates) are one person: they share its record id, so they are
 * tied together before the usual fold. Anyone with a lead row among theirs is a Lead.
 */
function buildExport(rows = []) {
  const tied = (rows || []).filter(Boolean).map((r) => (r.lead_record_id && !r.person_ref ? { ...r, person_ref: `lead:${r.lead_record_id}` } : r));
  const people = groupPeople(tied);
  const isLead = (p) => (p.members || [p]).some((m) => m.lead_record_id);
  const reachable = (p) => (p.emails && p.emails.length) || p.phone;
  const sortName = (p) => { const n = nameParts(p); return `${n.last} ${n.first}`.trim().toLowerCase() || '￿'; };
  people.sort((a, b) => ((reachable(a) ? 0 : 1) - (reachable(b) ? 0 : 1)) || sortName(a).localeCompare(sortName(b)));
  const width = Math.min(MAX_EMAILS, Math.max(MIN_EMAILS, ...people.map((p) => (p.emails || []).length)));
  const columns = columnsFor(width);
  const lines = people.map((p) => {
    const { first, last } = nameParts(p);
    const emails = (p.emails || []).slice(0, width);
    const cells = [
      isLead(p) ? 'Lead' : 'Contact', knownFrom(p.sources), safeCell(first), safeCell(last), safeCell(p.company),
      ...Array.from({ length: width }, (_, i) => safeCell(emails[i] || '')),
      safeCell(p.phone, { phone: true }),
      (p.lists || []).map((l) => safeCell(l)).filter(Boolean).join(' ::: '),
      p.linkedin_slug ? `https://www.linkedin.com/in/${p.linkedin_slug}/` : '',
      dayOf(p.linkedin_connected_at), safeCell(p.headline),
    ];
    return cells.map(csvCell).join(',');
  });
  const csv = `﻿${columns.map(csvCell).join(',')}\r\n${lines.join('\r\n')}${lines.length ? '\r\n' : ''}`;
  const leads = people.filter(isLead).length;
  return { csv, people: people.length, leads, contacts: people.length - leads, withDetails: people.filter(reachable).length };
}

/** The whole export for one client. { ok, csv, people, withDetails } or { ok:false, status, error }. */
async function exportContacts(clientId, { deps = {} } = {}) {
  const store = deps.contactsStore || require('./contactsStore');
  if (!clientId) return { ok: false, status: 400, error: 'No client' };
  const rows = await store.listContactsForExport(clientId);
  return { ok: true, ...buildExport(rows) };
}

module.exports = { exportContacts, buildExport, knownFrom, safeCell, COLUMNS, columnsFor };
