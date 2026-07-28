// utils/linkedinCanonical.js
// THE one way to decide "are these two LinkedIn profile URLs the same person?" — born from the
// Andrew Bognar / Andrew Byrne collision (2026-07-28): dedup used Airtable SEARCH() (containment),
// so the slug "andrewdb" silently matched "andrewdbyrne" and create_lead handed back the wrong
// human's record. Dedup and lead RESOLUTION must compare canonical slugs with STRICT EQUALITY —
// containment (SEARCH/FIND/includes/startsWith) is only ever a cheap Airtable-side PREFILTER whose
// results get re-verified here. Loose matching remains fine for the UI *search box*; it must never
// share this path's job.
//
// Canonical slug = the /in/<handle> segment: percent-decoded, lowercased, trimmed, with protocol,
// www./country subdomains (au., uk., …), query string, fragment and trailing slashes all ignored.
// A blank/absent URL canonicalises to '' and NEVER matches anything — including another blank.

function canonicalLinkedinSlug(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  try { s = decodeURIComponent(s); } catch (_) { /* malformed %-escape — compare the raw form */ }
  s = s.trim().toLowerCase();
  // Any host variant works: linkedin.com, www.linkedin.com, au.linkedin.com, https or bare.
  const m = s.match(/linkedin\.com\/in\/([^/?#]+)/);
  let slug = m ? m[1] : '';
  if (!slug) {
    // Tolerate "/in/<slug>" with no host, or a bare slug (no separators — so "linkedin.com" alone
    // or free text never sneaks through). Lets lookup callers pass what a user typed.
    const inPath = s.match(/(?:^|\/)in\/([^/?#]+)/);
    if (inPath) slug = inPath[1];
    else if (s && !/[/?#\s.@]/.test(s)) slug = s;
    else return '';
  }
  return slug.replace(/\/+$/, '').trim();
}

// True only when BOTH sides canonicalise to the same non-empty slug.
function sameLinkedinProfile(a, b) {
  const sa = canonicalLinkedinSlug(a);
  return !!sa && sa === canonicalLinkedinSlug(b);
}

// Airtable-side PREFILTER ONLY — a containment formula that narrows candidates cheaply (Airtable
// can't compute the canonical slug server-side). It deliberately over-matches (prefix slugs!), so
// every caller MUST re-verify the returned records with findExactSlugMatch. When the slug has
// non-ASCII characters the stored URL may be percent-encoded, so both spellings are prefiltered.
function slugPrefilterFormula(slug, fieldName = 'LinkedIn Profile URL') {
  const plain = String(slug || '').replace(/["\\]/g, '');
  const encoded = encodeURIComponent(plain).toLowerCase().replace(/["\\]/g, '');
  const one = (needle) => `SEARCH("${needle}", LOWER({${fieldName}}))`;
  return encoded === plain ? one(plain) : `OR(${one(plain)}, ${one(encoded)})`;
}

// The strict-equality half of the prefilter handshake: keep only records whose STORED URL
// canonicalises to exactly `slug`. Blank stored URLs can never survive this.
function findExactSlugMatch(records, slug, fieldName = 'LinkedIn Profile URL') {
  if (!slug) return [];
  return (records || []).filter((r) => canonicalLinkedinSlug(((r && r.fields) || {})[fieldName]) === slug);
}

// For interpolating user-supplied text (e.g. names) into a double-quoted Airtable formula string.
function escapeFormulaText(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

module.exports = { canonicalLinkedinSlug, sameLinkedinProfile, slugPrefilterFormula, findExactSlugMatch, escapeFormulaText };
