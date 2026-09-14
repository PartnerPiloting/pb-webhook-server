/**
 * Contacts sweep - the FEEDS into the contacts warehouse (services/contactsStore.js).
 *
 * Step 1 (2026-09-13): two feeds, both things we already hold -
 *   'lead'      every record in the tenant's Leads base: primary {Email} (and each {Alt Emails}
 *               address as 'lead-alt'), name, company, headline, location, LinkedIn slug, the
 *               record id. A lead with no address still lands (keyed lead:<id>) so the lookup
 *               can say "in your leads, no email on file" instead of "unknown".
 *   'comms-log' everyone wingguy_comms_log has written to for this tenant (recipient), plus the
 *               people named inside a digest (meta.people) - the coach's own address skipped.
 * Later steps add the mailbox (everyone the coach has emailed) and a coach's own address book
 * via the ingest door - same table, same shape.
 *
 * INCREMENTAL BY DEFAULT: the first sweep of a tenant reads the whole base; every later one
 * asks Airtable only for rows modified since the last run (LAST_MODIFIED_TIME() formula, with
 * a day of slack). Pass { full: true } to force a full read.
 *
 * TENANCY: a sweep runs for ONE coach object at a time and writes under that coach's clientId.
 * sweepAll walks getAllClients() and skips anything without a leads base. No env defaults.
 */

const contactsStore = require('./contactsStore');
const { canonicalLinkedinSlug } = require('../utils/linkedinCanonical');

// Richest-first field ladders: engine fields roll out per base over time, and a base that
// predates one 422s on the unknown name - same degrade trick as the mail/dossier readers.
const LEAD_FIELDS_FULL = ['First Name', 'Last Name', 'Email', 'Alt Emails', 'Phone', 'Company Name', 'Headline', 'Location', 'LinkedIn Profile URL', 'Date Connected'];
const LEAD_FIELDS_CORE = ['First Name', 'Last Name', 'Email', 'Phone', 'LinkedIn Profile URL'];

function splitAltEmails(v) {
  return String(v || '').toLowerCase().split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
}

function fmtDay(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Brisbane' });
}

/** One Airtable lead record -> the contact rows it vouches for (primary + each alt). Pure. */
function leadToContacts(rec) {
  const f = (rec && rec.fields) || {};
  const first = String(f['First Name'] || '').trim();
  const last = String(f['Last Name'] || '').trim();
  const connected = f['Date Connected'] ? new Date(f['Date Connected']) : null;
  const connectedOk = connected && !Number.isNaN(connected.getTime()) ? connected : null;
  const shared = {
    first_name: first,
    last_name: last,
    company: f['Company Name'] || '',
    headline: f['Headline'] || '',
    location: f['Location'] || '',
    phone: f['Phone'] || '',
    linkedin_slug: canonicalLinkedinSlug(f['LinkedIn Profile URL'] || ''),
    lead_record_id: rec.id,
    last_seen_at: connectedOk,
    // The source label already says "lead record"; evidence carries only the date.
    evidence: connectedOk ? `connected ${fmtDay(connectedOk)}` : '',
  };
  const primary = contactsStore.cleanEmail(f['Email']);
  const out = [{ ...shared, email: primary, source: 'lead' }];
  for (const alt of splitAltEmails(f['Alt Emails'])) {
    const e = contactsStore.cleanEmail(alt);
    if (e && e !== primary) out.push({ ...shared, email: e, source: 'lead-alt' });
  }
  return out;
}

async function selectLeads(base, { since = null } = {}) {
  const sinceIso = since ? new Date(since).toISOString() : '';
  const opts = { pageSize: 100 };
  if (sinceIso) opts.filterByFormula = `IS_AFTER(LAST_MODIFIED_TIME(), '${sinceIso}')`;
  for (const fields of [LEAD_FIELDS_FULL, LEAD_FIELDS_CORE]) {
    try {
      return await base('Leads').select({ ...opts, fields }).all();
    } catch (e) {
      const unknownField = /UNKNOWN_FIELD_NAME|422|INVALID|Unknown field/i.test(e.message);
      if (!unknownField || fields === LEAD_FIELDS_CORE) throw e;
    }
  }
  return [];
}

