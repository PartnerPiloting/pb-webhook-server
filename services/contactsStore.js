/**
 * Wingguy contacts store - the WAREHOUSE behind "who is Bob, what's their email?" (decided with
 * Guy 2026-09-12; memory project_wingguy_contacts_lookup).
 *
 * WHY: the assistant had no single place to ask. A name meant guessing between the leads base,
 * a client's leads base, the comms log and the mailbox, one search at a time, often wrong. This
 * table is one row per person per tenant, fed by every source we already hold (leads, comms
 * log, later the mailbox and a coach's own address book), so the lookup is ONE indexed query.
 *
 * Shape, per tenant (coach_client_id):
 *   contact_key   the dedup key - the lowercased email, or `lead:<recId>` for a lead with no
 *                 address yet (still worth answering "they're in your leads, no email on file")
 *   sources       every feed that vouched for this person ('lead', 'lead-alt', 'comms-log',
 *                 'ingest:<slug>' ...) - unioned on merge, never overwritten
 *   last_seen_at  the most recent evidence (a send, a connection date); evidence = its one-line
 *                 human reading ("Wingguy emailed 3 Sep")
 * Merges keep whatever was already known: a blank never clobbers a value, a newer evidence line
 * replaces an older one, sources union.
 *
 * TENANCY: every write carries coach_client_id and every read filters on it - the one thing
 * that must not go wrong here is one coach's address book answering another's lookup. There is
 * no fallback tenant and no env default; a missing id is a refused call, not Guy's data.
 *
 * Reuses the recall store's pool (same as commsLog) - no new connection config. Never throws to
 * a caller on a store hiccup: reads return [] / writes return {ok:false}.
 */

const { getPool } = require('./recallWebhookDb');

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let ensured = false;
async function ensureTable(client) {
  if (ensured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_contacts (
      id BIGSERIAL PRIMARY KEY,
      coach_client_id TEXT NOT NULL,
      contact_key TEXT NOT NULL,
      email TEXT,
      name TEXT,
      first_name TEXT,
      last_name TEXT,
      company TEXT,
      headline TEXT,
      location TEXT,
      phone TEXT,
      linkedin_slug TEXT,
      lead_record_id TEXT,
      sources TEXT[] NOT NULL DEFAULT '{}',
      last_seen_at TIMESTAMPTZ,
      evidence TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (coach_client_id, contact_key)
    );
  `);
  // Columns added after the table first shipped. CREATE TABLE IF NOT EXISTS does NOT add a
  // column to a table that already exists (the warehouse was live from 2026-09-13), so every
  // later column needs its own idempotent ALTER here.
  await client.query(`ALTER TABLE wingguy_contacts ADD COLUMN IF NOT EXISTS phone TEXT;`);
  // manual (2026-11-24): the client added or edited this person BY HAND (the portal's contact form,
  // the details card's Edit, or "save X to my contacts" in Claude). What a person typed outranks
  // what a feed scraped, so the nightly sweep may only FILL BLANKS on such a row - see MANUAL_GUARD.
  await client.query(`ALTER TABLE wingguy_contacts ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT false;`);
  // lists (2026-11-24): the names of the uploaded lists this person came in on ("Safe to Say") - shown
  // as where Wingguy knows them from. Its own column, so no feed's upsert can ever drop it.
  await client.query(`ALTER TABLE wingguy_contacts ADD COLUMN IF NOT EXISTS lists TEXT[] NOT NULL DEFAULT '{}';`);
  // person_ref (2026-11-25): rows that an uploaded file listed under ONE entry carry the same value,
  // so a person with three addresses is shown once (services/contactGrouping.js). It records what a
  // file said - never a guess - and no feed's upsert touches it.
  await client.query(`ALTER TABLE wingguy_contacts ADD COLUMN IF NOT EXISTS person_ref TEXT;`);
  // linkedin_connected_at (2026-11-25): the day they connected on LinkedIn, for a person who is one
  // of the client's LinkedIn connections (source 'linkedin' - see syncLinkedinConnections).
  await client.query(`ALTER TABLE wingguy_contacts ADD COLUMN IF NOT EXISTS linkedin_connected_at TIMESTAMPTZ;`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wg_contacts_tenant_slug ON wingguy_contacts (coach_client_id, lower(linkedin_slug)) WHERE linkedin_slug IS NOT NULL;`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wg_contacts_tenant_ref ON wingguy_contacts (coach_client_id, person_ref) WHERE person_ref IS NOT NULL;`);
  // Failure columns (2026-09-15). last_run_at means SUCCESS; without a record of attempts,
  // "this feed has no stamp" cannot tell a genuinely broken feed from one that simply did not
  // exist yet - which would have alerted on every tenant the night a new feed shipped.
  await client.query(`ALTER TABLE wingguy_contacts_sweeps ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;`);
  await client.query(`ALTER TABLE wingguy_contacts_sweeps ADD COLUMN IF NOT EXISTS last_error TEXT;`);
  // last_run_at was NOT NULL when the table only ever recorded successes. Recording a FAILURE
  // for a feed that has never once succeeded needs it null, and without this the insert is
  // rejected, the failure is swallowed, and the staleness alert stays silent about the very
  // tenant it exists to report (Julian's mail, 2026-09-15). Idempotent.
  await client.query(`ALTER TABLE wingguy_contacts_sweeps ALTER COLUMN last_run_at DROP NOT NULL;`);
  // Where an unfinished mail backfill picks up next night (2026-10-27). NULL = caught up. Kept
  // apart from last_run_at, which the staleness alert reads as "last success" and must stay recent.
  await client.query(`ALTER TABLE wingguy_contacts_sweeps ADD COLUMN IF NOT EXISTS resume_from TIMESTAMPTZ;`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wg_contacts_tenant_name ON wingguy_contacts (coach_client_id, lower(name));`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wg_contacts_tenant_lead ON wingguy_contacts (coach_client_id, lead_record_id);`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_contacts_sweeps (
      coach_client_id TEXT NOT NULL,
      source TEXT NOT NULL,
      last_run_at TIMESTAMPTZ NOT NULL,
      rows_seen INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      PRIMARY KEY (coach_client_id, source)
    );
  `);
  ensured = true;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return EMAIL_SHAPE.test(e) ? e : '';
}

function clip(v, n = 200) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
}

