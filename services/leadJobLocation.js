// The location LinkedIn attaches to a person's CURRENT ROLE, read out of the scraped page text.
//
// Why this exists: {Location} on a lead record is often a country ("Australia"), which can't be
// mapped to one timezone, so booking stops and asks Guy which city. Twice on 2026-09-16 Guy
// answered by scrolling to the Experience section and reading the location line under the current
// job — an explicit field, not an inference. This makes that read available to Wingguy so it can
// OFFER the answer instead of asking cold.
//
// Where the text comes from: the extension's pageText — the whole visible profile, captured after
// autoScrollToLoad() has forced the lazy Experience section into the DOM. Nothing new is scraped,
// so this needs no extension release; it reads material already arriving on every /wg profile turn.
//
// LinkedIn renders each position as a run of lines:
//     Fractional CISO & DPO            <- title
//     Part-time                        <- employment type (not always present)
//     Apr 2026 - Present · 6 mos       <- date range
//     Melbourne, Victoria, Australia · Remote
//     • Supported a global technology service provider...
// So the location is the first real line AFTER the date range. We anchor on the date range rather
// than on position-from-title, because the employment-type line comes and goes.
//
// CURRENT role only, deliberately: a past role's location is where they worked THEN. John Zhao's
// current role says Melbourne; an old Fonterra row saying Melbourne would be a different claim.
// "· Remote" / "· Hybrid" is a work-mode chip, not part of the place — and on LinkedIn the location
// on a remote role is still the PERSON's location, which is exactly what we want.
//
// currentRoleLocation(pageText) → { location, title, dateLine } | null

// Section headings that mean the Experience list has ended.
const END_SECTIONS = /^(education|skills|licenses?\b|certifications?|volunteering|recommendations?|courses?|projects?|publications?|honors?|awards?|languages?|organizations?|test scores?|patents?|causes?|interests)\b/i;

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
// "Apr 2026 - Present · 6 mos", "Sep 2023 - Nov 2025 · 2 yrs 3 mos". LinkedIn uses a plain hyphen
// here, but accept en/em dashes too in case the rendering changes.
const DATE_RANGE = new RegExp(`^${MONTH}\\.?\\s+\\d{4}\\s*[-–—]\\s*(present|${MONTH}\\.?\\s+\\d{4})\\b`, 'i');

// Lines that sit in the position block but are never the location.
const WORK_MODE = /^(remote|hybrid|on-?site)$/i;
const EMPLOYMENT_TYPE = /^(full-?time|part-?time|self-?employed|contract|freelance|internship|apprenticeship|seasonal|temporary|permanent)$/i;
const SKILLS_LINE = /\bskills?$/i;
const BULLET = /^[•·*\-•▪>]/;

function cleanLine(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Strip the work-mode chip off "Melbourne, Victoria, Australia · Remote" without eating a place
// that legitimately contains a separator.
function stripWorkMode(line) {
  const parts = String(line).split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !WORK_MODE.test(p));
  return kept.join(', ').trim();
}

// Does this line read like a place rather than a stray bit of the position block?
function looksLikeLocation(line) {
  const s = cleanLine(line);
  if (!s || s.length > 120) return false;
  if (BULLET.test(s)) return false;                 // a description bullet
  if (DATE_RANGE.test(s)) return false;             // the next role's dates
  if (EMPLOYMENT_TYPE.test(s)) return false;
  if (SKILLS_LINE.test(s)) return false;            // "Leadership, Cybersecurity and +2 skills"
  if (END_SECTIONS.test(s)) return false;
  if (/^\d/.test(s)) return false;                  // "7 mos", "2 yrs 3 mos"
  if (/\b\d+\s*(yrs?|mos?|years?|months?)\b/i.test(s)) return false;
  if (/^(show|see)\b|\bmore$/i.test(s)) return false; // "…more", "Show all 12 experiences"
  if (!/[a-z]/i.test(s)) return false;
  return true;
}

function currentRoleLocation(pageText) {
  const raw = String(pageText || '');
  if (!raw.trim()) return null;

  const lines = raw.split('\n').map(cleanLine);

  // Start at the Experience heading so an "Apr 2020 - Present" inside an About paragraph can't be
  // mistaken for a position. Without the heading we have no reliable anchor, so bail.
  const startIdx = lines.findIndex((l) => /^experience$/i.test(l));
  if (startIdx === -1) return null;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (END_SECTIONS.test(line)) break;             // out of Experience, stop looking
    if (!DATE_RANGE.test(line)) continue;

    // Only the CURRENT role — see the note at the top.
    if (!/\bpresent\b/i.test(line)) continue;

    // The location is the next real line. Allow a blank or two, but give up quickly: if the role
    // has no location line at all, the next real line is the description, which looksLikeLocation
    // rejects, and we move on to the next current role rather than inventing one.
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cand = lines[j];
      if (!cand) continue;
      if (!looksLikeLocation(cand)) break;
      const location = stripWorkMode(cand);
      if (!location) break;
      // Walk back for the title: the nearest real line above the date range that isn't the
      // employment type. Purely for telling Guy WHERE the answer came from.
      let title = '';
      for (let k = i - 1; k >= startIdx && k >= i - 3; k--) {
        const t = lines[k];
        if (!t || EMPLOYMENT_TYPE.test(t)) continue;
        title = t;
        break;
      }
      return { location, title, dateLine: line };
    }
  }
  return null;
}

module.exports = { currentRoleLocation };
