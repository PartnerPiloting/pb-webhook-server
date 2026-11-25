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
 *   - LISTS (25 Nov 2026): the lists a person is on come from the FILE - a Google export carries
 *     each contact's own labels - plus the name typed in the box, which applies to everyone in the
 *     file (for an event list with no labels). A list is only ever ADDED: someone on two lists keeps
 *     both. On a contact the lists show as where Wingguy knows them from; on a LEAD each list becomes
 *     a tag, through the one tag writer (services/wingguyLeadTags.js, 15-tag cap) - existing tags
 *     are never removed, and a tag the cap refuses is counted in the summary.
 *   - ONE ENTRY IN THE FILE = ONE PERSON: every address under one entry is tied together
 *     (person_ref), so the person shows once however many addresses they have.
 *   - Guy is emailed when a file is refused, mostly skipped, or fails on Confirm (never the client).
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
const TAG_FIELDS = ['Search Terms', 'Search Tokens (canonical)'];
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
  // the lists ONE person is on: their own labels from the file, plus the name typed for the whole file
  const listsOf = (p) => {
    const out = [];
    for (const l of [...(p.labels || []), list]) { const t = tidyList(l); if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t); }
    return out;
  };
  const listPeople = new Map();     // list name -> how many people in the file are on it
  const extraRows = [];             // a NEW address for someone already held
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
    const lists = listsOf(p);
    for (const l of lists) listPeople.set(l, (listPeople.get(l) || 0) + 1);

    if (match && match.lead_record_id) {
      counts.leadsMatched++;
      const had = leadMatches.get(match.lead_record_id);
      leadMatches.set(match.lead_record_id, { leadRecordId: match.lead_record_id, name: match.name || p.name || '', phone: p.phone || '', email: emails[0] || '', company: p.company || '', lists: [...new Set([...((had && had.lists) || []), ...lists])] });
      continue;
    }
    // ONE ENTRY = ONE PERSON: the file listed these addresses together, so their rows are tied.
    const others = emails.map((e) => byEmail.get(e)).filter((r) => r && !r.lead_record_id && (!match || r.id !== match.id));
    const several = emails.length > 1;
    const ref = several ? ((match && match.person_ref) || (others.find((r) => r.person_ref) || {}).person_ref || (match ? match.contact_key : emails[0])) : null;
    const personHas = (f) => [match, ...others].some((r) => r && r[f]);
    // a row this person already has: fill its blanks, add the lists, tie it in. Counted once per person.
    const fillRow = (row, { withPhone }) => {
      const set = {};
      if (!row.name && p.name) set.name = p.name;
      if (!row.company && p.company) set.company = p.company;
      // phone and LinkedIn belong to the person: once ANY of their rows has one, it is not written again
      if (withPhone && !personHas('phone') && p.phone) set.phone = p.phone;
      if (withPhone && !personHas('linkedin_slug') && slug) set.linkedin_slug = slug;
      const addLists = lists.filter((l) => !(row.lists || []).some((x) => String(x).toLowerCase() === l.toLowerCase()));
      const tie = !!ref && !row.person_ref;
      const real = Object.keys(set).length > 0 || addLists.length > 0;
      if (real || tie) contactFills.set(row.id, { id: row.id, set, addLists, ref });
      return real;
    };
    if (match) {
      let changed = fillRow(match, { withPhone: true });
      for (const o of others) changed = fillRow(o, { withPhone: false }) || changed;
      // an address the file has for them that Wingguy has never seen: a new row for the same person
      const fresh = emails.filter((e) => !byEmail.has(e));
      for (const e of fresh) extraRows.push({ email: e, name: match.name || p.name || '', company: match.company || p.company || '', lists, ref });
      if (changed || fresh.length) counts.contactsUpdated++; else counts.unchanged++;
      continue;
    }
    counts.new++;
    const name = p.name || nameFromEmail(emails[0]) || '';
    // one row per address (how the store is built): the first carries the phone, the rest are the
    // same person's other addresses under the same name.
    newPeople.push({ name, email: emails[0] || '', phone: p.phone || '', company: p.company || '', linkedin: slug, otherEmails: emails.slice(1).filter((e) => !byEmail.has(e)), lists, ref });
    for (const o of others) fillRow(o, { withPhone: false });
  }
  const listsFound = [...listPeople.entries()].map(([name, n]) => ({ name, people: n })).sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
  return { newPeople, extraRows, contactFills: [...contactFills.values()], leadMatches: [...leadMatches.values()], counts, list, listsFound };
}

/**
 * Which of the matched leads have a BLANK field this file can fill, and which lists are not yet tags
 * on them. Reads the leads 40 at a time. Returns the fills array (as before) carrying two extras:
 *   fills.tagAdds  [{ id, add: [list names not yet on the lead] }]
 *   fills.capped   how many list tags the 15-tag cap would refuse
 * The tag question is answered with the tag writer's own merge, so the preview and the write agree.
 */