/**
 * Normalise one incoming contact into the row shape. Returns null when there is nothing to key
 * on (no email and no lead record) - a name alone is not a contact.
 * Accepts { email, name | first_name/last_name, company, headline, location, phone,
 * linkedin_url | linkedin_slug, lead_record_id, source | sources[], last_seen_at, evidence, meta }.
 *
 * A phone number is kept as the human wrote it (spacing and + intact) - it is for a person to
 * read and dial, never a match key, so normalising it would only lose information.
 */
function normaliseContact(input = {}) {
  const email = cleanEmail(input.email);
  const leadId = clip(input.lead_record_id || input.leadRecordId, 40);
  if (!email && !leadId) return null;
  const first = clip(input.first_name || input.firstName, 80);
  const last = clip(input.last_name || input.lastName, 80);
  const name = clip(input.name, 160) || [first, last].filter(Boolean).join(' ');
  let slug = clip(input.linkedin_slug || input.linkedinSlug, 120);
  if (!slug && (input.linkedin_url || input.linkedinUrl)) {
    try { slug = require('../utils/linkedinCanonical').canonicalLinkedinSlug(input.linkedin_url || input.linkedinUrl); } catch (_e) { slug = ''; }
  }
  const srcList = Array.isArray(input.sources) ? input.sources : (input.source ? [input.source] : []);
  const sources = [...new Set(srcList.map((s) => clip(s, 40).toLowerCase().replace(/[^a-z0-9:_-]/g, '')).filter(Boolean))];
  let lastSeen = null;
  if (input.last_seen_at || input.lastSeenAt) {
    const d = new Date(input.last_seen_at || input.lastSeenAt);
    if (!Number.isNaN(d.getTime())) lastSeen = d;
  }
  return {
    contactKey: email || `lead:${leadId}`,
    email: email || null,
    name: name || null,
    firstName: first || null,
    lastName: last || null,
    company: clip(input.company || input.company_name, 120) || null,
    headline: clip(input.headline, 200) || null,
    location: clip(input.location, 120) || null,
    phone: clip(input.phone, 60) || null,
    linkedinSlug: slug || null,
    leadRecordId: leadId || null,
    sources,
    lastSeenAt: lastSeen,
    evidence: clip(input.evidence, 160) || null,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : null,
  };
}

/**
 * Rank candidates for a query. Exact email beats name-starts-with beats contains; ties broken
 * by most recent evidence, then by having an email at all. Pure - the SQL only prefilters.
 */
