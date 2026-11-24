/**
 * Import contacts from a file (contacts step 2, Guy, 24 Nov 2026).
 *
 * A client uploads a file exported from Google Contacts, Outlook or a phone - or a newsletter or
 * event list - and the people in it become CONTACTS (never leads). The page shows a summary first
 * ("312 new, 48 updated, 9 skipped") and NOTHING is written until the client confirms: preview and
 * confirm are the same plan run twice, the second time applied.
 *
 * The rules (do not loosen without Guy):
 *   - match on EMAIL, or LinkedIn address where present. Never on a name alone.
 *   - someone new            -> a contact. Never a lead, never marked as a LinkedIn connection.
 *   - already a contact      -> blanks are filled; nothing they already have is overwritten.
 *   - already a lead         -> blank fields on the LEAD are filled (phone, email, company);
 *                               nothing is overwritten and Date Connected is never touched.
 *   - no email and no phone  -> skipped, and counted.
 *   - the list name ("Safe to Say") is kept as where Wingguy knows the person from.
 *   - uploading the same file again changes nothing; a later, longer file adds only who is new.
 *   - imported rows are `manual` (the client supplied them), so the nightly sweep can fill their
 *     blanks but never overwrite or remove them (services/contactsStore.js MANUAL_GUARD).
 *
 * No automatic Google link - ruled out in September (memory: project_wingguy_contacts_lookup).
 */

const { parseContactsFile } = require('./contactsImportParse');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'contacts_import');

const LEAD_FILLS = [['Phone', 'phone'], ['Email', 'email'], ['Company Name', 'company']];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const tidyList = (v) => String(v || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/** A name for someone the file gave none: from the email ("jane.smith@x" -> "Jane Smith"). */
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0].split(/[._-]+/).filter((x) => x && !/^\d+$/.test(x));
  return local.map(cap).join(' ');
}

/**
 * PURE. Work out what an upload would do.
 *   people - from parseContactsFile
 *   held   - every row the client already has in the contacts store:
 *            [{ id, contact_key, email, linkedin_slug, lead_record_id, name, company, phone, lists }]
 *   slugOf - contactsStore.slugOf
 * Returns { newPeople, contactFills, leadMatches, counts } - nothing in it has been written.
 */
function planImport(people, held, { listName = '', slugOf = () => '' } = {}) {
  const list = tidyList(listName);
  const byEmail = new Map();
  const bySlug = new Map();
  // A person with no email is filed under their phone number (contact_key 'phone:<digits>'). The same
  // number in a later upload is that same record - a match on the KEY, still never on the name.
  const byPhoneKey = new Map();
  for (const r of held || []) {
    if (String(r.contact_key || '').startsWith('phone:')) byPhoneKey.set(String(r.contact_key), r);
    if (r.email) { const k = String(r.email).toLowerCase(); const had = byEmail.get(k); if (!had || (r.lead_record_id && !had.lead_record_id)) byEmail.set(k, r); }
    if (r.linkedin_slug) { const k = String(r.linkedin_slug).toLowerCase(); const had = bySlug.get(k); if (!had || (r.lead_record_id && !had.lead_record_id)) bySlug.set(k, r); }
  }
  const counts = { inFile: (people || []).length, new: 0, contactsUpdated: 0, leadsMatched: 0, unchanged: 0, skippedNoDetails: 0, repeated: 0 };
  const newPeople = [];
  const contactFills = new Map();   // row id -> { id, set: {col: value}, addList }
  const leadMatches = new Map();    // lead record id -> { leadRecordId, name, phone, email, company }
  const seen = new Set();
  for (const p of people || []) {
    const emails = p.emails || [];
    const digits = String(p.phone || '').replace(/\D/g, '');
    if (!emails.length && digits.length < 6) { counts.skippedNoDetails++; continue; }
    const slug = String(slugOf(p.linkedin) || '').toLowerCase();
    let match = null;
    for (const e of emails) { match = byEmail.get(e); if (match) break; }
    if (!match && slug) match = bySlug.get(slug) || null;
    if (!match && !emails.length) match = byPhoneKey.get(`phone:${digits}`) || null;
    const key = match ? `row:${match.id}` : (emails[0] || `phone:${digits}`);
    if (seen.has(key)) { counts.repeated++; continue; }
    seen.add(key);

    if (match && match.lead_record_id) {
      counts.leadsMatched++;
      leadMatches.set(match.lead_record_id, { leadRecordId: match.lead_record_id, name: match.name || p.name || '', phone: p.phone || '', email: emails[0] || '', company: p.company || '' });
      continue;
    }
    if (match) {
      const set = {};
      if (!match.name && p.name) set.name = p.name;
      if (!match.company && p.company) set.company = p.company;
      if (!match.phone && p.phone) set.phone = p.phone;
      if (!match.linkedin_slug && slug) set.linkedin_slug = slug;
      const addList = !!list && !(match.lists || []).includes(list);
      if (Object.keys(set).length || addList) { counts.contactsUpdated++; contactFills.set(match.id, { id: match.id, set, addList }); } else counts.unchanged++;
      continue;
    }
    counts.new++;
    const name = p.name || nameFromEmail(emails[0]) || '';
    // one row per address (how the store is built): the first carries the phone, the rest are the
    // same person's other addresses under the same name.
    newPeople.push({ name, email: emails[0] || '', phone: p.phone || '', company: p.company || '', linkedin: slug, otherEmails: emails.slice(1).filter((e) => !byEmail.has(e)) });
  }
  return { newPeople, contactFills: [...contactFills.values()], leadMatches: [...leadMatches.values()], counts, list };
}

