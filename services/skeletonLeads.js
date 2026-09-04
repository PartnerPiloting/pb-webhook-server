/**
 * Skeleton leads - people the coach has MET (a call, an intro) and filed with a name and an email
 * but NO LinkedIn URL yet. Agreed with Guy 2026-09-04 after Rick Wong called the "find their
 * LinkedIn URL first" step painful: for someone off a call, the email is the identity and the
 * transcript is the value, neither needs LinkedIn. The URL stays REQUIRED on the blank New Lead
 * form and remains the dedup key for everything that arrives from Linked Helper.
 *
 * The cost of a URL-less record is that the Linked Helper duplicate check (by LinkedIn address)
 * cannot see it. This module is that cover, in two steps:
 *
 *   1. SAME EMAIL  - when a Linked Helper lead arrives with an email that a skeleton carries
 *                    (Email or Alt Emails), the skeleton is ADOPTED: updated in place, the URL
 *                    and profile fill in, and it enters the scoring queue. Automatic.
 *   2. SAME NAME   - when only the name matches a skeleton, we do NOT merge on our own (two
 *                    people can share a name). The Linked Helper record is created normally and
 *                    the New Leads page shows "Possible match" with one button to combine, one to
 *                    say "different person". The coach knows; we don't.
 *
 * Everything here is computed at query time from the base itself - no new Airtable fields.
 * The only state is the "different person" dismissals, kept in Postgres so a dismissed pair never
 * comes back.
 */

const { escapeFormulaText } = require('../utils/linkedinCanonical');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'skeleton-leads' });

const LEADS = 'Leads';
const F = {
  URL: 'LinkedIn Profile URL',
  FIRST: 'First Name',
  LAST: 'Last Name',
  EMAIL: 'Email',
  ALT: 'Alt Emails',
  PHONE: 'Phone',
  LOCATION: 'Location',
  NOTES: 'Notes',
  TERMS: 'Search Terms',
  HEADLINE: 'Headline',
  COMPANY: 'Company Name',
};

// A URL field that is genuinely empty. `& ""` makes the test safe for a url-type primary field.
const NO_URL = `LEN({${F.URL}} & "") = 0`;
const HAS_URL = `LEN({${F.URL}} & "") > 0`;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

function norm(s) { return String(s || '').trim().toLowerCase(); }

