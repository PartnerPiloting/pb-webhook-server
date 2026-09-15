/**
 * Contacts sweep - the FEEDS into the contacts warehouse (services/contactsStore.js).
 *
 * Three feeds -
 *   'lead'      every record in the tenant's Leads base: primary {Email} (and each {Alt Emails}
 *               address as 'lead-alt'), name, company, headline, location, LinkedIn slug, the
 *               record id. A lead with no address still lands (keyed lead:<id>) so the lookup
 *               can say "in your leads, no email on file" instead of "unknown".
 *   'comms-log' everyone wingguy_comms_log has written to for this tenant (recipient), plus the
 *               people named inside a digest (meta.people) - the coach's own address skipped.
 *   'mail-*'    (step 2, 2026-09-15) everyone the coach has actually corresponded with, read
 *               through mailProvider so Nylas, Unipile and Zoho-over-IMAP all work unchanged.
 *               Tagged by direction: 'mail-to' the coach wrote to them, 'mail-from' they wrote
 *               to the coach, 'mail-thread' they merely shared a thread. THIS is the feed that
 *               matters to clients - their leads bases are LinkedIn connections that rarely
 *               carry an address, while their mail is full of people they genuinely deal with.
 * A coach's own address book arrives separately through the ingest door - same table, same shape.
 *
 * INCREMENTAL BY DEFAULT: the first sweep of a tenant reads the whole base (and a year of mail);
 * every later one asks only for what changed since the last run - Airtable via
 * LAST_MODIFIED_TIME(), the mailbox via its `after` cursor - with a day of slack either way.
 * Pass { full: true } to force a full read.
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

// Feed 3 knobs. The mailbox is the only feed that talks to a third party per tenant, so it is
// the only one that can hang: Ashley's and Roland's Outlook accounts 504 after 180s during the
// Unipile outage (project_unipile_outlook_email_outage_20260910). One slow tenant must never
// cost the other fourteen their nightly sweep, hence the hard per-tenant timeout.
const MAIL_TIMEOUT_MS = 120000;         // a nightly incremental read is one day of mail
const MAIL_BACKFILL_TIMEOUT_MS = 600000; // a first run reads a year and is minutes, not seconds
const MAIL_FIRST_RUN_DAYS = 365;
const MAIL_MAX_MESSAGES = 3000;

/**
 * How long to let a mailbox read run. Pulled out so the decision can be tested in milliseconds
 * instead of by waiting for the real fuse to burn.
 *   first read of a year of mail  -> ten minutes, or it gets killed and thrown away
 *   already failed, never worked  -> the nightly bound, so it fails fast forever after
 *   nightly incremental           -> the nightly bound, which is all a day of mail needs
 */
function mailTimeoutFor({ backfill = false, full = false, triedAndFailed = false, override } = {}) {
  if (override) return override;
  return (backfill || full) && !triedAndFailed ? MAIL_BACKFILL_TIMEOUT_MS : MAIL_TIMEOUT_MS;
}

/** Reject after ms rather than letting a stuck provider hold the whole sweep. */
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/** A readable name for someone we only have an address for: bob.carter@x -> Bob Carter. */
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  if (!local || local.length < 2) return '';
  const parts = local.split(/[._-]+/).filter((p) => p.length > 1 && !/^\d+$/.test(p));
  if (parts.length < 2) return '';            // a single token is a handle, not a name
  if (parts.length > 3) return '';            // long machine-ish locals are not names
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

/**
 * One message -> the contacts it vouches for. Pure, so the direction logic is testable.
 *
 * Direction is the useful part: an address the coach WROTE to is a person they chose to contact
 * ('mail-to'); an address that wrote to THEM is weaker but still real ('mail-from'). Someone who
 * appears both ways collects both source tags, because sources union on merge.
 *
 * `isSelf` decides which side of that line the coach sits on - it must recognise every address
 * the coach sends from, not just their record's one, or outbound mail reads as inbound.
 */