async function leadFills(base, leadMatches) {
  const fills = [];
  fills.tagAdds = [];
  fills.capped = 0;
  const { mergeTags } = require('./wingguyLeadTags');
  const wantsTags = leadMatches.some((m) => (m.lists || []).length);
  for (let i = 0; i < leadMatches.length; i += 40) {
    const slice = leadMatches.slice(i, i + 40);
    const formula = `OR(${slice.map((m) => `RECORD_ID()='${String(m.leadRecordId).replace(/[^A-Za-z0-9]/g, '')}'`).join(',')})`;
    let recs = [];
    let tagsRead = wantsTags;
    try {
      try {
        recs = await base('Leads').select({ fields: [...LEAD_FILLS.map(([f]) => f), ...(wantsTags ? TAG_FIELDS : [])], filterByFormula: formula, pageSize: 100 }).all();
      } catch (e) {
        // an older base may not have both tag fields: read without them, and leave the tags to the writer
        if (!wantsTags || !/UNKNOWN_FIELD_NAME|Unknown field/i.test(String(e.message || e.error || ''))) throw e;
        tagsRead = false;
        recs = await base('Leads').select({ fields: LEAD_FILLS.map(([f]) => f), filterByFormula: formula, pageSize: 100 }).all();
      }
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
      if ((m.lists || []).length) {
        const merged = tagsRead ? mergeTags({ displayRaw: f['Search Terms'] || '', canonicalRaw: f['Search Tokens (canonical)'] || '', add: m.lists }) : { added: m.lists, overflow: [] };
        fills.capped += merged.overflow.length;
        if (merged.added.length) fills.tagAdds.push({ id: m.leadRecordId, add: m.lists });
      }
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

/** "2 lists found in the file: CC Results Group (13 people), Evercontact (40 people)" - '' when none. */
function listsLine(lists) {
  if (!lists || !lists.length) return '';
  const shown = lists.slice(0, 12).map((l) => `${l.name} (${plural(l.people, 'person', 'people')})`).join(', ');
  return `${plural(lists.length, 'list')} found: ${shown}${lists.length > 12 ? `, and ${lists.length - 12} more` : ''}`;
}

// ---------------------------------------------------------------- tell Guy when an import goes wrong
//
// Outlook and phone files have only ever been tested with files written for the tests, so the first
// real one that fails must not fail silently (Guy, 25 Nov 2026). One plain email to Guy per failed
// attempt - never the client: which client, the file type detected, the counts, the reason.
// "Check the file" and "Import" send the same file twice, so the same client + file + reason is
// only reported once in six hours.
const ALERT_EVERY_MS = 6 * 60 * 60 * 1000;
const alerted = new Map();
const fileMark = (text) => require('crypto').createHash('sha1').update(String(text || '')).digest('hex').slice(0, 16);
const escHtml = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function tellGuy(clientId, kind, { text = '', filename = '', format = '', summary = null, reason = '', step = '' } = {}, deps = {}) {
  try {
    const now = (deps.now || Date.now)();
    const key = `${clientId}|${kind}|${fileMark(text)}`;
    for (const [k, at] of alerted) if (now - at > ALERT_EVERY_MS) alerted.delete(k);
    if (alerted.has(key)) return false;
    alerted.set(key, now);
    const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
    const what = { refused: 'file refused', 'mostly-skipped': 'more than half the file skipped', error: 'import failed on Confirm' }[kind] || kind;
    const counts = summary ? `${summary.inFile} in the file: ${summary.line}` : 'none - the file was not read';
    const lines = [
      ['Client', clientId], ['What happened', what], ['When', step === 'confirm' ? 'on Import (Confirm)' : 'on Check the file'],
      ['File', filename || '(no name)'], ['File type detected', format || 'unknown'],
      ['Size', `${String(text || '').length} characters`], ['Counts', counts], ['Reason', reason || '(none given)'],
    ];
    await send(`Contacts import - ${what} (${clientId})`,
      `<p>A contacts import did not go cleanly. Nothing was sent to the client.</p><table>${lines.map(([a, b]) => `<tr><td><b>${escHtml(a)}</b></td><td>${escHtml(b)}</td></tr>`).join('')}</table>`);
    return true;
  } catch (e) {
    log.warn(`contacts import: the alert email was not sent (${e.message})`);
    return false;
  }
}

/**
 * Preview (apply=false) or import (apply=true) one file.
 * Returns { ok, status, applied, summary: { inFile, new, updated, contactsUpdated, leadsUpdated,
 *           unchanged, skippedNoDetails, repeated, line }, list, format, error? }.
 */
async function importContacts(clientId, airtableBaseId, { text = '', filename = '', listName = '' } = {}, { apply = false, deps = {} } = {}) {
  const store = deps.store || require('./contactsStore');
  const clientService = deps.clientService || require('./clientService');
  const step = apply ? 'confirm' : 'check';
  let parsed = { format: 'unknown' };
  let summary = null;
  try {
    parsed = parseContactsFile(text, filename);
    if (parsed.problem) {
      await tellGuy(clientId, 'refused', { text, filename, format: parsed.format, reason: parsed.problem, step }, deps);
      return { ok: false, status: 400, error: parsed.problem, format: parsed.format };
    }

    const held = await store.listForImport(clientId);
    const plan = planImport(parsed.people, held, { listName, slugOf: store.slugOf });
    const base = airtableBaseId ? clientService.getClientBase(airtableBaseId) : null;
    const fills = base && plan.leadMatches.length ? await leadFills(base, plan.leadMatches) : [];
    const tagAdds = fills.tagAdds || [];
    // a lead counts once as "updated", whether a blank was filled, a list tag added, or both
    const leadsTouched = new Set([...fills.map((f) => f.id), ...tagAdds.map((t) => t.id)]).size;
    const c = plan.counts;
    summary = {
      inFile: c.inFile, new: c.new, contactsUpdated: c.contactsUpdated, leadsUpdated: leadsTouched,
      updated: c.contactsUpdated + leadsTouched,
      unchanged: c.unchanged + (c.leadsMatched - leadsTouched),
      skippedNoDetails: c.skippedNoDetails, repeated: c.repeated,
      lists: plan.listsFound, leadsTagged: tagAdds.length, tagsCapped: fills.capped || 0,
    };
    summary.line = summaryLine(summary);
    summary.listsLine = listsLine(plan.listsFound);
    if (c.inFile >= 2 && c.skippedNoDetails > c.inFile / 2) {
      await tellGuy(clientId, 'mostly-skipped', { text, filename, format: parsed.format, summary, reason: `${c.skippedNoDetails} of ${c.inFile} people had no email and no phone number that could be read - the columns may not have been recognised.`, step }, deps);
    }
    const out = { ok: true, status: 200, applied: false, summary, list: plan.list, format: parsed.format };
    if (!apply) return out;

    const w = await store.applyImport(clientId, { newPeople: plan.newPeople, extraRows: plan.extraRows, contactFills: plan.contactFills });
    if (!w.ok) {
      await tellGuy(clientId, 'error', { text, filename, format: parsed.format, summary, reason: w.error || 'The import could not be saved.', step }, deps);
      return { ok: false, status: 500, error: w.error || 'The import could not be saved.', summary, format: parsed.format };
    }
    // The leads' blanks are filled, and their list tags added, behind the answer: ten at a time is
    // Airtable's limit, and a big address book would otherwise keep the page waiting minutes. Only
    // blank fields; tags go through the one tag writer, which never removes one and enforces the cap.
    if (fills.length || tagAdds.length) {
      const work = (async () => {
        let done = 0;
        for (let i = 0; i < fills.length; i += 10) {
          try { await base('Leads').update(fills.slice(i, i + 10)); done += Math.min(10, fills.length - i); } catch (e) { log.warn(`contacts import: lead fill batch failed for ${clientId}: ${e.message}`); }
          await new Promise((r) => setTimeout(r, deps.pauseMs === undefined ? 220 : deps.pauseMs));
        }
        if (fills.length) log.info(`contacts import: ${clientId} - filled blanks on ${done} of ${fills.length} lead(s)`);
        const leadTags = deps.leadTags || require('./wingguyLeadTags');
        let tagged = 0; let refused = 0;
        for (const t of tagAdds) {
          try {
            const r = await leadTags.updateLeadTags(base, t.id, { add: t.add });
            if (r && r.ok && r.changed) tagged++;
            refused += ((r && r.overflow) || []).length;
          } catch (e) { log.warn(`contacts import: list tags not written on ${t.id} for ${clientId}: ${e.message}`); }
          await new Promise((r) => setTimeout(r, deps.pauseMs === undefined ? 450 : deps.pauseMs));
        }
        if (tagAdds.length) log.info(`contacts import: ${clientId} - list tags added on ${tagged} of ${tagAdds.length} lead(s)${refused ? `, ${refused} refused by the 15-tag cap` : ''}`);
      })().catch(() => {});
      if (deps.waitForLeads) await work;
    }
    log.info(`contacts import: ${clientId} - ${summary.line}${summary.listsLine ? ` (${summary.listsLine})` : ''} from a ${parsed.format} file`);
    return { ...out, applied: true, written: w };
  } catch (e) {
    log.warn(`contacts import: ${clientId} failed on ${step}: ${e.message}`);
    await tellGuy(clientId, 'error', { text, filename, format: parsed.format, summary, reason: e.message, step }, deps);
    return { ok: false, status: 500, error: 'The import did not work. Nothing was saved - Guy has been told.', format: parsed.format };
  }
}

module.exports = { importContacts, planImport, leadFills, summaryLine, listsLine, tellGuy, nameFromEmail, plural, LEAD_FILLS };
