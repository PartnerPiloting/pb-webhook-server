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
 *     their own.
 *   - ONE LIST (Guy, 23 Nov 2026, replacing a separate section that hid itself when more than five
 *     leads matched): the page shows the leads first and these contacts after them in the same
 *     table, each row labelled Lead or Contact. Exports stay leads only - contacts are never sent to
 *     the lead search or export routes, only to this one.
 *   - anyone who is already a lead is left out.
 *   - "Add as lead" goes through the same door as every other hand-add (wingguyLeads.createLead):
 *     dedupe first - by LinkedIn address, by name, and here by email as well - so it never makes a
 *     duplicate, and the person is NOT marked as a LinkedIn connection.
 *   - a contact with no LinkedIn address is added on name + email. Only the blank New Lead form
 *     insists on a LinkedIn address; createLead never did.
 *   - tenant-safe: the search is filtered on the client, and the add re-reads the contact by id AND
 *     client, so one client can never add (or even see) another's contact.
 */

const { describeSources } = require('./wingguyContactsMcp');
const { groupPeople, nameKey } = require('./contactGrouping');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'lead_search_contacts');

const MIN_QUERY = 3;
const MAX_SHOWN = 25;                    // contacts shown under one search; more than this and the page says so
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

const joinAnd = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** "your list "Safe to Say"" / "your lists CC Results Group and Evercontact" - '' when on none. */
function listsText(lists) {
  const l = [...new Set((lists || []).map((x) => String(x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!l.length) return '';
  return l.length === 1 ? `your list "${l[0]}"` : `your lists ${joinAnd(l)}`;
}

/**
 * ONE ROW PER PERSON (Guy, 25 Nov 2026). The store keeps a row per address; a person's other rows
 * may not have matched the words typed (search an email and only that row comes back). So: fetch
 * every non-lead row with the same full name or the same file entry, let contactGrouping decide who
 * is really the same person, and hand back one person for each row asked about - in the same order.
 */
async function peopleFor(store, clientId, rows) {
  const asked = (rows || []).filter(Boolean);
  if (!asked.length) return [];
  let more = [];
  if (store.findSamePeople) {
    const names = asked.map((r) => nameKey(r.name || [r.first_name, r.last_name].filter(Boolean).join(' '))).filter(Boolean);
    const refs = asked.map((r) => r.person_ref).filter(Boolean);
    if (names.length || refs.length) more = await store.findSamePeople(clientId, { names, refs });
  }
  const have = new Set(asked.map((r) => String(r.id)));
  const all = [...asked, ...(more || []).filter((r) => r && !r.lead_record_id && !have.has(String(r.id)))];
  // only people who include a row that was asked for; the extra rows exist to complete them
  return groupPeople(all).filter((p) => p.ids.some((id) => have.has(id)));
}

/** The whole person a contact id belongs to (or null). Leads' rows are handed back as they are. */
async function personOf(store, clientId, contactId) {
  const row = await store.getContact(clientId, contactId);
  if (!row) return null;
  if (row.lead_record_id) return { ...row, ids: [String(row.id)], emails: row.email ? [row.email] : [], members: [row] };
  const people = await peopleFor(store, clientId, [row]);
  return people.find((p) => p.ids.includes(String(row.id))) || { ...row, ids: [String(row.id)], emails: row.email ? [row.email] : [], members: [row] };
}

/** "3 Mar 2024" - '' for no date. Day-level, so the timezone only matters at midnight. */
function dayText(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Brisbane' });
}

/** What the page shows for one person. */
function shape(r) {
  const emails = r.emails || (r.email ? [r.email] : []);
  const { first, last } = nameParts(r);
  const onLinkedin = (r.sources || []).includes('linkedin');
  const connectedOn = onLinkedin ? dayText(r.linkedin_connected_at) : '';
  return {
    id: String(r.id),
    name: String(r.name || '').trim() || [first, last].filter(Boolean).join(' ') || emails[0] || '',
    email: emails[0] || '',
    otherEmails: emails.slice(1),
    phone: r.phone || '',
    linkedin: r.linkedin_slug ? `https://www.linkedin.com/in/${r.linkedin_slug}/` : '',
    company: r.company || '',
    // an uploaded list is named: 'your list "Safe to Say"' says more than 'you imported them'
    // a LinkedIn connection says so, with the day they connected when LinkedIn gave one
    knownFrom: [listsText(r.lists), onLinkedin ? `connected on LinkedIn${connectedOn ? ` ${connectedOn}` : ''}` : '',
      describeSources((r.sources || []).filter((x) => x !== 'linkedin' && !((r.lists || []).length && x === 'import')))].filter(Boolean).join(', '),
    lists: [...new Set(r.lists || [])],
    headline: r.headline || '',
    connectedOn,
    manual: !!r.manual,
  };
}

/**
 * People in the client's contacts matching what was typed, who are not already leads:
 * { contacts: [up to MAX_SHOWN], more: true when further people matched }. Never throws.
 */
async function searchContacts(clientId, query, { deps = {} } = {}) {
  const store = deps.store || require('./contactsStore');
  const q = String(query || '').trim();
  const none = { contacts: [], more: false };
  if (!clientId || q.length < MIN_QUERY) return none;
  if (/linkedin\.com\//i.test(q)) return none;        // a pasted profile link is a lead lookup, not a name
  try {
    // notLeads: a lead's main AND alternate addresses both carry its record id, so neither comes back.
    const rows = (await store.findPeople(clientId, q, { limit: 60, notLeads: true })).filter((r) => !r.lead_record_id);
    const people = await peopleFor(store, clientId, rows);
    return { contacts: people.slice(0, MAX_SHOWN).map(shape), more: people.length > MAX_SHOWN };
  } catch (e) {
    log.warn(`lead-search contacts: lookup failed for ${clientId}: ${e.message}`);
    return none;
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
  // The whole PERSON, not the one address row that was clicked: every address they have goes onto
  // the lead (the first as the main email, the rest as alternates).
  const row = await personOf(store, clientId, contactId);
  if (!row) return { ok: false, status: 404, error: 'That contact was not found.' };
  const { first, last } = nameParts(row);
  const emails = (row.emails || []).filter(Boolean);
  const name = [first, last].filter(Boolean).join(' ') || emails[0] || '';
  if (row.lead_record_id) return { ok: true, status: 200, exists: true, leadRecordId: row.lead_record_id, name };
  if (!first && !last && !row.linkedin_slug) return { ok: false, status: 400, error: 'There is no name on this contact to file them under.' };
  const markAll = async (leadId) => { for (const m of row.members || [row]) await store.markAsLead(clientId, m.id, leadId).catch(() => {}); };

  const base = clientService.getClientBase(airtableBaseId);
  if (!base) return { ok: false, status: 500, error: 'Your leads database is unavailable.' };
  let sameEmail = null;
  for (const e of emails.slice(0, 6)) { sameEmail = await findLeadByEmail(base, e); if (sameEmail) break; }
  if (sameEmail) {
    await markAll(sameEmail.id);
    return { ok: true, status: 200, exists: true, leadRecordId: sameEmail.id, name: `${sameEmail.fields['First Name'] || ''} ${sameEmail.fields['Last Name'] || ''}`.trim() || name };
  }

  const knownFrom = describeSources(row.sources);
  const r = await wingguyLeads.createLead(airtableBaseId, {
    firstName: first,
    lastName: last,
    linkedinUrl: row.linkedin_slug ? `https://www.linkedin.com/in/${row.linkedin_slug}/` : '',
    email: emails[0] || '',
    phone: row.phone || '',
    location: row.location || '',
    notes: `Added from your contacts on Lead Search${knownFrom ? ` (${knownFrom})` : ''}.`,
    source: ADD_SOURCE,
    // Knowing someone by email does not make them a LinkedIn connection, so `connected` is normally
    // left out. The one exception is a person LinkedIn itself says is a connection AND gave a date
    // for (the connections copy): the lead then carries that real date - never today's.
    ...((row.sources || []).includes('linkedin') && row.linkedin_connected_at ? { connected: true, dateConnectedISO: new Date(row.linkedin_connected_at).toISOString() } : {}),
  });
  if (!r || !r.ok) return { ok: false, status: 500, error: (r && r.error) || 'The lead could not be created.' };
  await markAll(r.leadRecordId);
  // Their other addresses go on as alternates - so a reply from any of them finds this lead. And the
  // lists they came in on become tags, through the one tag writer. Extras: neither can fail the add.
  if (r.created && emails.length > 1 && wingguyLeads.updateLeadEmails) {
    try { await wingguyLeads.updateLeadEmails(airtableBaseId, r.leadRecordId, { addOthers: emails.slice(1) }); } catch (e) { log.warn(`make-a-lead: other addresses not added for ${clientId}: ${e.message}`); }
  }
  if (r.created && (row.lists || []).length) {
    try { await (deps.leadTags || require('./wingguyLeadTags')).updateLeadTags(base, r.leadRecordId, { add: row.lists }); } catch (e) { log.warn(`make-a-lead: list tags not added for ${clientId}: ${e.message}`); }
  }
  // A meeting recorded before they were a lead is parked under their email - attach it now (same as
  // every other create door). A bonus: never fails the add.
  if (r.created) {
    for (const e of emails.slice(0, 6)) {
      try {
        await (deps.recallDb || require('./recallWebhookDb')).resolvePendingLeadByEmail({ email: e, airtableLeadId: r.leadRecordId, coachClientId: clientId, source: 'lead-created' });
      } catch (_) { /* non-fatal */ }
    }
  }
  // OVERNIGHT FILL-IN (Guy, 27 Nov 2026): the lead just made is light - a name and an address. With a
  // LinkedIn address on it, note it for the client's Linked Helper machine, which visits the profile
  // on its nightly run so the lead has the full picture and a score by morning
  // (services/leadFillIns.js). `fillIn` is true only when their machine really will. Never fails the add.
  let fillIn = false;
  if (r.created && row.linkedin_slug) {
    try {
      const noted = await (deps.leadFillIns || require('./leadFillIns')).request(clientId, row.linkedin_slug, r.leadRecordId);
      fillIn = !!(noted && noted.willFill);
    } catch (e) { log.warn(`make-a-lead: fill-in not noted for ${clientId}: ${e.message}`); }
  }
  return { ok: true, status: 200, created: !!r.created, exists: !!r.exists, leadRecordId: r.leadRecordId, name: r.name || name, fillIn };
}

/**
 * ADD A CONTACT BY HAND (Guy, 24 Nov 2026): Wingguy is the one place for everyone a client knows.
 * A lead is someone Wingguy works on with them; a contact is someone it just keeps details for.
 * Until now every hand-add made a lead. This saves to the contacts store instead - never the leads
 * base - under the source "you added them".
 *
 *   needs: a name, plus an email or a phone number. No LinkedIn address required.
 *   dedupe first, on EMAIL or LINKEDIN ADDRESS only - never on a name alone: if the person is
 *   already a lead or a contact nothing is created and that person is handed back.
 *
 * Returns { ok, status, created, exists, kind: 'contact'|'lead', contact?, leadRecordId?, name, error? }.
 */
async function saveContact(clientId, airtableBaseId, input = {}, { deps = {}, source = 'manual' } = {}) {
  const store = deps.store || require('./contactsStore');
  const clientService = deps.clientService || require('./clientService');
  const wingguyLeads = deps.wingguyLeads || require('./wingguyLeads');
  const text = (v) => String(v === undefined || v === null ? '' : v).trim();
  const first = text(input.firstName || input.first_name);
  const last = text(input.lastName || input.last_name);
  const name = text(input.name) || [first, last].filter(Boolean).join(' ');
  const emailRaw = text(input.email);
  const email = store.cleanEmail ? store.cleanEmail(emailRaw) : emailRaw.toLowerCase();
  const phone = text(input.phone);
  const linkedinRaw = text(input.linkedin || input.linkedinUrl || input.linkedin_url);
  const slug = linkedinRaw ? (store.slugOf ? store.slugOf(linkedinRaw) : '') : '';
  if (!name) return { ok: false, status: 400, error: 'A contact needs a name.' };
  if (emailRaw && !email) return { ok: false, status: 400, error: 'That does not look like an email address.' };
  if (linkedinRaw && !slug) return { ok: false, status: 400, error: 'That does not look like a LinkedIn profile address.' };
  if (!email && phone.replace(/\D/g, '').length < 6) return { ok: false, status: 400, error: 'A contact needs an email or a phone number.' };

  // 1. already held in the contacts store (a lead's rows live there too)?
  const held = await store.findByIdentity(clientId, { email, linkedin: slug });
  if (held.length) {
    const r = held[0];
    const who = String(r.name || '').trim() || r.email || name;
    if (r.lead_record_id) return { ok: true, status: 200, created: false, exists: true, kind: 'lead', leadRecordId: r.lead_record_id, name: who };
    return { ok: true, status: 200, created: false, exists: true, kind: 'contact', contact: shape({ ...r, emails: r.email ? [r.email] : [] }), name: who };
  }
  // 2. a lead the nightly sweep has not copied across yet? Ask the leads base itself.
  const base = airtableBaseId ? clientService.getClientBase(airtableBaseId) : null;
  if (base) {
    let lead = email ? await findLeadByEmail(base, email) : null;
    if (!lead && slug && wingguyLeads.findLeadRecord) lead = await wingguyLeads.findLeadRecord(base, { linkedinUrl: `https://www.linkedin.com/in/${slug}/` });
    if (lead) {
      const who = `${lead.fields['First Name'] || ''} ${lead.fields['Last Name'] || ''}`.trim() || name;
      return { ok: true, status: 200, created: false, exists: true, kind: 'lead', leadRecordId: lead.id, name: who };
    }
  }
  const r = await store.addManualContact(clientId, { name, firstName: first, lastName: last, email, phone, company: text(input.company), linkedin: slug }, { source });
  if (!r.ok || !r.row) return { ok: false, status: 500, error: r.error || 'The contact could not be saved.' };
  return {
    ok: true, status: 200, created: !!r.created, exists: !r.created, kind: r.row.lead_record_id ? 'lead' : 'contact',
    ...(r.row.lead_record_id ? { leadRecordId: r.row.lead_record_id } : { contact: shape({ ...r.row, emails: r.row.email ? [r.row.email] : [] }) }),
    name: String(r.row.name || '').trim() || name,
  };
}

/**
 * Edit a contact from its details card: name, company, email, phone, LinkedIn. The row is marked as
 * hand-edited so the nightly sweep cannot put the old values back.
 * Returns { ok, status, contact? , error? }.
 */
async function editContact(clientId, contactId, fields = {}, { deps = {} } = {}) {
  const store = deps.store || require('./contactsStore');
  const allowed = {};
  for (const k of ['name', 'company', 'email', 'phone', 'linkedin']) if (k in (fields || {})) allowed[k] = fields[k];
  if (!Object.keys(allowed).length) return { ok: false, status: 400, error: 'Nothing to change.' };
  // a changed email or LinkedIn address must not collide with someone else the client already holds
  const cur = await store.getContact(clientId, contactId);
  if (!cur) return { ok: false, status: 404, error: 'That contact was not found.' };
  const newEmail = 'email' in allowed ? String(allowed.email || '').trim().toLowerCase() : '';
  const newLinkedin = 'linkedin' in allowed ? String(allowed.linkedin || '').trim() : '';
  // The whole person: someone shown once may be several address rows, and their own other rows are
  // not "someone else".
  const person = cur.lead_record_id ? null : await personOf(store, clientId, contactId);
  const ownIds = new Set((person && person.ids) || [String(cur.id)]);
  if ((newEmail && newEmail !== String(cur.email || '').toLowerCase()) || newLinkedin) {
    const others = (await store.findByIdentity(clientId, { email: newEmail, linkedin: newLinkedin })).filter((r) => !ownIds.has(String(r.id)));
    if (others.length) {
      const o = others[0];
      return { ok: false, status: 409, error: `${String(o.name || '').trim() || o.email || 'Someone else'} already has that ${newEmail && String(o.email || '').toLowerCase() === newEmail ? 'email address' : 'LinkedIn address'} - they are one of your ${o.lead_record_id ? 'leads' : 'contacts'}.` };
    }
  }
  const r = await store.updateContactFields(clientId, contactId, allowed);
  if (!r.ok) return { ok: false, status: r.status || 500, error: r.error };
  // A person with several address rows: the name and company go onto all of them and the rows are
  // tied together, so the edit cannot split one person back into two.
  if (ownIds.size > 1 && store.updatePersonShared) {
    await store.updatePersonShared(clientId, [...ownIds], {
      ...('name' in allowed ? { name: r.row.name } : {}), ...('company' in allowed ? { company: r.row.company } : {}),
      ref: (person && person.person_ref) || `edit:${[...ownIds].sort()[0]}`,
    });
  }
  const after = (await personOf(store, clientId, contactId)) || { ...r.row, emails: r.row.email ? [r.row.email] : [] };
  // the row that was edited leads: its address is the one the card showed in the box
  const lead = String(r.row.email || '').toLowerCase();
  const emails = lead ? [lead, ...(after.emails || []).filter((e) => e !== lead)] : (after.emails || []);
  return { ok: true, status: 200, contact: shape({ ...after, id: r.row.id, name: r.row.name, emails }) };
}

module.exports = { saveContact, editContact, searchContacts, addContactAsLead, nameParts, shape, listsText, peopleFor, personOf, findLeadByEmail, MIN_QUERY, MAX_SHOWN, ADD_SOURCE };