function messageToContacts(msg, { isSelf, isJunk } = {}) {
  const parties = Array.isArray(msg && msg.parties) ? msg.parties : [];
  if (!parties.length) return [];
  const when = msg.date ? new Date(msg.date) : null;
  const whenOk = when && !Number.isNaN(when.getTime()) ? when : null;
  const fromEmail = String(msg.fromEmail || '').toLowerCase();
  const outbound = !!fromEmail && isSelf(fromEmail);
  const out = [];
  for (const p of parties) {
    const email = String(p.email || '').toLowerCase();
    if (!email || isSelf(email)) continue;
    if (isJunk && isJunk(email)) continue;
    // On a message the coach sent, everyone else is someone they wrote to. On one they received,
    // the sender wrote to them and the other recipients merely shared the thread.
    out.push({
      email,
      name: p.name || nameFromEmail(email),
      source: outbound ? 'mail-to' : (p.role === 'from' ? 'mail-from' : 'mail-thread'),
      last_seen_at: whenOk,
      evidence: whenOk
        ? (outbound ? `you emailed them ${fmtDay(whenOk)}` : (p.role === 'from' ? `they emailed you ${fmtDay(whenOk)}` : `on a thread with you ${fmtDay(whenOk)}`))
        : '',
    });
  }
  return out;
}

/**
 * Feed 3: the mailbox - everyone this coach has actually corresponded with.
 *
 * This is the feed that matters most to clients: their leads bases are LinkedIn connections and
 * rarely carry an address (Dean 636 of 6,107; Julian 27 of 626), while their mail is full of
 * people they genuinely deal with. Reads through mailProvider, so Nylas, Unipile and Julian's
 * Zoho-over-IMAP all work without a word of provider code here.
 */
async function sweepMailbox(coach, { full = false, firstRunDays = MAIL_FIRST_RUN_DAYS, maxMessages = MAIL_MAX_MESSAGES, timeoutMs, mailProvider } = {}) {
  const mp = mailProvider || require('./mailProvider');
  const tenant = coach && coach.clientId;
  if (!tenant) return { ok: false, error: 'coach.clientId required' };
  // The ONE mailbox gate (see project_wingguy_unipile_migration) - never the raw provider field.
  if (!mp.hasMailbox(coach)) return { ok: false, skipped: 'no mailbox connected' };

  const startedAt = new Date();
  const state = await contactsStore.sweepState(tenant, 'mail');
  let since = null;
  if (!full && state.lastRunAt) since = new Date(state.lastRunAt.getTime() - 24 * 3600 * 1000);
  // No prior success (or a forced full) means a BACKFILL: a year of mail, not a day of it.
  const backfill = !since;
  if (!since) since = new Date(Date.now() - firstRunDays * 24 * 3600 * 1000);
  const afterEpochSeconds = Math.floor(since.getTime() / 1000);
  // Measured on Guy's mailbox: ~12 messages a second, so 3,000 is roughly four minutes. The
  // nightly timeout would kill that and throw the whole backfill away - every message read,
  // nothing filed. A backfill therefore gets ten minutes.
  //
  // BUT only its FIRST attempt. Julian's Zoho-over-IMAP cannot read a year of history at all,
  // and without this his feed would spend ten minutes failing every single night, turning a
  // seconds-long sweep into a ten-minute one forever. Once a failure is on the record with no
  // success behind it, later attempts fail fast on the nightly bound - still tried, still
  // recorded, still reported by the staleness alert, just not at the cost of everyone's sweep.
  const triedAndFailed = !!state.lastErrorAt && !state.lastRunAt;
  const limitMs = mailTimeoutFor({ backfill, full, triedAndFailed, override: timeoutMs });

  let r;
  try {
    r = await withTimeout(mp.listRecent(coach, { after: afterEpochSeconds, max: maxMessages }), limitMs, `${tenant} mailbox read`);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'mailbox read failed' };

  const { isJunkPendingEmail } = require('./pendingLeadFilter');
  // Every address that IS the coach: their record's address, plus whatever their own mailbox
  // sends as. Without the second, their own outbound mail would file them as a contact.
  const selfSet = new Set([
    contactsStore.cleanEmail(coach.clientEmailAddress),
    contactsStore.cleanEmail(coach.googleCalendarEmail),
    contactsStore.cleanEmail(coach.calendarEmail),
  ].filter(Boolean));
  const isSelf = (e) => selfSet.has(String(e || '').toLowerCase());
  // Role mailboxes, the operator's address and the coach's own company domain, exactly as the
  // pending-people list already judges them - one junk rule for the whole product.
  const isJunk = (e) => isJunkPendingEmail(e, coach);

  const contacts = [];
  for (const msg of (r.messages || [])) contacts.push(...messageToContacts(msg, { isSelf, isJunk }));

  const w = await contactsStore.upsertContacts(tenant, contacts);
  if (!w.ok) return { ok: false, error: w.error, messages: (r.messages || []).length };
  // A partial read still stamps the sweep: the window it DID cover is now in the warehouse, and
  // the next run's day of slack re-reads the overlap anyway.
  await contactsStore.recordSweep(tenant, 'mail', {
    rowsSeen: (r.messages || []).length,
    at: startedAt,
    note: `${backfill || full ? 'backfill' : 'incremental'} since ${since.toISOString().slice(0, 10)}${r.truncated ? ' (truncated)' : ''}${r.partialError ? ` (partial: ${String(r.partialError).slice(0, 80)})` : ''}`,
  });
  return {
    ok: true,
    messages: (r.messages || []).length,
    contacts: contacts.length,
    mode: backfill || full ? 'backfill' : 'incremental',
    truncated: !!r.truncated,
    ...(r.partialError ? { partialError: String(r.partialError).slice(0, 120) } : {}),
  };
}