/** Which of the matched leads have a BLANK field this file can fill. Reads the leads 40 at a time. */
async function leadFills(base, leadMatches) {
  const fills = [];
  for (let i = 0; i < leadMatches.length; i += 40) {
    const slice = leadMatches.slice(i, i + 40);
    const formula = `OR(${slice.map((m) => `RECORD_ID()='${String(m.leadRecordId).replace(/[^A-Za-z0-9]/g, '')}'`).join(',')})`;
    let recs = [];
    try {
      recs = await base('Leads').select({ fields: LEAD_FILLS.map(([f]) => f), filterByFormula: formula, pageSize: 100 }).all();
    } catch (e) {
      log.warn(`contacts import: leads not read (${e.message}) - those leads are left as they are`);
      continue;
    }
    const byId = new Map(recs.map((r) => [r.id, r.fields || {}]));
    for (const m of slice) {
      const f = byId.get(m.leadRecordId);
      if (!f) continue;
      const set = {};
      for (const [field, from] of LEAD_FILLS) if (!String(f[field] || '').trim() && String(m[from] || '').trim()) set[field] = m[from];
      if (Object.keys(set).length) fills.push({ id: m.leadRecordId, fields: set });
    }
  }
  return fills;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

/** The one line the page shows before Confirm, and after. */
function summaryLine(s) {
  const bits = [`${s.new} new`, `${s.updated} updated`];
  if (s.unchanged) bits.push(`${s.unchanged} already up to date`);
  if (s.skippedNoDetails) bits.push(`${s.skippedNoDetails} skipped (no email or phone)`);
  if (s.repeated) bits.push(`${s.repeated} repeated in the file`);
  return bits.join(', ');
}

/**
 * Preview (apply=false) or import (apply=true) one file.
 * Returns { ok, status, applied, summary: { inFile, new, updated, contactsUpdated, leadsUpdated,
 *           unchanged, skippedNoDetails, repeated, line }, list, format, error? }.
 */
async function importContacts(clientId, airtableBaseId, { text = '', filename = '', listName = '' } = {}, { apply = false, deps = {} } = {}) {
  const store = deps.store || require('./contactsStore');
  const clientService = deps.clientService || require('./clientService');
  const parsed = parseContactsFile(text, filename);
  if (parsed.problem) return { ok: false, status: 400, error: parsed.problem, format: parsed.format };

  const held = await store.listForImport(clientId);
  const plan = planImport(parsed.people, held, { listName, slugOf: store.slugOf });
  const base = airtableBaseId ? clientService.getClientBase(airtableBaseId) : null;
  const fills = base && plan.leadMatches.length ? await leadFills(base, plan.leadMatches) : [];
  const c = plan.counts;
  const summary = {
    inFile: c.inFile, new: c.new, contactsUpdated: c.contactsUpdated, leadsUpdated: fills.length,
    updated: c.contactsUpdated + fills.length,
    unchanged: c.unchanged + (c.leadsMatched - fills.length),
    skippedNoDetails: c.skippedNoDetails, repeated: c.repeated,
  };
  summary.line = summaryLine(summary);
  const out = { ok: true, status: 200, applied: false, summary, list: plan.list, format: parsed.format };
  if (!apply) return out;

  const w = await store.applyImport(clientId, { newPeople: plan.newPeople, contactFills: plan.contactFills, list: plan.list });
  if (!w.ok) return { ok: false, status: 500, error: w.error || 'The import could not be saved.', summary, format: parsed.format };
  // The leads' blanks are filled behind the answer: ten at a time is Airtable's limit, and a big
  // address book would otherwise keep the page waiting a minute. Only blank fields, one write each.
  if (fills.length) {
    (async () => {
      let done = 0;
      for (let i = 0; i < fills.length; i += 10) {
        try { await base('Leads').update(fills.slice(i, i + 10)); done += Math.min(10, fills.length - i); } catch (e) { log.warn(`contacts import: lead fill batch failed for ${clientId}: ${e.message}`); }
        await new Promise((r) => setTimeout(r, 220));
      }
      log.info(`contacts import: ${clientId} - filled blanks on ${done} of ${fills.length} lead(s)`);
    })().catch(() => {});
  }
  log.info(`contacts import: ${clientId} - ${summary.line}${plan.list ? ` (list "${plan.list}")` : ''} from a ${parsed.format} file`);
  return { ...out, applied: true, written: w };
}

module.exports = { importContacts, planImport, leadFills, summaryLine, nameFromEmail, plural, LEAD_FILLS };
