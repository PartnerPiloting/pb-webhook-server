/**
 * A lead's TAGS - the {Search Terms} chips on their CRM record.
 *
 * WHY (Guy, 2026-09-17): the tags are not just a search filter, they define LIST MEMBERSHIP - the
 * Mindset Mastery newsletter goes to whoever carries the `mindset mastery` chip. So "take Martin off
 * the list" is a tag edit. The Portal's chip editor could already do it
 * (PATCH /api/linkedin/leads/:id/search-terms) but nothing else could, which meant an unsubscribe
 * arriving by email was a trip to the Portal by hand - or a waiver of the standing "no CRM writes
 * through the Airtable connector" rule. This is that same merge, lifted out so the MCP tool and the
 * Portal route can share ONE implementation instead of drifting apart.
 *
 * The shape on the record is two fields kept in step:
 *   {Search Terms}              display casing, comma-separated - what the coach reads
 *   {Search Tokens (canonical)} lowercased, comma-separated     - what the search formulae match on
 * Older bases spell these {Search Term} / {Search Tokens}, hence the write ladder below.
 */

// Airtable's chip editor caps a lead at 15 terms; past that the record stops being a segment and
// starts being a junk drawer. Adds beyond the cap are REPORTED, not silently dropped.
const MAX_TAGS = 15;

const norm = (s) => (s == null ? '' : String(s)).trim().replace(/\s+/g, ' ');
const normLower = (s) => norm(s).toLowerCase();

/** Split a cell that may arrive as an array (multi-select) or a comma-separated string. */
function splitCell(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return parts.map(norm).filter(Boolean);
}

/** Accept tags as an array OR a single comma-separated string, so either call style works. */
function asList(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return arr.map(norm).filter(Boolean);
}

/**
 * The merge itself - PURE, so it can be tested without an Airtable base.
 *
 * Removes run BEFORE adds, so re-adding a tag in the same call ends with it present. Existing tags
 * keep the casing already on the record; a genuinely new one keeps the casing it was passed with.
 *
 * Returns { display, canonical, tokens, added, removed, overflow, changed } where `added`/`removed`
 * are what ACTUALLY changed (not what was asked) and `overflow` lists adds refused by the cap.
 */
function mergeTags({ displayRaw, canonicalRaw, add = [], remove = [] } = {}) {
  const displayTokensBefore = splitCell(displayRaw);

  // Canonical is the source of truth when it is populated; a base that has never had it written
  // falls back to the display cell so the merge still works on the tags actually shown.
  let tokens = splitCell(canonicalRaw).map(normLower);
  if (!tokens.length) tokens = displayTokensBefore.map(normLower);

  const seen = new Set();
  tokens = tokens.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  const before = new Set(tokens);

  const addList = asList(add);
  const removeSet = new Set(asList(remove).map(normLower));

  const removed = tokens.filter((t) => removeSet.has(t));
  tokens = tokens.filter((t) => !removeSet.has(t));

  const added = [];
  const overflow = [];
  for (const raw of addList) {
    const t = normLower(raw);
    if (tokens.includes(t)) continue;
    if (tokens.length >= MAX_TAGS) { overflow.push(norm(raw)); continue; }
    tokens.push(t);
    added.push(t);
  }

  // Display casing: whatever the record already used, else however the caller typed the new tag.
  const display = tokens.map((t) => {
    const existing = displayTokensBefore.find((d) => d.toLowerCase() === t);
    if (existing) return existing;
    const asTyped = addList.find((a) => normLower(a) === t);
    return asTyped ? norm(asTyped) : t;
  });

  const changed = removed.length > 0 || added.length > 0
    || tokens.length !== before.size || tokens.some((t) => !before.has(t));

  return {
    display: display.join(', '),
    canonical: tokens.join(', '),
    tokens,
    added,
    removed,
    overflow,
    changed,
  };
}

/**
 * Apply a tag change to a lead record and write it back.
 *
 * `base` is an already-scoped Airtable base handle (the caller owns tenancy - this never resolves a
 * client). Returns { ok, changed, before, display, canonical, tokens, added, removed, overflow }, or
 * { ok:false, error }. A no-op is still ok:true with changed:false - nothing is written.
 */
async function updateLeadTags(base, leadRecordId, { add = [], remove = [] } = {}) {
  if (!base) return { ok: false, error: 'CRM base unavailable' };
  if (!leadRecordId) return { ok: false, error: 'no lead record to tag' };
  if (!asList(add).length && !asList(remove).length) {
    return { ok: false, error: 'nothing to change - pass tags to add and/or remove' };
  }

  const rec = await base('Leads').find(leadRecordId);
  if (!rec) return { ok: false, error: 'lead not found' };

  const displayRaw = rec.fields['Search Terms'] || rec.fields['Search Term'] || '';
  const canonicalRaw = rec.fields['Search Tokens (canonical)'] || rec.fields['Search Tokens'] || '';
  const before = splitCell(displayRaw).join(', ');

  const merged = mergeTags({ displayRaw, canonicalRaw, add, remove });
  if (!merged.changed) {
    return { ok: true, changed: false, before, ...merged };
  }

  // Bases differ on which of these fields exist; try the richest shape first and fall back rather
  // than failing the whole write because one column is missing (same ladder as the Portal route).
  const attempts = [
    { 'Search Terms': merged.display, 'Search Tokens (canonical)': merged.canonical },
    { 'Search Terms': merged.display },
    { 'Search Term': merged.display, 'Search Tokens (canonical)': merged.canonical },
    { 'Search Term': merged.display },
    { 'Search Tokens (canonical)': merged.canonical },
    { 'Search Tokens': merged.canonical },
  ];
  const errors = [];
  for (const fields of attempts) {
    try {
      const updated = await base('Leads').update([{ id: leadRecordId, fields }]);
      if (updated && updated.length) return { ok: true, changed: true, before, ...merged };
    } catch (e) {
      errors.push(`${Object.keys(fields).join('+')}: ${e.message}`);
    }
  }
  return { ok: false, error: `the tags could not be written (${errors.join(' | ')})` };
}

module.exports = { mergeTags, updateLeadTags, splitCell, asList, MAX_TAGS };