/** Split an Alt Emails cell the tolerant way the rest of the codebase does (newline / ; / ,). */
function splitAlts(cell) {
  return String(cell || '').split(/[;,\n]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Does this record carry `email` as its primary OR one of its alternates? Exact, never substring. */
function recordHasEmail(rec, email) {
  const e = norm(email);
  if (!e || !rec || !rec.fields) return false;
  if (norm(rec.fields[F.EMAIL]) === e) return true;
  return splitAlts(rec.fields[F.ALT]).includes(e);
}

/** Skeleton = a Leads record with no LinkedIn URL. */
function isSkeleton(rec) {
  return !!rec && !!rec.fields && !String(rec.fields[F.URL] || '').trim();
}

/** Formula: URL-less records that carry this email (primary or alternate). */
function skeletonByEmailFormula(email, { withAltEmails = true } = {}) {
  const e = escapeFormulaText(norm(email));
  const emailTest = withAltEmails
    ? `OR(LOWER({${F.EMAIL}}) = "${e}", FIND("${e}", LOWER({${F.ALT}} & "")) > 0)`
    : `LOWER({${F.EMAIL}}) = "${e}"`;
  return `AND(${NO_URL}, ${emailTest})`;
}

/** Formula: records with this exact first + last name, with or without a URL. */
function nameFormula(firstName, lastName, { withUrl }) {
  const f = escapeFormulaText(norm(firstName));
  const l = escapeFormulaText(norm(lastName));
  return `AND(${withUrl ? HAS_URL : NO_URL}, LOWER(TRIM({${F.FIRST}})) = "${f}", LOWER(TRIM({${F.LAST}})) = "${l}")`;
}

/** Merge two Search Terms cells: union, original order, comma-separated. */
function mergeSearchTerms(a, b) {
  const seen = new Set();
  const out = [];
  for (const cell of [a, b]) {
    for (const t of String(cell || '').split(/[,\n]+/)) {
      const v = t.trim();
      const k = v.toLowerCase();
      if (!v || seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
  }
  return out.join(', ');
}

/**
 * Field-level plan for folding `skeleton` into `target`. Pure: returns the fields to write on the
 * target (nothing else is touched), so the rule is testable without Airtable.
 *   - Email: target keeps its own primary; the skeleton's primary + alternates go under Alt Emails.
 *            A target with NO primary takes the skeleton's.
 *   - Phone / Location: filled only when the target's is blank (Linked Helper's is fresher).
 *   - Notes: the skeleton's notes are appended under a dated marker so nothing is lost.
 *   - Search Terms: union.
 */
function planMerge(skeleton, target, { today = new Date() } = {}) {
  const s = (skeleton && skeleton.fields) || {};
  const t = (target && target.fields) || {};
  const fields = {};

  const targetPrimary = norm(t[F.EMAIL]);
  const skeletonPrimary = norm(s[F.EMAIL]);
  const primary = targetPrimary || skeletonPrimary;
  if (!targetPrimary && skeletonPrimary) fields[F.EMAIL] = skeletonPrimary;
  const alts = [];
  const seen = new Set([primary]);
  for (const e of [...splitAlts(t[F.ALT]), skeletonPrimary, ...splitAlts(s[F.ALT])]) {
    if (!e || seen.has(e)) continue;
    seen.add(e);
    alts.push(e);
  }
  const altCell = alts.join('\n');
  if (altCell !== String(t[F.ALT] || '').trim()) fields[F.ALT] = altCell;

  if (!String(t[F.PHONE] || '').trim() && String(s[F.PHONE] || '').trim()) fields[F.PHONE] = String(s[F.PHONE]).trim();
  if (!String(t[F.LOCATION] || '').trim() && String(s[F.LOCATION] || '').trim()) fields[F.LOCATION] = String(s[F.LOCATION]).trim();

  const skNotes = String(s[F.NOTES] || '').trim();
  if (skNotes) {
    const d = today.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Brisbane' });
    const marker = `=== MERGED FROM EARLIER RECORD (${d}) ===`;
    const existing = String(t[F.NOTES] || '').trim();
    fields[F.NOTES] = existing ? `${existing}\n\n${marker}\n${skNotes}` : `${marker}\n${skNotes}`;
  }

  const terms = mergeSearchTerms(t[F.TERMS], s[F.TERMS]);
  if (terms && terms !== String(t[F.TERMS] || '').trim()) fields[F.TERMS] = terms;

  return fields;
}

// ---------------------------------------------------------------------------
// Airtable reads
// ---------------------------------------------------------------------------

async function selectAll(base, opts) {
  return base(LEADS).select(opts).all();
}

/**
 * The one skeleton that carries this email, or null. Null on zero AND on more-than-one (two
 * skeletons with the same address is a mess for a human, not something to auto-adopt). Falls back
 * to an Email-only formula on bases that predate the Alt Emails field.
 */
async function findSkeletonByEmail(base, email) {
  const e = norm(email);
  if (!e || !e.includes('@')) return null;
  let rows;
  try {
    rows = await selectAll(base, { filterByFormula: skeletonByEmailFormula(e), maxRecords: 5 });
  } catch (err) {
    rows = await selectAll(base, { filterByFormula: skeletonByEmailFormula(e, { withAltEmails: false }), maxRecords: 5 });
  }
  const exact = rows.filter((r) => isSkeleton(r) && recordHasEmail(r, e));
  return exact.length === 1 ? exact[0] : null;
}

/** Skeletons whose first + last name equal these (case/space-insensitive). */
async function findSkeletonsByName(base, firstName, lastName) {
  if (!norm(firstName) || !norm(lastName)) return [];
  const rows = await selectAll(base, { filterByFormula: nameFormula(firstName, lastName, { withUrl: false }), maxRecords: 10 });
  return rows.filter(isSkeleton);
}

/** Full records (with a URL) whose first + last name equal these. */
async function findNamedLeadsWithUrl(base, firstName, lastName) {
  if (!norm(firstName) || !norm(lastName)) return [];
  return selectAll(base, {
    filterByFormula: nameFormula(firstName, lastName, { withUrl: true }),
    fields: [F.FIRST, F.LAST, F.EMAIL, F.URL, F.HEADLINE, F.COMPANY, F.LOCATION],
    maxRecords: 10,
  });
}

/** Every skeleton in the base (capped). */
async function listSkeletons(base, { limit = 200 } = {}) {
  return selectAll(base, {
    filterByFormula: NO_URL,
    fields: [F.FIRST, F.LAST, F.EMAIL, F.ALT, F.PHONE, F.LOCATION, F.NOTES, F.TERMS],
    maxRecords: limit,
  });
}

// ---------------------------------------------------------------------------
// Postgres: "different person" dismissals + re-pointing the transcript store on merge
// ---------------------------------------------------------------------------

let schemaEnsured = false;
async function ensureSchema(pool) {
  if (schemaEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_merge_dismissals (
      id BIGSERIAL PRIMARY KEY,
      coach_client_id TEXT NOT NULL,
      skeleton_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (coach_client_id, skeleton_id, candidate_id)
    );
  `);
  schemaEnsured = true;
}

function pool() {
  return require('./recallWebhookDb').getPool();
}

async function dismissMatch(coachClientId, skeletonId, candidateId) {
  const p = pool();
  if (!p) return { ok: false, error: 'database not available' };
  await ensureSchema(p);
  await p.query(
    `INSERT INTO lead_merge_dismissals (coach_client_id, skeleton_id, candidate_id)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [String(coachClientId), String(skeletonId), String(candidateId)],
  );
  return { ok: true };
}

async function listDismissed(coachClientId) {
  const p = pool();
  if (!p) return new Set();
  await ensureSchema(p);
  const r = await p.query(`SELECT skeleton_id, candidate_id FROM lead_merge_dismissals WHERE coach_client_id = $1`, [String(coachClientId)]);
  return new Set(r.rows.map((x) => `${x.skeleton_id}|${x.candidate_id}`));
}

/**
 * Move every transcript-store link from the skeleton to the surviving record. A meeting already
 * linked to the survivor keeps one link (the duplicate row is dropped, not doubled).
 */
async function repointMeetingLeads(skeletonId, targetId) {
  const p = pool();
  if (!p) return { ok: false, error: 'database not available', moved: 0 };
  const sk = String(skeletonId);
  const tg = String(targetId);
  const moved = await p.query(
    `UPDATE recall_meeting_leads ml SET airtable_lead_id = $2
     WHERE ml.airtable_lead_id = $1
       AND NOT EXISTS (SELECT 1 FROM recall_meeting_leads x WHERE x.meeting_id = ml.meeting_id AND x.airtable_lead_id = $2)`,
    [sk, tg],
  );
  await p.query(`DELETE FROM recall_meeting_leads WHERE airtable_lead_id = $1`, [sk]);
  await p.query(`UPDATE recall_meeting_participants SET airtable_lead_id = $2 WHERE airtable_lead_id = $1`, [sk, tg]);
  return { ok: true, moved: moved.rowCount || 0 };
}

// ---------------------------------------------------------------------------
// The two portal operations
// ---------------------------------------------------------------------------

/**
 * "Possible match" pairs for the New Leads page: each skeleton beside every full record that
 * shares its exact first + last name, minus pairs the coach has already said are different people.
 */
async function listPossibleMatches(base, coachClientId) {
  const skeletons = await listSkeletons(base);
  if (!skeletons.length) return [];
  const dismissed = await listDismissed(coachClientId).catch(() => new Set());
  const out = [];
  for (const sk of skeletons) {
    const f = sk.fields || {};
    let named = [];
    try { named = await findNamedLeadsWithUrl(base, f[F.FIRST], f[F.LAST]); } catch (e) { logger.warn(`possible-match lookup failed for ${sk.id}: ${e.message}`); continue; }
    for (const c of named) {
      if (dismissed.has(`${sk.id}|${c.id}`)) continue;
      const cf = c.fields || {};
      out.push({
        skeleton: {
          id: sk.id,
          name: `${f[F.FIRST] || ''} ${f[F.LAST] || ''}`.trim(),
          email: String(f[F.EMAIL] || '').trim() || null,
          createdTime: sk._rawJson && sk._rawJson.createdTime ? sk._rawJson.createdTime : null,
        },
        candidate: {
          id: c.id,
          name: `${cf[F.FIRST] || ''} ${cf[F.LAST] || ''}`.trim(),
          email: String(cf[F.EMAIL] || '').trim() || null,
          linkedinUrl: String(cf[F.URL] || '').trim() || null,
          headline: String(cf[F.HEADLINE] || '').trim() || null,
          company: String(cf[F.COMPANY] || '').trim() || null,
          location: String(cf[F.LOCATION] || '').trim() || null,
        },
      });
    }
  }
  return out;
}

/**
 * Fold a skeleton into the full record: copy what the skeleton knew (planMerge), move the
 * transcript links, delete the skeleton. Refuses unless the skeleton really has no URL and the
 * target really has one - a wrong merge is worse than a duplicate.
 */
async function mergeSkeletonInto(base, coachClientId, skeletonId, targetId) {
  if (!skeletonId || !targetId || skeletonId === targetId) return { ok: false, error: 'need two different records' };
  const [skeleton, target] = await Promise.all([base(LEADS).find(skeletonId), base(LEADS).find(targetId)]);
  if (!isSkeleton(skeleton)) return { ok: false, error: 'the record to fold in already has a LinkedIn URL - only a record without one can be merged this way' };
  if (isSkeleton(target)) return { ok: false, error: 'the record to keep has no LinkedIn URL - keep the one that does' };

  const fields = planMerge(skeleton, target);
  if (Object.keys(fields).length) await base(LEADS).update([{ id: targetId, fields }]);

  let store = { ok: false, moved: 0 };
  try { store = await repointMeetingLeads(skeletonId, targetId); } catch (e) { logger.warn(`merge ${skeletonId}->${targetId}: store re-point failed: ${e.message}`); }

  await base(LEADS).destroy([skeletonId]);
  logger.info(`merged skeleton ${skeletonId} into ${targetId} for ${coachClientId}: ${Object.keys(fields).join(', ') || 'no field changes'}; ${store.moved} meeting link(s) moved`);
  return { ok: true, targetId, fieldsWritten: Object.keys(fields), meetingsMoved: store.moved };
}

module.exports = {
  // pure
  recordHasEmail, isSkeleton, skeletonByEmailFormula, nameFormula, mergeSearchTerms, planMerge, splitAlts,
  // airtable
  findSkeletonByEmail, findSkeletonsByName, findNamedLeadsWithUrl, listSkeletons,
  // postgres
  dismissMatch, listDismissed, repointMeetingLeads,
  // portal ops
  listPossibleMatches, mergeSkeletonInto,
};
