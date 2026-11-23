/**
 * "Found in your contacts" on Lead Search (Guy, 23 Nov 2026).
 *
 * WHY: a client types a name into Lead Search, the person is not a lead, and the page says nothing -
 * although Wingguy knows them perfectly well from their email. The contacts warehouse behind
 * wingguy_find_person (services/contactsStore.js: Postgres wingguy_contacts, one row per address,
 * always filtered on the client) already holds everyone they have corresponded with. This shows those
 * people UNDER a name search, each with an "Add as lead" button.
 *
 * Rules:
 *   - only ever in answer to a typed name / email (3+ characters). Contacts are never listed on
 *     their own and never mixed into the lead results.
 *   - anyone who is already a lead is left out.
 *   - "Add as lead" goes through the same door as every other hand-add (wingguyLeads.createLead):
 *     dedupe first - by LinkedIn address, by name, and here by email as well - so it never makes a
 *     duplicate, and the person is NOT marked as a LinkedIn connection.
 *   - a contact with no LinkedIn address is added on name + email. Only the blank New Lead form
 *     insists on a LinkedIn address; createLead never did.
 *   - tenant-safe: the search is filtered on the client, and the add re-reads the contact by id AND
 *     client, so one client can never add (or even see) another's contact.
 */

const { groupByPerson, describeSources } = require('./wingguyContactsMcp');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'lead_search_contacts');

const MIN_QUERY = 3;
const MAX_SHOWN = 6;
const ADD_SOURCE = 'Follow-Up Personally';   // an existing choice in every base's Source list

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** First + last name for the new record: the contact's own, else split from the full name, else from the email. */
function nameParts(row = {}) {
  let first = String(row.first_name || '').trim();
  let last = String(row.last_name || '').trim();
  if (!first && !last) {
    const parts = String(row.name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length) {
      first = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
      last = parts.length > 1 ? parts[parts.length - 1] : '';
    }
  }
  if (!first && !last && row.email) {
    const local = String(row.email).split('@')[0].split(/[._-]+/).filter(Boolean);
    first = cap(local[0] || '');
    last = local.length > 1 ? cap(local[local.length - 1]) : '';
  }
  return { first, last };
}

/** What the page shows for one person. */
function shape(r) {
  const emails = r.emails || (r.email ? [r.email] : []);
  const { first, last } = nameParts(r);
  return {
    id: String(r.id),
    name: String(r.name || '').trim() || [first, last].filter(Boolean).join(' ') || emails[0] || '',
    email: emails[0] || '',
    otherEmails: emails.slice(1),
    phone: r.phone || '',
    linkedin: r.linkedin_slug ? `https://www.linkedin.com/in/${r.linkedin_slug}/` : '',
    company: r.company || '',
    knownFrom: describeSources(r.sources) || '',
  };
}

/** People in the client's contacts matching what was typed, who are not already leads. Never throws. */
async function searchContacts(clientId, query, { deps = {} } = {}) {
  const store = deps.store || require('./contactsStore');
  const q = String(query || '').trim();
  if (!clientId || q.length < MIN_QUERY) return [];
  if (/linkedin\.com\//i.test(q)) return [];          // a pasted profile link is a lead lookup, not a name
  try {
    const rows = await store.findPeople(clientId, q, { limit: 25 });
    // Fold a person's several addresses into one line first, THEN drop the leads - so a lead's
    // alternate address can never slip through as "not a lead".
    return groupByPerson(rows).filter((r) => !r.lead_record_id).slice(0, MAX_SHOWN).map(shape);
  } catch (e) {
    log.warn(`lead-search contacts: lookup failed for ${clientId}: ${e.message}`);
    return [];
  }
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** A lead already holding this email (primary or alternate), or null. A base without Alt Emails is fine. */
async function findLeadByEmail(base, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const tries = [
    `OR(LOWER(TRIM({Email})) = "${esc(e)}", FIND("${esc(e)}", LOWER({Alt Emails} & "")) > 0)`,
    `LOWER(TRIM({Email})) = "${esc(e)}"`,
  ];
  for (const formula of tries) {
    try {
      const hit = await base('Leads').select({ filterByFormula: formula, maxRecords: 1, fields: ['First Name', 'Last Name'] }).firstPage();
      return hit[0] || null;
    } catch (err) {
      if (!/UNKNOWN_FIELD_NAME|Unknown field/i.test(String(err.message || err.error || ''))) throw err;
    }
  }
  return null;
}

/**
 * Add one contact as a lead. contactId is the warehouse row id the search handed out.
 * Returns { ok, status, created?, exists?, leadRecordId?, name?, error? }.
 */
async function addContactAsLead(clientId, airtableBaseId, contactId, { deps = {} } = {}) {
  const store = deps.store || require('./contactsStore');
  const wingguyLeads = deps.wingguyLeads || require('./wingguyLeads');
  const clientService = deps.clientService || require('./clientService');
  const row = await store.getContact(clientId, contactId);
  if (!row) return { ok: false, status: 404, error: 'That contact was not found.' };
  const { first, last } = nameParts(row);
  const name = [first, last].filter(Boolean).join(' ') || row.email || '';
  if (row.lead_record_id) return { ok: true, status: 200, exists: true, leadRecordId: row.lead_record_id, name };
  if (!first && !last && !row.linkedin_slug) return { ok: false, status: 400, error: 'There is no name on this contact to file them under.' };

  const base = clientService.getClientBase(airtableBaseId);
  if (!base) return { ok: false, status: 500, error: 'Your leads database is unavailable.' };
  const sameEmail = await findLeadByEmail(base, row.email);
  if (sameEmail) {
    await store.markAsLead(clientId, row.id, sameEmail.id).catch(() => {});
    return { ok: true, status: 200, exists: true, leadRecordId: sameEmail.id, name: `${sameEmail.fields['First Name'] || ''} ${sameEmail.fields['Last Name'] || ''}`.trim() || name };
  }

  const knownFrom = describeSources(row.sources);
  const r = await wingguyLeads.createLead(airtableBaseId, {
    firstName: first,
    lastName: last,
    linkedinUrl: row.linkedin_slug ? `https://www.linkedin.com/in/${row.linkedin_slug}/` : '',
    email: row.email || '',
    phone: row.phone || '',
    location: row.location || '',
    notes: `Added from your contacts on Lead Search${knownFrom ? ` (${knownFrom})` : ''}.`,
    source: ADD_SOURCE,
    // connected is deliberately left out: knowing someone by email does not make them a LinkedIn connection
  });
  if (!r || !r.ok) return { ok: false, status: 500, error: (r && r.error) || 'The lead could not be created.' };
  await store.markAsLead(clientId, row.id, r.leadRecordId).catch(() => {});
  // A meeting recorded before they were a lead is parked under their email - attach it now (same as
  // every other create door). A bonus: never fails the add.
  if (r.created && row.email) {
    try {
      await require('./recallWebhookDb').resolvePendingLeadByEmail({ email: row.email, airtableLeadId: r.leadRecordId, coachClientId: clientId, source: 'lead-created' });
    } catch (_) { /* non-fatal */ }
  }
  return { ok: true, status: 200, created: !!r.created, exists: !!r.exists, leadRecordId: r.leadRecordId, name: r.name || name };
}

module.exports = { searchContacts, addContactAsLead, nameParts, shape, findLeadByEmail, MIN_QUERY, MAX_SHOWN, ADD_SOURCE };
