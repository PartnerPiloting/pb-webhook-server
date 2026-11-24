/**
 * "People you've met" - is this person ALREADY a lead? (Guy, 24 Nov 2026)
 *
 * WHY: the Add button on "People you've met who aren't in Wingguy yet" created a new lead with no
 * check at all, so a duplicate was one click away - most often a person who is already a lead under
 * a different address (the recorder saw their gmail, the lead holds their work email).
 *
 * The check, before anything is created:
 *   - their EMAIL is already on a lead (main address or any alternate)  -> kind 'email'.
 *     The same person for certain: nothing is created, the waiting transcripts attach to that lead.
 *   - only their FULL NAME matches a lead                               -> kind 'name'.
 *     NEVER merged and never blocked on a name (two people can share one - the standing rule since
 *     September). The client is shown the lead and chooses "Same person" or "Different person".
 *   - neither                                                           -> kind null, add as before.
 * (A person waiting from a recorded call has no LinkedIn address, so there is nothing to match there.)
 *
 * Read-only apart from attachToLead, which the client's own "Same person" click (or an email match)
 * triggers. A base that cannot be read answers kind null: the Add button must never stop working
 * because a check failed.
 */

const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'pending_people_match');

const FIELDS = ['First Name', 'Last Name', 'Company Name', 'Email'];
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const tidy = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();

/** What the page shows for a lead that may be the same person. */
function card(rec) {
  const f = (rec && rec.fields) || {};
  return {
    id: rec.id,
    name: tidy(`${f['First Name'] || ''} ${f['Last Name'] || ''}`) || tidy(f['Email']) || 'a lead',
    company: tidy(f['Company Name']),
    email: tidy(f['Email']),
  };
}

/**
 * "Jane Smith" -> { first: 'jane', last: 'smith' }, split the way the portal splits a name (the last
 * word is the surname). A single word, or no name at all, is not enough to call a name match.
 */
function nameKey(name) {
  const parts = tidy(name).toLowerCase().split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

async function leadsWithEmail(base, email) {
  const e = tidy(email).toLowerCase();
  if (!e) return [];
  const tries = [
    `OR(LOWER(TRIM({Email})) = "${esc(e)}", FIND("${esc(e)}", LOWER({Alt Emails} & "")) > 0)`,
    `LOWER(TRIM({Email})) = "${esc(e)}"`,
  ];
  for (const formula of tries) {
    try {
      return await base('Leads').select({ filterByFormula: formula, maxRecords: 3, fields: FIELDS }).firstPage();
    } catch (err) {
      if (!/UNKNOWN_FIELD_NAME|Unknown field/i.test(String(err.message || err.error || ''))) throw err;
    }
  }
  return [];
}

async function leadsWithName(base, name) {
  const k = nameKey(name);
  if (!k) return [];
  return base('Leads').select({
    filterByFormula: `AND(LOWER(TRIM({First Name})) = "${esc(k.first)}", LOWER(TRIM({Last Name})) = "${esc(k.last)}")`,
    maxRecords: 3,
    fields: FIELDS,
  }).firstPage();
}

/** { kind: 'email' | 'name' | null, leads: [{ id, name, company, email }] }. Never throws. */
async function findExistingLead(base, { email = '', name = '' } = {}) {
  try {
    const byEmail = await leadsWithEmail(base, email);
    if (byEmail.length) return { kind: 'email', leads: [card(byEmail[0])] };
    const byName = await leadsWithName(base, name);
    if (byName.length) return { kind: 'name', leads: byName.map(card) };
  } catch (e) {
    log.warn(`pending-people match: leads not read (${e.message}) - answering "no match" so Add still works`);
  }
  return { kind: null, leads: [] };
}

/**
 * The person waiting under `email` IS the lead `leadId`: keep the address on the lead as an alternate
 * (or the next recording of them parks again) and attach every transcript that was waiting.
 * Returns { ok, status, attachedMeetings, lead: { id, name }, error? }.
 */
async function attachToLead(clientId, airtableBaseId, { email = '', leadId = '' } = {}, { deps = {} } = {}) {
  const clientService = deps.clientService || require('./clientService');
  const wingguyLeads = deps.wingguyLeads || require('./wingguyLeads');
  const db = deps.db || require('./recallWebhookDb');
  const addr = tidy(email).toLowerCase();
  if (!addr || !/^rec[A-Za-z0-9]{14}$/.test(String(leadId || ''))) return { ok: false, status: 400, error: 'email and leadId are required' };
  const base = clientService.getClientBase(airtableBaseId);
  if (!base) return { ok: false, status: 500, error: 'Your leads database is unavailable.' };
  let rec;
  try {
    rec = await base('Leads').find(leadId);
  } catch (e) {
    return { ok: false, status: 404, error: 'That lead was not found.' };
  }
  const f = rec.fields || {};
  const held = [tidy(f['Email']).toLowerCase(), ...String(f['Alt Emails'] || '').toLowerCase().split(/[;,\n]+/).map((x) => x.trim())];
  if (!held.includes(addr)) {
    const r = await wingguyLeads.updateLeadEmails(airtableBaseId, leadId, { addOthers: [addr] }).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) log.warn(`pending-people attach: ${addr} not kept on ${leadId} for ${clientId}: ${(r && r.error) || 'unknown'} - attaching the transcripts anyway`);
  }
  const pr = await db.resolvePendingLeadByEmail({ email: addr, airtableLeadId: leadId, coachClientId: clientId, source: 'portal-same-person' });
  log.info(`pending-people attach: ${clientId} said ${addr} is lead ${leadId} - ${(pr.linked || []).length} transcript(s) attached`);
  return { ok: true, status: 200, attachedMeetings: (pr.linked || []).length, lead: { id: rec.id, name: card(rec).name } };
}

module.exports = { findExistingLead, attachToLead, nameKey, card };