/** Feed 1: the tenant's leads base. */
async function sweepLeads(coach, { full = false, clientService } = {}) {
  const cs = clientService || require('./clientService');
  const tenant = coach && coach.clientId;
  if (!tenant) return { ok: false, error: 'coach.clientId required' };
  if (!coach.airtableBaseId) return { ok: false, skipped: 'no leads base' };
  const base = cs.getClientBase(coach.airtableBaseId);
  if (!base) return { ok: false, error: 'leads base unavailable' };

  const startedAt = new Date();
  let since = null;
  if (!full) {
    const last = await contactsStore.lastSweepAt(tenant, 'lead');
    if (last) since = new Date(last.getTime() - 24 * 3600 * 1000);
  }
  const records = await selectLeads(base, { since });
  const contacts = [];
  for (const rec of records) contacts.push(...leadToContacts(rec));
  const w = await contactsStore.upsertContacts(tenant, contacts);
  if (!w.ok) return { ok: false, error: w.error, leads: records.length };
  await contactsStore.recordSweep(tenant, 'lead', { rowsSeen: records.length, at: startedAt, note: since ? `incremental since ${since.toISOString()}` : 'full' });
  return { ok: true, leads: records.length, contacts: contacts.length, mode: since ? 'incremental' : 'full' };
}

/** Feed 2: the comms log - who Wingguy has written to on this tenant's behalf. */
async function sweepCommsLog(coach, { full = false } = {}) {
  const tenant = coach && coach.clientId;
  if (!tenant) return { ok: false, error: 'coach.clientId required' };
  const { getPool } = require('./recallWebhookDb');
  const p = getPool();
  if (!p) return { ok: false, error: 'no database' };
  const startedAt = new Date();
  let since = null;
  if (!full) {
    const last = await contactsStore.lastSweepAt(tenant, 'comms-log');
    if (last) since = new Date(last.getTime() - 24 * 3600 * 1000);
  }
  const self = contactsStore.cleanEmail(coach.clientEmailAddress);
  const client = await p.connect();
  let rows;
  try {
    const r = await client.query(
      `SELECT channel, recipient, meta, sent_at FROM wingguy_comms_log
        WHERE coach_client_id = $1 ${since ? 'AND sent_at > $2' : ''} ORDER BY sent_at ASC`,
      since ? [tenant, since] : [tenant],
    );
    rows = r.rows;
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
  const contacts = [];
  for (const row of rows) {
    const when = row.sent_at ? new Date(row.sent_at) : null;
    const to = contactsStore.cleanEmail(row.recipient);
    if (to && to !== self) {
      contacts.push({ email: to, source: 'comms-log', last_seen_at: when, evidence: `Wingguy emailed ${fmtDay(when)} (${row.channel})` });
    }
    const people = row.meta && Array.isArray(row.meta.people) ? row.meta.people : [];
    for (const person of people) {
      const e = contactsStore.cleanEmail(person && person.email);
      if (!e || e === self) continue;
      contacts.push({ email: e, name: person.name || '', source: 'comms-log-people', last_seen_at: when, evidence: `named in a Wingguy ${row.channel} ${fmtDay(when)}` });
    }
  }
  const w = await contactsStore.upsertContacts(tenant, contacts);
  if (!w.ok) return { ok: false, error: w.error, rows: rows.length };
  await contactsStore.recordSweep(tenant, 'comms-log', { rowsSeen: rows.length, at: startedAt, note: since ? `incremental since ${since.toISOString()}` : 'full' });
  return { ok: true, rows: rows.length, contacts: contacts.length, mode: since ? 'incremental' : 'full' };
}

/** Both feeds for one coach. Never throws - each feed reports its own result. */
async function sweepTenant(coach, opts = {}) {
  const out = { clientId: coach && coach.clientId };
  try { out.leads = await sweepLeads(coach, opts); } catch (e) { out.leads = { ok: false, error: e.message }; }
  try { out.commsLog = await sweepCommsLog(coach, opts); } catch (e) { out.commsLog = { ok: false, error: e.message }; }
  return out;
}

/** Every active client with a leads base - or just the ones named in `onlyClientIds`. */
async function sweepAll({ full = false, onlyClientIds = null, clientService } = {}) {
  const cs = clientService || require('./clientService');
  const clients = await cs.getAllClients();
  const want = onlyClientIds && onlyClientIds.length ? new Set(onlyClientIds) : null;
  const results = [];
  for (const coach of clients) {
    if (want && !want.has(coach.clientId)) continue;
    if (!want && String(coach.status || '').toLowerCase() !== 'active') continue;
    if (!coach.airtableBaseId) continue;
    results.push(await sweepTenant(coach, { full, clientService: cs }));
  }
  return results;
}

module.exports = { sweepLeads, sweepCommsLog, sweepTenant, sweepAll, leadToContacts, splitAltEmails, fmtDay };