function rankMatches(rows, query) {
  const q = String(query || '').trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const score = (r) => {
    const email = String(r.email || '').toLowerCase();
    const name = String(r.name || '').toLowerCase();
    if (email && email === q) return 100;
    if (name && name === q) return 90;
    if (email && email.startsWith(q)) return 80;
    if (name && name.startsWith(q)) return 70;
    const words = name.split(/\s+/);
    if (tokens.length && tokens.every((t) => words.some((w) => w.startsWith(t)))) return 60;
    if (email && email.split('@')[0].includes(q.replace(/\s+/g, ''))) return 40;
    return 20;
  };
  return rows
    .map((r) => ({ ...r, _score: score(r) }))
    .sort((a, b) => b._score - a._score
      || (new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0))
      || ((b.email ? 1 : 0) - (a.email ? 1 : 0))
      || String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * Fold a normalised list so each contact_key appears exactly ONCE, applying the same merge the
 * database would: later non-null values win, sources union, the freshest evidence survives.
 *
 * Postgres refuses an INSERT ... ON CONFLICT DO UPDATE whose own VALUES list names the same
 * conflict key twice ("cannot affect row a second time"), so a feed that mentions one person
 * more than once in a batch would fail the WHOLE batch. Found on the first prod sweep
 * (2026-09-14): the comms-log feed sends a recipient who is also named inside the digest's
 * people list, and two leads can share an address just as easily.
 */
function mergeContacts(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const prev = byKey.get(r.contactKey);
    if (!prev) { byKey.set(r.contactKey, { ...r, sources: [...r.sources] }); continue; }
    for (const f of ['email', 'name', 'firstName', 'lastName', 'company', 'headline', 'location', 'phone', 'linkedinSlug', 'leadRecordId', 'meta']) {
      if (r[f] != null) prev[f] = r[f];
    }
    for (const s of r.sources) if (!prev.sources.includes(s)) prev.sources.push(s);
    // Evidence belongs to whichever sighting is newest; an undated row never displaces a dated one.
    if (r.lastSeenAt && (!prev.lastSeenAt || r.lastSeenAt >= prev.lastSeenAt)) {
      prev.lastSeenAt = r.lastSeenAt;
      if (r.evidence) prev.evidence = r.evidence;
    } else if (!prev.evidence && r.evidence) {
      prev.evidence = r.evidence;
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * THE SWEEP NEVER OVERWRITES A HAND-MADE CONTACT (Guy, 24 Nov 2026).
 * For an ordinary row a feed's newer non-blank value wins (the lead record or mailbox knows best).
 * For a row marked `manual` it is the other way round: what the client typed stays, and a feed may
 * only fill a field that is still blank. Nothing here ever deletes a row, and `manual` itself is
 * never touched by an upsert - only addManualContact / updateContactFields set it.
 * (sources, lead_record_id, evidence and last_seen_at still merge as before, so a hand-made contact
 * who later becomes a lead is still recognised as one.)
 */
const GUARDED_COLS = ['email', 'name', 'first_name', 'last_name', 'company', 'headline', 'location', 'phone', 'linkedin_slug'];
const MANUAL_GUARD = GUARDED_COLS.map((col) =>
  `${col} = CASE WHEN wingguy_contacts.manual THEN COALESCE(wingguy_contacts.${col}, EXCLUDED.${col}) ELSE COALESCE(EXCLUDED.${col}, wingguy_contacts.${col}) END`).join(',\n           ');

/** The same rule in plain JS, for one field - what the SQL above does to it. Pure; the tests use it. */
function mergedValue(existing, incoming, manual) {
  const has = (v) => v !== null && v !== undefined;
  if (manual) return has(existing) ? existing : (has(incoming) ? incoming : null);
  return has(incoming) ? incoming : (has(existing) ? existing : null);
}

const COLS = ['coach_client_id', 'contact_key', 'email', 'name', 'first_name', 'last_name', 'company',
  'headline', 'location', 'phone', 'linkedin_slug', 'lead_record_id', 'sources', 'last_seen_at', 'evidence', 'meta'];

/**
 * Insert-or-merge a batch of contacts for ONE tenant. Chunks of 200 so a whole leads base lands
 * in a few statements. Returns { ok, written } (written = rows sent, not "new").
 */
async function upsertContacts(coachClientId, contacts = []) {
  const tenant = clip(coachClientId, 80);
  if (!tenant) return { ok: false, error: 'coach_client_id required' };
  const rows = mergeContacts((contacts || []).map(normaliseContact).filter(Boolean));
  if (!rows.length) return { ok: true, written: 0 };
  const p = getPool();
  if (!p) return { ok: false, error: 'no database' };
  const client = await p.connect();
  try {
    await ensureTable(client);
    let written = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const params = [];
      const values = chunk.map((r) => {
        const base = params.length;
        params.push(tenant, r.contactKey, r.email, r.name, r.firstName, r.lastName, r.company, r.headline,
          r.location, r.phone, r.linkedinSlug, r.leadRecordId, r.sources, r.lastSeenAt, r.evidence, r.meta ? JSON.stringify(r.meta) : null);
        return `(${COLS.map((_, j) => `$${base + j + 1}`).join(', ')})`;
      });
      await client.query(
        `INSERT INTO wingguy_contacts (${COLS.join(', ')}) VALUES ${values.join(', ')}
         ON CONFLICT (coach_client_id, contact_key) DO UPDATE SET
           ${MANUAL_GUARD},
           lead_record_id = COALESCE(EXCLUDED.lead_record_id, wingguy_contacts.lead_record_id),
           sources = ARRAY(SELECT DISTINCT s FROM unnest(wingguy_contacts.sources || EXCLUDED.sources) AS s),
           evidence = CASE
             WHEN EXCLUDED.last_seen_at IS NOT NULL AND (wingguy_contacts.last_seen_at IS NULL OR EXCLUDED.last_seen_at >= wingguy_contacts.last_seen_at)
               THEN COALESCE(EXCLUDED.evidence, wingguy_contacts.evidence)
             ELSE COALESCE(wingguy_contacts.evidence, EXCLUDED.evidence) END,
           last_seen_at = GREATEST(wingguy_contacts.last_seen_at, EXCLUDED.last_seen_at),
           meta = COALESCE(EXCLUDED.meta, wingguy_contacts.meta),
           updated_at = now()`,
        params,
      );
      written += chunk.length;
    }
    // A lead that has since gained an address now lives under its email key - drop the stale
    // `lead:<id>` placeholder so the same person is not listed twice.
    await client.query(
      `DELETE FROM wingguy_contacts a USING wingguy_contacts b
        WHERE a.coach_client_id = $1 AND b.coach_client_id = $1
          AND a.contact_key LIKE 'lead:%' AND b.email IS NOT NULL
          AND a.lead_record_id IS NOT NULL AND a.lead_record_id = b.lead_record_id AND a.id <> b.id`,
      [tenant],
    );
    return { ok: true, written };
  } catch (e) {
    console.warn(`[contactsStore] upsert failed (${tenant}): ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

async function recordSweep(coachClientId, source, { rowsSeen = 0, note = '', at = new Date(), resumeFrom = null } = {}) {
  const p = getPool();
  if (!p || !coachClientId || !source) return { ok: false };
  const client = await p.connect();
  try {
    await ensureTable(client);
    await client.query(
      `INSERT INTO wingguy_contacts_sweeps (coach_client_id, source, last_run_at, rows_seen, note, resume_from)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (coach_client_id, source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, rows_seen = EXCLUDED.rows_seen, note = EXCLUDED.note,
         resume_from = EXCLUDED.resume_from, last_error_at = NULL, last_error = NULL`,
      [coachClientId, source, at, rowsSeen, clip(note, 300) || null, resumeFrom],
    );
    return { ok: true };
  } catch (e) {
    console.warn(`[contactsStore] recordSweep failed (${coachClientId}/${source}): ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * Record that a feed was TRIED and failed. Leaves last_run_at (the last success) alone, so the
 * staleness check can tell "broken" from "brand new": a feed with no row at all was never
 * attempted and is nobody's fault; a row with an error and an old-or-absent success is a fault.
 * Never throws - bookkeeping must not turn a feed failure into a sweep failure.
 */
async function recordSweepFailure(coachClientId, source, error, { at = new Date() } = {}) {
  const p = getPool();
  if (!p || !coachClientId || !source) return { ok: false };
  const client = await p.connect();
  try {
    await ensureTable(client);
    await client.query(
      `INSERT INTO wingguy_contacts_sweeps (coach_client_id, source, last_run_at, rows_seen, note, last_error_at, last_error)
       VALUES ($1, $2, NULL, 0, NULL, $3, $4)
       ON CONFLICT (coach_client_id, source) DO UPDATE SET last_error_at = EXCLUDED.last_error_at, last_error = EXCLUDED.last_error`,
      [coachClientId, source, at, clip(error, 300) || 'unknown error'],
    );
    return { ok: true };
  } catch (e) {
    console.warn(`[contactsStore] recordSweepFailure failed (${coachClientId}/${source}): ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * The whole state of one feed: when it last succeeded, and when it last failed. Callers that
 * only want the success can use lastSweepAt; this exists so a feed can tell "never tried" from
 * "tried and failed", which decides how much patience to give it on the next attempt.
 */
async function sweepState(coachClientId, source) {
  const p = getPool();
  if (!p || !coachClientId || !source) return { lastRunAt: null, lastErrorAt: null, lastError: null, resumeFrom: null };
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `SELECT last_run_at, last_error_at, last_error, resume_from FROM wingguy_contacts_sweeps WHERE coach_client_id = $1 AND source = $2`,
      [coachClientId, source],
    );
    const row = r.rows[0];
    if (!row) return { lastRunAt: null, lastErrorAt: null, lastError: null, resumeFrom: null };
    return {
      lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
      lastErrorAt: row.last_error_at ? new Date(row.last_error_at) : null,
      lastError: row.last_error || null,
      resumeFrom: row.resume_from ? new Date(row.resume_from) : null,
    };
  } catch (e) {
    return { lastRunAt: null, lastErrorAt: null, lastError: null, resumeFrom: null };
  } finally {
    client.release();
  }
}

async function lastSweepAt(coachClientId, source) {
  const p = getPool();
  if (!p || !coachClientId || !source) return null;
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `SELECT last_run_at FROM wingguy_contacts_sweeps WHERE coach_client_id = $1 AND source = $2`,
      [coachClientId, source],
    );
    return r.rows[0] && r.rows[0].last_run_at ? new Date(r.rows[0].last_run_at) : null;
  } catch (e) {
    return null;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The lookup. Every token of the query must appear somewhere in name / email / company for the
 * caller's tenant; the SQL narrows, rankMatches orders. Returns up to `limit` rows, best first.
 * notLeads: only people who are NOT lead records (Lead Search's "Found in your contacts") - asked
 * for in the SQL, because with a common first name the 60-row cut is otherwise all leads.
 */
async function findPeople(coachClientId, query, { limit = 8, notLeads = false } = {}) {
  const tenant = clip(coachClientId, 80);
  const q = clip(query, 120);
  if (!tenant || !q) return [];
  const p = getPool();
  if (!p) return [];
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const params = [tenant];
  // Phone is searchable too ("who is 0412 …?"), with separators stripped on BOTH sides so a
  // query written 0412345678 still finds a stored "+61 412 345 678".
  const clauses = tokens.map((t) => {
    const like = `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    params.push(like);
    const textIdx = params.length;
    const digits = t.replace(/\D/g, '');
    if (digits.length >= 5) {
      params.push(`%${digits}%`);
      return `((coalesce(name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(company,'')) ILIKE $${textIdx}
               OR regexp_replace(coalesce(phone,''), '\\D', '', 'g') LIKE $${params.length})`;
    }
    return `(coalesce(name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(company,'')) ILIKE $${textIdx}`;
  });
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `SELECT id, email, name, first_name, last_name, company, headline, location, phone, linkedin_slug,
              lead_record_id, sources, last_seen_at, evidence, manual, lists, person_ref, linkedin_connected_at
         FROM wingguy_contacts
        WHERE coach_client_id = $1 ${clauses.length ? 'AND ' + clauses.join(' AND ') : ''}
              ${notLeads ? 'AND lead_record_id IS NULL' : ''}
        LIMIT 60`,
      params,
    );
    return rankMatches(r.rows, q).slice(0, Math.max(1, Math.min(60, limit)));
  } catch (e) {
    console.warn(`[contactsStore] findPeople failed (${tenant}): ${e.message}`);
    return [];
  } finally {
    client.release();
  }
}

const ROW_COLS = 'id, email, name, first_name, last_name, company, headline, location, phone, linkedin_slug, lead_record_id, sources, last_seen_at, evidence, manual, lists, person_ref, linkedin_connected_at';

/**
 * LINKEDIN CONNECTIONS AS CONTACTS (Guy, 25 Nov 2026): a client wants ONE place to look someone up,
 * not Wingguy and then LinkedIn. Wingguy already holds each linked client's connections (Postgres
 * linkedin_people, read from Unipile for Reconnect - name, headline, profile link, date connected).
 * This copies them into the contacts lookup:
 *   - someone who is already a LEAD is left out - they show once, as the lead
 *   - someone Wingguy already holds as a contact under the same LinkedIn address is not added again:
 *     that contact is marked "connected on LinkedIn", with the date and (if blank) the headline
 *   - everyone else becomes a contact keyed on their LinkedIn address (li:<slug>), source 'linkedin'
 *   - a connection row made redundant since (the person became a lead, or gained a fuller contact
 *     row) is removed, so nobody is ever listed twice. Only rows THIS feed made are ever removed -
 *     never one a client typed, uploaded, or that carries an email.
 * It writes nothing to the leads base: no scoring, no follow-ups. "Make this contact a lead" is the
 * only way one of them becomes a lead. Set-based SQL - 8,000 connections is three statements.
 *   apply=false only COUNTS. Returns { ok, connections, alreadyLeads, alreadyContacts, newContacts,
 *   removed, lastSynced } or { ok:false, skipped?, error }.
 */
async function syncLinkedinConnections(coachClientId, { apply = true } = {}) {
  const tenant = clip(coachClientId, 80);
  if (!tenant) return { ok: false, error: 'coach_client_id required' };
  const p = getPool();
  if (!p) return { ok: false, error: 'no database' };
  const client = await p.connect();
  const CONN = `
    SELECT DISTINCT ON (lower(public_identifier)) lower(public_identifier) AS slug, name, first_name, last_name, headline, connected_at, lead_rec_id
      FROM linkedin_people
     WHERE tenant_id = $1 AND is_connection AND coalesce(public_identifier, '') <> ''
     ORDER BY lower(public_identifier), connected_at DESC NULLS LAST`;
  try {
    await ensureTable(client);
    let counts;
    try {
      counts = (await client.query(
        `WITH conn AS (${CONN}),
              held AS (SELECT lower(linkedin_slug) AS slug, bool_or(lead_record_id IS NOT NULL) AS is_lead, bool_or(contact_key <> 'li:' || lower(linkedin_slug)) AS other_row
                         FROM wingguy_contacts WHERE coach_client_id = $1 AND linkedin_slug IS NOT NULL GROUP BY 1)
         SELECT count(*)::int AS connections,
                count(*) FILTER (WHERE conn.lead_rec_id IS NOT NULL OR coalesce(held.is_lead, false))::int AS already_leads,
                count(*) FILTER (WHERE conn.lead_rec_id IS NULL AND NOT coalesce(held.is_lead, false) AND coalesce(held.other_row, false))::int AS already_contacts,
                count(*) FILTER (WHERE conn.lead_rec_id IS NULL AND held.slug IS NULL)::int AS brand_new,
                count(*) FILTER (WHERE conn.lead_rec_id IS NULL AND NOT coalesce(held.is_lead, false) AND NOT coalesce(held.other_row, false))::int AS as_contacts,
                (SELECT max(synced_at) FROM linkedin_people WHERE tenant_id = $1) AS last_synced
           FROM conn LEFT JOIN held ON held.slug = conn.slug`, [tenant])).rows[0];
    } catch (e) {
      // a client who never linked LinkedIn, or a database with no connections table: nothing to copy
      if (/linkedin_people/.test(e.message)) return { ok: false, skipped: true, error: 'no LinkedIn connections are stored for this client' };
      throw e;
    }
    const out = { ok: true, connections: counts.connections, alreadyLeads: counts.already_leads, alreadyContacts: counts.already_contacts,
      newContacts: counts.as_contacts, toAdd: counts.brand_new, removed: 0, lastSynced: counts.last_synced, applied: false };
    if (!apply || !counts.connections) return out;

    await client.query('BEGIN');
    // 1. a contact Wingguy already holds under that LinkedIn address: say they are connected
    await client.query(
      `WITH conn AS (${CONN})
       UPDATE wingguy_contacts c SET
              sources = ARRAY(SELECT DISTINCT s FROM unnest(c.sources || ARRAY['linkedin']) AS s),
              linkedin_connected_at = COALESCE(conn.connected_at, c.linkedin_connected_at),
              headline = COALESCE(c.headline, conn.headline),
              updated_at = now()
         FROM conn
        WHERE c.coach_client_id = $1 AND c.lead_record_id IS NULL AND c.contact_key NOT LIKE 'li:%' AND lower(c.linkedin_slug) = conn.slug
          AND (NOT ('linkedin' = ANY(c.sources)) OR c.linkedin_connected_at IS DISTINCT FROM COALESCE(conn.connected_at, c.linkedin_connected_at))`, [tenant]);
    // 2. everyone else who is not a lead: a contact keyed on their LinkedIn address
    await client.query(
      `WITH conn AS (${CONN})
       INSERT INTO wingguy_contacts (coach_client_id, contact_key, name, first_name, last_name, headline, linkedin_slug, sources, linkedin_connected_at)
       SELECT $1, 'li:' || conn.slug, NULLIF(trim(coalesce(conn.name, concat_ws(' ', conn.first_name, conn.last_name))), ''), conn.first_name, conn.last_name, conn.headline, conn.slug, ARRAY['linkedin'], conn.connected_at
         FROM conn
        WHERE conn.lead_rec_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM wingguy_contacts c WHERE c.coach_client_id = $1 AND lower(c.linkedin_slug) = conn.slug AND c.contact_key <> 'li:' || conn.slug)
       ON CONFLICT (coach_client_id, contact_key) DO UPDATE SET
              name = CASE WHEN wingguy_contacts.manual THEN COALESCE(wingguy_contacts.name, EXCLUDED.name) ELSE COALESCE(EXCLUDED.name, wingguy_contacts.name) END,
              first_name = CASE WHEN wingguy_contacts.manual THEN COALESCE(wingguy_contacts.first_name, EXCLUDED.first_name) ELSE COALESCE(EXCLUDED.first_name, wingguy_contacts.first_name) END,
              last_name = CASE WHEN wingguy_contacts.manual THEN COALESCE(wingguy_contacts.last_name, EXCLUDED.last_name) ELSE COALESCE(EXCLUDED.last_name, wingguy_contacts.last_name) END,
              headline = CASE WHEN wingguy_contacts.manual THEN COALESCE(wingguy_contacts.headline, EXCLUDED.headline) ELSE COALESCE(EXCLUDED.headline, wingguy_contacts.headline) END,
              linkedin_connected_at = COALESCE(EXCLUDED.linkedin_connected_at, wingguy_contacts.linkedin_connected_at),
              sources = ARRAY(SELECT DISTINCT s FROM unnest(wingguy_contacts.sources || ARRAY['linkedin']) AS s),
              updated_at = now()`, [tenant]);
    // 3. a connection row this feed made that is now redundant: the person is a lead, or has a fuller row
    const gone = await client.query(
      `DELETE FROM wingguy_contacts a
        WHERE a.coach_client_id = $1 AND a.contact_key LIKE 'li:%' AND NOT a.manual AND a.email IS NULL
          AND a.sources = ARRAY['linkedin']::text[] AND a.lists = '{}'
          AND (EXISTS (SELECT 1 FROM wingguy_contacts b WHERE b.coach_client_id = $1 AND b.id <> a.id AND lower(b.linkedin_slug) = lower(a.linkedin_slug))
               OR EXISTS (SELECT 1 FROM linkedin_people lp WHERE lp.tenant_id = $1 AND lower(lp.public_identifier) = lower(a.linkedin_slug) AND lp.lead_rec_id IS NOT NULL))`, [tenant]);
    await client.query('COMMIT');
    return { ...out, removed: gone.rowCount, applied: true };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
    console.warn(`[contactsStore] syncLinkedinConnections failed (${tenant}): ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * Every NON-LEAD row of this client that could be the same person as one already in hand: the same
 * full name, or the same person_ref. The caller (services/contactGrouping.js) decides who really is
 * - this only fetches the candidates, so a person's other addresses are found even when the search
 * words matched just one of them. Capped: a name shared by hundreds is not one person.
 */
async function findSamePeople(coachClientId, { names = [], refs = [] } = {}) {
  const tenant = clip(coachClientId, 80);
  const n = [...new Set((names || []).map((x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 80);
  const rf = [...new Set((refs || []).map((x) => String(x || '')).filter(Boolean))].slice(0, 80);
  if (!tenant || (!n.length && !rf.length)) return [];
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `SELECT ${ROW_COLS} FROM wingguy_contacts
        WHERE coach_client_id = $1 AND lead_record_id IS NULL
          AND (lower(name) = ANY($2::text[]) OR person_ref = ANY($3::text[]))
        ORDER BY id LIMIT 400`, [tenant, n, rf]);
    return r.rows;
  } catch (e) {
    console.warn(`[contactsStore] findSamePeople failed (${tenant}): ${e.message}`);
    return [];
  } finally {
    client.release();
  }
}

/**
 * A person shown as ONE (several address rows) has been edited: the name and company go onto every
 * one of their rows, and the rows are tied together (person_ref) so a later edit cannot split them.
 * Leads' rows are never touched. Returns the number of rows written.
 */
async function updatePersonShared(coachClientId, ids = [], { name, company, ref = '' } = {}) {
  const tenant = clip(coachClientId, 80);
  const list = [...new Set((ids || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (!tenant || list.length < 2) return 0;
  const p = getPool();
  if (!p) return 0;
  const client = await p.connect();
  try {
    await ensureTable(client);
    const setName = name !== undefined;
    const setCompany = company !== undefined;
    const r = await client.query(
      `UPDATE wingguy_contacts SET
          name = CASE WHEN $3 THEN $4 ELSE name END,
          first_name = CASE WHEN $3 THEN NULL ELSE first_name END,
          last_name = CASE WHEN $3 THEN NULL ELSE last_name END,
          company = CASE WHEN $5 THEN $6 ELSE company END,
          person_ref = COALESCE(person_ref, NULLIF($7, '')),
          manual = true, updated_at = now()
        WHERE coach_client_id = $1 AND id = ANY($2::bigint[]) AND lead_record_id IS NULL`,
      [tenant, list, setName, setName ? (clip(name, 160) || null) : null, setCompany, setCompany ? (clip(company, 120) || null) : null, clip(ref, 200)]);
    return r.rowCount;
  } catch (e) {
    console.warn(`[contactsStore] updatePersonShared failed (${tenant}): ${e.message}`);
    return 0;
  } finally {
    client.release();
  }
}

/** LinkedIn address or slug -> the slug we key on ('' when it is not a profile link). */
function slugOf(v) {
  const t = clip(v, 300);
  if (!t) return '';
  if (!/linkedin\.com/i.test(t)) return /^[a-z0-9-_%.]{3,120}$/i.test(t) ? t.toLowerCase() : '';
  try { return require('../utils/linkedinCanonical').canonicalLinkedinSlug(t) || ''; } catch (_e) { return ''; }
}

/**
 * Everyone this client holds under an email address or a LinkedIn profile - leads included (a lead's
 * row carries lead_record_id). The dedupe check before a hand-add: NEVER a match on name alone.
 */
async function findByIdentity(coachClientId, { email = '', linkedin = '' } = {}) {
  const tenant = clip(coachClientId, 80);
  const e = cleanEmail(email);
  const slug = slugOf(linkedin);
  if (!tenant || (!e && !slug)) return [];
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `SELECT ${ROW_COLS} FROM wingguy_contacts
        WHERE coach_client_id = $1 AND (($2 <> '' AND lower(email) = $2) OR ($3 <> '' AND lower(linkedin_slug) = $3))
        ORDER BY (lead_record_id IS NOT NULL) DESC, id LIMIT 5`, [tenant, e, slug.toLowerCase()]);
    return r.rows;
  } finally {
    client.release();
  }
}

/**
 * Add ONE contact by hand. Needs a name and an email or a phone (the caller checks; here a row with
 * nothing to key on is refused). Create-only: an existing row under the same key is left exactly as
 * it is and handed back with created=false. Returns { ok, created, row } or { ok:false, error }.
 */
async function addManualContact(coachClientId, input = {}, { source = 'manual' } = {}) {
  const tenant = clip(coachClientId, 80);
  if (!tenant) return { ok: false, error: 'coach_client_id required' };
  const email = cleanEmail(input.email);
  const slug = slugOf(input.linkedin || input.linkedin_url || input.linkedin_slug);
  const phone = clip(input.phone, 60);
  const first = clip(input.first_name || input.firstName, 80);
  const last = clip(input.last_name || input.lastName, 80);
  const name = clip(input.name, 160) || [first, last].filter(Boolean).join(' ');
  const digits = phone.replace(/\D/g, '');
  // The key: the email when there is one (so a later mail-feed sighting lands on THIS row), else the
  // LinkedIn profile, else the phone number.
  const key = email || (slug ? `li:${slug.toLowerCase()}` : (digits.length >= 6 ? `phone:${digits}` : ''));
  if (!key) return { ok: false, error: 'an email, a phone number or a LinkedIn address is needed' };
  const src = clip(source, 40).toLowerCase().replace(/[^a-z0-9:_-]/g, '') || 'manual';
  const p = getPool();
  if (!p) return { ok: false, error: 'no database' };
  const client = await p.connect();
  try {
    await ensureTable(client);
    const ins = await client.query(
      `INSERT INTO wingguy_contacts (coach_client_id, contact_key, email, name, first_name, last_name, company, location, phone, linkedin_slug, sources, last_seen_at, evidence, manual)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, true)
       ON CONFLICT (coach_client_id, contact_key) DO NOTHING
       RETURNING ${ROW_COLS}`,
      [tenant, key, email || null, name || null, first || null, last || null, clip(input.company, 120) || null,
        clip(input.location, 120) || null, phone || null, slug || null, [src], clip(input.evidence, 160) || null]);
    if (ins.rows[0]) return { ok: true, created: true, row: ins.rows[0] };
    const had = await client.query(`SELECT ${ROW_COLS} FROM wingguy_contacts WHERE coach_client_id = $1 AND contact_key = $2`, [tenant, key]);
    return { ok: true, created: false, row: had.rows[0] || null };
  } catch (e) {
    console.warn(`[contactsStore] addManualContact failed (${tenant}): ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * Edit a contact's details by hand - name, company, email, phone, LinkedIn. Only the fields given
 * are changed ('' clears one). The row becomes `manual`, so the sweep will not undo the edit.
 * A lead's row is not edited here (the lead record is the truth for a lead).
 * Returns { ok, row } | { ok:false, status, error }.
 */
async function updateContactFields(coachClientId, id, fields = {}) {
  const tenant = clip(coachClientId, 80);
  const n = Number(id);
  if (!tenant || !Number.isInteger(n) || n <= 0) return { ok: false, status: 404, error: 'That contact was not found.' };
  const p = getPool();
  if (!p) return { ok: false, status: 500, error: 'no database' };
  const client = await p.connect();
  try {
    await ensureTable(client);
    const cur = (await client.query(`SELECT ${ROW_COLS}, contact_key FROM wingguy_contacts WHERE coach_client_id = $1 AND id = $2`, [tenant, n])).rows[0];
    if (!cur) return { ok: false, status: 404, error: 'That contact was not found.' };
    if (cur.lead_record_id) return { ok: false, status: 409, error: 'This person is one of your leads - change their details on the lead record.' };
    const next = { ...cur };
    if ('name' in fields) { next.name = clip(fields.name, 160) || null; next.first_name = null; next.last_name = null; }
    if ('company' in fields) next.company = clip(fields.company, 120) || null;
    if ('phone' in fields) next.phone = clip(fields.phone, 60) || null;
    if ('linkedin' in fields) {
      const raw = clip(fields.linkedin, 300);
      const slug = slugOf(raw);
      if (raw && !slug) return { ok: false, status: 400, error: 'That does not look like a LinkedIn profile address.' };
      next.linkedin_slug = slug || null;
    }
    if ('email' in fields) {
      const raw = clip(fields.email, 200);
      const e = cleanEmail(raw);
      if (raw && !e) return { ok: false, status: 400, error: 'That does not look like an email address.' };
      next.email = e || null;
    }
    const digits = String(next.phone || '').replace(/\D/g, '');
    if (!next.name) return { ok: false, status: 400, error: 'A contact needs a name.' };
    if (!next.email && digits.length < 6) return { ok: false, status: 400, error: 'A contact needs an email or a phone number.' };
    // The key follows the email (a mail-feed sighting must land on this row); a row that never had
    // an email keeps the key it was born with unless it now gains one.
    const key = next.email || (String(cur.contact_key).includes('@') ? (next.linkedin_slug ? `li:${String(next.linkedin_slug).toLowerCase()}` : `phone:${digits}`) : cur.contact_key);
    try {
      const up = await client.query(
        `UPDATE wingguy_contacts SET contact_key = $3, email = $4, name = $5, first_name = $6, last_name = $7, company = $8, phone = $9,
                linkedin_slug = $10, manual = true, updated_at = now()
          WHERE coach_client_id = $1 AND id = $2 RETURNING ${ROW_COLS}`,
        [tenant, n, key, next.email, next.name, next.first_name, next.last_name, next.company, next.phone, next.linkedin_slug]);
      return { ok: true, row: up.rows[0] };
    } catch (e) {
      if (e.code === '23505') return { ok: false, status: 409, error: 'Another of your contacts already has that email address.' };
      throw e;
    }
  } catch (e) {
    console.warn(`[contactsStore] updateContactFields failed (${tenant}): ${e.message}`);
    return { ok: false, status: 500, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * Everything an import needs to know about who the client already holds: one light row per address.
 * (16,000 rows for the biggest client - one query, a few hundred ms.)
 */
async function listForImport(coachClientId) {
  const tenant = clip(coachClientId, 80);
  if (!tenant) return [];
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `SELECT id, contact_key, email, linkedin_slug, lead_record_id, name, company, phone, lists, person_ref FROM wingguy_contacts WHERE coach_client_id = $1`, [tenant]);
    return r.rows;
  } finally {
    client.release();
  }
}

/**
 * Write an import (services/contactsImport.js planned it; nothing here decides anything).
 *   newPeople    [{ name, email, phone, company, linkedin (slug), otherEmails[], lists[], ref }] -> new contact rows
 *   extraRows    [{ email, name, company, lists[], ref }]  -> a new address for someone already held
 *   contactFills [{ id, set: { name?, company?, phone?, linkedin_slug? }, addLists[], ref }] -> blanks filled
 * lists are PER PERSON (a Google file carries each contact's own labels) and are only ever ADDED - a
 * list a person is already on is never replaced. ref ties one file entry's addresses together.
 * New rows are `manual` with source 'import'. An existing key is never overwritten (DO NOTHING), and
 * a fill is written as COALESCE(existing, new) - so even a row that changed since the preview keeps
 * what it has. One transaction: an import either lands whole or not at all.
 * Returns { ok, inserted, filled }.
 */
async function applyImport(coachClientId, { newPeople = [], contactFills = [], extraRows = [] } = {}) {
  const tenant = clip(coachClientId, 80);
  if (!tenant) return { ok: false, error: 'coach_client_id required' };
  const listsJson = (l) => JSON.stringify([...new Set((l || []).map((x) => clip(x, 60)).filter(Boolean))]);
  const rows = [];
  for (const person of newPeople) {
    const email = cleanEmail(person.email);
    const phone = clip(person.phone, 60);
    const digits = phone.replace(/\D/g, '');
    const slug = slugOf(person.linkedin);
    const key = email || (digits.length >= 6 ? `phone:${digits}` : '');
    if (!key) continue;
    const name = clip(person.name, 160) || null;
    const lj = listsJson(person.lists);
    const ref = clip(person.ref, 200) || null;
    rows.push([key, email || null, name, clip(person.company, 120) || null, phone || null, slug || null, lj, ref]);
    for (const other of person.otherEmails || []) {
      const e = cleanEmail(other);
      if (e && e !== email) rows.push([e, e, name, clip(person.company, 120) || null, null, null, lj, ref]);
    }
  }
  for (const x of extraRows || []) {
    const e = cleanEmail(x.email);
    if (e) rows.push([e, e, clip(x.name, 160) || null, clip(x.company, 120) || null, null, null, listsJson(x.lists), clip(x.ref, 200) || null]);
  }
  const p = getPool();
  if (!p) return { ok: false, error: 'no database' };
  const client = await p.connect();
  try {
    await ensureTable(client);
    await client.query('BEGIN');
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const r = await client.query(
        `INSERT INTO wingguy_contacts (coach_client_id, contact_key, email, name, company, phone, linkedin_slug, sources, last_seen_at, manual, lists, person_ref)
         SELECT $1, v.k, v.e, v.n, v.c, v.ph, v.s, ARRAY['import'], now(), true, ARRAY(SELECT jsonb_array_elements_text(v.l::jsonb)), v.r
           FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) AS v(k, e, n, c, ph, s, l, r)
         ON CONFLICT (coach_client_id, contact_key) DO NOTHING`,
        [tenant, chunk.map((x) => x[0]), chunk.map((x) => x[1]), chunk.map((x) => x[2]), chunk.map((x) => x[3]), chunk.map((x) => x[4]), chunk.map((x) => x[5]), chunk.map((x) => x[6]), chunk.map((x) => x[7])]);
      inserted += r.rowCount;
    }
    let filled = 0;
    for (let i = 0; i < contactFills.length; i += 500) {
      const chunk = contactFills.slice(i, i + 500);
      const r = await client.query(
        `UPDATE wingguy_contacts c SET
            name = COALESCE(c.name, v.n), company = COALESCE(c.company, v.c), phone = COALESCE(c.phone, v.ph),
            linkedin_slug = COALESCE(c.linkedin_slug, v.s),
            sources = ARRAY(SELECT DISTINCT x FROM unnest(c.sources || ARRAY['import']) AS x),
            lists = ARRAY(SELECT DISTINCT x FROM unnest(c.lists || ARRAY(SELECT jsonb_array_elements_text(v.l::jsonb))) AS x),
            person_ref = COALESCE(c.person_ref, v.r),
            updated_at = now()
           FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS v(id, n, c, ph, s, l, r)
          WHERE c.coach_client_id = $1 AND c.id = v.id AND c.lead_record_id IS NULL`,
        [tenant, chunk.map((x) => Number(x.id)), chunk.map((x) => clip(x.set && x.set.name, 160) || null), chunk.map((x) => clip(x.set && x.set.company, 120) || null),
          chunk.map((x) => clip(x.set && x.set.phone, 60) || null), chunk.map((x) => (x.set && x.set.linkedin_slug ? slugOf(x.set.linkedin_slug) : null) || null),
          chunk.map((x) => listsJson(x.addLists)), chunk.map((x) => clip(x.ref, 200) || null)]);
      filled += r.rowCount;
    }
    await client.query('COMMIT');
    return { ok: true, inserted, filled };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
    console.warn(`[contactsStore] applyImport failed (${tenant}): ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * One contact row by its id - but only if it belongs to this client. The id comes back from a
 * browser (Lead Search's "Add as lead"), so it is never trusted on its own.
 */
async function getContact(coachClientId, id) {
  const tenant = clip(coachClientId, 80);
  const n = Number(id);
  if (!tenant || !Number.isInteger(n) || n <= 0) return null;
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `SELECT id, email, name, first_name, last_name, company, headline, location, phone, linkedin_slug,
              lead_record_id, sources, last_seen_at, evidence, manual, lists, person_ref, linkedin_connected_at
         FROM wingguy_contacts WHERE coach_client_id = $1 AND id = $2`, [tenant, n]);
    return r.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * The contact has just become a lead: say so on its row now, so Lead Search stops offering it
 * without waiting for the nightly sweep. Same client filter. The sweep would set the same value.
 */
async function markAsLead(coachClientId, id, leadRecordId) {
  const tenant = clip(coachClientId, 80);
  const n = Number(id);
  const rec = clip(leadRecordId, 40);
  if (!tenant || !Number.isInteger(n) || n <= 0 || !rec) return false;
  const p = getPool();
  if (!p) return false;
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `UPDATE wingguy_contacts SET lead_record_id = $3, updated_at = now()
        WHERE coach_client_id = $1 AND id = $2 AND lead_record_id IS NULL`, [tenant, n, rec]);
    return r.rowCount > 0;
  } finally {
    client.release();
  }
}

/** Counts per source + last sweep times - the "is the warehouse stocked?" answer. */
async function tenantStatus(coachClientId) {
  const tenant = clip(coachClientId, 80);
  if (!tenant) return { total: 0, withEmail: 0, bySource: {}, sweeps: [] };
  const p = getPool();
  if (!p) return { total: 0, withEmail: 0, bySource: {}, sweeps: [], error: 'no database' };
  const client = await p.connect();
  try {
    await ensureTable(client);
    const tot = await client.query(
      `SELECT count(*)::int AS total, count(email)::int AS with_email FROM wingguy_contacts WHERE coach_client_id = $1`, [tenant]);
    const src = await client.query(
      `SELECT s AS source, count(*)::int AS n FROM wingguy_contacts, unnest(sources) AS s WHERE coach_client_id = $1 GROUP BY s ORDER BY n DESC`, [tenant]);
    const sw = await client.query(
      `SELECT source, last_run_at, rows_seen, note FROM wingguy_contacts_sweeps WHERE coach_client_id = $1 ORDER BY source`, [tenant]);
    const bySource = {};
    for (const row of src.rows) bySource[row.source] = row.n;
    return { total: tot.rows[0].total, withEmail: tot.rows[0].with_email, bySource, sweeps: sw.rows };
  } catch (e) {
    return { total: 0, withEmail: 0, bySource: {}, sweeps: [], error: e.message };
  } finally {
    client.release();
  }
}

/**
 * Everything the contacts lookup holds for one client - for offboarding (Guy, 26 Nov 2026). The terms
 * page says a member's contacts are deleted when they leave, so this is what makes that true:
 *   - every row in wingguy_contacts (imported, typed in, from their email, from LinkedIn, and the
 *     copies of their leads - the leads themselves stay in their own Airtable base)
 *   - the sweep stamps, so a client who comes back starts with a clean full sweep
 *   - their stored LinkedIn connection list (linkedin_people)
 * apply=false only COUNTS. Returns { ok, contacts, linkedinPeople, applied } or { ok:false, error }.
 * A database with no linkedin_people table simply has none to delete.
 */
async function forgetClient(coachClientId, { apply = false } = {}) {
  const tenant = clip(coachClientId, 80);
  if (!tenant) return { ok: false, error: 'coach_client_id required' };
  const p = getPool();
  if (!p) return { ok: false, error: 'no database' };
  const client = await p.connect();
  const optional = async (sql) => {
    try { return await client.query(sql, [tenant]); } catch (e) { if (/does not exist/.test(e.message)) return { rows: [{ n: 0 }], rowCount: 0 }; throw e; }
  };
  try {
    await ensureTable(client);
    if (!apply) {
      const c = await client.query('SELECT count(*)::int AS n FROM wingguy_contacts WHERE coach_client_id = $1', [tenant]);
      const l = await optional('SELECT count(*)::int AS n FROM linkedin_people WHERE tenant_id = $1');
      return { ok: true, contacts: c.rows[0].n, linkedinPeople: l.rows[0].n, applied: false };
    }
    const l = await optional('DELETE FROM linkedin_people WHERE tenant_id = $1');
    await client.query('BEGIN');
    const c = await client.query('DELETE FROM wingguy_contacts WHERE coach_client_id = $1', [tenant]);
    await client.query('DELETE FROM wingguy_contacts_sweeps WHERE coach_client_id = $1', [tenant]);
    await client.query('COMMIT');
    return { ok: true, contacts: c.rowCount, linkedinPeople: l.rowCount, applied: true };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

module.exports = {
  forgetClient,
  upsertContacts, syncLinkedinConnections, findPeople, findSamePeople, updatePersonShared, getContact, markAsLead, findByIdentity, addManualContact, updateContactFields, listForImport, applyImport, tenantStatus, recordSweep, recordSweepFailure, lastSweepAt, sweepState,
  // pure, for tests
  normaliseContact, rankMatches, cleanEmail, mergeContacts, mergedValue, slugOf, MANUAL_GUARD, GUARDED_COLS,
};
