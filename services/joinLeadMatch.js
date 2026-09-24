// services/joinLeadMatch.js
//
// A new member is almost always already a lead in Guy's own base - he met them on LinkedIn, called
// them, emailed them, and only then sent the join link. So the join chain looks them up there and
// copies across what the checkout never asks for: LinkedIn, phone, where they live (-> timezone),
// and every other email address Guy knows them by.
//
// Why (Guy, 24 Sep 2026): Steve Nelson paid and his Clients row came out as Brisbane with no
// LinkedIn and no phone, while his lead record already said "Greater Melbourne Area" with all of
// it. He paid from australia@euroswift.com; the lead is steve@euroswift.com - so the lookup can't
// stop at the email. Order, strongest first:
//   1. exact {Email}
//   2. exact member of {Alt Emails}
//   3. exact first + last name - taken only when it names ONE lead, or when exactly one of several
//      shares the joiner's (non-webmail) email domain. Two Steve Nelsons and no tie-break = no match;
//      a wrong person's phone on a client row is worse than a blank one.
//
// Best-effort by design: nothing here may stop a paid join. Any failure comes back as
// { matched: false, error } and the chain carries on with the old defaults.

const { resolveLeadTimezone } = require('./leadLocationResolver');
const { recordRoleLocation } = require('./leadRecordLocation');

const ALT_EMAIL_SPLIT = /[;,\n]+/;
const WEBMAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.com.au', 'icloud.com', 'me.com', 'mac.com', 'bigpond.com',
  'bigpond.net.au', 'optusnet.com.au', 'protonmail.com', 'proton.me', 'aol.com',
]);

const LEAD_FIELDS = [
  'First Name', 'Last Name', 'Email', 'Alt Emails', 'Phone', 'LinkedIn Profile URL',
  'Location', 'Headline', 'Company Name', 'Job Title', 'Raw Profile Data',
];

const norm = (v) => String(v || '').trim().toLowerCase();
const quote = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function splitEmails(v) {
  return String(v || '').split(ALT_EMAIL_SPLIT).map(norm).filter((e) => e.includes('@'));
}

function domainOf(email) {
  const d = norm(email).split('@')[1] || '';
  return d && !WEBMAIL.has(d) ? d : '';
}

/**
 * Find the joiner in the coach's Leads table.
 * @param {Function} leadsTable  base('Leads') - anything with .select({...}).firstPage()
 * @returns {Promise<{ record, matchedBy } | { record: null, reason }>}
 */
async function findJoinerLead(leadsTable, { email, firstName, lastName }) {
  const e = norm(email);
  const select = (filterByFormula, maxRecords) =>
    leadsTable.select({ filterByFormula, maxRecords, fields: LEAD_FIELDS }).firstPage();

  if (e) {
    const byEmail = await select(`LOWER({Email}) = ${quote(e)}`, 1);
    if (byEmail.length) return { record: byEmail[0], matchedBy: 'email' };

    try {
      const byAlt = await select(`AND({Alt Emails} != "", FIND(${quote(e)}, LOWER({Alt Emails})) > 0)`, 5);
      const hit = byAlt.find((r) => splitEmails(r.fields['Alt Emails']).includes(e));
      if (hit) return { record: hit, matchedBy: 'alt email' };
    } catch (_) { /* no {Alt Emails} in this base - fall through to the name */ }
  }

  const f = norm(firstName);
  const l = norm(lastName);
  if (!f || !l) return { record: null, reason: 'no email match, and no full name to try' };
  const byName = await select(
    `AND(LOWER(TRIM({First Name})) = ${quote(f)}, LOWER(TRIM({Last Name})) = ${quote(l)})`, 10
  );
  if (byName.length === 1) return { record: byName[0], matchedBy: 'name' };
  if (!byName.length) return { record: null, reason: `no lead with this email or the name "${firstName} ${lastName}"` };

  const d = domainOf(e);
  if (d) {
    const sameDomain = byName.filter((r) =>
      [r.fields['Email'], ...splitEmails(r.fields['Alt Emails'])].some((x) => domainOf(x) === d));
    if (sameDomain.length === 1) return { record: sameDomain[0], matchedBy: `name + ${d}` };
  }
  return { record: null, reason: `${byName.length} leads named "${firstName} ${lastName}" - not guessing which` };
}

function linkedinUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`;
}

/**
 * The lead's timezone, or null when it can't be pinned without asking. Same two sources the
 * booking clock trusts: {Location} first, then the CURRENT role's city in {Raw Profile Data}
 * (a past role is where they worked then, not where they live - not good enough for a client row).
 */
function timezoneFromLead(fields) {
  const loc = String(fields['Location'] || '').trim();
  const r = resolveLeadTimezone(loc);
  if (r.detected && r.timezone) return { timezone: r.timezone, from: `Location "${loc}"` };
  const role = recordRoleLocation(fields['Raw Profile Data'], loc);
  if (role && role.source === 'current') {
    return { timezone: role.timezone, from: `current role at ${role.org} (${role.location})` };
  }
  return null;
}

/**
 * Pure: what goes on the new Clients row from the lead's fields. Only fields with a value.
 * @returns {{ fields: object, timezone: string|null, summary: string[] }}
 */
function clientFieldsFromLead(leadFields, joinEmail) {
  const lf = leadFields || {};
  const fields = {};
  const summary = [];

  const li = linkedinUrl(lf['LinkedIn Profile URL']);
  if (li) { fields['LinkedIn URL'] = li; summary.push(`LinkedIn ${li}`); }

  const phone = String(lf['Phone'] || '').trim();
  if (phone) { fields['Phone'] = phone; summary.push(`phone ${phone}`); }

  const join = norm(joinEmail);
  const others = [...new Set([norm(lf['Email']), ...splitEmails(lf['Alt Emails'])])]
    .filter((x) => x && x.includes('@') && x !== join);
  if (others.length) {
    fields['Alternative Email Addresses'] = others.join('\n');
    summary.push(`other email${others.length > 1 ? 's' : ''} ${others.join(', ')}`);
  }

  const tz = timezoneFromLead(lf);
  if (tz) summary.push(`timezone ${tz.timezone} (from ${tz.from})`);

  const about = [lf['Headline'], lf['Location']].map((v) => String(v || '').trim()).filter(Boolean);
  if (about.length) summary.push(about.join(' - '));

  return { fields, timezone: tz ? tz.timezone : null, summary };
}

module.exports = { findJoinerLead, clientFieldsFromLead, timezoneFromLead, LEAD_FIELDS };
