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
           email = COALESCE(EXCLUDED.email, wingguy_contacts.email),
           name = COALESCE(EXCLUDED.name, wingguy_contacts.name),
           first_name = COALESCE(EXCLUDED.first_name, wingguy_contacts.first_name),
           last_name = COALESCE(EXCLUDED.last_name, wingguy_contacts.last_name),
           company = COALESCE(EXCLUDED.company, wingguy_contacts.company),
           headline = COALESCE(EXCLUDED.headline, wingguy_contacts.headline),
           location = COALESCE(EXCLUDED.location, wingguy_contacts.location),
           phone = COALESCE(EXCLUDED.phone, wingguy_contacts.phone),
           linkedin_slug = COALESCE(EXCLUDED.linkedin_slug, wingguy_contacts.linkedin_slug),
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

async function recordSweep(coachClientId, source, { rowsSeen = 0, note = '', at = new Date() } = {}) {
  const p = getPool();
  if (!p || !coachClientId || !source) return { ok: false };
  const client = await p.connect();
  try {
    await ensureTable(client);
    await client.query(
      `INSERT INTO wingguy_contacts_sweeps (coach_client_id, source, last_run_at, rows_seen, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (coach_client_id, source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, rows_seen = EXCLUDED.rows_seen, note = EXCLUDED.note,
         last_error_at = NULL, last_error = NULL`,
      [coachClientId, source, at, rowsSeen, clip(note, 300) || null],
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
  if (!p || !coachClientId || !source) return { lastRunAt: null, lastErrorAt: null, lastError: null };
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `SELECT last_run_at, last_error_at, last_error FROM wingguy_contacts_sweeps WHERE coach_client_id = $1 AND source = $2`,
      [coachClientId, source],
    );
    const row = r.rows[0];
    if (!row) return { lastRunAt: null, lastErrorAt: null, lastError: null };
    return {
      lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
      lastErrorAt: row.last_error_at ? new Date(row.last_error_at) : null,
      lastError: row.last_error || null,
    };
  } catch (e) {
    return { lastRunAt: null, lastErrorAt: null, lastError: null };
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
 */
async function findPeople(coachClientId, query, { limit = 8 } = {}) {
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
              lead_record_id, sources, last_seen_at, evidence
         FROM wingguy_contacts
        WHERE coach_client_id = $1 ${clauses.length ? 'AND ' + clauses.join(' AND ') : ''}
        LIMIT 60`,
      params,
    );
    return rankMatches(r.rows, q).slice(0, Math.max(1, Math.min(25, limit)));
  } catch (e) {
    console.warn(`[contactsStore] findPeople failed (${tenant}): ${e.message}`);
    return [];
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

module.exports = {
  upsertContacts, findPeople, tenantStatus, recordSweep, recordSweepFailure, lastSweepAt, sweepState,
  // pure, for tests
  normaliseContact, rankMatches, cleanEmail, mergeContacts,
};