/**
 * Every feed for one coach. Never throws - each feed reports its own result, and a genuine
 * failure (not a skip) is written to the sweeps row so the staleness alert can tell a broken
 * feed from one that simply has not been invented yet. Bookkeeping is best-effort.
 */
async function sweepTenant(coach, opts = {}) {
  const tenant = coach && coach.clientId;
  const out = { clientId: tenant };
  const note = async (source, r) => {
    if (!tenant || !r || r.ok !== false || r.skipped) return;
    try {
      const w = await contactsStore.recordSweepFailure(tenant, source, r.error);
      // Say so loudly if the bookkeeping itself fails: a swallowed failure record is how a
      // broken feed becomes invisible, which is the whole thing the alert exists to prevent.
      if (!w || !w.ok) console.warn(`[contactsSweep] could not record ${tenant}/${source} failure: ${(w && w.error) || 'unknown'}`);
    } catch (e) {
      console.warn(`[contactsSweep] could not record ${tenant}/${source} failure: ${e.message}`);
    }
  };
  try { out.leads = await sweepLeads(coach, opts); } catch (e) { out.leads = { ok: false, error: e.message }; }
  await note('lead', out.leads);
  try { out.commsLog = await sweepCommsLog(coach, opts); } catch (e) { out.commsLog = { ok: false, error: e.message }; }
  await note('comms-log', out.commsLog);
  if (opts.skipMail !== true) {
    try { out.mail = await sweepMailbox(coach, opts); } catch (e) { out.mail = { ok: false, error: e.message }; }
    await note('mail', out.mail);
  }
  return out;
}

/** Every active client with a leads base - or just the ones named in `onlyClientIds`. */
async function sweepAll({ full = false, onlyClientIds = null, clientService, skipMail = false } = {}) {
  const cs = clientService || require('./clientService');
  const mp = require('./mailProvider');
  const clients = await cs.getAllClients();
  const want = onlyClientIds && onlyClientIds.length ? new Set(onlyClientIds) : null;
  const results = [];
  for (const coach of clients) {
    if (want && !want.has(coach.clientId)) continue;
    if (!want && String(coach.status || '').toLowerCase() !== 'active') continue;
    // A leads base OR a mailbox is enough to be worth sweeping - a coach on the connector with
    // no CRM still has an address book in their mail.
    if (!coach.airtableBaseId && !mp.hasMailbox(coach)) continue;
    results.push(await sweepTenant(coach, { full, clientService: cs, skipMail }));
  }
  return results;
}

module.exports = {
  sweepLeads, sweepCommsLog, sweepMailbox, sweepTenant, sweepAll,
  leadToContacts, messageToContacts, nameFromEmail, splitAltEmails, fmtDay, withTimeout, mailTimeoutFor,
};
